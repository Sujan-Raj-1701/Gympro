from fastapi import HTTPException
from sqlalchemy import select, and_
from sqlalchemy.exc import SQLAlchemyError
from typing import List, Dict, Any
from db import engine
from sqlalchemy import MetaData, Table
import os
import time
import threading

# NOTE:
#   Reading previously used the shared global metadata passed in from callers.
#   After a schema change (e.g. dropping columns start_datetime/end_datetime and
#   adding eventdate) the first reflected Table object cached in that metadata
#   continued to list old columns, causing SELECT statements to reference
#   columns that no longer exist (MySQL 1054 Unknown column ...).
#   To make reads resilient to live schema tweaks during development, we now
#   perform reflection against a fresh MetaData() per table fetch. This avoids
#   stale column definitions without requiring an application restart.

# Reflection is expensive (hits information_schema). To speed up hot paths like
# the /read endpoint, we keep a short-lived in-memory cache of reflected Table
# objects. If the schema changes while the app is running, reads will refresh
# automatically after TTL, and we also retry once on SQL errors.
_TABLE_REFLECTION_CACHE_TTL_SECONDS = int(os.getenv("TABLE_REFLECTION_CACHE_TTL_SECONDS", "60"))
_TABLE_CACHE_LOCK = threading.Lock()
_TABLE_CACHE: Dict[str, Any] = {}

# Some deployments use different physical table names for the same logical master.
# The frontend generally requests the canonical name (e.g., 'master_paymentmodes'),
# so we transparently fall back to alternate names when reflecting.
_TABLE_NAME_ALIASES: Dict[str, List[str]] = {
    # Payment modes / paymodes
    "master_paymentmodes": [
        "master_paymentmodes",
        "master_payment_mode",
        "master_paymode",
        "master_payment_modes",
        "payment_modes",
        "payment_mode_master",
    ],
}


def _cache_get(table_name: str):
    now = time.time()
    with _TABLE_CACHE_LOCK:
        entry = _TABLE_CACHE.get(table_name)
        if not entry:
            return None
        ts, tbl = entry
        if _TABLE_REFLECTION_CACHE_TTL_SECONDS > 0 and (now - ts) <= _TABLE_REFLECTION_CACHE_TTL_SECONDS:
            return tbl
        # Expired
        _TABLE_CACHE.pop(table_name, None)
        return None


def _cache_set(table_name: str, table_obj: Table) -> None:
    with _TABLE_CACHE_LOCK:
        _TABLE_CACHE[table_name] = (time.time(), table_obj)

def get_table(metadata, table_name: str, *, force_refresh: bool = False):
    """Return a freshly reflected Table object.

    The incoming metadata parameter is ignored intentionally to prevent reuse
    of a possibly stale Table definition held in the shared metadata registry.
    """
    try:
        if not force_refresh:
            cached = _cache_get(table_name)
            if cached is not None:
                return cached
        fresh_md = MetaData()
        tbl = Table(table_name, fresh_md, autoload_with=engine)
        _cache_set(table_name, tbl)
        return tbl
    except Exception:
        raise HTTPException(status_code=400, detail=f"Table '{table_name}' not found.")


def get_table_with_fallback(metadata, table_name: str, *, force_refresh: bool = False):
    """Resolve a requested table name to an existing table using alias fallbacks."""
    candidates = _TABLE_NAME_ALIASES.get(table_name, [table_name])
    last_exc: Exception | None = None
    for cand in candidates:
        try:
            tbl = get_table(metadata, cand, force_refresh=force_refresh)
            # Also cache under the requested name to speed subsequent lookups.
            if cand != table_name:
                _cache_set(table_name, tbl)
            return tbl
        except Exception as e:
            last_exc = e
            continue
    # Preserve original error semantics
    if isinstance(last_exc, HTTPException):
        raise last_exc
    raise HTTPException(status_code=400, detail=f"Table '{table_name}' not found.")


def _execute_read(conn, stmt):
    # Use SQLAlchemy mappings for a faster dict conversion.
    return [dict(r) for r in conn.execute(stmt).mappings().all()]

