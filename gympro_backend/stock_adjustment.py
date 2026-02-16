from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import BigInteger, MetaData, Table, and_, cast, insert, select
from sqlalchemy.exc import SQLAlchemyError

from auth import User, get_current_user
from db import engine
from logger import get_logger

logger = get_logger()

router = APIRouter(tags=["stock-adjustment"])


# Reflection is expensive on MySQL; cache reflected tables per process.
_REFLECT_MD = MetaData()
_TABLE_CACHE: Dict[str, Table] = {}


def _resolve_scope_from_user(user: User, account_code: Optional[str], retail_code: Optional[str]) -> Tuple[str, str]:
    acct = (account_code or getattr(user, "account_code", None) or "").strip()
    retail = (retail_code or getattr(user, "retail_code", None) or "").strip()
    if not acct or not retail:
        raise HTTPException(status_code=400, detail="account_code and retail_code are required")
    if getattr(user, "account_code", None) and acct != user.account_code:
        raise HTTPException(status_code=403, detail="account_code not allowed")
    if getattr(user, "retail_code", None) and retail != user.retail_code:
        raise HTTPException(status_code=403, detail="retail_code not allowed")
    return acct, retail


def _reflect_table(name: str) -> Table:
    cached = _TABLE_CACHE.get(name)
    if cached is not None:
        return cached

    try:
        tbl = Table(name, _REFLECT_MD, autoload_with=engine, extend_existing=True)
        _TABLE_CACHE[name] = tbl
        return tbl
    except Exception as e:
        logger.error(f"[STOCK_ADJUSTMENT] Missing table '{name}': {e}")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Required table '{name}' not found. "
                "Create the table(s) stock_adjustment and stock_adjustment_summary and retry."
            ),
        )


def _to_decimal(v: Any, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if v is None or v == "":
            return default
        if isinstance(v, Decimal):
            return v
        return Decimal(str(v))
    except Exception:
        return default


def _next_adjustment_id(conn, header_tbl: Table, acct: str, retail: str) -> str:
    """Generate next numeric adjustment_id for an account+retail scope.

    Requirement: adjustment_id = max(adjustment_id) + 1 within (account_code, retail_code)
    with no prefix. Stored as string in DB.
    """
    # MySQL: casting VARCHAR to UNSIGNED works with CAST(col AS UNSIGNED).
    # SQLAlchemy uses CAST(col AS BIGINT) which maps appropriately.
    max_stmt = (
        select(
            header_tbl.c.adjustment_id,
            cast(header_tbl.c.adjustment_id, BigInteger).label("adj_num"),
        )
        .where(and_(header_tbl.c.account_code == acct, header_tbl.c.retail_code == retail))
        .order_by(cast(header_tbl.c.adjustment_id, BigInteger).desc())
        .limit(1)
    )
    row = conn.execute(max_stmt).first()
    current_max = None
    if row is not None:
        # row[1] is adj_num; may be None if casting fails
        current_max = row[1]
    try:
        next_num = int(current_max or 0) + 1
    except Exception:
        next_num = 1
    return str(next_num)


class StockAdjustmentLine(BaseModel):
    item_id: str = Field(..., min_length=1)
    item_name: str = Field(..., min_length=1)
    variant_id: Optional[str] = None
    variant_name: Optional[str] = None
    current_qty: Decimal = Field(...)
    adjustment_qty: Decimal = Field(...)


class StockAdjustmentCreateRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None
    adjustment_id: Optional[str] = None
    adjustment_date: Optional[date] = None
    remarks: Optional[str] = None
    lines: List[StockAdjustmentLine] = Field(default_factory=list)


@router.post("/stock-adjustment/create")
def create_stock_adjustment(req: StockAdjustmentCreateRequest, user: User = Depends(get_current_user)):
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    lines_in = req.lines or []
    normalized: List[Dict[str, Any]] = []
    for ln in lines_in:
        adj = _to_decimal(ln.adjustment_qty)
        if adj == 0:
            continue
        current = _to_decimal(ln.current_qty)
        item_id = (ln.item_id or "").strip()
        item_name = (ln.item_name or "").strip()
        if not item_id or not item_name:
            continue
        variant_id = (ln.variant_id or "").strip() or None
        variant_name = (ln.variant_name or "").strip() or None
        normalized.append(
            {
                "item_id": item_id,
                "item_name": item_name,
                "variant_id": variant_id,
                "variant_name": variant_name,
                "current_qty": current,
                "adjustment_qty": adj,
            }
        )

    if not normalized:
        raise HTTPException(status_code=400, detail="Add at least one item with non-zero adjustment")

    provided_adj_id = (req.adjustment_id or "").strip()
    if provided_adj_id and not provided_adj_id.isdigit():
        raise HTTPException(status_code=400, detail="adjustment_id must be numeric")
    adjustment_date = req.adjustment_date or date.today()
    remarks = (req.remarks or "").strip() or None

    header_tbl = _reflect_table("stock_adjustment")
    lines_tbl = _reflect_table("stock_adjustment_summary")

    try:
        # Retry a couple of times in case of concurrent inserts causing duplicate adjustment_id
        for _ in range(3):
            with engine.begin() as conn:
                adjustment_id = provided_adj_id or _next_adjustment_id(conn, header_tbl, acct, retail)

                header_payload: Dict[str, Any] = {
                    "account_code": acct,
                    "retail_code": retail,
                    "adjustment_id": adjustment_id,
                    "adjustment_date": adjustment_date,
                    "remarks": remarks,
                    "created_by": getattr(user, "username", None),
                }
                allowed_header = set(header_tbl.c.keys())
                header_payload = {k: v for k, v in header_payload.items() if k in allowed_header and v is not None}

                conn.execute(insert(header_tbl).values(**header_payload))

                allowed_line = set(lines_tbl.c.keys())
                line_rows: List[Dict[str, Any]] = []
                for ln in normalized:
                    row = {
                        "account_code": acct,
                        "retail_code": retail,
                        "adjustment_id": adjustment_id,
                        "adjustment_date": adjustment_date,
                        **ln,
                    }
                    line_rows.append({k: v for k, v in row.items() if k in allowed_line and v is not None})

                conn.execute(insert(lines_tbl), line_rows)

            return {
                "success": True,
                "data": {
                    "adjustment_id": adjustment_id,
                    "adjustment_date": str(adjustment_date),
                    "line_count": len(normalized),
                },
            }

        raise HTTPException(status_code=409, detail="Unable to allocate unique adjustment_id. Please retry.")
    except SQLAlchemyError as e:
        logger.error(f"[STOCK_ADJUSTMENT][CREATE] SQL error: {e}")
        # Give a nicer message for duplicate adjustment_id
        msg = str(e)
        if "uk_adjustment" in msg or "Duplicate" in msg:
            # If user provided adjustment_id, it is a hard conflict.
            if provided_adj_id:
                raise HTTPException(status_code=409, detail="Duplicate adjustment_id")
            # Otherwise allow caller to retry; our loop may not have captured this exception depending on driver.
            raise HTTPException(status_code=409, detail="Duplicate adjustment_id. Please retry.")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[STOCK_ADJUSTMENT][CREATE] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