def read_rows(metadata, tables: List[str], account_code: str, retail_code: str) -> Dict[str, Any]:
    if not tables:
        raise HTTPException(status_code=400, detail="At least one table must be specified.")
    try:
        # If only one table requested, keep existing behavior (with optional scoping by account/retail)
        if len(tables) == 1:
            tname = tables[0]
            tbl = get_table_with_fallback(metadata, tname)
            cols = {c.name for c in tbl.columns}
            conditions = []
            if 'account_code' in cols:
                conditions.append(tbl.c.account_code == account_code)
            if 'retail_code' in cols:
                conditions.append(tbl.c.retail_code == retail_code)

            base_select = select(*tbl.columns)
            stmt = base_select.where(and_(*conditions)) if conditions else base_select

            # Apply is_active filter specifically for modules table
            if tbl.name.lower() == 'modules' and 'is_active' in cols:
                stmt = stmt.where(tbl.c.is_active == 1)

            with engine.begin() as conn:
                try:
                    rows = _execute_read(conn, stmt)
                except SQLAlchemyError:
                    # Schema may have changed; refresh reflection and retry once.
                    tbl = get_table_with_fallback(metadata, tname, force_refresh=True)
                    cols = {c.name for c in tbl.columns}
                    conditions = []
                    if 'account_code' in cols:
                        conditions.append(tbl.c.account_code == account_code)
                    if 'retail_code' in cols:
                        conditions.append(tbl.c.retail_code == retail_code)
                    base_select = select(*tbl.columns)
                    stmt = base_select.where(and_(*conditions)) if conditions else base_select

                    if tbl.name.lower() == 'modules' and 'is_active' in cols:
                        stmt = stmt.where(tbl.c.is_active == 1)

                    rows = _execute_read(conn, stmt)
            return {"success": True, "data": rows}

        # When multiple tables are requested, return a mapping of table->rows so clients can
        # fetch several lookup tables in a single request without joining them.
        response_map: Dict[str, Any] = {}
        with engine.begin() as conn:
            for tname in tables:
                tbl = get_table_with_fallback(metadata, tname)
                cols = {c.name for c in tbl.columns}
                conditions = []
                if 'account_code' in cols:
                    conditions.append(tbl.c.account_code == account_code)
                if 'retail_code' in cols:
                    conditions.append(tbl.c.retail_code == retail_code)
                sel = select(*tbl.columns)
                stmt = sel.where(and_(*conditions)) if conditions else sel

                if tbl.name.lower() == 'modules' and 'is_active' in cols:
                    stmt = stmt.where(tbl.c.is_active == 1)

                try:
                    rows = _execute_read(conn, stmt)
                except SQLAlchemyError:
                    tbl = get_table_with_fallback(metadata, tname, force_refresh=True)
                    cols = {c.name for c in tbl.columns}
                    conditions = []
                    if 'account_code' in cols:
                        conditions.append(tbl.c.account_code == account_code)
                    
                    if tbl.name.lower() == 'modules' and 'is_active' in cols:
                        stmt = stmt.where(tbl.c.is_active == 1)

                    if 'retail_code' in cols:
                        conditions.append(tbl.c.retail_code == retail_code)
                    sel = select(*tbl.columns)
                    stmt = sel.where(and_(*conditions)) if conditions else sel
                    rows = _execute_read(conn, stmt)
                # Key by requested name so frontend lookups remain stable even if a fallback table was used.
                response_map[tname] = rows
        return {"success": True, "data": response_map}
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=str(e))

def read_businessmaster_data(metadata, tables: List[str]) -> Dict[str, Any]:
    """
    Read master/public tables without requiring account/retail credentials.

    Behavior mirrors /read:
      - Single table => data is a list of row dicts
      - Multiple tables => data is a mapping of table_name -> list of row dicts

    NOTE: We DO NOT join tables. Each table is fetched independently so lookups can
    be requested together (e.g., ["modules", "roles"]).
    """
    if not tables:
        raise HTTPException(status_code=400, detail="At least one table must be specified.")

    try:
        if len(tables) == 1:
            tname = tables[0]
            tbl = get_table(metadata, tname)
            # Apply is_active filter specifically for modules table
            stmt = select(*tbl.columns)
            if tbl.name.lower() == 'modules':
                cols = set(c.name for c in tbl.columns)
                if 'is_active' in cols:
                    stmt = stmt.where(tbl.c.is_active == 1)
            with engine.begin() as conn:
                try:
                    rows = _execute_read(conn, stmt)
                except SQLAlchemyError:
                    tbl = get_table(metadata, tname, force_refresh=True)
                    stmt = select(*tbl.columns)
                    if tbl.name.lower() == 'modules':
                        cols = set(c.name for c in tbl.columns)
                        if 'is_active' in cols:
                            stmt = stmt.where(tbl.c.is_active == 1)
                    rows = _execute_read(conn, stmt)
            return {"success": True, "data": rows}

        # Multiple tables: return a dict mapping
        response_map: Dict[str, Any] = {}
        with engine.begin() as conn:
            for tname in tables:
                tbl = get_table(metadata, tname)
                stmt = select(*tbl.columns)
                # Apply is_active filter specifically for modules table
                if tbl.name.lower() == 'modules':
                    cols = set(c.name for c in tbl.columns)
                    if 'is_active' in cols:
                        stmt = stmt.where(tbl.c.is_active == 1)
                try:
                    rows = _execute_read(conn, stmt)
                except SQLAlchemyError:
                    tbl = get_table(metadata, tname, force_refresh=True)
                    stmt = select(*tbl.columns)
                    if tbl.name.lower() == 'modules':
                        cols = set(c.name for c in tbl.columns)
                        if 'is_active' in cols:
                            stmt = stmt.where(tbl.c.is_active == 1)
                    rows = _execute_read(conn, stmt)
                response_map[tbl.name] = rows
        return {"success": True, "data": response_map}
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=str(e))