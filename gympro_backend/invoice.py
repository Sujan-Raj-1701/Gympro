from typing import List, Optional, Dict, Any
import time
import traceback
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import MetaData, Table, insert, select, update as sql_update, and_, func, cast, String
from sqlalchemy import Integer as SAInteger
from sqlalchemy.exc import SQLAlchemyError
from db import engine
from logger import get_logger

logger = get_logger()

_metadata_cache: Optional[MetaData] = None
_table_cache: Optional[Table] = None
_txn_table_cache: Optional[Table] = None
_paymode_table_cache: Optional[Table] = None
_master_customer_cache: Optional[Table] = None
_master_payment_modes_cache: Optional[Table] = None
_packages_table_cache: Optional[Table] = None
_inventory_table_cache: Optional[Table] = None


def _serialize_ts(val: Any) -> Any:
    """Serialize a timestamp value to ISO8601 with explicit +05:30 offset (IST).

    Rules:
    - If value is not a datetime, return as-is.
    - If naive datetime, assume it is stored in local IST already (do NOT add extra offset).
    - If timezone-aware, convert to IST directly.
    - Output truncated to milliseconds for compactness
    """
    try:
        if not isinstance(val, datetime):
            return val
        ist_offset = timedelta(hours=5, minutes=30)
        ist_tz = timezone(ist_offset)
        if val.tzinfo is None:
            # Treat naive as IST (as DB stores local time), only attach tzinfo without shifting
            val = val.replace(tzinfo=ist_tz)
        else:
            val = val.astimezone(ist_tz)
        # Truncate microseconds to milliseconds
        ms = int(val.microsecond / 1000)
        return f"{val.strftime('%Y-%m-%dT%H:%M:%S')}.{ms:03d}+05:30"
    except Exception:
        return val


def _get_table() -> Table:
    global _metadata_cache, _table_cache
    if _table_cache is not None:
        return _table_cache
    try:
        md = MetaData()
        _table_cache = Table('billing_trans_summary', md, autoload_with=engine)
        _metadata_cache = md
        return _table_cache
    except Exception as e:
        logger.error(f"[INVOICE] Failed reflecting table billing_trans_summary: {e}")
        raise HTTPException(status_code=500, detail="billing_trans_summary table not found")


def _get_packages_table() -> Optional[Table]:
    """Reflect and cache billing_trans_packages if present."""
    global _packages_table_cache
    if _packages_table_cache is not None:
        return _packages_table_cache
    try:
        md = MetaData()
        _packages_table_cache = Table('billing_trans_packages', md, autoload_with=engine)
        return _packages_table_cache
    except Exception as e:
        logger.debug(f"[INVOICE] billing_trans_packages table not found: {e}")
        return None


def _get_inventory_table() -> Optional[Table]:
    """Reflect and cache billing_trans_inventory if present."""
    global _inventory_table_cache
    if _inventory_table_cache is not None:
        return _inventory_table_cache
    try:
        md = MetaData()
        _inventory_table_cache = Table('billing_trans_inventory', md, autoload_with=engine)
        return _inventory_table_cache
    except Exception as e:
        logger.debug(f"[INVOICE] billing_trans_inventory table not found: {e}")
        return None


def _parse_yyyymmdd(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        return datetime.strptime(str(val).strip(), '%Y-%m-%d')
    except Exception:
        return None


def _pick_date_column(tbl: Table) -> Optional[Any]:
    # Prefer created_at for range filters; fall back to updated_at; then common alternates.
    for cname in ['created_at', 'updated_at', 'date', 'entry_date', 'billing_date']:
        if cname in tbl.c.keys():
            return getattr(tbl.c, cname)
    return None


def list_billing_lines(
    table_kind: str,
    account_code: str,
    retail_code: str,
    limit: int = 1000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> Dict[str, Any]:
    """List raw line rows from services/packages/inventory tables with consistent filters.

    table_kind:
      - 'services' => billing_trans_summary
      - 'packages' => billing_trans_packages
      - 'inventory' => billing_trans_inventory
    """
    if not account_code or not retail_code:
        raise HTTPException(status_code=400, detail="account_code and retail_code required")

    kind = (table_kind or '').strip().lower()
    if kind == 'services':
        tbl = _get_table()
    elif kind == 'packages':
        tbl = _get_packages_table()
    elif kind == 'inventory':
        tbl = _get_inventory_table()
    else:
        raise HTTPException(status_code=400, detail="Invalid table_kind")

    if tbl is None:
        return {"success": False, "message": f"{kind} table not available", "count": 0, "timezone": "IST", "data": []}

    stmt = select(tbl)
    conds = []
    if 'account_code' in tbl.c.keys():
        conds.append(tbl.c.account_code == account_code)
    if 'retail_code' in tbl.c.keys():
        conds.append(tbl.c.retail_code == retail_code)
    if conds:
        stmt = stmt.where(and_(*conds))

    if invoice_id and 'invoice_id' in tbl.c.keys():
        stmt = stmt.where(tbl.c.invoice_id == invoice_id)

    date_col = _pick_date_column(tbl)
    start_dt = _parse_yyyymmdd(from_date)
    end_dt = _parse_yyyymmdd(to_date)
    if date_col is not None:
        if start_dt is not None:
            stmt = stmt.where(date_col >= start_dt)
        if end_dt is not None:
            stmt = stmt.where(date_col < (end_dt + timedelta(days=1)))

        try:
            stmt = stmt.order_by(date_col.desc())
        except Exception:
            pass
    else:
        # Best-effort ordering
        for cname in ['updated_at', 'created_at', 'id', 'sequence_id']:
            if cname in tbl.c.keys():
                try:
                    stmt = stmt.order_by(getattr(tbl.c, cname).desc())
                except Exception:
                    pass
                break

    if offset and offset > 0:
        stmt = stmt.offset(offset)
    stmt = stmt.limit(limit)

    with engine.begin() as conn:
        rows = [dict(r._mapping) for r in conn.execute(stmt).fetchall()]

    for r in rows:
        for k, v in list(r.items()):
            if isinstance(k, str) and k.endswith('_at'):
                r[k] = _serialize_ts(v)

    return {"success": True, "count": len(rows), "timezone": "IST", "data": rows}


def _get_txn_table() -> Optional[Table]:
    """Reflect and cache the invoice level transactions table if present.

    We keep this optional so environments without the table still work.
    """
    global _txn_table_cache
    if _txn_table_cache is not None:
        return _txn_table_cache
    try:
        md = MetaData()
        _txn_table_cache = Table('billing_transactions', md, autoload_with=engine)
        return _txn_table_cache
    except Exception:
        logger.warning("[INVOICE] billing_transactions table not found; combined summary will exclude header data")
        return None


def _get_paymode_table() -> Optional[Table]:
    """Reflect and cache the billing_paymode table if present.

            # single payment field removed; use `payments` instead
    """
    global _paymode_table_cache
    if _paymode_table_cache is not None:
        return _paymode_table_cache
    try:
        md = MetaData()
        _paymode_table_cache = Table('billing_paymode', md, autoload_with=engine)
        logger.debug(f"[INVOICE] billing_paymode table found with {len(_paymode_table_cache.c)} columns")
        return _paymode_table_cache
    except Exception as e:
        logger.debug(f"[INVOICE] billing_paymode table not found: {e}")
        return None


def _get_master_payment_modes_table() -> Optional[Table]:
    """Reflect and cache the master payment modes table if present.

    Different deployments may use different table names.
    """
    global _master_payment_modes_cache
    if _master_payment_modes_cache is not None:
        return _master_payment_modes_cache

    md = MetaData()
    for table_name in ['master_paymentmodes', 'master_payment_mode', 'master_paymode']:
        try:
            _master_payment_modes_cache = Table(table_name, md, autoload_with=engine)
            logger.debug(f"[INVOICE] {table_name} table found with {len(_master_payment_modes_cache.c)} columns")
            return _master_payment_modes_cache
        except Exception:
            continue

    logger.debug("[INVOICE] master payment modes table not found")
    return None


def _get_master_customer_table() -> Optional[Table]:
    """Reflect and cache the master_customer table if present."""
    global _master_customer_cache
    if _master_customer_cache is not None:
        return _master_customer_cache
    try:
        md = MetaData()
        _master_customer_cache = Table('master_customer', md, autoload_with=engine)
        return _master_customer_cache
    except Exception:
        logger.debug("[CUSTOMER] master_customer table not found")
        return None


def _upsert_master_customer(
    conn,
    account_code: Optional[str],
    retail_code: Optional[str],
    first_line_dict: Dict[str, Any],
    username: str,
    *,
    increment_visit: bool = True,
    apply_credit: bool = True,
) -> Optional[Any]:
    """Upsert customer details from billing into master_customer.

    Notes:
    - `apply_credit=False` is used on invoice edits so we don't double-add credit.
    - Credit adjustments on edit are handled via invoice-level wallet-ledger reconciliation.
    """
    mc_tbl = _get_master_customer_table()
    if mc_tbl is None:
        return None

    mc_cols = set(mc_tbl.c.keys())

    cust_id = first_line_dict.get('customer_id')
    name_in = first_line_dict.get('customer_name') or first_line_dict.get('full_name') or first_line_dict.get('name')
    phone_in = (
        first_line_dict.get('customer_number')
        or first_line_dict.get('customer_mobile')
        or first_line_dict.get('customer_phone')
        or first_line_dict.get('custumer_number')
    )

    # Normalize gender from payload
    gender_in_raw = (first_line_dict.get('customer_gender') or first_line_dict.get('gender') or '')
    try:
        gin = str(gender_in_raw or '').strip().lower()
    except Exception:
        gin = ''
    if gin in ('male', 'm', '1'):
        gender_norm = 'Male'
    elif gin in ('female', 'f', '2'):
        gender_norm = 'Female'
    elif gin:
        gender_norm = 'Other'
    else:
        gender_norm = ''

    # Credit amount from incoming payload
    credit_amount_in = first_line_dict.get('credit_amount', 0)
    try:
        credit_amount_in = float(credit_amount_in or 0)
    except Exception:
        credit_amount_in = 0.0

    # Build update/insert row using available columns
    row: Dict[str, Any] = {}
    for cand in ['customer_name', 'full_name', 'name']:
        if cand in mc_cols and name_in not in (None, ''):
            row[cand] = name_in
            break
    for cand in ['phone', 'mobile', 'customer_phone', 'customer_mobile', 'customer_number', 'custumer_number']:
        if cand in mc_cols and phone_in not in (None, ''):
            row[cand] = phone_in
            break
    if 'account_code' in mc_cols and account_code not in (None, ''):
        row['account_code'] = account_code
    if 'retail_code' in mc_cols and retail_code not in (None, ''):
        row['retail_code'] = retail_code
    if 'membership_id' in mc_cols and first_line_dict.get('membership_id') not in (None, ''):
        row['membership_id'] = first_line_dict.get('membership_id')
    if 'membership_cardno' in mc_cols and first_line_dict.get('membership_cardno') not in (None, ''):
        row['membership_cardno'] = first_line_dict.get('membership_cardno')
    if 'card_number' in mc_cols and 'membership_cardno' not in row and first_line_dict.get('membership_cardno') not in (None, ''):
        row['card_number'] = first_line_dict.get('membership_cardno')
    if 'birthday_date' in mc_cols and first_line_dict.get('birthday_date') not in (None, ''):
        row['birthday_date'] = first_line_dict.get('birthday_date')
    if 'anniversary_date' in mc_cols and first_line_dict.get('anniversary_date') not in (None, ''):
        row['anniversary_date'] = first_line_dict.get('anniversary_date')
    if 'address' in mc_cols and first_line_dict.get('address') not in (None, ''):
        row['address'] = first_line_dict.get('address')
    elif 'customer_address' in mc_cols and first_line_dict.get('address') not in (None, ''):
        row['customer_address'] = first_line_dict.get('address')
    if gender_norm:
        for cand in ['gender', 'customer_gender']:
            if cand in mc_cols:
                row[cand] = gender_norm
                break
    
    # Physical stats enrichment
    if 'age' in mc_cols:
        age_in = first_line_dict.get('age')
        if age_in is not None:
            try:
                row['age'] = int(age_in)
            except Exception:
                pass
    if 'height_cm' in mc_cols:
        h_in = first_line_dict.get('height_cm') or first_line_dict.get('height')
        if h_in is not None:
            try:
                row['height_cm'] = float(h_in)
            except Exception:
                pass
    if 'weight_kg' in mc_cols:
        w_in = first_line_dict.get('weight_kg') or first_line_dict.get('weight')
        if w_in is not None:
            try:
                row['weight_kg'] = float(w_in)
            except Exception:
                pass

    if 'updated_by' in mc_cols:
        row['updated_by'] = username
    if 'updated_at' in mc_cols:
        row['updated_at'] = func.now()

    if not row:
        return None

    try:
        target_stmt = None
        if cust_id not in (None, '', 0, '0') and 'customer_id' in mc_cols:
            sel_cols = [mc_tbl.c.id]
            if 'customer_visitcnt' in mc_cols:
                sel_cols.append(mc_tbl.c.customer_visitcnt)
            if 'customer_credit' in mc_cols:
                sel_cols.append(mc_tbl.c.customer_credit)
            target_stmt = select(*sel_cols)
            target_stmt = target_stmt.where(mc_tbl.c.customer_id == str(cust_id))
            if 'account_code' in mc_cols and account_code not in (None, ''):
                target_stmt = target_stmt.where(mc_tbl.c.account_code == account_code)
            if 'retail_code' in mc_cols and retail_code not in (None, ''):
                target_stmt = target_stmt.where(mc_tbl.c.retail_code == retail_code)

        existing = conn.execute(target_stmt).first() if target_stmt is not None else None
        if existing:
            upd_vals = dict(row)

            if increment_visit and 'customer_visitcnt' in mc_cols:
                current_visitcnt = getattr(existing, 'customer_visitcnt', None) or 0
                try:
                    current_visitcnt = int(current_visitcnt)
                except Exception:
                    current_visitcnt = 0
                upd_vals['customer_visitcnt'] = current_visitcnt + 1

            if apply_credit and 'customer_credit' in mc_cols and abs(credit_amount_in) > 0.0001:
                current_credit = getattr(existing, 'customer_credit', None) or 0
                try:
                    current_credit = float(current_credit)
                except Exception:
                    current_credit = 0.0
                new_credit = current_credit + credit_amount_in
                upd_vals['customer_credit'] = new_credit
                logger.info(f"[CUSTOMER] Adjusting credit: {current_credit} + {credit_amount_in} = {new_credit}")

            conn.execute(sql_update(mc_tbl).where(mc_tbl.c.id == existing.id).values(**upd_vals))
            return existing.id

        ins_vals = dict(row)
        if 'customer_id' in mc_cols:
            if cust_id not in (None, '', 0, '0') and 'customer_id' not in ins_vals:
                ins_vals['customer_id'] = cust_id
            if ins_vals.get('customer_id') in (None, '', 0, '0'):
                try:
                    max_stmt = select(func.max(cast(mc_tbl.c.customer_id, SAInteger)))
                    if 'account_code' in mc_cols and account_code not in (None, ''):
                        max_stmt = max_stmt.where(mc_tbl.c.account_code == account_code)
                    if 'retail_code' in mc_cols and retail_code not in (None, ''):
                        max_stmt = max_stmt.where(mc_tbl.c.retail_code == retail_code)
                    current_max = conn.execute(max_stmt).scalar()
                    ins_vals['customer_id'] = int(current_max or 0) + 1
                except Exception:
                    ins_vals['customer_id'] = 1
        if 'created_by' in mc_cols:
            ins_vals['created_by'] = username
        if 'created_at' in mc_cols:
            ins_vals['created_at'] = func.now()
        if 'customer_visitcnt' in mc_cols:
            ins_vals['customer_visitcnt'] = 1 if increment_visit else 0
        if apply_credit and 'customer_credit' in mc_cols:
            ins_vals['customer_credit'] = max(credit_amount_in, 0.0)

        result = conn.execute(insert(mc_tbl).values(**ins_vals))
        try:
            if hasattr(result, 'inserted_primary_key') and result.inserted_primary_key:
                return result.inserted_primary_key[0]
        except Exception:
            pass
        return None
    except SQLAlchemyError as e:
        logger.warning(f"[CUSTOMER][WARN] Upsert failed: {e}")
        return None


def _insert_customer_visit_count(conn, account_code: Optional[str], retail_code: Optional[str], customer_id: Any, total_amount: float, invoice_id: Optional[str] = None) -> None:
    """Insert a record into customer_visit_count table for each bill creation.
    
    Args:
        conn: Database connection
        account_code: Account code
        retail_code: Retail code  
        customer_id: Customer ID
        total_amount: Total amount of the bill
    """
    try:
        # Check if customer_visit_count table exists
        from sqlalchemy import MetaData, Table, text
        local_md = MetaData()
        try:
            visit_tbl = Table('customer_visit_count', local_md, autoload_with=engine)
        except Exception:
            logger.debug("[CUSTOMER_VISIT_COUNT] Table customer_visit_count not found, skipping visit count insert")
            return
        
        # Prepare visit count record
        visit_record = {
            'account_code': account_code or '',
            'retail_code': retail_code or '', 
            'customer_id': customer_id or 0,
            'visit_date': func.curdate(),  # Current date
            'total_spend': float(total_amount or 0),
            'created_at': func.now(),
            'updated_at': func.now()
        }

        # Capture invoice id if the column exists (schema varies across deployments)
        try:
            if 'invoice_id' in visit_tbl.c:
                visit_record['invoice_id'] = str(invoice_id or '')
            elif 'invoice_no' in visit_tbl.c:
                visit_record['invoice_no'] = str(invoice_id or '')
        except Exception:
            pass
        
        # Insert visit count record
        conn.execute(insert(visit_tbl).values(**visit_record))
        logger.info(f"[CUSTOMER_VISIT_COUNT] Inserted visit record: customer_id={customer_id}, total_spend={total_amount}, date={visit_record['visit_date']}")
        
    except Exception as e:
        logger.warning(f"[CUSTOMER_VISIT_COUNT][WARN] Failed to insert visit count: {e}")


def _update_customer_visit_billstatus(conn, account_code: Optional[str], retail_code: Optional[str], customer_id: Any, billstatus: str = 'Y') -> None:
    """Update billstatus='Y' in customer_visit_count for the latest visit of the customer.

    Some installations add a `billstatus` column to `customer_visit_count`. This helper
    defensively updates the most recent row for the given customer if the column exists.
    """
    try:
        from sqlalchemy import MetaData as _MD, Table as _T
        local_md = _MD()
        try:
            visit_tbl = _T('customer_visit_count', local_md, autoload_with=engine)
        except Exception:
            logger.debug("[CUSTOMER_VISIT_COUNT] Table customer_visit_count not found, skipping billstatus update")
            return

        # If billstatus column doesn't exist, skip silently
        if 'billstatus' not in visit_tbl.c:
            logger.debug("[CUSTOMER_VISIT_COUNT] billstatus column not present, skipping update")
            return

        # Find the latest row for this customer within account+retail scope
        latest_q = (
            select(visit_tbl.c.id)
            .where((visit_tbl.c.account_code == (account_code or '')) & (visit_tbl.c.retail_code == (retail_code or '')) & (visit_tbl.c.customer_id == (customer_id or 0)))
            .order_by(visit_tbl.c.id.desc())
            .limit(1)
        )
        latest_row = conn.execute(latest_q).fetchone()
        if not latest_row:
            logger.debug("[CUSTOMER_VISIT_COUNT] No rows to update for customer_id=%s", customer_id)
            return

        latest_id = latest_row[0]
        upd = (
            sql_update(visit_tbl)
            .where(visit_tbl.c.id == latest_id)
            .values(billstatus=billstatus)
        )
        conn.execute(upd)
        logger.info("[CUSTOMER_VISIT_COUNT] Updated billstatus=%s for visit id=%s (customer_id=%s)", billstatus, latest_id, customer_id)
    except Exception as e:
        logger.warning(f"[CUSTOMER_VISIT_COUNT][WARN] Failed to update billstatus: {e}")


def _update_customer_visit_count_by_invoice(
    conn,
    account_code: Optional[str],
    retail_code: Optional[str],
    customer_id: Any,
    invoice_id: Optional[str],
    total_amount: float,
) -> None:
    """Update an existing customer_visit_count row for a given invoice/customer.

    Requirement: when updating an invoice, do NOT insert a new row into customer_visit_count.
    We only update the existing row matched by invoice_id + customer_id (scoped by account/retail
    when those columns exist).
    """
    try:
        from sqlalchemy import MetaData as _MD, Table as _T
        local_md = _MD()
        try:
            visit_tbl = _T('customer_visit_count', local_md, autoload_with=engine)
        except Exception:
            logger.debug("[CUSTOMER_VISIT_COUNT] Table customer_visit_count not found, skipping visit count update")
            return

        # Some deployments use invoice_no instead of invoice_id
        inv_col = None
        if 'invoice_id' in visit_tbl.c:
            inv_col = visit_tbl.c.invoice_id
        elif 'invoice_no' in visit_tbl.c:
            inv_col = visit_tbl.c.invoice_no
        if inv_col is None:
            logger.debug("[CUSTOMER_VISIT_COUNT] invoice_id/invoice_no column not present, skipping visit count update")
            return

        inv = str(invoice_id or '').strip()
        if not inv:
            logger.debug("[CUSTOMER_VISIT_COUNT] Missing invoice_id, skipping visit count update")
            return

        # Prefer matching by invoice + customer_id when possible.
        # If customer_id was changed during edit, fallback to invoice-only match.
        base_where = (inv_col == inv)
        if 'account_code' in visit_tbl.c:
            base_where = base_where & (visit_tbl.c.account_code == (account_code or ''))
        if 'retail_code' in visit_tbl.c:
            base_where = base_where & (visit_tbl.c.retail_code == (retail_code or ''))

        where_clause = base_where
        if 'customer_id' in visit_tbl.c:
            where_clause = where_clause & (visit_tbl.c.customer_id == (customer_id or 0))

        upd_vals: Dict[str, Any] = {}
        if 'total_spend' in visit_tbl.c:
            upd_vals['total_spend'] = float(total_amount or 0)
        # Keep existing visit_date unless your business rules require edits to move the visit.
        # (Leaving it unchanged avoids shifting historical visit dates on invoice edits.)
        if 'updated_at' in visit_tbl.c:
            upd_vals['updated_at'] = func.now()
        # If the customer was changed on the invoice, keep visit row aligned with latest customer_id
        if 'customer_id' in visit_tbl.c and customer_id not in (None, '', 0, '0'):
            upd_vals['customer_id'] = customer_id

        if not upd_vals:
            logger.debug("[CUSTOMER_VISIT_COUNT] No updatable columns found, skipping")
            return

        res = conn.execute(sql_update(visit_tbl).where(where_clause).values(**upd_vals))
        try:
            rowcount = getattr(res, 'rowcount', None)
        except Exception:
            rowcount = None

        # If no row updated (or DB doesn't report rowcount), attempt invoice-only match
        if rowcount in (0, None):
            try:
                res2 = conn.execute(sql_update(visit_tbl).where(base_where).values(**upd_vals))
                rowcount2 = getattr(res2, 'rowcount', None)
            except Exception:
                rowcount2 = None
            if rowcount2 in (0, None):
                logger.info(
                    "[CUSTOMER_VISIT_COUNT] No existing row to update for invoice=%s (no insert per requirement)",
                    inv,
                )
            else:
                logger.info(
                    "[CUSTOMER_VISIT_COUNT] Updated visit record (invoice-only match) for invoice=%s total_spend=%s",
                    inv,
                    float(total_amount or 0),
                )
        else:
            logger.info(
                "[CUSTOMER_VISIT_COUNT] Updated visit record for invoice=%s customer_id=%s total_spend=%s",
                inv,
                customer_id,
                float(total_amount or 0),
            )
    except Exception as e:
        logger.warning(f"[CUSTOMER_VISIT_COUNT][WARN] Failed to update visit count by invoice: {e}")


def _insert_customer_wallet_ledger(conn, account_code: Optional[str], retail_code: Optional[str], customer_id: Any, invoice_id: str, credit_amount: float) -> None:
    """Insert a record into customer_wallet_ledger table when there's a credit amount.

    This routine is defensive: it maps fields to whatever columns exist in the table
    (names vary across deployments) and fills non-nullable columns with safe defaults.
    """
    try:
        from sqlalchemy import MetaData as _MD, Table as _T
        local_md = _MD()
        try:
            wallet_tbl = _T('customer_wallet_ledger', local_md, autoload_with=engine)
        except Exception:
            logger.debug("[WALLET_LEDGER] Table customer_wallet_ledger not found, skipping wallet ledger insert")
            return

        # Only insert if there's actually a credit amount (after coercion)
        try:
            amt_val = float(credit_amount or 0)
        except Exception:
            amt_val = 0.0
        if amt_val <= 0:
            return

        cols = set(wallet_tbl.c.keys())
        row: Dict[str, Any] = {}

        # Scope
        if 'account_code' in cols:
            row['account_code'] = account_code or ''
        if 'retail_code' in cols:
            row['retail_code'] = retail_code or ''
        if 'customer_id' in cols:
            row['customer_id'] = customer_id or 0

        # Link to invoice/bill/reference
        link_candidates = ['invoice_id', 'billing_id', 'bill_id', 'reference_id', 'ref_id', 'txn_ref', 'order_id']
        link_col = next((c for c in link_candidates if c in cols), None)
        if link_col:
            row[link_col] = invoice_id

        # Date/time
        for dcol in ['entry_date', 'txn_date', 'created_at']:
            if dcol in cols:
                row[dcol] = func.now()
                break

        # Type / mode
        for tcol in ['txn_type', 'type', 'transaction_type']:
            if tcol in cols:
                row[tcol] = 'CREDIT'
                break

        # Amount
        for acol in ['amount', 'txn_amount', 'credit_amount', 'value']:
            if acol in cols:
                row[acol] = amt_val
                break

        # Status
        for scol in ['status', 'txn_status']:
            if scol in cols:
                row[scol] = 'SUCCESS'
                break

        # Notes/description
        note_txt = f'Credit from invoice {invoice_id}'
        for ncol in ['notes', 'description', 'remarks', 'comment']:
            if ncol in cols:
                row[ncol] = note_txt
                break

        # Fill required non-nullables with safe defaults
        try:
            for c in wallet_tbl.c:
                if c.name in row or c.primary_key:
                    continue
                if getattr(c, 'nullable', True) is False and c.default is None and c.server_default is None:
                    try:
                        py_t = c.type.python_type
                    except Exception:
                        py_t = str
                    if py_t is int:
                        row[c.name] = 0
                    elif py_t is float:
                        row[c.name] = 0.0
                    else:
                        row[c.name] = ''
        except Exception:
            pass

        conn.execute(insert(wallet_tbl).values(**row))
        logger.info(f"[WALLET_LEDGER] Inserted credit entry: customer_id={customer_id}, invoice_id={invoice_id}, amount={amt_val}")

    except Exception as e:
        logger.warning(f"[WALLET_LEDGER][WARN] Failed to insert wallet ledger: {e}")


def _apply_master_customer_credit_delta(
    conn,
    account_code: Optional[str],
    retail_code: Optional[str],
    customer_id: Any,
    delta_amount: float,
) -> None:
    """Add (or subtract) credit from master_customer.customer_credit."""
    try:
        mc_tbl = _get_master_customer_table()
        if mc_tbl is None:
            return
        mc_cols = set(mc_tbl.c.keys())
        if 'customer_credit' not in mc_cols or 'customer_id' not in mc_cols:
            return
        try:
            delta = float(delta_amount or 0)
        except Exception:
            delta = 0.0
        if abs(delta) < 0.0001:
            return

        stmt = select(mc_tbl.c.id, mc_tbl.c.customer_credit).where(mc_tbl.c.customer_id == str(customer_id))
        if 'account_code' in mc_cols and account_code not in (None, ''):
            stmt = stmt.where(mc_tbl.c.account_code == account_code)
        if 'retail_code' in mc_cols and retail_code not in (None, ''):
            stmt = stmt.where(mc_tbl.c.retail_code == retail_code)
        row = conn.execute(stmt).first()
        if not row:
            return

        current_val = getattr(row, 'customer_credit', None) or 0
        try:
            current_val = float(current_val)
        except Exception:
            current_val = 0.0

        new_val = current_val + delta
        conn.execute(sql_update(mc_tbl).where(mc_tbl.c.id == row.id).values(customer_credit=new_val))
        logger.info("[CUSTOMER][CREDIT_DELTA] customer_id=%s delta=%.2f %s->%s", customer_id, delta, current_val, new_val)
    except Exception as e:
        logger.warning(f"[CUSTOMER][CREDIT_DELTA][WARN] Failed applying credit delta: {e}")


def _reconcile_invoice_credit_ledger(
    conn,
    account_code: Optional[str],
    retail_code: Optional[str],
    invoice_id: str,
    new_customer_id: Any,
    new_credit_amount: float,
) -> None:
    """Make invoice CREDIT idempotent (no duplicates) and keep master_customer credit consistent."""
    try:
        from sqlalchemy import MetaData as _MD, Table as _T
        md = _MD()
        try:
            wallet_tbl = _T('customer_wallet_ledger', md, autoload_with=engine)
        except Exception:
            return

        cols = set(wallet_tbl.c.keys())
        link_candidates = ['invoice_id', 'billing_id', 'bill_id', 'reference_id', 'ref_id', 'txn_ref', 'order_id']
        link_col = next((c for c in link_candidates if c in cols), None)
        if not link_col:
            return
        type_candidates = ['txn_type', 'type', 'transaction_type']
        type_col = next((c for c in type_candidates if c in cols), None)
        amount_candidates = ['amount', 'txn_amount', 'credit_amount', 'value']
        amount_col = next((c for c in amount_candidates if c in cols), None)

        where = (getattr(wallet_tbl.c, link_col) == invoice_id)
        if type_col:
            where = where & (getattr(wallet_tbl.c, type_col) == 'CREDIT')
        if 'account_code' in cols:
            where = where & (wallet_tbl.c.account_code == (account_code or ''))
        if 'retail_code' in cols:
            where = where & (wallet_tbl.c.retail_code == (retail_code or ''))

        # Capture old CREDIT amounts (by customer) so we can subtract from master_customer
        removed_by_customer: Dict[str, float] = {}
        try:
            sel_cols = []
            if 'customer_id' in cols:
                sel_cols.append(wallet_tbl.c.customer_id)
            if amount_col:
                sel_cols.append(getattr(wallet_tbl.c, amount_col))
            if sel_cols:
                old_rows = conn.execute(select(*sel_cols).where(where)).fetchall()
                for r in old_rows:
                    rmap = getattr(r, '_mapping', {})
                    cust_val = rmap.get('customer_id') if 'customer_id' in cols else None
                    try:
                        amt_val = float(rmap.get(amount_col) or 0) if amount_col else 0.0
                    except Exception:
                        amt_val = 0.0
                    if cust_val not in (None, '') and amt_val:
                        key = str(cust_val)
                        removed_by_customer[key] = removed_by_customer.get(key, 0.0) + amt_val
        except Exception:
            removed_by_customer = {}

        # Delete existing CREDIT rows for this invoice
        try:
            conn.execute(wallet_tbl.delete().where(where))
        except Exception:
            pass

        # Apply negative deltas for removed credit amounts
        for cust_key, removed_amt in removed_by_customer.items():
            _apply_master_customer_credit_delta(conn, account_code, retail_code, cust_key, -float(removed_amt or 0))

        # Insert single new CREDIT row + apply positive delta
        try:
            new_amt = float(new_credit_amount or 0)
        except Exception:
            new_amt = 0.0

        if new_amt > 0 and new_customer_id not in (None, '', 0, '0'):
            _insert_customer_wallet_ledger(conn, account_code, retail_code, new_customer_id, invoice_id, new_amt)
            _apply_master_customer_credit_delta(conn, account_code, retail_code, new_customer_id, new_amt)
    except Exception as e:
        logger.warning(f"[WALLET_LEDGER][RECONCILE][WARN] Failed reconciling invoice credit: {e}")


def record_customer_credit_payment(customer_id: int, account_code: str, retail_code: str, amount: float, payment_mode: str, notes: Optional[str] = None) -> Dict[str, Any]:
    """Record a credit payment into customer_wallet_ledger.

    Creates a PAYMENT entry that reduces outstanding credit. For table compatibility,
    we mark status as SUCCESS (UI may render as PAID).
    """
    try:
        if not amount or amount <= 0:
            return {"success": False, "error": "Amount must be positive", "data": []}

        from sqlalchemy import MetaData, Table
        local_md = MetaData()
        try:
            wallet_tbl = Table('customer_wallet_ledger', local_md, autoload_with=engine)
        except Exception:
            return {"success": False, "error": "Customer wallet ledger table not found", "data": []}

        from datetime import datetime
        payment_id = f"PAY-{int(time.time())}"
        now = datetime.now()
        record = {
            'account_code': account_code or '',
            'retail_code': retail_code or '',
            'customer_id': customer_id,
            'invoice_id': payment_id,
            'entry_date': now,
            'txn_type': 'PAYMENT',
            'amount': float(amount),
            'status': 'SUCCESS',
            'notes': notes or f'Credit payment via {payment_mode}'
        }

        with engine.begin() as conn:
            res = conn.execute(insert(wallet_tbl).values(**record))
            inserted_id = res.inserted_primary_key[0] if hasattr(res, 'inserted_primary_key') else None

        logger.info(f"[WALLET_LEDGER] Recorded credit payment: customer_id={customer_id}, amount={amount}, mode={payment_mode}")
        return {"success": True, "id": inserted_id, "payment_ref": payment_id, "data": record}
    except Exception as e:
        logger.error(f"[WALLET_LEDGER][ERROR] Failed to record credit payment: {e}")
        return {"success": False, "error": str(e), "data": []}


def _record_customer_credit_payment(customer_id: int, amount: float, payment_mode: str, account_code: str, retail_code: str, notes: Optional[str] = None, username: str = None) -> Dict[str, Any]:
    """Record a credit payment and reduce customer credit in master_customer table."""
    logger.info(f"[CUSTOMER_CREDIT_PAYMENT] ========== STARTING CREDIT PAYMENT PROCESS ==========")
    logger.info(f"[CUSTOMER_CREDIT_PAYMENT] customer_id={customer_id}, amount={amount}, mode={payment_mode}")
    
    try:
        if not amount or amount <= 0:
            logger.error(f"[CUSTOMER_CREDIT_PAYMENT] Invalid amount: {amount}")
            return {"success": False, "error": "Amount must be positive"}

        with engine.begin() as conn:
            logger.info("[CUSTOMER_CREDIT_PAYMENT] ========== STEP 1: UPDATE MASTER_CUSTOMER CREDIT ==========")
            
            # FIRST: Update master_customer credit (this is the main requirement)
            from sqlalchemy import MetaData, Table
            mc_md = MetaData()
            try:
                mc_tbl = Table('master_customer', mc_md, autoload_with=engine)
                logger.info("[CUSTOMER_CREDIT_PAYMENT] Successfully loaded master_customer table")
            except Exception as e:
                logger.error(f"[CUSTOMER_CREDIT_PAYMENT] Failed to load master_customer table: {e}")
                return {"success": False, "error": "Master customer table not found"}

            mc_cols = set(mc_tbl.c.keys())
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] master_customer columns: {list(mc_cols)}")
            
            if 'customer_credit' not in mc_cols:
                logger.error("[CUSTOMER_CREDIT_PAYMENT] customer_credit column not found")
                return {"success": False, "error": "Customer credit column not found"}

            # Get current credit for the customer
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Looking up current credit for customer_id={customer_id}")
            # customer_id may be stored as VARCHAR in some schemas; match robustly and scope by account/retail when present
            from sqlalchemy import String as SAString, and_, or_
            cust_id_str = str(customer_id)
            cust_pred = or_(
                mc_tbl.c.customer_id == customer_id,
                mc_tbl.c.customer_id == cust_id_str,
                cast(mc_tbl.c.customer_id, SAString) == cust_id_str,
            )
            if 'account_code' in mc_cols and account_code not in (None, ''):
                cust_pred = and_(cust_pred, mc_tbl.c.account_code == account_code)
            if 'retail_code' in mc_cols and retail_code not in (None, ''):
                cust_pred = and_(cust_pred, mc_tbl.c.retail_code == retail_code)

            select_stmt = select(mc_tbl.c.customer_credit, mc_tbl.c.customer_id).where(cust_pred)
            current_row = conn.execute(select_stmt).first()
            
            if not current_row:
                logger.error(f"[CUSTOMER_CREDIT_PAYMENT] Customer not found: customer_id={customer_id}")
                # Debug: show all customers
                all_rows = conn.execute(select(mc_tbl.c.customer_id, mc_tbl.c.customer_credit)).fetchall()
                logger.info(f"[CUSTOMER_CREDIT_PAYMENT] All customers: {[(r.customer_id, r.customer_credit) for r in all_rows]}")
                return {"success": False, "error": f"Customer {customer_id} not found"}

            current_credit = float(current_row.customer_credit or 0)
            new_credit = max(current_credit - amount, 0.0)
            
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Current credit: {current_credit}")
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Payment amount: {amount}")
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] New credit will be: {new_credit}")

            # Update the customer credit
            update_stmt = sql_update(mc_tbl).where(cust_pred).values(customer_credit=new_credit)
            if username and 'updated_by' in mc_cols:
                update_stmt = update_stmt.values(updated_by=username)
                
            logger.info("[CUSTOMER_CREDIT_PAYMENT] Executing credit update...")
            update_result = conn.execute(update_stmt)
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Update result: {update_result.rowcount} rows affected")
            
            # Verify the update
            verify_row = conn.execute(select(mc_tbl.c.customer_credit).where(cust_pred)).first()
            actual_new_credit = float(verify_row.customer_credit) if verify_row else None
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Verification: credit is now {actual_new_credit}")
            
            if update_result.rowcount == 0:
                # Some DBs report 0 affected rows when the value is unchanged.
                # If verification matches expected credit, treat as success.
                try:
                    if actual_new_credit is not None and abs(float(actual_new_credit) - float(new_credit)) < 0.0001:
                        logger.warning("[CUSTOMER_CREDIT_PAYMENT] Update rowcount=0 but credit matches expected; continuing")
                    else:
                        logger.error("[CUSTOMER_CREDIT_PAYMENT] NO ROWS WERE UPDATED!")
                        return {"success": False, "error": "Failed to update customer credit"}
                except Exception:
                    logger.error("[CUSTOMER_CREDIT_PAYMENT] NO ROWS WERE UPDATED!")
                    return {"success": False, "error": "Failed to update customer credit"}
            
            logger.info("[CUSTOMER_CREDIT_PAYMENT] ========== STEP 2: INSERT WALLET LEDGER RECORD ==========")
            
            # SECOND: Insert payment record in wallet ledger
            from datetime import datetime
            import time
            
            wallet_md = MetaData()
            try:
                wallet_tbl = Table('customer_wallet_ledger', wallet_md, autoload_with=engine)
                logger.info("[CUSTOMER_CREDIT_PAYMENT] Successfully loaded customer_wallet_ledger table")
            except Exception as e:
                logger.warning(f"[CUSTOMER_CREDIT_PAYMENT] Wallet ledger table not found: {e}")
                # Still return success since we updated the credit
                return {
                    "success": True, 
                    "warning": "Credit updated but wallet ledger not recorded",
                    "previous_credit": current_credit,
                    "paid_amount": amount,
                    "remaining_credit": actual_new_credit
                }

            payment_id = f"PAY-{int(time.time())}"
            now = datetime.now()
            wallet_record = {
                'account_code': account_code or '',
                'retail_code': retail_code or '',
                'customer_id': customer_id,
                'invoice_id': payment_id,
                'entry_date': now,
                'txn_type': 'PAYMENT',
                'amount': float(amount),
                'status': 'SUCCESS',
                'notes': notes or f'Credit payment via {payment_mode}'
            }

            # Filter to existing columns
            wallet_cols = set(wallet_tbl.c.keys())
            wallet_record_filtered = {k: v for k, v in wallet_record.items() if k in wallet_cols}
            
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Inserting wallet record: {wallet_record_filtered}")
            wallet_res = conn.execute(insert(wallet_tbl).values(**wallet_record_filtered))
            wallet_id = wallet_res.inserted_primary_key[0] if hasattr(wallet_res, 'inserted_primary_key') else None
            logger.info(f"[CUSTOMER_CREDIT_PAYMENT] Wallet record inserted with ID: {wallet_id}")
            
            logger.info("[CUSTOMER_CREDIT_PAYMENT] ========== PAYMENT PROCESS COMPLETED SUCCESSFULLY ==========")
            return {
                "success": True,
                "payment_ref": payment_id,
                "wallet_id": wallet_id,
                "previous_credit": current_credit,
                "paid_amount": amount,
                "remaining_credit": actual_new_credit,
                "rows_updated": update_result.rowcount
            }

    except Exception as e:
        logger.error(f"[CUSTOMER_CREDIT_PAYMENT] ========== ERROR OCCURRED ==========")
        logger.error(f"[CUSTOMER_CREDIT_PAYMENT] Error: {e}")
        import traceback
        logger.error(f"[CUSTOMER_CREDIT_PAYMENT] Traceback: {traceback.format_exc()}")
        return {"success": False, "error": str(e)}


class InvoiceLineCreate(BaseModel):
    account_code: str
    retail_code: str
    invoice_id: str
    service_id: Optional[str] = None
    service_name: str
    qty: int = Field(ge=1, default=1)
    # Optional existing customer reference (0 or missing triggers auto-create if name/phone provided on first line)
    customer_id: Optional[int] = None
    # Original/base price before any markup (optional)
    base_price: Optional[float] = Field(default=None, ge=0)
    unit_price: float = Field(ge=0)
    tax_id: Optional[str] = None
    tax_rate_percent: Optional[float] = Field(default=0, ge=0)
    discount_amount: Optional[float] = Field(default=0, ge=0)
    # Customer (header) level fields optionally passed on first line
    customer_name: Optional[str] = None  # matches DB column spelling
    customer_number: Optional[str] = None
    # Employee / staff enrichment fields (header level; only first line needed)
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    # Customer gender from frontend (used for master_customer upsert/insert)
    customer_gender: Optional[str] = None
    employee_level: Optional[str] = None
    employee_percent: Optional[float] = None  # raw percent configured for employee
    markup_percent_applied: Optional[float] = None  # applied markup percent (may mirror employee_percent)
    markup_amount_per_unit: Optional[float] = None  # unit markup amount (unit_price - base_price)
    # Optional pre-computed totals; if omitted they are derived simplistically
    taxable_amount: Optional[float] = None
    cgst_rate_percent: Optional[float] = None
    sgst_rate_percent: Optional[float] = None
    igst_rate_percent: Optional[float] = None
    total_cgst: Optional[float] = None
    total_sgst: Optional[float] = None
    total_igst: Optional[float] = None
    total_vat: Optional[float] = None
    tax_amount: Optional[float] = None
    # Optional header-carrier fields (frontend may attach to first line)
    tax_amount_total: Optional[float] = None
    # Membership discount information
    membership_discount: Optional[float] = Field(default=0, ge=0)  # membership discount amount per line
    grand_total: Optional[float] = None
    subtotal_amount: Optional[float] = None
    rounded_total: Optional[float] = None
    # Round off amount for billing
    round_off: Optional[float] = Field(default=0)  # round off amount (can be positive or negative)
    # Payment information (for billing_paymode persistence)
    payment_mode_id: Optional[str] = None  # Payment mode ID
    payment_method: Optional[str] = None   # Payment method name (e.g., "card", "cash", "upi")

    # Additional notes to persist on billing_transactions header when column exists
    additional_notes: Optional[str] = None
    
    # New physical stats for enrollment
    age: Optional[int] = Field(None, ge=5, le=100)
    height_cm: Optional[float] = Field(None, ge=50, le=250)
    weight_kg: Optional[float] = Field(None, ge=20, le=300)


class InvoiceBulkCreate(BaseModel):
    lines: List[InvoiceLineCreate]
    # Optional arrays for packages and inventory items
    package_lines: Optional[List[Dict[str, Any]]] = None
    inventory_lines: Optional[List[Dict[str, Any]]] = None
    # Optional array for multiple customers attached to an invoice (not persisted yet)
    customer_lines: Optional[List[Dict[str, Any]]] = None
    # New: multiple payment modes and credit amount from frontend payload
    payment_modes: Optional[List[Dict[str, Any]]] = None
    credit_amount: Optional[float] = None
    # Add invoice status field for hold functionality
    invoice_status: Optional[str] = None


class InvoiceBulkUpdate(BaseModel):
    # Fields applied to all matching rows (partial update)
    update_fields: Dict[str, Any]


def _coerce_numeric(val: Any, default: float = 0.0) -> float:
    try:
        if val is None:
            return default
        return float(val)
    except Exception:
        return default


def create_invoice_lines(payload: InvoiceBulkCreate, username: str) -> Dict[str, Any]:
    tbl = _get_table()
    cols = set(tbl.c.keys())
    inserted_ids: List[Any] = []
    logger.info(f"[INVOICE/CREATE] invoice_id={payload.lines[0].invoice_id if payload.lines else 'N/A'} lines={len(payload.lines)} user={username}")
    with engine.begin() as conn:
        # --- Invoice sequence generation (per account_code + retail_code) ---
        generated_sequence_id = None
        try:
            if payload.lines:
                seq_first = payload.lines[0]
                acc = getattr(seq_first, 'account_code', None)
                ret = getattr(seq_first, 'retail_code', None)
                txn_tbl_seq = _get_txn_table()
                if txn_tbl_seq is not None and acc and ret and 'sequence_id' in txn_tbl_seq.c.keys():
                    # Compute next sequence scoped by account+retail
                    seq_stmt = select(func.max(txn_tbl_seq.c.sequence_id)).where(
                        txn_tbl_seq.c.account_code == acc,
                        txn_tbl_seq.c.retail_code == ret
                    )
                    current_max = conn.execute(seq_stmt).scalar()
                    try:
                        generated_sequence_id = int(current_max or 0) + 1
                    except Exception:
                        generated_sequence_id = 1
                    new_invoice_id = f"INV-{generated_sequence_id}"
                    # Override invoice_id on every line so lines + header stay consistent
                    for l in payload.lines:
                        try:
                            setattr(l, 'invoice_id', new_invoice_id)
                        except Exception:
                            pass
                    
                    # Also update package_lines, inventory_lines, and customer_lines with the new invoice_id
                    if payload.package_lines:
                        for pkg_line in payload.package_lines:
                            if isinstance(pkg_line, dict):
                                pkg_line['invoice_id'] = new_invoice_id
                    
                    if payload.inventory_lines:
                        for inv_line in payload.inventory_lines:
                            if isinstance(inv_line, dict):
                                inv_line['invoice_id'] = new_invoice_id
                    
                    if payload.customer_lines:
                        for cust_line in payload.customer_lines:
                            if isinstance(cust_line, dict):
                                cust_line['invoice_id'] = new_invoice_id
                    
                    logger.info(f"[INVOICE/SEQ] Generated sequence_id={generated_sequence_id} invoice_id={new_invoice_id} scope acc={acc} ret={ret}")
                    logger.info(f"[INVOICE/SEQ] Updated package_lines count: {len(payload.package_lines) if payload.package_lines else 0}")
                    logger.info(f"[INVOICE/SEQ] Updated inventory_lines count: {len(payload.inventory_lines) if payload.inventory_lines else 0}")
                    logger.info(f"[INVOICE/SEQ] Updated customer_lines count: {len(payload.customer_lines) if payload.customer_lines else 0}")
        except Exception as seq_err:
            logger.warning(f"[INVOICE/SEQ][WARN] Failed to generate sequence id: {seq_err}")
        # --- Optional customer auto-create (first line only) ---
        try:
            if payload.lines:
                first_line = payload.lines[0]
                cust_id_incoming = getattr(first_line, 'customer_id', None)
                name_incoming = getattr(first_line, 'customer_name', None)
                phone_incoming = (getattr(first_line, 'customer_number', None) or 
                                  getattr(first_line, 'custumer_number', None) or 
                                  getattr(first_line, 'customer_number', None))
                need_create = (cust_id_incoming in (None, 0, '0')) and (name_incoming or phone_incoming)
                logger.info(f"[INVOICE/CUSTOMER] Auto-create check: customer_id={cust_id_incoming}, name={name_incoming}, phone={phone_incoming}, need_create={need_create}")
                if need_create:
                    # Reflect master_customer
                    from sqlalchemy import MetaData, Table
                    try:
                        mc_tbl = Table('master_customer', MetaData(), autoload_with=engine)
                        mc_cols = mc_tbl.c.keys()
                        # Generate customer_id as max + 1 for account/retail scope (consistent with booking logic)
                        next_cust_id = None
                        if 'customer_id' in mc_cols:
                            try:
                                acc_val_in = first_line.account_code
                                ret_val_in = first_line.retail_code
                                has_acc = 'account_code' in mc_cols and bool(acc_val_in)
                                has_ret = 'retail_code' in mc_cols and bool(ret_val_in)
                                max_result = None
                                
                                if has_acc and has_ret:
                                    # Normalize comparison on TRIM(UPPER(...)) to avoid whitespace/case mismatches
                                    acc_val = str(acc_val_in).strip().upper()
                                    ret_val = str(ret_val_in).strip().upper()
                                    # Fix: Cast customer_id to INTEGER for proper numeric MAX comparison
                                    max_query = select(func.max(func.cast(mc_tbl.c.customer_id, 'INTEGER'))).where(
                                        and_(
                                            func.upper(func.trim(mc_tbl.c.account_code)) == acc_val,
                                            func.upper(func.trim(mc_tbl.c.retail_code)) == ret_val,
                                            mc_tbl.c.customer_id.isnot(None),
                                            # Also ensure customer_id is numeric (exclude non-numeric values)
                                            func.cast(mc_tbl.c.customer_id, 'INTEGER').isnot(None)
                                        )
                                    )
                                    max_result = conn.execute(max_query).scalar()
                                    logger.debug(f"[INVOICE/CUSTOMER] Scoped max query for account={acc_val} retail={ret_val} returned: {max_result}")
                                else:
                                    # Fallback to global max if scope not available in table or payload
                                    # Fix: Cast customer_id to INTEGER for proper numeric MAX comparison
                                    max_query = select(func.max(func.cast(mc_tbl.c.customer_id, 'INTEGER'))).where(
                                        and_(
                                            mc_tbl.c.customer_id.isnot(None),
                                            # Also ensure customer_id is numeric (exclude non-numeric values)
                                            func.cast(mc_tbl.c.customer_id, 'INTEGER').isnot(None)
                                        )
                                    )
                                    max_result = conn.execute(max_query).scalar()
                                    logger.debug(f"[INVOICE/CUSTOMER] Global max query returned: {max_result}")
                                
                                try:
                                    next_cust_id = int(max_result or 0) + 1
                                except Exception as convert_err:
                                    logger.warning(f"[INVOICE/CUSTOMER] Failed to convert max_result to int: {max_result}, error: {convert_err}")
                                    next_cust_id = 1
                                logger.info(f"[INVOICE/CUSTOMER] Generated customer_id (scoped by account+retail): {next_cust_id} | account={acc_val_in} retail={ret_val_in} max={max_result}")
                                
                            except Exception as id_gen_error:
                                logger.error(f"[INVOICE/CUSTOMER] Failed to generate customer_id: {id_gen_error}")
                                # Fallback to simple incrementing logic
                                try:
                                    # Fix: Cast customer_id to INTEGER for proper numeric MAX comparison
                                    max_stmt = select(func.max(func.cast(mc_tbl.c.customer_id, 'INTEGER'))).where(
                                        and_(
                                            mc_tbl.c.customer_id.isnot(None),
                                            func.cast(mc_tbl.c.customer_id, 'INTEGER').isnot(None)
                                        )
                                    )
                                    max_val = conn.execute(max_stmt).scalar()
                                    next_cust_id = int(max_val or 0) + 1
                                    logger.info(f"[INVOICE/CUSTOMER] Fallback customer_id generation: {next_cust_id}")
                                except Exception:
                                    next_cust_id = 1
                                    logger.warning(f"[INVOICE/CUSTOMER] Using fallback customer_id: 1")
                        insert_data = {}
                        if 'customer_id' in mc_cols and next_cust_id is not None:
                            # Verification: Check if customer_id already exists
                            check_exists = select(mc_tbl.c.customer_id).where(mc_tbl.c.customer_id == str(next_cust_id)).limit(1)
                            existing = conn.execute(check_exists).first()
                            if existing:
                                logger.warning(f"[INVOICE/CUSTOMER] customer_id {next_cust_id} already exists! Incrementing...")
                                # Find the actual next available ID
                                while existing:
                                    next_cust_id += 1
                                    check_exists = select(mc_tbl.c.customer_id).where(mc_tbl.c.customer_id == str(next_cust_id)).limit(1)
                                    existing = conn.execute(check_exists).first()
                                logger.info(f"[INVOICE/CUSTOMER] Found available customer_id: {next_cust_id}")
                            insert_data['customer_id'] = next_cust_id
                        # Map name/phone variations
                        name_field = next((c for c in ['customer_name','full_name','name'] if c in mc_cols), None)
                        phone_field = next((c for c in ['phone','mobile','customer_phone','customer_mobile','customer_number','custumer_number'] if c in mc_cols), None)
                        if name_field and name_incoming:
                            insert_data[name_field] = name_incoming
                        if phone_field and phone_incoming:
                            insert_data[phone_field] = phone_incoming
                        # Include gender if column exists and provided
                        gender_incoming = None
                        try:
                            gender_incoming = getattr(first_line, 'customer_gender', None)
                        except Exception:
                            gender_incoming = None
                        if gender_incoming:
                            graw = str(gender_incoming).strip().lower()
                            if graw in ('male','m','1'):
                                gval = 'Male'
                            elif graw in ('female','f','2'):
                                gval = 'Female'
                            else:
                                gval = 'Other'
                            g_field = next((c for c in ['gender','customer_gender'] if c in mc_cols), None)
                            if g_field:
                                insert_data[g_field] = gval
                        if 'account_code' in mc_cols:
                            insert_data['account_code'] = first_line.account_code
                        if 'retail_code' in mc_cols:
                            insert_data['retail_code'] = first_line.retail_code
                        # Basic timestamps if columns exist
                        for ts_col in ['created_at','updated_at']:
                            if ts_col in mc_cols:
                                insert_data[ts_col] = func.now()
                        if insert_data:
                            ins_res = conn.execute(insert(mc_tbl).values(**insert_data))
                            # Determine final customer id
                            new_customer_id = None
                            if 'customer_id' in mc_cols and next_cust_id is not None:
                                new_customer_id = next_cust_id
                            else:
                                # fall back to PK 'id'
                                try:
                                    new_customer_id = ins_res.inserted_primary_key[0]
                                except Exception:
                                    new_customer_id = None
                            logger.info(f"[INVOICE/CUSTOMER] Auto-created master_customer id={new_customer_id} data={insert_data}")
                            # Mutate first line + propagate to others
                            if new_customer_id is not None:
                                for l in payload.lines:
                                    try:
                                        setattr(l, 'customer_id', int(new_customer_id))
                                    except Exception:
                                        pass
                        else:
                            logger.warning("[INVOICE/CUSTOMER] Skipped auto-create: no insertable columns determined")
                    except Exception as cust_err:
                        logger.error(f"[INVOICE/CUSTOMER][ERROR] Failed auto-create: {cust_err}")
        except Exception as outer_cust_err:
            logger.error(f"[INVOICE/CUSTOMER][FATAL_WRAP] {outer_cust_err}")
        for idx, line in enumerate(payload.lines):
            data = line.dict()
            try:
                # If the client provided dedicated package/inventory arrays, do NOT also store
                # those items as synthetic `pkg:*` / `inv:*` rows in billing_trans_summary.
                sid_val = str(data.get('service_id') or '')
                if sid_val.startswith('pkg:') and getattr(payload, 'package_lines', None):
                    logger.info(f"[INVOICE/SUMMARY_SKIP] Skipping package line {idx+1} from billing_trans_summary (service_id={sid_val})")
                    continue
                if sid_val.startswith('inv:') and getattr(payload, 'inventory_lines', None):
                    logger.info(f"[INVOICE/SUMMARY_SKIP] Skipping inventory line {idx+1} from billing_trans_summary (service_id={sid_val})")
                    continue
                # Derive basic totals if not supplied
                line_amount = _coerce_numeric(data.get('qty'), 1.0) * _coerce_numeric(data.get('unit_price'), 0.0)
                reg_discount = _coerce_numeric(data.get('discount_amount'), 0.0)
                mem_discount = _coerce_numeric(data.get('membership_discount'), 0.0)
                # Treat membership discount like normal discount by folding into discount_amount
                data['discount_amount'] = _coerce_numeric(reg_discount + mem_discount, 0.0)
                taxable = max(line_amount - reg_discount - mem_discount, 0.0)
                data['taxable_amount'] = taxable

                # Recompute tax/grand_total for summary lines strictly from service amounts.
                c_rate = _coerce_numeric(data.get('cgst_rate_percent'), 0.0)
                s_rate = _coerce_numeric(data.get('sgst_rate_percent'), 0.0)
                i_rate = _coerce_numeric(data.get('igst_rate_percent'), 0.0)
                if (c_rate + s_rate + i_rate) <= 0.0:
                    combined = _coerce_numeric(data.get('tax_rate_percent'), 0.0)
                    c_rate = combined / 2.0
                    s_rate = combined / 2.0
                    i_rate = 0.0

                total_cgst = round((taxable * c_rate) / 100.0, 2)
                total_sgst = round((taxable * s_rate) / 100.0, 2)
                total_igst = round((taxable * i_rate) / 100.0, 2)
                total_vat = _coerce_numeric(data.get('total_vat'), 0.0)
                total_tax = round(total_cgst + total_sgst + total_igst + total_vat, 2)

                data['total_cgst'] = total_cgst
                data['total_sgst'] = total_sgst
                data['total_igst'] = total_igst
                data['tax_amount'] = total_tax

                # Remove header-only total fields (can be present on line[0] due to payload coercion)
                for _k in ('subtotal_amount', 'tax_amount_total', 'rounded_total', 'round_off'):
                    if _k in data:
                        data.pop(_k, None)

                # Always compute grand_total from (taxable + tax_amount) for summary rows
                data['grand_total'] = round(taxable + _coerce_numeric(data.get('tax_amount'), 0.0), 2)

                # Keep only columns that exist
                row = {k: v for k, v in data.items() if k in cols and v is not None}
                # Ensure employee_id is propagated and coerced to int when possible
                try:
                    if 'employee_id' in cols:
                        if row.get('employee_id') in (None, '') and payload.lines:
                            first_emp = getattr(payload.lines[0], 'employee_id', None)
                            if first_emp not in (None, ''):
                                try:
                                    row['employee_id'] = int(first_emp)
                                except Exception:
                                    row['employee_id'] = first_emp
                        elif row.get('employee_id') not in (None, ''):
                            try:
                                row['employee_id'] = int(row['employee_id']) if str(row['employee_id']).isdigit() else row['employee_id']
                            except Exception:
                                pass
                except Exception:
                    pass
                # Ensure employee_id and employee_name are populated for services on replace
                try:
                    if 'employee_id' in cols:
                        if row.get('employee_id') in (None, ''):
                            first_emp = None
                            try:
                                first_emp = getattr(payload.lines[0], 'employee_id', None)
                            except Exception:
                                first_emp = None
                            if first_emp not in (None, ''):
                                row['employee_id'] = first_emp
                    if 'employee_name' in cols:
                        if row.get('employee_name') in (None, ''):
                            first_name = None
                            try:
                                first_name = getattr(payload.lines[0], 'employee_name', None)
                            except Exception:
                                first_name = None
                            if first_name not in (None, ''):
                                row['employee_name'] = first_name
                except Exception:
                    pass
                # Ensure employee_id and employee_name are populated for services
                try:
                    if 'employee_id' in cols:
                        if row.get('employee_id') in (None, ''):
                            # Prefer per-line value; fallback to first line's employee_id
                            first_emp = None
                            try:
                                first_emp = getattr(payload.lines[0], 'employee_id', None)
                            except Exception:
                                first_emp = None
                            if first_emp not in (None, ''):
                                # Coerce to integer when possible
                                try:
                                    row['employee_id'] = int(first_emp)
                                except Exception:
                                    row['employee_id'] = first_emp
                        else:
                            # Coerce existing value to int when possible
                            try:
                                row['employee_id'] = int(row['employee_id'])
                            except Exception:
                                pass
                    if 'employee_name' in cols:
                        if row.get('employee_name') in (None, ''):
                            # Resolve name from first line or leave empty
                            first_name = None
                            try:
                                first_name = getattr(payload.lines[0], 'employee_name', None)
                            except Exception:
                                first_name = None
                            if first_name not in (None, ''):
                                row['employee_name'] = first_name
                except Exception:
                    pass
                
                # Debug logging for employee_id
                employee_id_value = data.get('employee_id')
                logger.info(f"[INVOICE/EMPLOYEE_DEBUG] Line {idx+1}: employee_id from data={employee_id_value}, service_name={data.get('service_name')}, invoice_id={data.get('invoice_id')}")
                # Map membership discount into first available membership-related column (supports amount/percent synonyms)
                try:
                    mem_val = data.get('membership_discount', None)
                    if mem_val not in (None, ''):
                        def _first_existing_ci(_cols: set, *cands: str):
                            lower_map = {c.lower(): c for c in _cols}
                            for cand in cands:
                                ckey = cand.lower()
                                if ckey in lower_map:
                                    return lower_map[ckey]
                            # fuzzy fallback: any col containing both 'member' and 'discount'
                            for c in _cols:
                                cl = c.lower()
                                if 'member' in cl and 'discount' in cl:
                                    return c
                            return None
                        mem_col = _first_existing_ci(cols,
                            'membership_discount',
                            'membership_discount_amount',
                            'membership_disc_amount',
                            'membership_amount',
                            'member_discount',
                            'member_discount_amount',
                            'membership_discount_percent',
                            'membership_percent',
                            'membership_disc_percent'
                        )
                        if mem_col and mem_col not in row:
                            row[mem_col] = mem_val
                except Exception:
                    pass
                # Ensure customer_id included if column exists and was set via auto-create or provided
                if 'customer_id' in cols and 'customer_id' not in row and data.get('customer_id') not in (None,''):
                    row['customer_id'] = data.get('customer_id')
                # Coerce employee_id type again just before insert
                try:
                    if 'employee_id' in cols and row.get('employee_id') not in (None, ''):
                        row['employee_id'] = int(row['employee_id']) if str(row['employee_id']).isdigit() else row['employee_id']
                except Exception:
                    pass
                if 'created_by' in cols:
                    row['created_by'] = username
                if 'updated_by' in cols:
                    row['updated_by'] = username
                # Guarantee service_id if column exists (some schemas mark it NOT NULL without default)
                if 'service_id' in cols and 'service_id' not in row:
                    # Prefer explicit provided field even if blank in original data
                    provided = data.get('service_id')
                    if provided:
                        row['service_id'] = provided
                    else:
                        # Derive from service_name or generate unique token
                        base = (data.get('service_name') or 'SRV')
                        sanitized = ''.join(ch for ch in base if ch.isalnum())[:30]
                        row['service_id'] = f"{sanitized or 'SRV'}_{int(time.time()*1000)%100000000}"
                # Auto-fill mandatory columns (non-nullable without defaults) that are missing
                try:
                    for c in tbl.c:
                        if c.name in row or c.primary_key:
                            continue
                        # Skip auto timestamps or columns with server/default values
                        if getattr(c, 'nullable', True) is False and c.default is None and c.server_default is None:
                            # Provide safe placeholder based on python type
                            if hasattr(c.type, 'python_type'):
                                py_t = c.type.python_type
                                if py_t in (int,):
                                    row[c.name] = 0
                                elif py_t in (float,):
                                    row[c.name] = 0.0
                                else:
                                    row[c.name] = ''
                            else:
                                row[c.name] = ''
                except Exception as autofill_err:
                    logger.debug(f"[INVOICE/CREATE] autofill skip due to error: {autofill_err}")
                logger.debug(f"[INVOICE/CREATE] inserting line {idx+1}/{len(payload.lines)} row={row}")
                
                # Additional debug for employee_id in row
                if 'employee_id' in row:
                    logger.info(f"[INVOICE/EMPLOYEE_INSERT] Line {idx+1}: employee_id={row['employee_id']} will be inserted for service={row.get('service_name')}")
                else:
                    logger.warning(f"[INVOICE/EMPLOYEE_INSERT] Line {idx+1}: employee_id NOT in row data for service={row.get('service_name')}")
                
                ins = conn.execute(insert(tbl).values(**row))
                try:
                    pk = ins.inserted_primary_key[0]
                    logger.info(f"[INVOICE/INSERT_SUCCESS] Line {idx+1}: Successfully inserted with PK={pk}, employee_id={row.get('employee_id')}, service={row.get('service_name')}")
                except Exception as pk_err:
                    pk = None
                    logger.warning(f"[INVOICE/INSERT_PK_ERROR] Line {idx+1}: Could not get PK: {pk_err}")
                inserted_ids.append(pk)
            except Exception as e:
                logger.error(f"[INVOICE/CREATE][ERROR] line_index={idx} invoice_id={data.get('invoice_id')} error={e}")
                raise HTTPException(status_code=500, detail=f"Failed inserting invoice line {idx+1}: {str(e)}")

        # --- Header upsert into billing_transactions (if table exists) ---
        try:
            txn_tbl = _get_txn_table()
            if txn_tbl is not None and payload.lines:
                inv_id = payload.lines[0].invoice_id
                line_cols = tbl.c
                # Aggregate current line totals (services)
                agg_stmt = select(
                    func.sum(line_cols.qty * line_cols.unit_price).label('subtotal'),
                    func.sum(func.coalesce(line_cols.discount_amount, 0)).label('discount_sum'),
                    func.sum(func.coalesce(line_cols.tax_amount, 0)).label('tax_amount'),
                    func.sum(func.coalesce(line_cols.total_cgst, 0)).label('total_cgst'),
                    func.sum(func.coalesce(line_cols.total_sgst, 0)).label('total_sgst'),
                    func.sum(func.coalesce(line_cols.total_igst, 0)).label('total_igst'),
                    func.sum(func.coalesce(line_cols.total_vat, 0)).label('total_vat'),
                    func.sum(func.coalesce(line_cols.qty, 0)).label('quantity'),
                    func.max(func.coalesce(line_cols.tax_rate_percent, 0)).label('tax_rate_percent'),
                ).where(line_cols.invoice_id == inv_id)
                first_line = payload.lines[0]
                acc_code = first_line.account_code
                ret_code = first_line.retail_code
                if 'account_code' in line_cols.keys():
                    agg_stmt = agg_stmt.where(line_cols.account_code == acc_code)
                if 'retail_code' in line_cols.keys():
                    agg_stmt = agg_stmt.where(line_cols.retail_code == ret_code)
                agg_row = conn.execute(agg_stmt).first()
                if not agg_row:
                    logger.debug(f"[INVOICE/HEADER] No aggregation row produced for invoice_id={inv_id}")
                else:
                    subtotal = float(agg_row.subtotal or 0)
                    discount_sum = float(agg_row.discount_sum or 0)
                    # membership_discount is already folded into discount_amount on each line
                    taxable_amount = max(subtotal - discount_sum, 0.0)
                    tax_amount = float(agg_row.tax_amount or 0)
                    qty_total = float(agg_row.quantity or 0)
                    tax_rate_percent = float(agg_row.tax_rate_percent or 0)

                    # Include packages and inventory (products) in totals
                    try:
                        from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                        md_extra = SQLAMetaData()
                        # Packages table aggregation
                        try:
                            pkg_tbl = SQLATable('billing_trans_packages', md_extra, autoload_with=engine)
                            pkg_cols = pkg_tbl.c
                            pkg_stmt = select(
                                func.sum(func.coalesce(pkg_cols.qty, 0) * func.coalesce(pkg_cols.unit_price, 0)).label('pkg_subtotal'),
                                func.sum(func.coalesce(pkg_cols.discount_amount, 0)).label('pkg_discount'),
                                func.sum(func.coalesce(pkg_cols.tax_amount, 0)).label('pkg_tax'),
                                func.sum(func.coalesce(pkg_cols.total_cgst, 0)).label('pkg_cgst'),
                                func.sum(func.coalesce(pkg_cols.total_sgst, 0)).label('pkg_sgst'),
                                func.sum(func.coalesce(pkg_cols.total_igst, 0)).label('pkg_igst'),
                                func.sum(func.coalesce(pkg_cols.total_vat, 0)).label('pkg_vat'),
                                func.sum(func.coalesce(pkg_cols.qty, 0)).label('pkg_qty')
                            ).where(pkg_cols.invoice_id == inv_id)
                            if 'account_code' in pkg_cols.keys():
                                pkg_stmt = pkg_stmt.where(pkg_cols.account_code == acc_code)
                            if 'retail_code' in pkg_cols.keys():
                                pkg_stmt = pkg_stmt.where(pkg_cols.retail_code == ret_code)
                            pkg_row = conn.execute(pkg_stmt).first()
                            if pkg_row:
                                subtotal += float(pkg_row.pkg_subtotal or 0)
                                discount_sum += float(pkg_row.pkg_discount or 0)
                                tax_amount += float(pkg_row.pkg_tax or 0)
                                qty_total += float(pkg_row.pkg_qty or 0)
                                # Add tax component totals
                                agg_total_cgst = float(agg_row.total_cgst or 0) + float(pkg_row.pkg_cgst or 0)
                                agg_total_sgst = float(agg_row.total_sgst or 0) + float(pkg_row.pkg_sgst or 0)
                                agg_total_igst = float(agg_row.total_igst or 0) + float(pkg_row.pkg_igst or 0)
                                agg_total_vat = float(agg_row.total_vat or 0) + float(pkg_row.pkg_vat or 0)
                            else:
                                agg_total_cgst = float(agg_row.total_cgst or 0)
                                agg_total_sgst = float(agg_row.total_sgst or 0)
                                agg_total_igst = float(agg_row.total_igst or 0)
                                agg_total_vat = float(agg_row.total_vat or 0)
                        except Exception as pkg_err:
                            logger.debug(f"[INVOICE/HEADER] Packages aggregation skipped: {pkg_err}")
                            agg_total_cgst = float(agg_row.total_cgst or 0)
                            agg_total_sgst = float(agg_row.total_sgst or 0)
                            agg_total_igst = float(agg_row.total_igst or 0)
                            agg_total_vat = float(agg_row.total_vat or 0)

                        # Inventory (products) table aggregation
                        try:
                            inv_tbl = SQLATable('billing_trans_inventory', md_extra, autoload_with=engine)
                            inv_cols = inv_tbl.c
                            inv_stmt = select(
                                func.sum(func.coalesce(inv_cols.qty, 0) * func.coalesce(inv_cols.unit_price, 0)).label('inv_subtotal'),
                                func.sum(func.coalesce(inv_cols.discount_amount, 0)).label('inv_discount'),
                                func.sum(func.coalesce(inv_cols.tax_amount, 0)).label('inv_tax'),
                                func.sum(func.coalesce(inv_cols.total_cgst, 0)).label('inv_cgst'),
                                func.sum(func.coalesce(inv_cols.total_sgst, 0)).label('inv_sgst'),
                                func.sum(func.coalesce(inv_cols.total_igst, 0)).label('inv_igst'),
                                func.sum(func.coalesce(inv_cols.total_vat, 0)).label('inv_vat'),
                                func.sum(func.coalesce(inv_cols.qty, 0)).label('inv_qty')
                            ).where(inv_cols.invoice_id == inv_id)
                            if 'account_code' in inv_cols.keys():
                                inv_stmt = inv_stmt.where(inv_cols.account_code == acc_code)
                            if 'retail_code' in inv_cols.keys():
                                inv_stmt = inv_stmt.where(inv_cols.retail_code == ret_code)
                            inv_row = conn.execute(inv_stmt).first()
                            if inv_row:
                                subtotal += float(inv_row.inv_subtotal or 0)
                                discount_sum += float(inv_row.inv_discount or 0)
                                tax_amount += float(inv_row.inv_tax or 0)
                                qty_total += float(inv_row.inv_qty or 0)
                                # Add tax components to aggregates
                                agg_total_cgst += float(inv_row.inv_cgst or 0)
                                agg_total_sgst += float(inv_row.inv_sgst or 0)
                                agg_total_igst += float(inv_row.inv_igst or 0)
                                agg_total_vat += float(inv_row.inv_vat or 0)
                        except Exception as inv_err:
                            logger.debug(f"[INVOICE/HEADER] Inventory aggregation skipped: {inv_err}")

                    except Exception as extra_err:
                        logger.debug(f"[INVOICE/HEADER] Extra totals aggregation error: {extra_err}")

                    # Final totals (aggregated from services + packages + inventory)
                    taxable_amount = max(subtotal - discount_sum, 0.0)
                    base_grand_total = taxable_amount + tax_amount

                    # Ensure we have the first line dict before reading round_off
                    first_line_dict = first_line.dict()
                    # Add round off amount from first line if provided
                    round_off_amount = 0.0
                    try:
                        round_off_amount = float(first_line_dict.get('round_off', 0) or 0)
                    except Exception:
                        round_off_amount = 0.0

                    # Prefer payload overrides when provided
                    try:
                        tax_amount_override = first_line_dict.get('tax_amount_total')
                        if tax_amount_override not in (None, ''):
                            tax_amount = float(tax_amount_override)
                    except Exception:
                        pass

                    # Compute grand total and override if payload provides it
                    grand_total = base_grand_total + round_off_amount
                    try:
                        grand_override = first_line_dict.get('grand_total')
                        if grand_override not in (None, ''):
                            grand_total = float(grand_override)
                    except Exception:
                        pass

                    txn_cols = set(txn_tbl.c.keys())

                    def first_existing(*cands: str) -> Optional[str]:
                        for c in cands:
                            if c in txn_cols:
                                return c
                        return None

                    # Derive markup percent if not explicitly provided
                    markup_amount_per_unit = first_line_dict.get('markup_amount_per_unit')
                    base_price_fl = first_line_dict.get('base_price')
                    unit_price_fl = first_line_dict.get('unit_price')
                    markup_percent_applied = first_line_dict.get('markup_percent_applied')
                    try:
                        if markup_percent_applied is None and base_price_fl not in (None, 0) and unit_price_fl not in (None, 0):
                            diff = (unit_price_fl or 0) - (base_price_fl or 0)
                            if diff and base_price_fl:
                                markup_percent_applied = round((diff / base_price_fl) * 100, 3)
                        if markup_amount_per_unit is None and base_price_fl not in (None,) and unit_price_fl not in (None,):
                            markup_amount_per_unit = round((unit_price_fl or 0) - (base_price_fl or 0), 3)
                    except Exception:
                        pass

                    header_row: Dict[str, Any] = {
                        'account_code': acc_code,
                        'retail_code': ret_code,
                        'invoice_id': inv_id,
                    }
                    if generated_sequence_id is not None and 'sequence_id' in txn_cols:
                        header_row['sequence_id'] = generated_sequence_id

                    # Prepare tax split totals and allow payload overrides
                    try:
                        cg_total = float(agg_total_cgst if 'agg_total_cgst' in locals() else (agg_row.total_cgst or 0))
                    except Exception:
                        cg_total = float(agg_row.total_cgst or 0)
                    try:
                        sg_total = float(agg_total_sgst if 'agg_total_sgst' in locals() else (agg_row.total_sgst or 0))
                    except Exception:
                        sg_total = float(agg_row.total_sgst or 0)
                    try:
                        ig_total = float(agg_total_igst if 'agg_total_igst' in locals() else (agg_row.total_igst or 0))
                    except Exception:
                        ig_total = float(agg_row.total_igst or 0)
                    try:
                        vt_total = float(agg_total_vat if 'agg_total_vat' in locals() else (agg_row.total_vat or 0))
                    except Exception:
                        vt_total = float(agg_row.total_vat or 0)

                    try:
                        override_cgst = first_line_dict.get('total_cgst')
                        override_sgst = first_line_dict.get('total_sgst')
                        override_igst = first_line_dict.get('total_igst')
                        override_vat = first_line_dict.get('total_vat')
                        if override_cgst not in (None, ''):
                            cg_total = float(override_cgst)
                        if override_sgst not in (None, ''):
                            sg_total = float(override_sgst)
                        if override_igst not in (None, ''):
                            ig_total = float(override_igst)
                        if override_vat not in (None, ''):
                            vt_total = float(override_vat)
                    except Exception:
                        pass

                    # Map dual/synonym columns
                    col_map_values = [
                        (subtotal, ('subtotal_amount', 'subtotal')),  # support either name
                        (discount_sum, ('discount_amount',)),
                        (taxable_amount, ('taxable_amount',)),
                        (tax_amount, ('tax_amount',)),
                        (grand_total, ('grand_total', 'total_amount', 'total')),  # flexible naming
                        (round_off_amount, ('round_off', 'roundoff_amount', 'roundoff')),  # round off amount (support legacy column name)
                        (qty_total, ('quantity', 'qty_total')),
                        (tax_rate_percent, ('tax_rate_percent', 'tax_percent')),
                        (cg_total, ('total_cgst',)),
                        (sg_total, ('total_sgst',)),
                        (ig_total, ('total_igst',)),
                        (vt_total, ('total_vat',)),
                        (base_price_fl, ('base_price',)),
                        (unit_price_fl if unit_price_fl is not None else (round(subtotal / qty_total, 2) if qty_total else None), ('unit_price',)),
                        (markup_percent_applied, ('markup_percent_applied',)),
                        (markup_amount_per_unit, ('markup_amount_per_unit',)),
                    ]
                    for val, cands in col_map_values:
                        if val is None:
                            continue
                        col_name = first_existing(*cands)
                        if col_name:
                            header_row[col_name] = val

                    # Employee / customer fields + membership info
                    for f in ['employee_id','employee_name','employee_level','employee_percent','customer_name','customer_number','customer_id']:
                        if f in txn_cols and first_line_dict.get(f) not in (None, ''):
                            header_row[f] = first_line_dict.get(f)
                        elif f in txn_cols:
                            logger.debug(f"[INVOICE/HEADER] Field '{f}' present in table but not provided/non-empty on first line; skipping")
                    # Payment mode fields if present on header table
                    try:
                        for f in ['payment_mode_id', 'payment_id', 'payment_method', 'payment_mode_name']:
                            if f in txn_cols and first_line_dict.get(f) not in (None, ''):
                                header_row[f] = first_line_dict.get(f)
                    except Exception:
                        pass
                    # membership_discount handled as part of discount_amount; no extra header persistence required
                    # Synonym / legacy typo mapping for customer columns
                    # Accept incoming customer_* fields and map to customerr_name / customer_mobile if present
                    try:
                        incoming_name = first_line_dict.get('customer_name') or first_line_dict.get('customer_name')
                        incoming_phone = (first_line_dict.get('customer_number') or 
                                         first_line_dict.get('custumer_number') or 
                                         first_line_dict.get('customer_number'))
                        if incoming_name:
                            if 'customerr_name' in txn_cols:
                                header_row['customerr_name'] = incoming_name
                            if 'customer_name' in txn_cols:
                                header_row['customer_name'] = incoming_name
                        if incoming_phone:
                            if 'customer_mobile' in txn_cols:
                                header_row['customer_mobile'] = incoming_phone
                            if 'customer_number' in txn_cols:
                                header_row['customer_number'] = incoming_phone
                        # customer_id already handled above, but ensure string compatibility
                        if 'customer_id' in txn_cols and first_line_dict.get('customer_id') not in (None,'') and 'customer_id' not in header_row:
                            header_row['customer_id'] = first_line_dict.get('customer_id')
                    except Exception as syn_err:
                        logger.debug(f"[INVOICE/HEADER] Customer synonym mapping skipped: {syn_err}")
                    # Ensure numeric NOT NULL columns at least have 0 default
                    for c in txn_tbl.c:
                        try:
                            if c.name not in header_row and not c.nullable and not c.primary_key and c.default is None and c.server_default is None:
                                # numeric vs string fallback
                                py_t = None
                                try:
                                    py_t = c.type.python_type
                                except Exception:
                                    pass
                                if py_t in (int, float):
                                    header_row[c.name] = 0
                                # Skip timestamps/audit which DB may default
                        except Exception:
                            pass
                    if 'created_by' in txn_cols:
                        header_row['created_by'] = username
                    if 'updated_by' in txn_cols:
                        header_row['updated_by'] = username

                    # Add billstatus based on invoice_status from payload
                    if 'billstatus' in txn_cols:
                        invoice_status = getattr(payload, 'invoice_status', None)
                        if invoice_status == 'hold':
                            header_row['billstatus'] = 'N'  # N for hold/draft bills
                        else:
                            header_row['billstatus'] = 'Y'  # Y for active/completed bills

                    # Determine if existing row present
                    exists_stmt = select(txn_tbl.c.id).where(txn_tbl.c.invoice_id == inv_id)
                    if 'account_code' in txn_cols:
                        exists_stmt = exists_stmt.where(txn_tbl.c.account_code == acc_code)
                    if 'retail_code' in txn_cols:
                        exists_stmt = exists_stmt.where(txn_tbl.c.retail_code == ret_code)
                    existing = conn.execute(exists_stmt).first()
                    if existing:
                        update_data = {k: v for k, v in header_row.items() if k != 'created_by'}
                        conn.execute(sql_update(txn_tbl).where(txn_tbl.c.id == existing.id).values(**update_data))
                        logger.debug(
                            "[INVOICE/HEADER] Updated billing_transactions invoice_id=%s keys=%s row=%s",
                            inv_id,
                            list(update_data.keys()),
                            {k: update_data[k] for k in sorted(update_data.keys())},
                        )
                    else:
                        conn.execute(insert(txn_tbl).values(**header_row))
                        logger.debug(
                            "[INVOICE/HEADER] Inserted billing_transactions invoice_id=%s keys=%s row=%s",
                            inv_id,
                            list(header_row.keys()),
                            {k: header_row[k] for k in sorted(header_row.keys())},
                        )
            # After header/paymode, upsert customer into master_customer
            try:
                created_customer_ids: list[Dict[str, Any]] = []
                if payload.lines:
                    first_line_dict = payload.lines[0].dict()
                    # Control visit count increment and credit logic based on invoice status
                    try:
                        _inv_status_for_visit = getattr(payload, 'invoice_status', None)
                    except Exception:
                        _inv_status_for_visit = None
                    _increment_visit_flag = (_inv_status_for_visit != 'hold')
                    _credit_allowed = (_inv_status_for_visit != 'hold')

                    # Add credit_amount from payload root only for active invoices.
                    # For HOLD bills, do not convert the pending amount into customer credit.
                    if _credit_allowed and hasattr(payload, 'credit_amount') and payload.credit_amount is not None:
                        first_line_dict['credit_amount'] = payload.credit_amount
                    cid_primary = _upsert_master_customer(conn, first_line_dict.get('account_code'), first_line_dict.get('retail_code'), first_line_dict, username, increment_visit=_increment_visit_flag)
                    try:
                        if cid_primary is not None:
                            created_customer_ids.append({
                                'source': 'header',
                                'customer_id': cid_primary,
                                'customer_name': first_line_dict.get('customer_name'),
                                'customer_number': first_line_dict.get('customer_number') or first_line_dict.get('customer_mobile')
                            })
                    except Exception:
                        pass

                    # Also upsert all customers present in customer_lines array
                    try:
                        if getattr(payload, 'customer_lines', None):
                            def _get(obj, key):
                                try:
                                    if isinstance(obj, dict):
                                        return obj.get(key)
                                    return getattr(obj, key, None)
                                except Exception:
                                    return None
                            def _norm_phone(v: Any) -> str:
                                try:
                                    return ''.join(ch for ch in str(v or '') if ch.isdigit())
                                except Exception:
                                    return ''

                            _primary_id_raw = str(first_line_dict.get('customer_id') or '').strip()
                            _primary_cid = str(cid_primary or '').strip()
                            _primary_phone_norm = _norm_phone(first_line_dict.get('customer_number') or first_line_dict.get('customer_mobile'))
                            for cl in payload.customer_lines or []:
                                # Build a minimal dict compatible with _upsert_master_customer
                                fld = {
                                    'customer_id': _get(cl, 'customer_id'),
                                    'customer_name': (_get(cl, 'customer_name') or _get(cl, 'name') or _get(cl, 'full_name')),
                                    'customer_number': (_get(cl, 'customer_number') or _get(cl, 'customer_mobile') or _get(cl, 'customer_phone')),
                                    'customer_gender': (_get(cl, 'customer_gender') or _get(cl, 'gender')),
                                    'membership_id': _get(cl, 'membership_id'),
                                    'membership_cardno': (_get(cl, 'membership_cardno') or _get(cl, 'card_number')),
                                    'birthday_date': _get(cl, 'birthday_date'),
                                    'anniversary_date': _get(cl, 'anniversary_date'),
                                    'address': (_get(cl, 'address') or _get(cl, 'customer_address')),
                                    'account_code': first_line_dict.get('account_code'),
                                    'retail_code': first_line_dict.get('retail_code'),
                                    # No credit addition for non-primary rows unless provided
                                    'credit_amount': ((_get(cl, 'credit_amount') or 0) if _credit_allowed else 0),
                                }
                                # Skip empty rows with neither name nor phone
                                if not (fld.get('customer_name') or fld.get('customer_number') or fld.get('customer_id')):
                                    continue

                                # Avoid incrementing visits twice for the same primary customer.
                                # Primary customer is already handled via the header upsert above.
                                is_primary_line = False
                                try:
                                    _cid = str(fld.get('customer_id') or '').strip()
                                    if _cid and _cid != '0':
                                        if _primary_cid and _cid == _primary_cid:
                                            is_primary_line = True
                                        elif _primary_id_raw and _cid == _primary_id_raw:
                                            is_primary_line = True
                                    if not is_primary_line:
                                        _p = _norm_phone(fld.get('customer_number'))
                                        if _primary_phone_norm and _p and _p == _primary_phone_norm:
                                            is_primary_line = True
                                except Exception:
                                    is_primary_line = False

                                # Treat string/integer 0 as no ID (new customer)
                                try:
                                    if str(fld.get('customer_id') or '').strip() in ('', '0'):
                                        fld['customer_id'] = None
                                except Exception:
                                    pass
                                cid_line = _upsert_master_customer(
                                    conn,
                                    fld.get('account_code'),
                                    fld.get('retail_code'),
                                    fld,
                                    username,
                                    increment_visit=(_increment_visit_flag and not is_primary_line),
                                )
                                try:
                                    if cid_line is not None:
                                        created_customer_ids.append({
                                            'source': 'customer_lines',
                                            'customer_id': cid_line,
                                            'customer_name': fld.get('customer_name'),
                                            'customer_number': fld.get('customer_number')
                                        })
                                except Exception:
                                    pass
                    except Exception as e:
                        logger.warning(f"[INVOICE/CUSTOMER_LINES][WARN] Failed processing customer_lines upserts: {e}")
                    
                    # Insert customer visit count record only when not on hold
                    customer_id = first_line_dict.get('customer_id')
                    try:
                        _inv_status_for_visit = getattr(payload, 'invoice_status', None)
                    except Exception:
                        _inv_status_for_visit = None
                    if customer_id and 'grand_total' in locals() and _inv_status_for_visit != 'hold':
                        _insert_customer_visit_count(
                            conn,
                            first_line_dict.get('account_code'),
                            first_line_dict.get('retail_code'),
                            customer_id,
                            grand_total,
                            first_line_dict.get('invoice_id')
                        )
                    
                    # Wallet ledger / credit sale should be recorded only for active invoices.
                    # For HOLD bills, skip customer_wallet_ledger inserts entirely.
                    if _credit_allowed:
                        # Determine credit amount: prefer payload.credit_amount; fallback to grand_total - sum(payment_modes.amount)
                        credit_amount = getattr(payload, 'credit_amount', None)
                        effective_credit = 0.0
                        try:
                            effective_credit = float(credit_amount or 0)
                        except Exception:
                            effective_credit = 0.0
                        if effective_credit <= 0:
                            try:
                                total_paid_calc = 0.0
                                for pm in (getattr(payload, 'payment_modes') or []):
                                    amt = pm.get('amount') if isinstance(pm, dict) else None
                                    try:
                                        total_paid_calc += float(amt or 0)
                                    except Exception:
                                        pass
                                if 'grand_total' in locals():
                                    effective_credit = max(float(grand_total or 0) - total_paid_calc, 0.0)
                            except Exception:
                                effective_credit = 0.0
                        if customer_id and effective_credit > 0:
                            invoice_id = first_line_dict.get('invoice_id')
                            _insert_customer_wallet_ledger(
                                conn,
                                first_line_dict.get('account_code'),
                                first_line_dict.get('retail_code'),
                                customer_id,
                                invoice_id,
                                effective_credit
                            )
                # Attach created/updated customer IDs to context for response
                try:
                    locals()['created_customer_ids'] = created_customer_ids
                except Exception:
                    pass
            except Exception as cust_up_e:
                logger.warning(f"[INVOICE/CUSTOMER][WARN] Master upsert failed: {cust_up_e}")
            # --- Payment upsert into billing_paymode (if table exists and payment provided) ---
            try:
                pay_tbl = _get_paymode_table()
                if pay_tbl is not None and payload.lines:
                    # Context
                    first_line = payload.lines[0]
                    first_line_dict = first_line.dict()
                    inv_id_local = first_line_dict.get('invoice_id')
                    acc_code_local = first_line_dict.get('account_code')
                    ret_code_local = first_line_dict.get('retail_code')

                    # Helper to insert one payment row
                    def _insert_payment_row(mode_id: Any, mode_name: Any, amount_val: float):
                        pay_cols = set(pay_tbl.c.keys())
                        pay_row: Dict[str, Any] = {}
                        # Scope and linkage
                        if 'account_code' in pay_cols and acc_code_local is not None:
                            pay_row['account_code'] = acc_code_local
                        if 'retail_code' in pay_cols and ret_code_local is not None:
                            pay_row['retail_code'] = ret_code_local
                        link_col = None
                        for cand in ['billing_id', 'invoice_id', 'billingid', 'bill_id']:
                            if cand in pay_cols:
                                link_col = cand
                                break
                        if link_col and inv_id_local is not None:
                            pay_row[link_col] = inv_id_local
                        # Amount from provided value
                        for amt_col in ['amount', 'paid_amount', 'total_amount']:
                            if amt_col in pay_cols:
                                pay_row[amt_col] = float(amount_val or 0)
                                break
                        # IDs and names
                        if mode_id is not None:
                            for id_col in ['payment_mode_id', 'paymode_id', 'payment_id', 'mode_id']:
                                if id_col in pay_cols and id_col not in pay_row:
                                    try:
                                        pay_row[id_col] = int(mode_id)
                                    except Exception:
                                        pay_row[id_col] = mode_id
                                    break
                        for txt_col in ['payment_method', 'payment_mode', 'mode', 'payment_mode_name', 'paymode_name']:
                            if txt_col in pay_cols and mode_name not in (None, '') and txt_col not in pay_row:
                                pay_row[txt_col] = mode_name
                                break
                        # Status: partial if credit_amount > 0, else PAID
                        if 'status' in pay_cols and 'status' not in pay_row:
                            try:
                                is_partial = float(getattr(payload, 'credit_amount', 0) or 0) > 0
                            except Exception:
                                is_partial = False
                            pay_row['status'] = 'PARTIAL' if is_partial else 'PAID'
                        if 'created_by' in pay_cols:
                            pay_row['created_by'] = username
                        if 'updated_by' in pay_cols:
                            pay_row['updated_by'] = username

                        # Fill required non-nullables
                        try:
                            for c in pay_tbl.c:
                                if c.name in pay_row or c.primary_key:
                                    continue
                                if getattr(c, 'nullable', True) is False and c.default is None and c.server_default is None:
                                    try:
                                        py_t = c.type.python_type
                                    except Exception:
                                        py_t = str
                                    if py_t is int:
                                        pay_row[c.name] = 0
                                    elif py_t is float:
                                        pay_row[c.name] = 0.0
                                    else:
                                        pay_row[c.name] = ''
                        except Exception:
                            pass

                        # Insert (allow multiple payments per invoice)
                        conn.execute(insert(pay_tbl).values(**pay_row))
                        logger.debug("[INVOICE/PAYMODE] Inserted billing_paymode for %s (mode=%s amount=%.2f)", inv_id_local, mode_name, amount_val)

                    # Prefer new payload.payment_modes array
                    if getattr(payload, 'payment_modes', None):
                        total_paid = 0.0
                        for pm in getattr(payload, 'payment_modes') or []:
                            mode_id = pm.get('payment_mode_id') if isinstance(pm, dict) else None
                            mode_name = pm.get('payment_mode_name') if isinstance(pm, dict) else None
                            amount_val = pm.get('amount') if isinstance(pm, dict) else 0
                            try:
                                amount_val = float(amount_val or 0)
                            except Exception:
                                amount_val = 0.0
                            total_paid += amount_val
                            _insert_payment_row(mode_id, mode_name, amount_val)
                        logger.info("[INVOICE/PAYMODE] Processed %d payment modes; total paid=%.2f; credit=%.2f", len(getattr(payload, 'payment_modes') or []), total_paid, float(getattr(payload, 'credit_amount', 0) or 0))
                    else:
                        # Backward-compatible single payment from first line fields
                        pm_id = (first_line_dict.get('payment_mode_id') or first_line_dict.get('payment_id') or first_line_dict.get('paymode_id') or first_line_dict.get('mode_id'))
                        pm_method = first_line_dict.get('payment_method') or first_line_dict.get('payment_mode') or first_line_dict.get('mode') or first_line_dict.get('payment_mode_name')
                        # Derive amount from grand_total (aggregate) if available
                        grand_total_local = None
                        try:
                            grand_total_local = grand_total  # type: ignore[name-defined]
                        except Exception:
                            grand_total_local = None
                        if grand_total_local is None:
                            try:
                                line_cols_gt = tbl.c
                                agg_stmt_gt = select(
                                    func.sum(line_cols_gt.qty * line_cols_gt.unit_price).label('subtotal'),
                                    func.sum(func.coalesce(line_cols_gt.discount_amount, 0)).label('discount_sum'),
                                    func.sum(func.coalesce(line_cols_gt.tax_amount, 0)).label('tax_amount'),
                                ).where(line_cols_gt.invoice_id == inv_id_local)
                                if 'account_code' in line_cols_gt.keys() and acc_code_local:
                                    agg_stmt_gt = agg_stmt_gt.where(line_cols_gt.account_code == acc_code_local)
                                if 'retail_code' in line_cols_gt.keys() and ret_code_local:
                                    agg_stmt_gt = agg_stmt_gt.where(line_cols_gt.retail_code == ret_code_local)
                                agg_row_gt = conn.execute(agg_stmt_gt).first()
                                if agg_row_gt:
                                    subtotal_gt = float(agg_row_gt.subtotal or 0)
                                    discount_sum_gt = float(agg_row_gt.discount_sum or 0)
                                    tax_amount_gt = float(agg_row_gt.tax_amount or 0)
                                    taxable_gt = max(subtotal_gt - discount_sum_gt, 0.0)
                                    grand_total_local = taxable_gt + tax_amount_gt
                            except Exception:
                                grand_total_local = None
                        if grand_total_local is None:
                            try:
                                grand_total_local = float(first_line_dict.get('grand_total') or 0)
                            except Exception:
                                grand_total_local = 0.0
                        if pm_id is not None or (pm_method not in (None, '')):
                            _insert_payment_row(pm_id, pm_method, float(grand_total_local or 0))
            except Exception as pay_e:
                logger.warning(f"[INVOICE/PAYMODE][WARN] {pay_e}")
        except Exception as header_err:
            logger.warning(f"[INVOICE/HEADER][WARN] Failed header upsert: {header_err}")
        # --- Optional inserts into billing_trans_packages ---
        try:
            logger.info(f"[PKG_LINES] Checking package_lines: exists={hasattr(payload, 'package_lines')}, value={getattr(payload, 'package_lines', None)}")
            logger.info(f"[PKG_LINES] Package lines type: {type(payload.package_lines) if hasattr(payload, 'package_lines') else 'N/A'}")
            if hasattr(payload, 'package_lines') and payload.package_lines is not None:
                logger.info(f"[PKG_LINES] Package lines length: {len(payload.package_lines)}")
                logger.info(f"[PKG_LINES] Package lines content: {payload.package_lines}")
            
            if payload.package_lines:
                logger.info(f"[PKG_LINES] Processing {len(payload.package_lines)} package lines")
                
                # Get the current invoice_id from the first line (in case it was generated)
                current_invoice_id = None
                if payload.lines:
                    current_invoice_id = getattr(payload.lines[0], 'invoice_id', None)
                    logger.info(f"[PKG_LINES] Using invoice_id from lines: {current_invoice_id}")
                
                from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                md_pkg = SQLAMetaData()
                pkg_tbl = SQLATable('billing_trans_packages', md_pkg, autoload_with=engine)
                pkg_cols = set(pkg_tbl.c.keys())
                logger.info(f"[PKG_LINES] Package table columns: {sorted(pkg_cols)}")
                
                # Check if table is empty initially
                try:
                    count_before = conn.execute(select(func.count()).select_from(pkg_tbl)).scalar()
                    logger.info(f"[PKG_LINES] Package table row count before insertion: {count_before}")
                except Exception as count_err:
                    logger.warning(f"[PKG_LINES] Could not count rows before insertion: {count_err}")
                
                for i, p in enumerate(payload.package_lines):
                    logger.info(f"[PKG_LINES] Processing package line {i+1}: {p}")
                    row = dict(p)
                    
                    # Ensure we're using the correct invoice_id 
                    if current_invoice_id and 'invoice_id' in pkg_cols:
                        row['invoice_id'] = current_invoice_id
                        logger.info(f"[PKG_LINES] Updated package line {i+1} invoice_id to: {current_invoice_id}")
                    
                    # Coerce numeric fields
                    for k in ['qty','unit_price','tax_rate_percent','total_cgst','total_sgst','total_igst','total_vat','tax_amount','discount_amount','grand_total']:
                        if k in row and row[k] is not None:
                            try:
                                row[k] = float(row[k]) if k != 'qty' else int(row[k])
                            except Exception:
                                row[k] = 0 if k != 'unit_price' else 0.0
                    # Defaults
                    row.setdefault('qty', 1)
                    row.setdefault('tax_id', '0')
                    row.setdefault('tax_rate_percent', 0.0)
                    row.setdefault('total_cgst', 0.0)
                    row.setdefault('total_sgst', 0.0)
                    row.setdefault('total_igst', 0.0)
                    row.setdefault('total_vat', 0.0)
                    row.setdefault('tax_amount', 0.0)
                    row.setdefault('discount_amount', 0.0)
                    row.setdefault('grand_total', 0.0)
                    # Audit
                    if 'created_by' in pkg_cols:
                        row['created_by'] = row.get('created_by') or username
                    if 'updated_by' in pkg_cols:
                        row['updated_by'] = row.get('updated_by') or username
                    # Staff assignment: propagate employee_id if available in first line
                    try:
                        if 'employee_id' in pkg_cols:
                            if 'employee_id' in row and row['employee_id'] not in (None, ''):
                                pass
                            else:
                                if payload.lines:
                                    first_emp = getattr(payload.lines[0], 'employee_id', None)
                                    if first_emp not in (None, ''):
                                        row['employee_id'] = first_emp
                    except Exception:
                        pass
                    # Keep only table columns
                    row = {k: v for k, v in row.items() if k in pkg_cols}
                    logger.info(f"[PKG_LINES] Inserting package row {i+1}: {row}")
                    try:
                        insert_stmt = insert(pkg_tbl).values(**row)
                        logger.info(f"[PKG_LINES] Insert statement for row {i+1}: {str(insert_stmt)}")
                        result = conn.execute(insert_stmt)
                        logger.info(f"[PKG_LINES] Successfully inserted package row {i+1}, result: {result}")
                        if hasattr(result, 'inserted_primary_key'):
                            logger.info(f"[PKG_LINES] Inserted primary key: {result.inserted_primary_key}")
                    except Exception as insert_err:
                        logger.error(f"[PKG_LINES] Failed to insert package row {i+1}: {insert_err}")
                        logger.error(f"[PKG_LINES] Row data that failed: {row}")
                        raise
                logger.info(f"[PKG_LINES] Successfully inserted {len(payload.package_lines)} package rows")
                
                # Verify insertions
                try:
                    count_after = conn.execute(select(func.count()).select_from(pkg_tbl)).scalar()
                    logger.info(f"[PKG_LINES] Package table row count after insertion: {count_after}")
                    
                    # Check if our specific invoice has packages
                    if current_invoice_id:
                        invoice_count = conn.execute(
                            select(func.count()).select_from(pkg_tbl).where(
                                pkg_tbl.c.invoice_id == current_invoice_id
                            )
                        ).scalar()
                        logger.info(f"[PKG_LINES] Packages for invoice {current_invoice_id}: {invoice_count}")
                except Exception as verify_err:
                    logger.warning(f"[PKG_LINES] Could not verify insertions: {verify_err}")
            else:
                logger.info("[PKG_LINES] No package_lines to process")
        except Exception as e:
            logger.error(f"[PKG_LINES][ERROR] Package insertion failed: {e}")
            logger.error(f"[PKG_LINES][ERROR] Exception details: {traceback.format_exc()}")
            # Don't raise to allow invoice creation to continue
        # --- Optional inserts into billing_trans_inventory ---
        try:
            logger.info(f"[INV_LINES] Checking inventory_lines: exists={hasattr(payload, 'inventory_lines')}, value={getattr(payload, 'inventory_lines', None)}")
            logger.info(f"[INV_LINES] Inventory lines type: {type(payload.inventory_lines) if hasattr(payload, 'inventory_lines') else 'N/A'}")
            if hasattr(payload, 'inventory_lines') and payload.inventory_lines is not None:
                logger.info(f"[INV_LINES] Inventory lines length: {len(payload.inventory_lines)}")
                logger.info(f"[INV_LINES] Inventory lines content: {payload.inventory_lines}")
            
            if payload.inventory_lines:
                logger.info(f"[INV_LINES] Processing {len(payload.inventory_lines)} inventory lines")
                
                # Get the current invoice_id from the first line (in case it was generated)
                current_invoice_id = None
                if payload.lines:
                    current_invoice_id = getattr(payload.lines[0], 'invoice_id', None)
                    logger.info(f"[INV_LINES] Using invoice_id from lines: {current_invoice_id}")
                
                from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                md_inv = SQLAMetaData()
                inv_tbl = SQLATable('billing_trans_inventory', md_inv, autoload_with=engine)
                inv_cols = set(inv_tbl.c.keys())
                logger.info(f"[INV_LINES] Inventory table columns: {sorted(inv_cols)}")
                
                # Check if table is empty initially
                try:
                    count_before = conn.execute(select(func.count()).select_from(inv_tbl)).scalar()
                    logger.info(f"[INV_LINES] Inventory table row count before insertion: {count_before}")
                except Exception as count_err:
                    logger.warning(f"[INV_LINES] Could not count rows before insertion: {count_err}")
                
                for i, it in enumerate(payload.inventory_lines):
                    logger.info(f"[INV_LINES] Processing inventory line {i+1}: {it}")
                    row = dict(it)
                    
                    # Ensure we're using the correct invoice_id 
                    if current_invoice_id and 'invoice_id' in inv_cols:
                        row['invoice_id'] = current_invoice_id
                        logger.info(f"[INV_LINES] Updated inventory line {i+1} invoice_id to: {current_invoice_id}")
                    
                    # Coerce numeric fields
                    for k in ['qty','unit_price','tax_rate_percent','total_cgst','total_sgst','total_igst','total_vat','tax_amount','discount_amount','grand_total']:
                        if k in row and row[k] is not None:
                            try:
                                row[k] = float(row[k]) if k != 'qty' else int(row[k])
                            except Exception:
                                row[k] = 0 if k != 'unit_price' else 0.0
                    # Fill missing product_name from master_inventory if possible
                    try:
                        if (not row.get('product_name')) and row.get('product_id'):
                            from sqlalchemy import MetaData as SQLAMetaData2, Table as SQLATable2
                            md_mi = SQLAMetaData2()
                            inv_master_tbl = SQLATable2('master_inventory', md_mi, autoload_with=engine)
                            q = select(inv_master_tbl.c.item_name).where(inv_master_tbl.c.id == int(str(row.get('product_id'))))
                            name_row = conn.execute(q).first()
                            if name_row and 'item_name' in name_row._mapping:
                                row['product_name'] = name_row._mapping['item_name']
                    except Exception as _mi_err:
                        logger.debug(f"[INV_LINES] Could not backfill product_name from master_inventory: {_mi_err}")
                    # Defaults
                    row.setdefault('qty', 1)
                    row.setdefault('tax_id', '0')
                    row.setdefault('tax_rate_percent', 0.0)
                    row.setdefault('total_cgst', 0.0)
                    row.setdefault('total_sgst', 0.0)
                    row.setdefault('total_igst', 0.0)
                    row.setdefault('total_vat', 0.0)
                    row.setdefault('tax_amount', 0.0)
                    row.setdefault('discount_amount', 0.0)
                    row.setdefault('grand_total', 0.0)
                    # Audit
                    if 'created_by' in inv_cols:
                        row['created_by'] = row.get('created_by') or username
                    if 'updated_by' in inv_cols:
                        row['updated_by'] = row.get('updated_by') or username
                    # Staff assignment: propagate employee_id if available in first line
                    try:
                        if 'employee_id' in inv_cols:
                            if 'employee_id' in row and row['employee_id'] not in (None, ''):
                                pass
                            else:
                                if payload.lines:
                                    first_emp = getattr(payload.lines[0], 'employee_id', None)
                                    if first_emp not in (None, ''):
                                        row['employee_id'] = first_emp
                    except Exception:
                        pass
                    # Keep only table columns
                    row = {k: v for k, v in row.items() if k in inv_cols}
                    logger.info(f"[INV_LINES] Inserting inventory row {i+1}: {row}")
                    try:
                        insert_stmt = insert(inv_tbl).values(**row)
                        logger.info(f"[INV_LINES] Insert statement for row {i+1}: {str(insert_stmt)}")
                        result = conn.execute(insert_stmt)
                        logger.info(f"[INV_LINES] Successfully inserted inventory row {i+1}, result: {result}")
                        if hasattr(result, 'inserted_primary_key'):
                            logger.info(f"[INV_LINES] Inserted primary key: {result.inserted_primary_key}")
                    except Exception as insert_err:
                        logger.error(f"[INV_LINES] Failed to insert inventory row {i+1}: {insert_err}")
                        logger.error(f"[INV_LINES] Row data that failed: {row}")
                        raise
                
                logger.info(f"[INV_LINES] Successfully inserted {len(payload.inventory_lines)} inventory rows")
                
                # Verify insertions
                try:
                    count_after = conn.execute(select(func.count()).select_from(inv_tbl)).scalar()
                    logger.info(f"[INV_LINES] Inventory table row count after insertion: {count_after}")
                    
                    # Check if our specific invoice has inventory items
                    if current_invoice_id:
                        invoice_count = conn.execute(
                            select(func.count()).select_from(inv_tbl).where(
                                inv_tbl.c.invoice_id == current_invoice_id
                            )
                        ).scalar()
                        logger.info(f"[INV_LINES] Inventory items for invoice {current_invoice_id}: {invoice_count}")
                except Exception as verify_err:
                    logger.warning(f"[INV_LINES] Could not verify insertions: {verify_err}")
            else:
                logger.info("[INV_LINES] No inventory_lines to process")
        except Exception as e:
            logger.error(f"[INV_LINES][ERROR] Inventory insertion failed: {e}")
            logger.error(f"[INV_LINES][ERROR] Exception details: {traceback.format_exc()}")
            # Don't raise to allow invoice creation to continue
        # Recompute and update billing_transactions header totals after all inserts
        try:
            txn_tbl = _get_txn_table()
            if txn_tbl is not None and payload.lines:
                inv_id = payload.lines[0].invoice_id
                acc_code = getattr(payload.lines[0], 'account_code', None)
                ret_code = getattr(payload.lines[0], 'retail_code', None)

                # Services aggregation
                try:
                    svc_tbl = _get_table()
                    svc_cols = svc_tbl.c
                    svc_stmt = select(
                        func.sum(func.coalesce(svc_cols.qty, 0) * func.coalesce(svc_cols.unit_price, 0)).label('sub'),
                        func.sum(func.coalesce(svc_cols.discount_amount, 0)).label('disc'),
                        func.sum(func.coalesce(svc_cols.tax_amount, 0)).label('tax'),
                        func.sum(func.coalesce(svc_cols.total_cgst, 0)).label('cgst'),
                        func.sum(func.coalesce(svc_cols.total_sgst, 0)).label('sgst'),
                        func.sum(func.coalesce(svc_cols.total_igst, 0)).label('igst'),
                        func.sum(func.coalesce(svc_cols.total_vat, 0)).label('vat'),
                        func.sum(func.coalesce(svc_cols.qty, 0)).label('qty')
                    ).where(svc_cols.invoice_id == inv_id)
                    if acc_code and 'account_code' in svc_cols.keys():
                        svc_stmt = svc_stmt.where(svc_cols.account_code == acc_code)
                    if ret_code and 'retail_code' in svc_cols.keys():
                        svc_stmt = svc_stmt.where(svc_cols.retail_code == ret_code)
                    svc_row = conn.execute(svc_stmt).first()
                except Exception:
                    svc_row = None

                sub = float((svc_row.sub if svc_row else 0) or 0)
                disc = float((svc_row.disc if svc_row else 0) or 0)
                tax = float((svc_row.tax if svc_row else 0) or 0)
                cgst = float((svc_row.cgst if svc_row else 0) or 0)
                sgst = float((svc_row.sgst if svc_row else 0) or 0)
                igst = float((svc_row.igst if svc_row else 0) or 0)
                vat = float((svc_row.vat if svc_row else 0) or 0)
                qty_total = float((svc_row.qty if svc_row else 0) or 0)

                # Packages aggregation
                try:
                    from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                    md_r = SQLAMetaData()
                    pkg_tbl = SQLATable('billing_trans_packages', md_r, autoload_with=engine)
                    p = pkg_tbl.c
                    pkg_stmt = select(
                        func.sum(func.coalesce(p.qty, 0) * func.coalesce(p.unit_price, 0)),
                        func.sum(func.coalesce(p.discount_amount, 0)),
                        func.sum(func.coalesce(p.tax_amount, 0)),
                        func.sum(func.coalesce(p.total_cgst, 0)),
                        func.sum(func.coalesce(p.total_sgst, 0)),
                        func.sum(func.coalesce(p.total_igst, 0)),
                        func.sum(func.coalesce(p.total_vat, 0)),
                        func.sum(func.coalesce(p.qty, 0))
                    ).where(p.invoice_id == inv_id)
                    if acc_code and 'account_code' in p.keys():
                        pkg_stmt = pkg_stmt.where(p.account_code == acc_code)
                    if ret_code and 'retail_code' in p.keys():
                        pkg_stmt = pkg_stmt.where(p.retail_code == ret_code)
                    r = conn.execute(pkg_stmt).first()
                    if r:
                        sub += float(r[0] or 0)
                        disc += float(r[1] or 0)
                        tax += float(r[2] or 0)
                        cgst += float(r[3] or 0)
                        sgst += float(r[4] or 0)
                        igst += float(r[5] or 0)
                        vat += float(r[6] or 0)
                        qty_total += float(r[7] or 0)
                except Exception:
                    pass

                # Inventory aggregation
                try:
                    from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                    md_r2 = SQLAMetaData()
                    inv_tbl2 = SQLATable('billing_trans_inventory', md_r2, autoload_with=engine)
                    i = inv_tbl2.c
                    inv_stmt = select(
                        func.sum(func.coalesce(i.qty, 0) * func.coalesce(i.unit_price, 0)),
                        func.sum(func.coalesce(i.discount_amount, 0)),
                        func.sum(func.coalesce(i.tax_amount, 0)),
                        func.sum(func.coalesce(i.total_cgst, 0)),
                        func.sum(func.coalesce(i.total_sgst, 0)),
                        func.sum(func.coalesce(i.total_igst, 0)),
                        func.sum(func.coalesce(i.total_vat, 0)),
                        func.sum(func.coalesce(i.qty, 0))
                    ).where(i.invoice_id == inv_id)
                    if acc_code and 'account_code' in i.keys():
                        inv_stmt = inv_stmt.where(i.account_code == acc_code)
                    if ret_code and 'retail_code' in i.keys():
                        inv_stmt = inv_stmt.where(i.retail_code == ret_code)
                    r2 = conn.execute(inv_stmt).first()
                    if r2:
                        sub += float(r2[0] or 0)
                        disc += float(r2[1] or 0)
                        tax += float(r2[2] or 0)
                        cgst += float(r2[3] or 0)
                        sgst += float(r2[4] or 0)
                        igst += float(r2[5] or 0)
                        vat += float(r2[6] or 0)
                        qty_total += float(r2[7] or 0)
                except Exception:
                    pass

                taxable = max(sub - disc, 0.0)
                base_grand_total = taxable + tax
                
                # Get round_off, prefer payload override when present
                round_off_amount = 0.0
                try:
                    if payload and getattr(payload, 'lines', None):
                        _first_line_dict = payload.lines[0].dict()
                        if _first_line_dict.get('round_off') not in (None, ''):
                            round_off_amount = float(_first_line_dict.get('round_off') or 0)
                    if round_off_amount == 0.0:
                        first_line_stmt = select(svc_cols.round_off).where(svc_cols.invoice_id == inv_id)
                        if acc_code and 'account_code' in svc_cols.keys():
                            first_line_stmt = first_line_stmt.where(svc_cols.account_code == acc_code)
                        if ret_code and 'retail_code' in svc_cols.keys():
                            first_line_stmt = first_line_stmt.where(svc_cols.retail_code == ret_code)
                        first_line_stmt = first_line_stmt.limit(1)
                        round_off_row = conn.execute(first_line_stmt).first()
                        if round_off_row and getattr(round_off_row, 'round_off', None) is not None:
                            round_off_amount = float(round_off_row.round_off)
                except Exception:
                    round_off_amount = 0.0

                # Prefer payload override for tax splits, tax and grand total
                try:
                    if payload and getattr(payload, 'lines', None):
                        _first_line_dict = payload.lines[0].dict()
                        # Tax split overrides
                        if _first_line_dict.get('total_cgst') not in (None, ''):
                            cgst = float(_first_line_dict.get('total_cgst') or 0)
                        if _first_line_dict.get('total_sgst') not in (None, ''):
                            sgst = float(_first_line_dict.get('total_sgst') or 0)
                        if _first_line_dict.get('total_igst') not in (None, ''):
                            igst = float(_first_line_dict.get('total_igst') or 0)
                        if _first_line_dict.get('total_vat') not in (None, ''):
                            vat = float(_first_line_dict.get('total_vat') or 0)
                        if _first_line_dict.get('tax_amount_total') not in (None, ''):
                            tax = float(_first_line_dict.get('tax_amount_total') or 0)
                except Exception:
                    pass

                grand_total = base_grand_total + round_off_amount
                try:
                    if payload and getattr(payload, 'lines', None):
                        _first_line_dict = payload.lines[0].dict()
                        if _first_line_dict.get('grand_total') not in (None, ''):
                            grand_total = float(_first_line_dict.get('grand_total') or 0)
                except Exception:
                    pass

                txn_cols = set(txn_tbl.c.keys())

                def first_existing(*cands: str) -> Optional[str]:
                    for c in cands:
                        if c in txn_cols:
                            return c
                    return None

                update_vals: Dict[str, Any] = {}
                def maybe_set(val, *names):
                    col = first_existing(*names)
                    if col is not None and val is not None:
                        update_vals[col] = val

                maybe_set(sub, 'subtotal_amount','subtotal')
                maybe_set(disc, 'discount_amount')
                maybe_set(taxable, 'taxable_amount')
                maybe_set(tax, 'tax_amount')
                maybe_set(grand_total, 'grand_total','total_amount','total')
                maybe_set(round_off_amount, 'round_off','roundoff_amount','roundoff')
                maybe_set(qty_total, 'quantity','qty_total')
                maybe_set(cgst, 'total_cgst')
                maybe_set(sgst, 'total_sgst')
                maybe_set(igst, 'total_igst')
                maybe_set(vat, 'total_vat')
                # Ensure billstatus reflects hold status while updating totals
                try:
                    invoice_status_local = getattr(payload, 'invoice_status', None)
                    if 'billstatus' in txn_cols:
                        # Default to 'Y' (active) when status not explicitly 'hold'
                        update_vals['billstatus'] = ('N' if invoice_status_local == 'hold' else 'Y')
                except Exception:
                    pass

                if update_vals:
                    upd = sql_update(txn_tbl).where(txn_tbl.c.invoice_id == inv_id)
                    if acc_code and 'account_code' in txn_cols:
                        upd = upd.where(txn_tbl.c.account_code == acc_code)
                    if ret_code and 'retail_code' in txn_cols:
                        upd = upd.where(txn_tbl.c.retail_code == ret_code)
                    conn.execute(upd.values(**update_vals))
                    logger.info(f"[INVOICE/HEADER/RECALC] Updated header totals for invoice {inv_id}: {update_vals}")
                    # Hard-ensure billstatus is 'Y' when updating in active mode
                    try:
                        invoice_status_local = getattr(payload, 'invoice_status', None)
                        if invoice_status_local != 'hold' and 'billstatus' in txn_cols:
                            _force_upd = sql_update(txn_tbl).where(txn_tbl.c.invoice_id == inv_id)
                            if acc_code and 'account_code' in txn_cols:
                                _force_upd = _force_upd.where(txn_tbl.c.account_code == acc_code)
                            if ret_code and 'retail_code' in txn_cols:
                                _force_upd = _force_upd.where(txn_tbl.c.retail_code == ret_code)
                            conn.execute(_force_upd.values(billstatus='Y'))
                            logger.info("[INVOICE/HEADER] Force-set billstatus='Y' for invoice %s", inv_id)
                    except Exception as _force_err:
                        logger.warning(f"[INVOICE/HEADER][WARN] Failed to force-set billstatus: {_force_err}")
                    # If billstatus moved to active ('Y'), reflect it in customer_visit_count
                    try:
                        if update_vals.get('billstatus') == 'Y':
                            # Prefer customer_id from payload first line if available
                            cust_id_to_update = None
                            try:
                                if payload and getattr(payload, 'lines', None):
                                    _first_line_dict = payload.lines[0].dict()
                                    cust_id_to_update = _first_line_dict.get('customer_id')
                                    acc_local = _first_line_dict.get('account_code') or acc_code
                                    ret_local = _first_line_dict.get('retail_code') or ret_code
                                else:
                                    acc_local = acc_code
                                    ret_local = ret_code
                            except Exception:
                                acc_local = acc_code
                                ret_local = ret_code
                            if cust_id_to_update:
                                _update_customer_visit_billstatus(conn, acc_local, ret_local, cust_id_to_update, 'Y')
                    except Exception as _bs_err:
                        logger.warning(f"[CUSTOMER_VISIT_COUNT][WARN] Failed to update billstatus after header update: {_bs_err}")
        except Exception as recompute_err:
            logger.warning(f"[INVOICE/HEADER/RECALC] Failed to recompute header totals: {recompute_err}")
    return {
        "success": True,
        "invoice_id": payload.lines[0].invoice_id if payload.lines else None,
        "inserted_count": len(inserted_ids),
        "inserted_ids": inserted_ids,
        "customer_ids": locals().get('created_customer_ids', [])
    }


def get_invoice_lines(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> Dict[str, Any]:
    tbl = _get_table()
    stmt = select(tbl).where(tbl.c.invoice_id == invoice_id)
    if account_code and 'account_code' in tbl.c:
        stmt = stmt.where(tbl.c.account_code == account_code)
    if retail_code and 'retail_code' in tbl.c:
        stmt = stmt.where(tbl.c.retail_code == retail_code)
    
    with engine.begin() as conn:
        rows = [dict(r._mapping) for r in conn.execute(stmt)]
        # Serialize timestamps on line rows
        for r in rows:
            for k, v in list(r.items()):
                if k.endswith('_at'):
                    r[k] = _serialize_ts(v)
        
        # Also fetch header data from billing_transactions if available
        header_data = {}
        txn_tbl = _get_txn_table()
        if txn_tbl is not None:
            try:
                header_stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
                if account_code and 'account_code' in txn_tbl.c:
                    header_stmt = header_stmt.where(txn_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in txn_tbl.c:
                    header_stmt = header_stmt.where(txn_tbl.c.retail_code == retail_code)
                header_row = conn.execute(header_stmt).first()
                if header_row:
                    header_data = dict(header_row._mapping)
                    for k, v in list(header_data.items()):
                        if k.endswith('_at'):
                            header_data[k] = _serialize_ts(v)
            except Exception:
                pass
                
        # Also fetch payment data from billing_paymode if available
        payment_data = {}
        payments_list: list[dict] = []
        pay_tbl = _get_paymode_table()
        if pay_tbl is not None:
            try:
                pay_stmt = select(pay_tbl)
                link_col = 'billing_id' if 'billing_id' in pay_tbl.c else ('invoice_id' if 'invoice_id' in pay_tbl.c else None)
                if link_col:
                    pay_stmt = pay_stmt.where(getattr(pay_tbl.c, link_col) == invoice_id)
                if account_code and 'account_code' in pay_tbl.c:
                    pay_stmt = pay_stmt.where(pay_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in pay_tbl.c:
                    pay_stmt = pay_stmt.where(pay_tbl.c.retail_code == retail_code)
                pay_rows = conn.execute(pay_stmt).fetchall()
                for pr in pay_rows:
                    pmap = dict(pr._mapping)
                    for k, v in list(pmap.items()):
                        if isinstance(k, str) and k.endswith('_at'):
                            pmap[k] = _serialize_ts(v)
                    # Resolve payment mode name per row if missing
                    if 'payment_method' not in pmap and (pmap.get('payment_mode_id') is not None or pmap.get('payment_id') is not None):
                        try:
                            md_local = MetaData()
                            pm_value = pmap.get('payment_mode_id') or pmap.get('payment_id')
                            pm_value_str = str(pm_value)
                            for pm_table_name in ['master_paymentmodes', 'master_payment_mode', 'master_paymode', 'master_payment_modes']:
                                try:
                                    pm_tbl = Table(pm_table_name, md_local, autoload_with=engine)
                                except Exception:
                                    continue
                                candidate_cols = ['payment_mode_id', 'payment_id', 'paymode_id', 'mode_id', 'id']
                                where_clause = None
                                for col in candidate_cols:
                                    if col in pm_tbl.c.keys():
                                        try:
                                            clause = (pm_tbl.c[col] == pm_value_str) if pm_tbl.c[col].type.python_type is str else (pm_tbl.c[col] == pm_value)
                                        except Exception:
                                            clause = (pm_tbl.c[col] == pm_value)
                                        where_clause = clause if where_clause is None else (where_clause | clause)
                                if where_clause is None:
                                    continue
                                pm_stmt = select(pm_tbl).where(where_clause)
                                if account_code and 'account_code' in pm_tbl.c.keys():
                                    pm_stmt = pm_stmt.where(pm_tbl.c.account_code == account_code)
                                if retail_code and 'retail_code' in pm_tbl.c.keys():
                                    pm_stmt = pm_stmt.where(pm_tbl.c.retail_code == retail_code)
                                pm_row = conn.execute(pm_stmt).first()
                                if pm_row:
                                    pm_data = dict(pm_row._mapping)
                                    payment_name = (
                                        pm_data.get('payment_mode_name') or
                                        pm_data.get('paymode_name') or
                                        pm_data.get('payment_name') or
                                        pm_data.get('mode_name') or
                                        pm_data.get('name') or
                                        pm_data.get('payment_mode') or
                                        pm_data.get('payment_method') or
                                        ''
                                    )
                                    if payment_name:
                                        pmap['payment_method'] = str(payment_name)
                                    if payment_name and 'payment_mode_name' not in pmap:
                                        pmap['payment_mode_name'] = str(payment_name)
                                    break
                        except Exception:
                            pass
                    payments_list.append(pmap)
                # Maintain backward compatibility: expose first payment as `payment`
                if payments_list:
                    payment_data = dict(payments_list[0])
            except Exception:
                pass

        # Fetch package lines from billing_trans_packages if available
        packages: list[dict] = []
        try:
            from sqlalchemy import MetaData as _MD, Table as _T
            md_pkg = _MD()
            pkg_tbl = _T('billing_trans_packages', md_pkg, autoload_with=engine)
            pkg_stmt = select(pkg_tbl).where(pkg_tbl.c.invoice_id == invoice_id)
            if account_code and 'account_code' in pkg_tbl.c:
                pkg_stmt = pkg_stmt.where(pkg_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in pkg_tbl.c:
                pkg_stmt = pkg_stmt.where(pkg_tbl.c.retail_code == retail_code)
            pkg_rows = conn.execute(pkg_stmt).fetchall()
            for r in pkg_rows:
                d = dict(r._mapping)
                for k, v in list(d.items()):
                    if k.endswith('_at'):
                        d[k] = _serialize_ts(v)
                packages.append(d)
        except Exception:
            packages = []

        # Fetch inventory lines from billing_trans_inventory if available
        inventory: list[dict] = []
        try:
            from sqlalchemy import MetaData as _MD2, Table as _T2
            md_inv = _MD2()
            inv_tbl = _T2('billing_trans_inventory', md_inv, autoload_with=engine)
            inv_stmt = select(inv_tbl).where(inv_tbl.c.invoice_id == invoice_id)
            if account_code and 'account_code' in inv_tbl.c:
                inv_stmt = inv_stmt.where(inv_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in inv_tbl.c:
                inv_stmt = inv_stmt.where(inv_tbl.c.retail_code == retail_code)
            inv_rows = conn.execute(inv_stmt).fetchall()
            for r in inv_rows:
                d = dict(r._mapping)
                for k, v in list(d.items()):
                    if k.endswith('_at'):
                        d[k] = _serialize_ts(v)
                inventory.append(d)
        except Exception:
            inventory = []

        # Fetch wallet ledger entries linked to this invoice (credit/payment records)
        wallet: list[dict] = []
        credit_for_invoice: float = 0.0
        try:
            from sqlalchemy import MetaData as _MDW, Table as _TW
            md_w = _MDW()
            wallet_tbl = _TW('customer_wallet_ledger', md_w, autoload_with=engine)
            wstmt = select(wallet_tbl)
            # Link by invoice reference column available
            link_candidates = ['invoice_id', 'billing_id', 'bill_id', 'reference_id', 'ref_id', 'txn_ref', 'order_id']
            link_col = next((c for c in link_candidates if c in wallet_tbl.c.keys()), None)
            if link_col:
                wstmt = wstmt.where(getattr(wallet_tbl.c, link_col) == invoice_id)
            if account_code and 'account_code' in wallet_tbl.c.keys():
                wstmt = wstmt.where(wallet_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in wallet_tbl.c.keys():
                wstmt = wstmt.where(wallet_tbl.c.retail_code == retail_code)
            wrows = conn.execute(wstmt).fetchall()
            for r in wrows:
                d = dict(r._mapping)
                for k, v in list(d.items()):
                    if isinstance(k, str) and (k.endswith('_date') or k.endswith('_at')):
                        d[k] = _serialize_ts(v)
                wallet.append(d)
            # Compute credit amount for this invoice (CREDIT increases, PAYMENT decreases)
            try:
                tvals = 0.0
                for d in wallet:
                    # Determine type and amount columns dynamically
                    t = (d.get('txn_type') or d.get('type') or d.get('transaction_type') or '').upper()
                    amt = (d.get('amount') or d.get('txn_amount') or d.get('credit_amount') or d.get('value') or 0)
                    try:
                        amt = float(amt or 0)
                    except Exception:
                        amt = 0.0
                    if t == 'CREDIT':
                        tvals += amt
                    elif t == 'PAYMENT':
                        tvals -= amt
                credit_for_invoice = max(tvals, 0.0)
            except Exception:
                credit_for_invoice = 0.0
        except Exception:
            wallet = []
            credit_for_invoice = 0.0
    
    return {
        "success": True, 
        "invoice_id": invoice_id, 
        "count": len(rows), 
        "data": rows,
        "header": header_data,
        "payments": payments_list,
        "packages": packages,
        "inventory": inventory,
        "wallet": wallet,
        "credit_amount": credit_for_invoice
    }


def get_invoice_employee_names(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> List[str]:
    """Return unique employee names (or IDs if names unavailable) linked to invoice lines.

    Sources:
    - billing_trans_summary (services)
    - billing_trans_packages (packages)
    - billing_trans_inventory (inventory)

    Output is de-duplicated, preserves first-seen order.
    """

    def _dedupe_append(out: List[str], seen: set[str], val: Any) -> None:
        if val in (None, ''):
            return
        s = str(val).strip()
        if not s:
            return
        if s in seen:
            return
        seen.add(s)
        out.append(s)

    def _dedupe_append_id(out: List[str], seen: set[str], emp_id: Any) -> None:
        if emp_id in (None, ''):
            return
        s = str(emp_id).strip()
        if not s:
            return
        if s in seen:
            return
        seen.add(s)
        out.append(s)

    def _pick_col(tbl: Table, keys: List[str]) -> Optional[str]:
        for k in keys:
            if k in tbl.c.keys():
                return k
        return None

    # Only look at employee-specific columns, avoid generic 'name' that could match customer_name
    name_keys = ['employee_name', 'txn_employee_name', 'staff_name', 'emp_name']
    id_keys = ['employee_id', 'txn_employee_id', 'staff_id', 'emp_id']

    # Collect employee names (preferred) and IDs (as fallback for resolution).
    employee_ids: List[str] = []
    seen_ids: set[str] = set()
    employee_names: List[str] = []
    seen_names_set: set[str] = set()

    with engine.begin() as conn:
        # Services (billing_trans_summary)
        try:
            sum_tbl = _get_table()
            col_id = _pick_col(sum_tbl, id_keys)
            col_name = _pick_col(sum_tbl, name_keys)
            if col_id or col_name:
                cols = []
                if col_id:
                    cols.append(getattr(sum_tbl.c, col_id).label('emp_id'))
                if col_name:
                    cols.append(getattr(sum_tbl.c, col_name).label('emp_name'))
                stmt = select(*cols).where(sum_tbl.c.invoice_id == invoice_id)
                if account_code and 'account_code' in sum_tbl.c:
                    stmt = stmt.where(sum_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in sum_tbl.c:
                    stmt = stmt.where(sum_tbl.c.retail_code == retail_code)
                # Best-effort ordering
                for order_key in ['created_at', 'id', 'sequence_id']:
                    if order_key in sum_tbl.c:
                        stmt = stmt.order_by(getattr(sum_tbl.c, order_key))
                        break
                for rr in conn.execute(stmt).fetchall():
                    m = dict(rr._mapping)
                    # Prefer name if present, otherwise collect ID for later resolution
                    if m.get('emp_name') not in (None, ''):
                        _dedupe_append(employee_names, seen_names_set, m.get('emp_name'))
                    elif m.get('emp_id') not in (None, ''):
                        _dedupe_append_id(employee_ids, seen_ids, m.get('emp_id'))
        except Exception:
            pass

        # Packages (billing_trans_packages)
        try:
            md_pkg = MetaData()
            pkg_tbl = Table('billing_trans_packages', md_pkg, autoload_with=engine)
            col_id = _pick_col(pkg_tbl, id_keys)
            col_name = _pick_col(pkg_tbl, name_keys)
            if col_id or col_name:
                cols = []
                if col_id:
                    cols.append(getattr(pkg_tbl.c, col_id).label('emp_id'))
                if col_name:
                    cols.append(getattr(pkg_tbl.c, col_name).label('emp_name'))
                stmt = select(*cols).where(pkg_tbl.c.invoice_id == invoice_id)
                if account_code and 'account_code' in pkg_tbl.c:
                    stmt = stmt.where(pkg_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in pkg_tbl.c:
                    stmt = stmt.where(pkg_tbl.c.retail_code == retail_code)
                for order_key in ['created_at', 'id', 'sequence_id']:
                    if order_key in pkg_tbl.c:
                        stmt = stmt.order_by(getattr(pkg_tbl.c, order_key))
                        break
                for rr in conn.execute(stmt).fetchall():
                    m = dict(rr._mapping)
                    # Prefer name if present, otherwise collect ID for later resolution
                    if m.get('emp_name') not in (None, ''):
                        _dedupe_append(employee_names, seen_names_set, m.get('emp_name'))
                    elif m.get('emp_id') not in (None, ''):
                        _dedupe_append_id(employee_ids, seen_ids, m.get('emp_id'))
        except Exception:
            pass

        # Inventory (billing_trans_inventory)
        try:
            md_inv = MetaData()
            inv_tbl = Table('billing_trans_inventory', md_inv, autoload_with=engine)
            col_id = _pick_col(inv_tbl, id_keys)
            col_name = _pick_col(inv_tbl, name_keys)
            if col_id or col_name:
                cols = []
                if col_id:
                    cols.append(getattr(inv_tbl.c, col_id).label('emp_id'))
                if col_name:
                    cols.append(getattr(inv_tbl.c, col_name).label('emp_name'))
                stmt = select(*cols).where(inv_tbl.c.invoice_id == invoice_id)
                if account_code and 'account_code' in inv_tbl.c:
                    stmt = stmt.where(inv_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in inv_tbl.c:
                    stmt = stmt.where(inv_tbl.c.retail_code == retail_code)
                for order_key in ['created_at', 'id', 'sequence_id']:
                    if order_key in inv_tbl.c:
                        stmt = stmt.order_by(getattr(inv_tbl.c, order_key))
                        break
                for rr in conn.execute(stmt).fetchall():
                    m = dict(rr._mapping)
                    # Prefer name if present, otherwise collect ID for later resolution
                    if m.get('emp_name') not in (None, ''):
                        _dedupe_append(employee_names, seen_names_set, m.get('emp_name'))
                    elif m.get('emp_id') not in (None, ''):
                        _dedupe_append_id(employee_ids, seen_ids, m.get('emp_id'))
        except Exception:
            pass

        # Resolve any remaining employee IDs to names using master_employee (preferred) or employee_master.
        # This must happen INSIDE the same connection context.
        id_to_name: Dict[str, str] = {}
        if employee_ids:
            try:
                for tbl_name in ['master_employee', 'employee_master']:
                    try:
                        emp_tbl = Table(tbl_name, MetaData(), autoload_with=engine)
                    except Exception:
                        continue

                    # Identify ID column
                    id_col_name = None
                    for c in ['id', 'employee_id', 'staff_id', 'emp_id']:
                        if c in emp_tbl.c.keys():
                            id_col_name = c
                            break
                    if not id_col_name:
                        continue

                    # Identify name columns (avoid generic 'name' which could be any name field)
                    has_first = 'first_name' in emp_tbl.c.keys()
                    has_last = 'last_name' in emp_tbl.c.keys()
                    name_col_name = None
                    for c in ['employee_name', 'staff_name', 'emp_name']:
                        if c in emp_tbl.c.keys():
                            name_col_name = c
                            break

                    sel_cols = [getattr(emp_tbl.c, id_col_name).label('emp_id')]
                    if name_col_name:
                        sel_cols.append(getattr(emp_tbl.c, name_col_name).label('emp_name'))
                    if has_first:
                        sel_cols.append(emp_tbl.c.first_name.label('first_name'))
                    if has_last:
                        sel_cols.append(emp_tbl.c.last_name.label('last_name'))

                    stmt = select(*sel_cols).where(getattr(emp_tbl.c, id_col_name).in_(employee_ids))
                    if account_code and 'account_code' in emp_tbl.c.keys():
                        stmt = stmt.where(emp_tbl.c.account_code == account_code)
                    # Try both with AND without account/retail filters for better ID resolution
                    stmt_strict = select(*sel_cols).where(getattr(emp_tbl.c, id_col_name).in_(employee_ids))
                    if account_code and 'account_code' in emp_tbl.c.keys():
                        stmt_strict = stmt_strict.where(emp_tbl.c.account_code == account_code)
                    if retail_code and 'retail_code' in emp_tbl.c.keys():
                        stmt_strict = stmt_strict.where(emp_tbl.c.retail_code == retail_code)

                    # Try strict filter first
                    for rr in conn.execute(stmt_strict).fetchall():
                        m = dict(rr._mapping)
                        emp_id_val = m.get('emp_id')
                        if emp_id_val in (None, ''):
                            continue
                        emp_id_str = str(emp_id_val).strip()
                        if not emp_id_str:
                            continue

                        nm = (m.get('emp_name') or '').strip() if isinstance(m.get('emp_name'), str) else m.get('emp_name')
                        if nm in (None, '') and has_first:
                            first = (m.get('first_name') or '').strip() if isinstance(m.get('first_name'), str) else str(m.get('first_name') or '').strip()
                            last = (m.get('last_name') or '').strip() if isinstance(m.get('last_name'), str) else str(m.get('last_name') or '').strip()
                            nm = f"{first} {last}".strip()
                        if nm not in (None, ''):
                            id_to_name[emp_id_str] = str(nm).strip()

                    # If strict filter didn't find IDs, try without account/retail filter as fallback
                    if not id_to_name and employee_ids:
                        stmt_loose = select(*sel_cols).where(getattr(emp_tbl.c, id_col_name).in_(employee_ids))
                        for rr in conn.execute(stmt_loose).fetchall():
                            m = dict(rr._mapping)
                            emp_id_val = m.get('emp_id')
                            if emp_id_val in (None, ''):
                                continue
                            emp_id_str = str(emp_id_val).strip()
                            if not emp_id_str or emp_id_str in id_to_name:
                                continue

                            nm = (m.get('emp_name') or '').strip() if isinstance(m.get('emp_name'), str) else m.get('emp_name')
                            if nm in (None, '') and has_first:
                                first = (m.get('first_name') or '').strip() if isinstance(m.get('first_name'), str) else str(m.get('first_name') or '').strip()
                                last = (m.get('last_name') or '').strip() if isinstance(m.get('last_name'), str) else str(m.get('last_name') or '').strip()
                                nm = f"{first} {last}".strip()
                            if nm not in (None, ''):
                                id_to_name[emp_id_str] = str(nm).strip()

                    if id_to_name:
                        break
            except Exception:
                id_to_name = {}

        # Build final list: use collected names first, then resolve any IDs
        final_names: List[str] = []
        final_seen: set[str] = set()
        
        # Add already-resolved names first (these came from invoice lines directly)
        for nm in employee_names:
            _dedupe_append(final_names, final_seen, nm)
        
        # Then resolve any IDs we collected
        for emp_id in employee_ids:
            resolved = id_to_name.get(str(emp_id).strip())
            if resolved:
                _dedupe_append(final_names, final_seen, resolved)
            else:
                # Last resort: keep the ID if we cannot resolve to a name
                _dedupe_append(final_names, final_seen, emp_id)

    return final_names


def get_employee_details_by_invoice_ids(
    invoice_ids: List[str],
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None,
) -> Dict[str, str]:
    """Return invoice_id -> comma-separated employee names.

    Requirements implemented:
    - Collect *employee_id* values linked to each invoice_id from:
      billing_trans_summary (services), billing_trans_packages (packages), billing_trans_inventory (inventory)
    - Resolve employee_id -> employee name via master_employee (or employee_master fallback)
    - De-duplicate names per invoice and merge across all sources
    - Scope lookups by account_code + retail_code when those columns exist
    """
    if not invoice_ids:
        return {}

    # Normalize invoice_ids to strings and de-dupe while preserving order
    normalized_invoice_ids: List[str] = []
    inv_seen: set[str] = set()
    for inv in invoice_ids:
        if inv in (None, ''):
            continue
        s = str(inv).strip()
        if not s or s in inv_seen:
            continue
        inv_seen.add(s)
        normalized_invoice_ids.append(s)
    if not normalized_invoice_ids:
        return {}

    def _pick_col(tbl: Table, keys: List[str]) -> Optional[str]:
        for k in keys:
            if k in tbl.c.keys():
                return k
        return None

    def _append_id(invoice_to_ids: Dict[str, List[str]], invoice_to_seen_ids: Dict[str, set[str]], inv_id: Any, emp_id: Any) -> None:
        if inv_id in (None, '') or emp_id in (None, ''):
            return
        inv_str = str(inv_id).strip()
        emp_str = str(emp_id).strip()
        if not inv_str or not emp_str:
            return
        seen = invoice_to_seen_ids.setdefault(inv_str, set())
        if emp_str in seen:
            return
        seen.add(emp_str)
        invoice_to_ids.setdefault(inv_str, []).append(emp_str)

    id_keys = ['employee_id', 'txn_employee_id', 'staff_id', 'emp_id']

    invoice_to_ids: Dict[str, List[str]] = {}
    invoice_to_seen_ids: Dict[str, set[str]] = {}

    txn_tbl = _get_txn_table()
    sum_tbl_for_join = None
    try:
        sum_tbl_for_join = _get_table()
    except Exception:
        sum_tbl_for_join = None

    def _collect_ids_from_table(table_name: str) -> None:
        try:
            tbl = Table(table_name, MetaData(), autoload_with=engine)
        except Exception:
            return

        col_inv = 'invoice_id' if 'invoice_id' in tbl.c.keys() else None
        if not col_inv:
            return

        col_emp = _pick_col(tbl, id_keys)
        if not col_emp:
            return

        # Build statement with strict scoping. If the table doesn't have account/retail columns,
        # join via billing_transactions (preferred) or billing_trans_summary (fallback) to enforce scoping.
        stmt = select(getattr(tbl.c, col_inv).label('invoice_id'), getattr(tbl.c, col_emp).label('emp_id'))
        stmt = stmt.where(getattr(tbl.c, col_inv).in_(normalized_invoice_ids))

        has_acc = 'account_code' in tbl.c.keys()
        has_ret = 'retail_code' in tbl.c.keys()
        if account_code and has_acc:
            stmt = stmt.where(tbl.c.account_code == account_code)
        if retail_code and has_ret:
            stmt = stmt.where(tbl.c.retail_code == retail_code)

        # If we couldn't apply account/retail directly, attempt join-scoping.
        need_join_scope = bool((account_code and not has_acc) or (retail_code and not has_ret))
        if need_join_scope:
            # Join to billing_transactions first
            if txn_tbl is not None and 'invoice_id' in txn_tbl.c.keys():
                stmt = stmt.select_from(tbl.join(txn_tbl, getattr(tbl.c, col_inv) == txn_tbl.c.invoice_id))
                if account_code and 'account_code' in txn_tbl.c.keys():
                    stmt = stmt.where(txn_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in txn_tbl.c.keys():
                    stmt = stmt.where(txn_tbl.c.retail_code == retail_code)
            # Fallback: join to billing_trans_summary (services) which typically carries account/retail
            elif sum_tbl_for_join is not None and 'invoice_id' in sum_tbl_for_join.c.keys():
                stmt = stmt.select_from(tbl.join(sum_tbl_for_join, getattr(tbl.c, col_inv) == sum_tbl_for_join.c.invoice_id))
                if account_code and 'account_code' in sum_tbl_for_join.c.keys():
                    stmt = stmt.where(sum_tbl_for_join.c.account_code == account_code)
                if retail_code and 'retail_code' in sum_tbl_for_join.c.keys():
                    stmt = stmt.where(sum_tbl_for_join.c.retail_code == retail_code)

        # Best-effort ordering to preserve stable "first-seen" per invoice
        for order_key in ['created_at', 'id', 'sequence_id']:
            if order_key in tbl.c.keys():
                stmt = stmt.order_by(getattr(tbl.c, order_key))
                break

        with engine.begin() as conn:
            for rr in conn.execute(stmt).fetchall():
                m = dict(rr._mapping)
                _append_id(invoice_to_ids, invoice_to_seen_ids, m.get('invoice_id'), m.get('emp_id'))

    # Collect from services, packages, inventory (merge across all sources)
    _collect_ids_from_table('billing_trans_summary')
    _collect_ids_from_table('billing_trans_packages')
    _collect_ids_from_table('billing_trans_inventory')

    # Resolve IDs to names from master_employee (preferred) / employee_master fallback
    all_emp_ids: List[str] = []
    emp_seen: set[str] = set()
    for inv in normalized_invoice_ids:
        for emp_id in invoice_to_ids.get(inv, []):
            if emp_id in emp_seen:
                continue
            emp_seen.add(emp_id)
            all_emp_ids.append(emp_id)

    id_to_name: Dict[str, str] = {}
    if all_emp_ids:
        for tbl_name in ['master_employee', 'employee_master']:
            try:
                emp_tbl = Table(tbl_name, MetaData(), autoload_with=engine)
            except Exception:
                continue

            # Identify candidate ID columns.
            # IMPORTANT: Prefer business keys like employee_id over generic numeric id.
            candidate_id_cols = [
                c for c in ['employee_id', 'staff_id', 'emp_id', 'employee_code', 'emp_code', 'code', 'id']
                if c in emp_tbl.c.keys()
            ]
            if not candidate_id_cols:
                continue

            # Identify name columns
            has_first = 'first_name' in emp_tbl.c.keys()
            has_last = 'last_name' in emp_tbl.c.keys()
            name_col_name = None
            for c in ['employee_name', 'staff_name', 'emp_name']:
                if c in emp_tbl.c.keys():
                    name_col_name = c
                    break

            sel_cols = [getattr(emp_tbl.c, c).label(c) for c in candidate_id_cols]
            if name_col_name:
                sel_cols.append(getattr(emp_tbl.c, name_col_name).label('emp_name'))
            if has_first:
                sel_cols.append(emp_tbl.c.first_name.label('first_name'))
            if has_last:
                sel_cols.append(emp_tbl.c.last_name.label('last_name'))

            def _consume_rows(rows: List[Any]) -> None:
                for rr in rows:
                    m = dict(rr._mapping)
                    nm = m.get('emp_name')
                    nm = nm.strip() if isinstance(nm, str) else (str(nm).strip() if nm not in (None, '') else '')
                    if not nm and has_first:
                        first = m.get('first_name')
                        last = m.get('last_name')
                        first = first.strip() if isinstance(first, str) else str(first or '').strip()
                        last = last.strip() if isinstance(last, str) else str(last or '').strip()
                        nm = f"{first} {last}".strip()
                    if not nm:
                        continue

                    # Map name for any matched identifier column in this row
                    for col_name in candidate_id_cols:
                        val = m.get(col_name)
                        if val in (None, ''):
                            continue
                        key = str(val).strip()
                        if not key or key in id_to_name:
                            continue
                        id_to_name[key] = nm

            with engine.begin() as conn:
                # Strict filter first
                where_clause = None
                for col_name in candidate_id_cols:
                    try:
                        clause = cast(getattr(emp_tbl.c, col_name), String).in_(all_emp_ids)
                    except Exception:
                        continue
                    where_clause = clause if where_clause is None else (where_clause | clause)
                if where_clause is None:
                    continue

                stmt_strict = select(*sel_cols).where(where_clause)
                if account_code and 'account_code' in emp_tbl.c.keys():
                    stmt_strict = stmt_strict.where(emp_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in emp_tbl.c.keys():
                    stmt_strict = stmt_strict.where(emp_tbl.c.retail_code == retail_code)
                _consume_rows(conn.execute(stmt_strict).fetchall())

                # If some IDs missing, try a loose lookup for missing IDs only
                missing = [eid for eid in all_emp_ids if eid not in id_to_name]
                if missing:
                    # Only relax scoping if the employee table does NOT support retail scoping.
                    # This prevents resolving IDs to a different retail when retail_code is supplied.
                    where_clause_missing = None
                    for col_name in candidate_id_cols:
                        try:
                            clause = cast(getattr(emp_tbl.c, col_name), String).in_(missing)
                        except Exception:
                            continue
                        where_clause_missing = clause if where_clause_missing is None else (where_clause_missing | clause)
                    if where_clause_missing is None:
                        continue

                    stmt_loose = select(*sel_cols).where(where_clause_missing)
                    if account_code and 'account_code' in emp_tbl.c.keys():
                        stmt_loose = stmt_loose.where(emp_tbl.c.account_code == account_code)
                    if retail_code and 'retail_code' in emp_tbl.c.keys():
                        # If retail scoping exists, keep it strict (no extra loosening).
                        stmt_loose = stmt_loose.where(emp_tbl.c.retail_code == retail_code)
                    _consume_rows(conn.execute(stmt_loose).fetchall())

            if id_to_name:
                break

    # Build invoice_id -> "A, B, C" strings (dedupe by *name* per invoice)
    invoice_to_employee_details: Dict[str, str] = {}
    for inv in normalized_invoice_ids:
        names_out: List[str] = []
        seen_names: set[str] = set()
        for emp_id in invoice_to_ids.get(inv, []):
            nm = id_to_name.get(str(emp_id).strip(), '')
            nm = nm.strip() if isinstance(nm, str) else str(nm or '').strip()
            if not nm:
                continue
            if nm in seen_names:
                continue
            seen_names.add(nm)
            names_out.append(nm)
        invoice_to_employee_details[inv] = ', '.join(names_out)

    return invoice_to_employee_details

def update_invoice_lines(invoice_id: str, update_fields: Dict[str, Any], username: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> Dict[str, Any]:
    if not update_fields:
        raise HTTPException(status_code=400, detail="update_fields cannot be empty")
    tbl = _get_table()
    cols = set(tbl.c.keys())
    # Prevent header-level totals from overwriting per-line service totals in billing_trans_summary.
    # The summary table's grand_total must always remain service-line based.
    blocked = {
        'grand_total',
        'subtotal_amount',
        'tax_amount_total',
        'rounded_total',
        'round_off',
    }
    fields = {k: v for k, v in update_fields.items() if k in cols and k not in blocked}
    if not fields:
        raise HTTPException(status_code=400, detail="No valid columns in update_fields")
    if 'updated_by' in cols:
        fields['updated_by'] = username
    stmt = sql_update(tbl).where(tbl.c.invoice_id == invoice_id)
    if account_code and 'account_code' in tbl.c:
        stmt = stmt.where(tbl.c.account_code == account_code)
    if retail_code and 'retail_code' in tbl.c:
        stmt = stmt.where(tbl.c.retail_code == retail_code)
    stmt = stmt.values(**fields)
    with engine.begin() as conn:
        res = conn.execute(stmt)
        rowcount = getattr(res, 'rowcount', 0)

        # Keep billing_transactions header totals in sync on invoice updates.
        # Without this, customer_visit_count may read stale grand_total.
        try:
            txn_tbl = _get_txn_table()
            if txn_tbl is not None:
                txn_cols = set(txn_tbl.c.keys())

                # Aggregate current invoice totals from services + optional packages/inventory
                sub = disc = tax = cgst = sgst = igst = vat = qty_total = 0.0

                try:
                    svc_cols = tbl.c
                    svc_stmt = select(
                        func.sum(func.coalesce(svc_cols.qty, 0) * func.coalesce(svc_cols.unit_price, 0)).label('sub'),
                        func.sum(func.coalesce(svc_cols.discount_amount, 0)).label('disc'),
                        func.sum(func.coalesce(svc_cols.tax_amount, 0)).label('tax'),
                        func.sum(func.coalesce(svc_cols.total_cgst, 0)).label('cgst'),
                        func.sum(func.coalesce(svc_cols.total_sgst, 0)).label('sgst'),
                        func.sum(func.coalesce(svc_cols.total_igst, 0)).label('igst'),
                        func.sum(func.coalesce(svc_cols.total_vat, 0)).label('vat'),
                        func.sum(func.coalesce(svc_cols.qty, 0)).label('qty')
                    ).where(svc_cols.invoice_id == invoice_id)
                    if account_code and 'account_code' in svc_cols.keys():
                        svc_stmt = svc_stmt.where(svc_cols.account_code == account_code)
                    if retail_code and 'retail_code' in svc_cols.keys():
                        svc_stmt = svc_stmt.where(svc_cols.retail_code == retail_code)
                    svc_row = conn.execute(svc_stmt).first()
                    if svc_row:
                        sub = float((svc_row.sub or 0) or 0)
                        disc = float((svc_row.disc or 0) or 0)
                        tax = float((svc_row.tax or 0) or 0)
                        cgst = float((svc_row.cgst or 0) or 0)
                        sgst = float((svc_row.sgst or 0) or 0)
                        igst = float((svc_row.igst or 0) or 0)
                        vat = float((svc_row.vat or 0) or 0)
                        qty_total = float((svc_row.qty or 0) or 0)
                except Exception:
                    pass

                # Packages aggregation (optional)
                try:
                    from sqlalchemy import MetaData as _MD_P, Table as _T_P
                    md_p = _MD_P()
                    pkg_tbl = _T_P('billing_trans_packages', md_p, autoload_with=engine)
                    p = pkg_tbl.c
                    pkg_stmt = select(
                        func.sum(func.coalesce(p.qty, 0) * func.coalesce(p.unit_price, 0)),
                        func.sum(func.coalesce(p.discount_amount, 0)),
                        func.sum(func.coalesce(p.tax_amount, 0)),
                        func.sum(func.coalesce(p.total_cgst, 0)),
                        func.sum(func.coalesce(p.total_sgst, 0)),
                        func.sum(func.coalesce(p.total_igst, 0)),
                        func.sum(func.coalesce(p.total_vat, 0)),
                        func.sum(func.coalesce(p.qty, 0))
                    ).where(p.invoice_id == invoice_id)
                    if account_code and 'account_code' in p.keys():
                        pkg_stmt = pkg_stmt.where(p.account_code == account_code)
                    if retail_code and 'retail_code' in p.keys():
                        pkg_stmt = pkg_stmt.where(p.retail_code == retail_code)
                    r = conn.execute(pkg_stmt).first()
                    if r:
                        sub += float(r[0] or 0)
                        disc += float(r[1] or 0)
                        tax += float(r[2] or 0)
                        cgst += float(r[3] or 0)
                        sgst += float(r[4] or 0)
                        igst += float(r[5] or 0)
                        vat += float(r[6] or 0)
                        qty_total += float(r[7] or 0)
                except Exception:
                    pass

                # Inventory aggregation (optional)
                try:
                    from sqlalchemy import MetaData as _MD_I, Table as _T_I
                    md_i = _MD_I()
                    inv_tbl = _T_I('billing_trans_inventory', md_i, autoload_with=engine)
                    i = inv_tbl.c
                    inv_stmt = select(
                        func.sum(func.coalesce(i.qty, 0) * func.coalesce(i.unit_price, 0)),
                        func.sum(func.coalesce(i.discount_amount, 0)),
                        func.sum(func.coalesce(i.tax_amount, 0)),
                        func.sum(func.coalesce(i.total_cgst, 0)),
                        func.sum(func.coalesce(i.total_sgst, 0)),
                        func.sum(func.coalesce(i.total_igst, 0)),
                        func.sum(func.coalesce(i.total_vat, 0)),
                        func.sum(func.coalesce(i.qty, 0))
                    ).where(i.invoice_id == invoice_id)
                    if account_code and 'account_code' in i.keys():
                        inv_stmt = inv_stmt.where(i.account_code == account_code)
                    if retail_code and 'retail_code' in i.keys():
                        inv_stmt = inv_stmt.where(i.retail_code == retail_code)
                    r2 = conn.execute(inv_stmt).first()
                    if r2:
                        sub += float(r2[0] or 0)
                        disc += float(r2[1] or 0)
                        tax += float(r2[2] or 0)
                        cgst += float(r2[3] or 0)
                        sgst += float(r2[4] or 0)
                        igst += float(r2[5] or 0)
                        vat += float(r2[6] or 0)
                        qty_total += float(r2[7] or 0)
                except Exception:
                    pass

                # Prefer payload overrides when present (frontend sometimes sends header totals)
                def _as_float(v: Any) -> Optional[float]:
                    if v in (None, ''):
                        return None
                    try:
                        return float(v)
                    except Exception:
                        return None

                sub = _as_float(update_fields.get('subtotal_amount') or update_fields.get('subtotal')) or sub
                disc = _as_float(update_fields.get('discount_amount')) or disc
                tax = _as_float(update_fields.get('tax_amount_total') or update_fields.get('tax_amount')) or tax
                cgst = _as_float(update_fields.get('total_cgst')) or cgst
                sgst = _as_float(update_fields.get('total_sgst')) or sgst
                igst = _as_float(update_fields.get('total_igst')) or igst
                vat = _as_float(update_fields.get('total_vat')) or vat
                qty_total = _as_float(update_fields.get('quantity') or update_fields.get('qty_total')) or qty_total

                taxable = max(sub - disc, 0.0)

                round_off_amount = (
                    _as_float(update_fields.get('round_off'))
                    or _as_float(update_fields.get('roundoff_amount'))
                    or _as_float(update_fields.get('roundoff'))
                    or 0.0
                )

                base_grand_total = taxable + tax
                grand_total = base_grand_total + round_off_amount
                grand_total_override = _as_float(update_fields.get('grand_total') or update_fields.get('total_amount') or update_fields.get('total'))
                if grand_total_override is not None:
                    grand_total = grand_total_override

                def _first_existing(*cands: str) -> Optional[str]:
                    for c in cands:
                        if c in txn_cols:
                            return c
                    return None

                update_vals: Dict[str, Any] = {}

                def _maybe_set(val: Any, *names: str) -> None:
                    col = _first_existing(*names)
                    if col is not None and val is not None:
                        update_vals[col] = val

                _maybe_set(sub, 'subtotal_amount', 'subtotal')
                _maybe_set(disc, 'discount_amount')
                _maybe_set(taxable, 'taxable_amount')
                _maybe_set(tax, 'tax_amount')
                _maybe_set(grand_total, 'grand_total', 'total_amount', 'total')
                _maybe_set(round_off_amount, 'round_off', 'roundoff_amount', 'roundoff')
                _maybe_set(qty_total, 'quantity', 'qty_total')
                _maybe_set(cgst, 'total_cgst')
                _maybe_set(sgst, 'total_sgst')
                _maybe_set(igst, 'total_igst')
                _maybe_set(vat, 'total_vat')

                # membership_discount is handled as part of discount_amount; no extra header sync

                # Bill status alignment
                try:
                    inv_status = update_fields.get('invoice_status')
                    if 'billstatus' in txn_cols:
                        update_vals['billstatus'] = ('N' if inv_status == 'hold' else 'Y')
                except Exception:
                    pass

                if update_vals:
                    upd = sql_update(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
                    if account_code and 'account_code' in txn_cols:
                        upd = upd.where(txn_tbl.c.account_code == account_code)
                    if retail_code and 'retail_code' in txn_cols:
                        upd = upd.where(txn_tbl.c.retail_code == retail_code)
                    conn.execute(upd.values(**update_vals))

                # Expose for subsequent visit_count update
                update_fields.setdefault('_computed_grand_total_for_visit', grand_total)
        except Exception as _hdr_upd_err:
            logger.warning(f"[INVOICE/UPDATE][HEADER_TOTALS][WARN] {_hdr_upd_err}")

        # When updating an invoice, do NOT insert into customer_visit_count.
        # Update the existing row matched by invoice_id + customer_id with the latest grand_total.
        try:
            inv_status = update_fields.get('invoice_status')
            if inv_status != 'hold':
                cust_id = update_fields.get('customer_id')

                # Prefer recomputed header total (written above). Fallback to payload/header.
                grand_total_val = update_fields.get('_computed_grand_total_for_visit')
                if grand_total_val in (None, '', 0, '0'):
                    grand_total_val = update_fields.get('grand_total')

                # If customer_id/grand_total not in payload, read from billing_transactions header
                if cust_id in (None, '', 0, '0') or grand_total_val in (None, '', 0, '0'):
                    try:
                        txn_tbl = _get_txn_table()
                        if txn_tbl is not None:
                            q = select(txn_tbl)
                            if 'invoice_id' in txn_tbl.c.keys():
                                q = q.where(txn_tbl.c.invoice_id == invoice_id)
                            if account_code and 'account_code' in txn_tbl.c.keys():
                                q = q.where(txn_tbl.c.account_code == account_code)
                            if retail_code and 'retail_code' in txn_tbl.c.keys():
                                q = q.where(txn_tbl.c.retail_code == retail_code)
                            hdr = conn.execute(q).first()
                            if hdr:
                                m = hdr._mapping
                                if cust_id in (None, '', 0, '0'):
                                    cust_id = m.get('customer_id')
                                if grand_total_val in (None, '', 0, '0'):
                                    grand_total_val = (
                                        m.get('grand_total')
                                        if 'grand_total' in m
                                        else m.get('total_amount')
                                    )
                    except Exception:
                        pass

                try:
                    total_for_visit = float(grand_total_val or 0)
                except Exception:
                    total_for_visit = 0.0

                if cust_id not in (None, '', 0, '0') and total_for_visit >= 0:
                    _update_customer_visit_count_by_invoice(
                        conn,
                        account_code,
                        retail_code,
                        cust_id,
                        invoice_id,
                        total_for_visit,
                    )
        except Exception as _vc_upd_err:
            logger.warning(f"[INVOICE/UPDATE][VISIT_COUNT][WARN] {_vc_upd_err}")

        # Also update master_customer if customer fields are part of update_fields
        try:
            mc_tbl = _get_master_customer_table()
            if mc_tbl is not None:
                relevant = {k: v for k, v in update_fields.items() if k in set(mc_tbl.c.keys()) or k in ('customer_name','customer_number','customer_id')}
                if relevant:
                    # Build synthetic first_line_dict from known fields
                    fld = {
                        'customer_id': update_fields.get('customer_id'),
                        'customer_name': update_fields.get('customer_name') or update_fields.get('name'),
                        'customer_number': update_fields.get('customer_number') or update_fields.get('customer_mobile') or update_fields.get('customer_phone'),
                        'customer_gender': update_fields.get('customer_gender') or update_fields.get('gender'),
                        'account_code': account_code,
                        'retail_code': retail_code,
                    }
                    _upsert_master_customer(conn, account_code, retail_code, fld, username, increment_visit=False)
        except Exception as cust_up_e:
            logger.warning(f"[INVOICE/UPDATE/CUSTOMER][WARN] Master upsert failed: {cust_up_e}")
    return {"success": True, "invoice_id": invoice_id, "updated_rows": rowcount}


def replace_invoice_lines(invoice_id: str, payload: InvoiceBulkCreate, username: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> Dict[str, Any]:
    """Delete existing lines for an invoice and create new ones, mirroring create logic and updating header."""
    tbl = _get_table()
    cols = set(tbl.c.keys())

    logger.info(f"[INVOICE/REPLACE] invoice_id={invoice_id} incoming_lines={len(payload.lines)} user={username}")

    with engine.begin() as conn:
        # Preserve original invoice created_at for child tables during replace.
        # The replace flow deletes and reinserts rows; without this, DB defaults can stamp a new created_at.
        header_created_at = None
        try:
            txn_tbl_for_ts = _get_txn_table()
            if txn_tbl_for_ts is not None:
                txn_cols_for_ts = set(txn_tbl_for_ts.c.keys())

                def _col_ci_ts(cols_set: set, name: str) -> Optional[str]:
                    target = str(name).lower()
                    for c in cols_set:
                        if str(c).lower() == target:
                            return c
                    return None

                created_col = _col_ci_ts(txn_cols_for_ts, 'created_at')
                if created_col:
                    acc_code_ts = account_code
                    ret_code_ts = retail_code
                    try:
                        if payload.lines:
                            if acc_code_ts is None:
                                acc_code_ts = getattr(payload.lines[0], 'account_code', None)
                            if ret_code_ts is None:
                                ret_code_ts = getattr(payload.lines[0], 'retail_code', None)
                    except Exception:
                        pass

                    ts_stmt = select(getattr(txn_tbl_for_ts.c, created_col)).where(txn_tbl_for_ts.c.invoice_id == invoice_id)
                    if acc_code_ts is not None and 'account_code' in txn_cols_for_ts:
                        ts_stmt = ts_stmt.where(txn_tbl_for_ts.c.account_code == acc_code_ts)
                    if ret_code_ts is not None and 'retail_code' in txn_cols_for_ts:
                        ts_stmt = ts_stmt.where(txn_tbl_for_ts.c.retail_code == ret_code_ts)
                    header_created_at = conn.execute(ts_stmt).scalar()
        except Exception:
            header_created_at = None

        # Delete existing lines for this invoice (scoped if account/retail provided)
        del_stmt = tbl.delete().where(tbl.c.invoice_id == invoice_id)
        if account_code and 'account_code' in cols:
            del_stmt = del_stmt.where(tbl.c.account_code == account_code)
        if retail_code and 'retail_code' in cols:
            del_stmt = del_stmt.where(tbl.c.retail_code == retail_code)
        del_res = conn.execute(del_stmt)
        deleted_count = getattr(del_res, 'rowcount', 0)

        # Also delete existing package/inventory rows for this invoice to prevent duplicates on replace
        try:
            from sqlalchemy import MetaData as _MD_R, Table as _T_R
            md_r = _MD_R()
            # Packages
            try:
                pkg_tbl_r = _T_R('billing_trans_packages', md_r, autoload_with=engine)
                pkg_del = pkg_tbl_r.delete().where(pkg_tbl_r.c.invoice_id == invoice_id)
                if account_code and 'account_code' in pkg_tbl_r.c.keys():
                    pkg_del = pkg_del.where(pkg_tbl_r.c.account_code == account_code)
                if retail_code and 'retail_code' in pkg_tbl_r.c.keys():
                    pkg_del = pkg_del.where(pkg_tbl_r.c.retail_code == retail_code)
                conn.execute(pkg_del)
            except Exception:
                pass
            # Inventory
            try:
                inv_tbl_r = _T_R('billing_trans_inventory', md_r, autoload_with=engine)
                inv_del = inv_tbl_r.delete().where(inv_tbl_r.c.invoice_id == invoice_id)
                if account_code and 'account_code' in inv_tbl_r.c.keys():
                    inv_del = inv_del.where(inv_tbl_r.c.account_code == account_code)
                if retail_code and 'retail_code' in inv_tbl_r.c.keys():
                    inv_del = inv_del.where(inv_tbl_r.c.retail_code == retail_code)
                conn.execute(inv_del)
            except Exception:
                pass
        except Exception:
            pass

        inserted_ids: List[Any] = []
        # Insert new lines computing totals as in create_invoice_lines
        for idx, line in enumerate(payload.lines):
            try:
                # Ensure invoice id and scope fields are consistent
                try:
                    setattr(line, 'invoice_id', invoice_id)
                except Exception:
                    pass
                data = line.dict()
                # Skip package pseudo-lines from summary: service_id beginning with 'pkg:'
                try:
                    sid_val = str(data.get('service_id') or '')
                    if sid_val.startswith('pkg:') and getattr(payload, 'package_lines', None):
                        logger.info(f"[INVOICE/SUMMARY_SKIP] Skipping package line {idx+1} from billing_trans_summary on replace (service_id={sid_val})")
                        continue
                    if sid_val.startswith('inv:') and getattr(payload, 'inventory_lines', None):
                        logger.info(f"[INVOICE/SUMMARY_SKIP] Skipping inventory line {idx+1} from billing_trans_summary on replace (service_id={sid_val})")
                        continue
                except Exception:
                    pass
                # Compute totals if missing
                line_amount = _coerce_numeric(data.get('qty'), 1.0) * _coerce_numeric(data.get('unit_price'), 0.0)
                reg_discount = _coerce_numeric(data.get('discount_amount'), 0.0)
                mem_discount = _coerce_numeric(data.get('membership_discount'), 0.0)
                # Treat membership discount like normal discount by folding into discount_amount
                data['discount_amount'] = _coerce_numeric(reg_discount + mem_discount, 0.0)
                taxable = max(line_amount - reg_discount - mem_discount, 0.0)
                data['taxable_amount'] = taxable

                # Recompute tax/grand_total for summary lines strictly from service amounts.
                c_rate = _coerce_numeric(data.get('cgst_rate_percent'), 0.0)
                s_rate = _coerce_numeric(data.get('sgst_rate_percent'), 0.0)
                i_rate = _coerce_numeric(data.get('igst_rate_percent'), 0.0)
                if (c_rate + s_rate + i_rate) <= 0.0:
                    combined = _coerce_numeric(data.get('tax_rate_percent'), 0.0)
                    c_rate = combined / 2.0
                    s_rate = combined / 2.0
                    i_rate = 0.0

                total_cgst = round((taxable * c_rate) / 100.0, 2)
                total_sgst = round((taxable * s_rate) / 100.0, 2)
                total_igst = round((taxable * i_rate) / 100.0, 2)
                total_vat = _coerce_numeric(data.get('total_vat'), 0.0)
                total_tax = round(total_cgst + total_sgst + total_igst + total_vat, 2)

                data['total_cgst'] = total_cgst
                data['total_sgst'] = total_sgst
                data['total_igst'] = total_igst
                data['tax_amount'] = total_tax

                # Remove header-only total fields (can be present on line[0] due to payload coercion)
                for _k in ('subtotal_amount', 'tax_amount_total', 'rounded_total', 'round_off'):
                    if _k in data:
                        data.pop(_k, None)

                # Always compute grand_total from (taxable + tax_amount) for summary rows
                data['grand_total'] = round(taxable + _coerce_numeric(data.get('tax_amount'), 0.0), 2)

                row = {k: v for k, v in data.items() if k in cols and v is not None}
                # Ensure employee_id and employee_name propagate like create() when missing
                try:
                    if 'employee_id' in cols:
                        if row.get('employee_id') in (None, ''):
                            first_emp = None
                            try:
                                first_emp = getattr(payload.lines[0], 'employee_id', None)
                            except Exception:
                                first_emp = None
                            if first_emp not in (None, ''):
                                try:
                                    row['employee_id'] = int(first_emp)
                                except Exception:
                                    row['employee_id'] = first_emp
                        else:
                            try:
                                row['employee_id'] = int(row['employee_id']) if str(row['employee_id']).isdigit() else row['employee_id']
                            except Exception:
                                pass
                    if 'employee_name' in cols:
                        if row.get('employee_name') in (None, ''):
                            first_name = None
                            try:
                                first_name = getattr(payload.lines[0], 'employee_name', None)
                            except Exception:
                                first_name = None
                            if first_name not in (None, ''):
                                row['employee_name'] = first_name
                except Exception:
                    pass
                # Map membership discount value into first available membership-related column on line (supports amount/percent synonyms)
                try:
                    mem_val = data.get('membership_discount', None)
                    if mem_val not in (None, ''):
                        def _first_existing_line(*cands: str):
                            for c in cands:
                                if c in cols:
                                    return c
                            return None
                        mem_col = _first_existing_line(
                            'membership_discount',
                            'membership_discount_amount',
                            'membership_disc_amount',
                            'membership_amount',
                            'member_discount',
                            'member_discount_amount',
                            'membership_discount_percent',
                            'membership_percent',
                            'membership_disc_percent'
                        )
                        if mem_col and mem_col not in row:
                            row[mem_col] = mem_val
                except Exception:
                    pass
                if 'created_by' in cols:
                    row['created_by'] = username
                if 'updated_by' in cols:
                    row['updated_by'] = username
                if header_created_at is not None and 'created_at' in cols and 'created_at' not in row:
                    row['created_at'] = header_created_at
                # Ensure service_id present if required
                if 'service_id' in cols and 'service_id' not in row:
                    base = (data.get('service_name') or 'SRV')
                    sanitized = ''.join(ch for ch in base if ch.isalnum())[:30]
                    row['service_id'] = f"{sanitized or 'SRV'}_{int(time.time()*1000)%100000000}"
                # Autofill non-nullable columns without defaults (defensive parity with create)
                try:
                    for c in tbl.c:
                        if c.name in row or c.primary_key:
                            continue
                        if getattr(c, 'nullable', True) is False and c.default is None and c.server_default is None:
                            try:
                                py_t = c.type.python_type
                            except Exception:
                                py_t = str
                            if py_t is int:
                                row[c.name] = 0
                            elif py_t is float:
                                row[c.name] = 0.0
                            else:
                                row[c.name] = ''
                except Exception:
                    pass

                ins_res = conn.execute(insert(tbl).values(**row))
                try:
                    pk = ins_res.inserted_primary_key[0]
                except Exception:
                    pk = None
                inserted_ids.append(pk)
            except Exception as e:
                logger.error(f"[INVOICE/REPLACE][ERROR] line_index={idx} invoice_id={invoice_id} error={e}")
                raise HTTPException(status_code=500, detail=f"Failed inserting invoice line {idx+1}: {str(e)}")

        # --- Insert package_lines into billing_trans_packages (mirror create path) ---
        try:
            if getattr(payload, 'package_lines', None):
                current_invoice_id = invoice_id
                from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                md_pkg = SQLAMetaData()
                pkg_tbl = SQLATable('billing_trans_packages', md_pkg, autoload_with=engine)
                pkg_cols = set(pkg_tbl.c.keys())

                # Optional debug of package rows
                try:
                    before_cnt = conn.execute(select(func.count()).select_from(pkg_tbl)).scalar()
                    logger.info(f"[REPLACE/PKG] rows before insert: {before_cnt}")
                except Exception:
                    pass

                for i, p in enumerate(payload.package_lines or []):
                    row = dict(p)
                    if current_invoice_id and 'invoice_id' in pkg_cols:
                        row['invoice_id'] = current_invoice_id
                    # Coerce numerics
                    for k in ['qty','unit_price','tax_rate_percent','total_cgst','total_sgst','total_igst','total_vat','tax_amount','discount_amount','grand_total']:
                        if k in row and row[k] is not None:
                            try:
                                row[k] = float(row[k]) if k != 'qty' else int(row[k])
                            except Exception:
                                row[k] = 0 if k != 'unit_price' else 0.0
                    row.setdefault('qty', 1)
                    row.setdefault('tax_id', '0')
                    row.setdefault('tax_rate_percent', 0.0)
                    row.setdefault('total_cgst', 0.0)
                    row.setdefault('total_sgst', 0.0)
                    row.setdefault('total_igst', 0.0)
                    row.setdefault('total_vat', 0.0)
                    row.setdefault('tax_amount', 0.0)
                    row.setdefault('discount_amount', 0.0)
                    row.setdefault('grand_total', 0.0)
                    if 'created_by' in pkg_cols:
                        row['created_by'] = row.get('created_by') or username
                    if 'updated_by' in pkg_cols:
                        row['updated_by'] = row.get('updated_by') or username
                    if header_created_at is not None and 'created_at' in pkg_cols and row.get('created_at') in (None, ''):
                        row['created_at'] = header_created_at
                    # Staff propagation from first service line if needed
                    try:
                        if 'employee_id' in pkg_cols and (row.get('employee_id') in (None, '')) and payload.lines:
                            first_emp = getattr(payload.lines[0], 'employee_id', None)
                            if first_emp not in (None, ''):
                                row['employee_id'] = first_emp
                    except Exception:
                        pass
                    row = {k: v for k, v in row.items() if k in pkg_cols}
                    conn.execute(insert(pkg_tbl).values(**row))
                try:
                    after_cnt = conn.execute(select(func.count()).select_from(pkg_tbl)).scalar()
                    logger.info(f"[REPLACE/PKG] rows after insert: {after_cnt}")
                except Exception:
                    pass
            else:
                logger.info("[REPLACE/PKG] No package_lines provided")
        except Exception as e:
            logger.warning(f"[REPLACE/PKG][WARN] {e}")

        # --- Insert inventory_lines into billing_trans_inventory (mirror create path) ---
        try:
            if getattr(payload, 'inventory_lines', None):
                current_invoice_id = invoice_id
                from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                md_inv = SQLAMetaData()
                inv_tbl = SQLATable('billing_trans_inventory', md_inv, autoload_with=engine)
                inv_cols = set(inv_tbl.c.keys())

                for i, it in enumerate(payload.inventory_lines or []):
                    row = dict(it)
                    if current_invoice_id and 'invoice_id' in inv_cols:
                        row['invoice_id'] = current_invoice_id
                    # Backfill product_name if missing from master_inventory
                    try:
                        if (not row.get('product_name')) and row.get('product_id'):
                            from sqlalchemy import MetaData as SQLAMetaData2, Table as SQLATable2
                            md_mi = SQLAMetaData2()
                            inv_master_tbl = SQLATable2('master_inventory', md_mi, autoload_with=engine)
                            q = select(inv_master_tbl.c.item_name).where(inv_master_tbl.c.id == int(str(row.get('product_id'))))
                            name_row = conn.execute(q).first()
                            if name_row and 'item_name' in name_row._mapping:
                                row['product_name'] = name_row._mapping['item_name']
                    except Exception:
                        pass
                    # Coerce numerics
                    for k in ['qty','unit_price','tax_rate_percent','total_cgst','total_sgst','total_igst','total_vat','tax_amount','discount_amount','grand_total']:
                        if k in row and row[k] is not None:
                            try:
                                row[k] = float(row[k]) if k != 'qty' else int(row[k])
                            except Exception:
                                row[k] = 0 if k != 'unit_price' else 0.0
                    row.setdefault('qty', 1)
                    row.setdefault('tax_id', '0')
                    row.setdefault('tax_rate_percent', 0.0)
                    row.setdefault('total_cgst', 0.0)
                    row.setdefault('total_sgst', 0.0)
                    row.setdefault('total_igst', 0.0)
                    row.setdefault('total_vat', 0.0)
                    row.setdefault('tax_amount', 0.0)
                    row.setdefault('discount_amount', 0.0)
                    row.setdefault('grand_total', 0.0)
                    if 'created_by' in inv_cols:
                        row['created_by'] = row.get('created_by') or username
                    if 'updated_by' in inv_cols:
                        row['updated_by'] = row.get('updated_by') or username
                    if header_created_at is not None and 'created_at' in inv_cols and row.get('created_at') in (None, ''):
                        row['created_at'] = header_created_at
                    # Staff propagation
                    try:
                        if 'employee_id' in inv_cols and (row.get('employee_id') in (None, '')) and payload.lines:
                            first_emp = getattr(payload.lines[0], 'employee_id', None)
                            if first_emp not in (None, ''):
                                row['employee_id'] = first_emp
                    except Exception:
                        pass
                    row = {k: v for k, v in row.items() if k in inv_cols}
                    conn.execute(insert(inv_tbl).values(**row))
            else:
                logger.info("[REPLACE/INV] No inventory_lines provided")
        except Exception as e:
            logger.warning(f"[REPLACE/INV][WARN] {e}")

        # After inserting lines, upsert/update header in billing_transactions like create
        try:
            txn_tbl = _get_txn_table()
            if txn_tbl is not None and payload.lines:
                line_cols = tbl.c
                first_line = payload.lines[0]
                inv_id = invoice_id
                acc_code = getattr(first_line, 'account_code', None)
                ret_code = getattr(first_line, 'retail_code', None)
                # Aggregate totals from inserted lines
                agg_stmt = select(
                    func.sum(line_cols.qty * line_cols.unit_price).label('subtotal'),
                    func.sum(func.coalesce(line_cols.discount_amount, 0)).label('discount_sum'),
                    func.sum(func.coalesce(line_cols.tax_amount, 0)).label('tax_amount'),
                    func.sum(func.coalesce(line_cols.total_cgst, 0)).label('total_cgst'),
                    func.sum(func.coalesce(line_cols.total_sgst, 0)).label('total_sgst'),
                    func.sum(func.coalesce(line_cols.total_igst, 0)).label('total_igst'),
                    func.sum(func.coalesce(line_cols.total_vat, 0)).label('total_vat'),
                    func.sum(func.coalesce(line_cols.qty, 0)).label('quantity'),
                    func.max(func.coalesce(line_cols.tax_rate_percent, 0)).label('tax_rate_percent'),
                ).where(line_cols.invoice_id == inv_id)
                if acc_code and 'account_code' in line_cols.keys():
                    agg_stmt = agg_stmt.where(line_cols.account_code == acc_code)
                if ret_code and 'retail_code' in line_cols.keys():
                    agg_stmt = agg_stmt.where(line_cols.retail_code == ret_code)
                agg_row = conn.execute(agg_stmt).first()
                if agg_row:
                    subtotal = float(agg_row.subtotal or 0)
                    discount_sum = float(agg_row.discount_sum or 0)
                    # membership_discount is already folded into discount_amount on each line
                    taxable_amount = max(subtotal - discount_sum, 0.0)
                    tax_amount = float(agg_row.tax_amount or 0)
                    base_grand_total = taxable_amount + tax_amount
                    
                    # Add round off amount from first line if provided
                    # Add round off amount from first line if provided
                    fdict = first_line.dict()
                    round_off_amount = 0.0
                    try:
                        round_off_amount = float(fdict.get('round_off', 0) or 0)
                    except Exception:
                        round_off_amount = 0.0

                    grand_total = base_grand_total + round_off_amount
                    # Prefer payload override (UI-calculated total) when provided.
                    # This is important during invoice updates where packages/inventory may not be part
                    # of the billing_trans_summary aggregation.
                    try:
                        _gt_override = fdict.get('grand_total')
                        if _gt_override not in (None, ''):
                            grand_total = float(_gt_override or 0)
                    except Exception:
                        pass
                    qty_total = float(agg_row.quantity or 0)
                    tax_rate_percent = float(agg_row.tax_rate_percent or 0)

                    txn_cols = set(txn_tbl.c.keys())
                    header_row: Dict[str, Any] = {
                        'account_code': acc_code,
                        'retail_code': ret_code,
                        'invoice_id': inv_id,
                    }

                    def _col_ci(cols: set, name: str) -> Optional[str]:
                        try:
                            target = name.lower()
                            for c in cols:
                                if str(c).lower() == target:
                                    return c
                        except Exception:
                            pass
                        return None
                    # Map totals and synonyms
                    def put(val, *names):
                        if val is None:
                            return
                        for n in names:
                            if n in txn_cols:
                                header_row[n] = val
                                break
                    put(subtotal, 'subtotal_amount', 'subtotal')
                    put(discount_sum, 'discount_amount')
                    put(taxable_amount, 'taxable_amount')
                    put(tax_amount, 'tax_amount')
                    put(grand_total, 'grand_total', 'total_amount', 'total')
                    put(round_off_amount, 'round_off', 'roundoff_amount')
                    put(qty_total, 'quantity', 'qty_total')
                    put(tax_rate_percent, 'tax_rate_percent', 'tax_percent')
                    put(float(agg_row.total_cgst or 0), 'total_cgst')
                    put(float(agg_row.total_sgst or 0), 'total_sgst')
                    put(float(agg_row.total_igst or 0), 'total_igst')
                    put(float(agg_row.total_vat or 0), 'total_vat')
                    # Carry over some fields from first line
                    # fdict already defined above
                    for f in ['base_price','unit_price','markup_percent_applied','markup_amount_per_unit','employee_id','employee_name','employee_level','employee_percent','customer_name','customer_number','customer_id']:
                        if f in txn_cols and fdict.get(f) not in (None, ''):
                            header_row[f] = fdict.get(f)

                    # Additional notes (write even if empty to allow clearing)
                    try:
                        notes_col = _col_ci(txn_cols, 'additional_notes')
                        if notes_col:
                            if 'additional_notes' in fdict:
                                header_row[notes_col] = fdict.get('additional_notes')
                            elif 'notes' in fdict:
                                header_row[notes_col] = fdict.get('notes')
                    except Exception:
                        pass
                    # membership_discount is handled as part of discount_amount; no extra header persistence
                    # Synonyms for legacy columns
                    if fdict.get('customer_name') and 'customerr_name' in txn_cols:
                        header_row['customerr_name'] = fdict.get('customer_name')
                    if fdict.get('customer_number') and 'customer_mobile' in txn_cols:
                        header_row['customer_mobile'] = fdict.get('customer_number')
                    # Audit
                    if 'created_by' in txn_cols:
                        header_row['created_by'] = username
                    if 'updated_by' in txn_cols:
                        header_row['updated_by'] = username

                    # Handle billstatus logic for invoice updates
                    if 'billstatus' in txn_cols:
                        # Check if we're updating an existing invoice
                        existing_check = select(txn_tbl.c.billstatus).where(txn_tbl.c.invoice_id == inv_id)
                        if acc_code and 'account_code' in txn_cols:
                            existing_check = existing_check.where(txn_tbl.c.account_code == acc_code)
                        if ret_code and 'retail_code' in txn_cols:
                            existing_check = existing_check.where(txn_tbl.c.retail_code == ret_code)
                        
                        existing_row = conn.execute(existing_check).first()
                        current_billstatus = existing_row.billstatus if existing_row else None
                        
                        # Set billstatus based on invoice_status from payload or default logic
                        invoice_status_local = getattr(payload, 'invoice_status', None)
                        if invoice_status_local == 'hold':
                            header_row['billstatus'] = 'N'  # N for hold/draft bills
                            logger.info("[INVOICE/REPLACE] Setting billstatus to 'N' for hold status, invoice_id=%s", inv_id)
                        else:
                            # For updates, if existing billstatus is 'N', change it to 'Y'
                            # For new invoices or when not 'hold', set to 'Y' (active/completed bills)
                            header_row['billstatus'] = 'Y'
                            if current_billstatus == 'N':
                                logger.info("[INVOICE/REPLACE] Updating billstatus from 'N' to 'Y' for invoice_id=%s", inv_id)
                            else:
                                logger.info("[INVOICE/REPLACE] Setting billstatus to 'Y' for invoice_id=%s", inv_id)

                    # Upsert by invoice_id (+ scope when available)
                    exists = select(txn_tbl.c.id).where(txn_tbl.c.invoice_id == inv_id)
                    if acc_code and 'account_code' in txn_cols:
                        exists = exists.where(txn_tbl.c.account_code == acc_code)
                    if ret_code and 'retail_code' in txn_cols:
                        exists = exists.where(txn_tbl.c.retail_code == ret_code)
                    row_exist = conn.execute(exists).first()
                    if row_exist:
                        upd = {k: v for k, v in header_row.items() if k != 'created_by'}
                        conn.execute(sql_update(txn_tbl).where(txn_tbl.c.id == row_exist.id).values(**upd))
                        logger.info("[INVOICE/REPLACE/HEADER] Updated billing_transactions for invoice_id=%s keys=%s", inv_id, list(upd.keys()))
                    else:
                        conn.execute(insert(txn_tbl).values(**header_row))
                        logger.info("[INVOICE/REPLACE/HEADER] Inserted billing_transactions for invoice_id=%s keys=%s", inv_id, list(header_row.keys()))

                    # If billstatus was updated to 'Y', also update customer_visit_count billstatus
                    if 'billstatus' in header_row and header_row['billstatus'] == 'Y':
                        try:
                            # Get customer_id from first line for customer visit update
                            cust_id_to_update = None
                            if payload.lines:
                                try:
                                    _first_line_dict = payload.lines[0].dict()
                                    cust_id_to_update = _first_line_dict.get('customer_id')
                                except Exception:
                                    pass
                            
                            if cust_id_to_update:
                                _update_customer_visit_billstatus(conn, acc_code, ret_code, cust_id_to_update, 'Y')
                                logger.info("[INVOICE/REPLACE] Updated customer_visit_count billstatus='Y' for customer_id=%s", cust_id_to_update)
                        except Exception as _cust_err:
                            logger.warning(f"[INVOICE/REPLACE][WARN] Failed to update customer_visit_count billstatus: {_cust_err}")
                # Mirror payment upsert to billing_paymode (if present)
                try:
                    pay_tbl = _get_paymode_table()
                    if pay_tbl is not None and payload.lines:
                        fdict = first_line.dict()
                        inv_id_local = inv_id
                        acc_code_local = acc_code
                        ret_code_local = ret_code

                        def _insert_pay_row(mode_id: Any, mode_name: Any, amount_val: float, status_val: str):
                            pay_cols = set(pay_tbl.c.keys())
                            pay_row: Dict[str, Any] = {}
                            if 'account_code' in pay_cols and acc_code_local is not None:
                                pay_row['account_code'] = acc_code_local
                            if 'retail_code' in pay_cols and ret_code_local is not None:
                                pay_row['retail_code'] = ret_code_local
                            link_col = None
                            for cand in ['billing_id', 'invoice_id', 'billingid', 'bill_id']:
                                if cand in pay_cols:
                                    link_col = cand
                                    break
                            if link_col:
                                pay_row[link_col] = inv_id_local
                            for amt_col in ['amount', 'paid_amount', 'total_amount']:
                                if amt_col in pay_cols:
                                    pay_row[amt_col] = float(amount_val or 0)
                                    break
                            if mode_id is not None:
                                for id_col in ['payment_mode_id', 'paymode_id', 'payment_id', 'mode_id']:
                                    if id_col in pay_cols and id_col not in pay_row:
                                        try:
                                            pay_row[id_col] = int(mode_id)
                                        except Exception:
                                            pay_row[id_col] = mode_id
                                        break
                            for txt_col in ['payment_method', 'payment_mode', 'mode', 'payment_mode_name', 'paymode_name']:
                                if txt_col in pay_cols and mode_name not in (None, '') and txt_col not in pay_row:
                                    pay_row[txt_col] = mode_name
                                    break
                            if 'status' in pay_cols and 'status' not in pay_row:
                                pay_row['status'] = status_val
                            if 'created_by' in pay_cols:
                                pay_row['created_by'] = username
                            if 'updated_by' in pay_cols:
                                pay_row['updated_by'] = username
                            if header_created_at is not None and 'created_at' in pay_cols and 'created_at' not in pay_row:
                                pay_row['created_at'] = header_created_at
                            if header_created_at is not None:
                                # Some schemas also track payment_date separately; keep it aligned with invoice created_at.
                                for _pdate_col in ['payment_date', 'pay_date', 'paid_date', 'paymentdate']:
                                    if _pdate_col in pay_cols and _pdate_col not in pay_row:
                                        pay_row[_pdate_col] = header_created_at
                                        break
                            # Fill required
                            try:
                                for c in pay_tbl.c:
                                    if c.name in pay_row or c.primary_key:
                                        continue
                                    if getattr(c, 'nullable', True) is False and c.default is None and c.server_default is None:
                                        try:
                                            py_t = c.type.python_type
                                        except Exception:
                                            py_t = str
                                        if py_t is int:
                                            pay_row[c.name] = 0
                                        elif py_t is float:
                                            pay_row[c.name] = 0.0
                                        else:
                                            pay_row[c.name] = ''
                            except Exception:
                                pass
                            conn.execute(insert(pay_tbl).values(**pay_row))

                        # If payload has explicit payment_modes, replace existing and insert all
                        if getattr(payload, 'payment_modes', None):
                            # Delete existing paymode rows for this invoice scope
                            try:
                                del_stmt = pay_tbl.delete()
                                link_col = 'billing_id' if 'billing_id' in pay_tbl.c else ('invoice_id' if 'invoice_id' in pay_tbl.c else None)
                                if link_col:
                                    del_stmt = del_stmt.where(getattr(pay_tbl.c, link_col) == inv_id_local)
                                if acc_code_local and 'account_code' in pay_tbl.c:
                                    del_stmt = del_stmt.where(pay_tbl.c.account_code == acc_code_local)
                                if ret_code_local and 'retail_code' in pay_tbl.c:
                                    del_stmt = del_stmt.where(pay_tbl.c.retail_code == ret_code_local)
                                conn.execute(del_stmt)
                            except Exception:
                                pass
                            total_paid = 0.0
                            for pm in getattr(payload, 'payment_modes') or []:
                                mode_id = pm.get('payment_mode_id') if isinstance(pm, dict) else None
                                mode_name = pm.get('payment_mode_name') if isinstance(pm, dict) else None
                                amount_val = pm.get('amount') if isinstance(pm, dict) else 0
                                try:
                                    amount_val = float(amount_val or 0)
                                except Exception:
                                    amount_val = 0.0
                                total_paid += amount_val
                                _insert_pay_row(mode_id, mode_name, amount_val, 'PARTIAL')
                            # If no credit amount, mark as PAID for last row
                            try:
                                is_partial = float(getattr(payload, 'credit_amount', 0) or 0) > 0
                                if not is_partial:
                                    # Update all rows to PAID
                                    upd_stmt = sql_update(pay_tbl)
                                    link_col2 = 'billing_id' if 'billing_id' in pay_tbl.c else ('invoice_id' if 'invoice_id' in pay_tbl.c else None)
                                    if link_col2:
                                        upd_stmt = upd_stmt.where(getattr(pay_tbl.c, link_col2) == inv_id_local)
                                    if acc_code_local and 'account_code' in pay_tbl.c:
                                        upd_stmt = upd_stmt.where(pay_tbl.c.account_code == acc_code_local)
                                    if ret_code_local and 'retail_code' in pay_tbl.c:
                                        upd_stmt = upd_stmt.where(pay_tbl.c.retail_code == ret_code_local)
                                    conn.execute(upd_stmt.values(status='PAID'))
                            except Exception:
                                pass
                        else:
                            # Fallback single-mode behavior from first line
                            pm_id = (fdict.get('payment_mode_id') or fdict.get('payment_id') or fdict.get('paymode_id') or fdict.get('mode_id'))
                            pm_method = fdict.get('payment_method') or fdict.get('payment_mode') or fdict.get('mode') or fdict.get('payment_mode_name')
                            # Use header total if available
                            grand_total_local = None
                            try:
                                grand_total_local = grand_total  # type: ignore[name-defined]
                            except Exception:
                                grand_total_local = None
                            if grand_total_local is None:
                                try:
                                    grand_total_local = float(fdict.get('grand_total') or 0)
                                except Exception:
                                    grand_total_local = 0.0
                            if pm_id is not None or (pm_method not in (None, '')):
                                _insert_pay_row(pm_id, pm_method, float(grand_total_local or 0), 'PAID')
                except Exception as pay_e:
                    logger.warning(f"[INVOICE/REPLACE][PAYMODE][WARN] {pay_e}")
            # Upsert customer into master_customer after replace
            try:
                if payload.lines:
                    fdict = payload.lines[0].dict()
                    # For HOLD bills, do not convert pending amount to customer credit.
                    # For invoice edits, do NOT add credit via master_customer upsert (prevents double counting).
                    try:
                        _inv_status_for_visit = getattr(payload, 'invoice_status', None)
                    except Exception:
                        _inv_status_for_visit = None
                    _credit_allowed = (_inv_status_for_visit != 'hold')
                    _upsert_master_customer(
                        conn,
                        fdict.get('account_code'),
                        fdict.get('retail_code'),
                        fdict,
                        username,
                        increment_visit=False,
                        apply_credit=False,
                    )
                    
                    # NOTE: customer_visit_count update for replace is performed after totals are recomputed
                    # (see below), so total_spend matches the final grand_total.

                    # Reconcile wallet credit for this invoice idempotently.
                    # This fixes "credit inserted again" on invoice update and prevents double-count totals.
                    try:
                        effective_credit = 0.0
                        if _credit_allowed:
                            if hasattr(payload, 'credit_amount') and payload.credit_amount is not None:
                                try:
                                    effective_credit = float(payload.credit_amount or 0)
                                except Exception:
                                    effective_credit = 0.0
                            else:
                                # Fallback: compute from grand_total - sum(payment_modes.amount)
                                try:
                                    total_paid_calc = 0.0
                                    for pm in (getattr(payload, 'payment_modes') or []):
                                        amt = pm.get('amount') if isinstance(pm, dict) else None
                                        try:
                                            total_paid_calc += float(amt or 0)
                                        except Exception:
                                            pass
                                    if 'grand_total' in locals():
                                        effective_credit = max(float(grand_total or 0) - total_paid_calc, 0.0)
                                except Exception:
                                    effective_credit = 0.0
                        if effective_credit < 0:
                            effective_credit = 0.0

                        _reconcile_invoice_credit_ledger(
                            conn,
                            fdict.get('account_code'),
                            fdict.get('retail_code'),
                            invoice_id,
                            customer_id,
                            effective_credit,
                        )
                    except Exception as wallet_err:
                        logger.warning(f"[INVOICE/REPLACE][WALLET][WARN] Failed to reconcile wallet ledger: {wallet_err}")
            except Exception as cust_up_e:
                logger.warning(f"[INVOICE/REPLACE/CUSTOMER][WARN] Master upsert failed: {cust_up_e}")
        except Exception as header_e:
            logger.warning(f"[INVOICE/REPLACE][HEADER][WARN] {header_e}")

        # Recompute and update header totals after inserting packages/inventory (parity with create)
        try:
            txn_tbl = _get_txn_table()
            if txn_tbl is not None and payload.lines:
                inv_id = invoice_id
                acc_code = getattr(payload.lines[0], 'account_code', None)
                ret_code = getattr(payload.lines[0], 'retail_code', None)

                svc_cols = tbl.c
                # Services aggregation
                svc_stmt = select(
                    func.sum(func.coalesce(svc_cols.qty, 0) * func.coalesce(svc_cols.unit_price, 0)).label('sub'),
                    func.sum(func.coalesce(svc_cols.discount_amount, 0)).label('disc'),
                    func.sum(func.coalesce(svc_cols.tax_amount, 0)).label('tax'),
                    func.sum(func.coalesce(svc_cols.total_cgst, 0)).label('cgst'),
                    func.sum(func.coalesce(svc_cols.total_sgst, 0)).label('sgst'),
                    func.sum(func.coalesce(svc_cols.total_igst, 0)).label('igst'),
                    func.sum(func.coalesce(svc_cols.total_vat, 0)).label('vat'),
                    func.sum(func.coalesce(svc_cols.qty, 0)).label('qty')
                ).where(svc_cols.invoice_id == inv_id)
                if acc_code and 'account_code' in svc_cols.keys():
                    svc_stmt = svc_stmt.where(svc_cols.account_code == acc_code)
                if ret_code and 'retail_code' in svc_cols.keys():
                    svc_stmt = svc_stmt.where(svc_cols.retail_code == ret_code)
                svc_row = conn.execute(svc_stmt).first()

                sub = float((svc_row.sub if svc_row else 0) or 0)
                disc = float((svc_row.disc if svc_row else 0) or 0)
                tax = float((svc_row.tax if svc_row else 0) or 0)
                cgst = float((svc_row.cgst if svc_row else 0) or 0)
                sgst = float((svc_row.sgst if svc_row else 0) or 0)
                igst = float((svc_row.igst if svc_row else 0) or 0)
                vat = float((svc_row.vat if svc_row else 0) or 0)
                qty_total = float((svc_row.qty if svc_row else 0) or 0)

                # Packages aggregation
                try:
                    from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                    md_r = SQLAMetaData()
                    pkg_tbl2 = SQLATable('billing_trans_packages', md_r, autoload_with=engine)
                    p = pkg_tbl2.c
                    pkg_stmt = select(
                        func.sum(func.coalesce(p.qty, 0) * func.coalesce(p.unit_price, 0)),
                        func.sum(func.coalesce(p.discount_amount, 0)),
                        func.sum(func.coalesce(p.tax_amount, 0)),
                        func.sum(func.coalesce(p.total_cgst, 0)),
                        func.sum(func.coalesce(p.total_sgst, 0)),
                        func.sum(func.coalesce(p.total_igst, 0)),
                        func.sum(func.coalesce(p.total_vat, 0)),
                        func.sum(func.coalesce(p.qty, 0))
                    ).where(p.invoice_id == inv_id)
                    if acc_code and 'account_code' in p.keys():
                        pkg_stmt = pkg_stmt.where(p.account_code == acc_code)
                    if ret_code and 'retail_code' in p.keys():
                        pkg_stmt = pkg_stmt.where(p.retail_code == ret_code)
                    r = conn.execute(pkg_stmt).first()
                    if r:
                        sub += float(r[0] or 0)
                        disc += float(r[1] or 0)
                        tax += float(r[2] or 0)
                        cgst += float(r[3] or 0)
                        sgst += float(r[4] or 0)
                        igst += float(r[5] or 0)
                        vat += float(r[6] or 0)
                        qty_total += float(r[7] or 0)
                except Exception:
                    pass

                # Inventory aggregation
                try:
                    from sqlalchemy import MetaData as SQLAMetaData, Table as SQLATable
                    md_r2 = SQLAMetaData()
                    inv_tbl2 = SQLATable('billing_trans_inventory', md_r2, autoload_with=engine)
                    i = inv_tbl2.c
                    inv_stmt = select(
                        func.sum(func.coalesce(i.qty, 0) * func.coalesce(i.unit_price, 0)),
                        func.sum(func.coalesce(i.discount_amount, 0)),
                        func.sum(func.coalesce(i.tax_amount, 0)),
                        func.sum(func.coalesce(i.total_cgst, 0)),
                        func.sum(func.coalesce(i.total_sgst, 0)),
                        func.sum(func.coalesce(i.total_igst, 0)),
                        func.sum(func.coalesce(i.total_vat, 0)),
                        func.sum(func.coalesce(i.qty, 0))
                    ).where(i.invoice_id == inv_id)
                    if acc_code and 'account_code' in i.keys():
                        inv_stmt = inv_stmt.where(i.account_code == acc_code)
                    if ret_code and 'retail_code' in i.keys():
                        inv_stmt = inv_stmt.where(i.retail_code == ret_code)
                    r2 = conn.execute(inv_stmt).first()
                    if r2:
                        sub += float(r2[0] or 0)
                        disc += float(r2[1] or 0)
                        tax += float(r2[2] or 0)
                        cgst += float(r2[3] or 0)
                        sgst += float(r2[4] or 0)
                        igst += float(r2[5] or 0)
                        vat += float(r2[6] or 0)
                        qty_total += float(r2[7] or 0)
                except Exception:
                    pass

                taxable = max(sub - disc, 0.0)
                # Prefer payload override of tax and grand total when provided
                round_off_amount = 0.0
                try:
                    _first_line_dict = payload.lines[0].dict()
                    if _first_line_dict.get('round_off') not in (None, ''):
                        round_off_amount = float(_first_line_dict.get('round_off') or 0)
                except Exception:
                    pass
                try:
                    _first_line_dict = payload.lines[0].dict()
                    if _first_line_dict.get('tax_amount_total') not in (None, ''):
                        tax = float(_first_line_dict.get('tax_amount_total') or 0)
                except Exception:
                    pass
                grand_total = taxable + tax + round_off_amount
                try:
                    _first_line_dict = payload.lines[0].dict()
                    if _first_line_dict.get('grand_total') not in (None, ''):
                        grand_total = float(_first_line_dict.get('grand_total') or 0)
                except Exception:
                    pass

                txn_cols = set(txn_tbl.c.keys())
                def first_existing(*cands: str) -> Optional[str]:
                    for c in cands:
                        if c in txn_cols:
                            return c
                    return None
                update_vals: Dict[str, Any] = {}
                def maybe_set(val, *names):
                    col = first_existing(*names)
                    if col is not None and val is not None:
                        update_vals[col] = val
                maybe_set(sub, 'subtotal_amount','subtotal')
                maybe_set(disc, 'discount_amount')
                maybe_set(taxable, 'taxable_amount')
                maybe_set(tax, 'tax_amount')
                maybe_set(grand_total, 'grand_total','total_amount','total')
                maybe_set(round_off_amount, 'round_off','roundoff_amount','roundoff')
                maybe_set(qty_total, 'quantity','qty_total')
                maybe_set(cgst, 'total_cgst')
                maybe_set(sgst, 'total_sgst')
                maybe_set(igst, 'total_igst')
                maybe_set(vat, 'total_vat')

                if update_vals:
                    upd = sql_update(txn_tbl).where(txn_tbl.c.invoice_id == inv_id)
                    if acc_code and 'account_code' in txn_cols:
                        upd = upd.where(txn_tbl.c.account_code == acc_code)
                    if ret_code and 'retail_code' in txn_cols:
                        upd = upd.where(txn_tbl.c.retail_code == ret_code)
                    conn.execute(upd.values(**update_vals))

                # Sync customer_visit_count.total_spend for invoice edits (replace operation)
                try:
                    invoice_status_local = getattr(payload, 'invoice_status', None)
                except Exception:
                    invoice_status_local = None
                try:
                    customer_id_for_visit = None
                    if payload.lines:
                        customer_id_for_visit = getattr(payload.lines[0], 'customer_id', None)
                    if customer_id_for_visit and invoice_status_local != 'hold':
                        _update_customer_visit_count_by_invoice(
                            conn,
                            acc_code,
                            ret_code,
                            customer_id_for_visit,
                            inv_id,
                            float(grand_total or 0),
                        )
                except Exception as _vc_rep_err:
                    logger.warning(f"[INVOICE/REPLACE][VISIT_COUNT][WARN] {_vc_rep_err}")
                    logger.info(f"[INVOICE/REPLACE/HEADER/RECALC] Updated header totals for invoice {inv_id}: {update_vals}")
        except Exception as recompute_err:
            logger.warning(f"[INVOICE/REPLACE/HEADER/RECALC][WARN] {recompute_err}")

    logger.info(f"[INVOICE/REPLACE] Completed invoice_id={invoice_id} deleted={deleted_count} inserted={len(inserted_ids)}")
    return {"success": True, "invoice_id": invoice_id, "deleted": deleted_count, "inserted": len(inserted_ids), "inserted_ids": inserted_ids}


def list_invoices(
    account_code: str,
    retail_code: str,
    limit: int = 100,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    billstatus: Optional[str] = None,
) -> Dict[str, Any]:
    """Return summarized invoices combining line aggregation + optional header (billing_transactions).

    Line Aggregations (billing_trans_summary):
      - line_count: count of rows
      - raw_subtotal: SUM(qty * unit_price)
      - discount_first_line: MAX(discount_amount)
      - discount_sum: SUM(discount_amount)
      - tax_amount: SUM(tax_amount)
      - grand_total: SUM(grand_total)
      - last_created_at / last_updated_at (max timestamps) if present

    Header (billing_transactions) prefixed with txn_:
      - txn_subtotal_amount, txn_discount_amount, txn_taxable_amount,
        txn_tax_amount, txn_grand_total, txn_created_at, txn_updated_at,
        plus txn_base_price, txn_quantity (if present) & any markup columns we map.

    If header table is absent the endpoint still works returning only line aggregates.
    """
    if not account_code or not retail_code:
        raise HTTPException(status_code=400, detail="account_code and retail_code required")

    line_tbl = _get_table()
    line_cols = line_tbl.c
    txn_tbl = _get_txn_table()

    # Build line aggregation selectable columns
    stmt_cols = [
        line_cols.invoice_id.label('invoice_id'),
        func.count().label('line_count'),
        func.sum(line_cols.qty * line_cols.unit_price).label('raw_subtotal'),
        func.max(line_cols.discount_amount).label('discount_first_line'),
        func.sum(func.coalesce(line_cols.discount_amount, 0)).label('discount_sum'),
        func.sum(func.coalesce(line_cols.tax_amount, 0)).label('tax_amount'),
        func.sum(func.coalesce(line_cols.grand_total, 0)).label('grand_total'),
    ]
    has_created = 'created_at' in line_cols.keys()
    has_updated = 'updated_at' in line_cols.keys()
    if has_created:
        stmt_cols.append(func.max(line_cols.created_at).label('last_created_at'))
    if has_updated:
        stmt_cols.append(func.max(line_cols.updated_at).label('last_updated_at'))

    line_stmt = select(*stmt_cols).where(
        and_(line_cols.account_code == account_code, line_cols.retail_code == retail_code)
    )
    if invoice_id:
        line_stmt = line_stmt.where(line_cols.invoice_id == invoice_id)
    
    # Add date filtering based on created_at or updated_at
    if from_date and has_created:
        try:
            # Parse date in YYYY-MM-DD format and create start of day timestamp
            from datetime import datetime
            start_dt = datetime.strptime(from_date, '%Y-%m-%d')
            line_stmt = line_stmt.where(line_cols.created_at >= start_dt)
        except ValueError:
            logger.warning(f"Invalid from_date format: {from_date}")
    
    if to_date and has_created:
        try:
            # Parse date and create end of day timestamp
            from datetime import datetime, timedelta
            end_dt = datetime.strptime(to_date, '%Y-%m-%d') + timedelta(days=1)
            line_stmt = line_stmt.where(line_cols.created_at < end_dt)
        except ValueError:
            logger.warning(f"Invalid to_date format: {to_date}")
    
    line_stmt = line_stmt.group_by(line_cols.invoice_id)
    if has_updated:
        line_stmt = line_stmt.order_by(func.max(line_cols.updated_at).desc())
    elif has_created:
        line_stmt = line_stmt.order_by(func.max(line_cols.created_at).desc())
    line_stmt = line_stmt.limit(limit)

    data_by_invoice: Dict[str, Dict[str, Any]] = {}
    invoice_order: List[str] = []
    with engine.begin() as conn:
        # Fetch line aggregates
        for r in conn.execute(line_stmt):
            row = dict(r._mapping)
            inv_id = row['invoice_id']
            data_by_invoice[inv_id] = row
            invoice_order.append(inv_id)

        # Fetch header transactions if table exists
        if txn_tbl is not None:
            txn_cols = txn_tbl.c
            txn_select_cols = [txn_cols.invoice_id]
            # Map selected header columns to prefixed names to avoid collision
            # Map header table columns -> prefixed response keys (support synonyms present in different schemas)
            header_mappings = {
                # Subtotals
                'subtotal': 'txn_subtotal',
                'subtotal_amount': 'txn_subtotal_amount',
                # Discount / taxable / tax
                'discount_amount': 'txn_discount_amount',
                # Membership discount at header level (explicit field)
                'membership_discount': 'txn_membership_discount',
                'taxable_amount': 'txn_taxable_amount',
                'tax_amount': 'txn_tax_amount',
                # Grand total synonyms (if any of these columns exist)
                'grand_total': 'txn_grand_total',
                'total_amount': 'txn_total_amount',
                'total': 'txn_total',
                # Base/unit pricing + quantity
                'base_price': 'txn_base_price',
                'unit_price': 'txn_unit_price',
                'quantity': 'txn_quantity',
                # Markup analytics
                'markup_percent_applied': 'txn_markup_percent_applied',
                'markup_amount_per_unit': 'txn_markup_amount_per_unit',
                # Tax breakdowns
                'total_cgst': 'txn_total_cgst',
                'total_sgst': 'txn_total_sgst',
                'total_igst': 'txn_total_igst',
                'total_vat': 'txn_total_vat',
                # Customer (handle schema typos/variants)
                'customer_name': 'txn_customer_name',
                'customerr_name': 'txn_customer_name',  # observed typo variant
                # Keep both number and mobile aliases. Some schemas store phone under
                # `customer_number`, others under `customer_mobile` or `customer_phone`.
                'customer_number': 'txn_customer_number',
                'customer_mobile': 'txn_customer_mobile',
                'customer_phone': 'txn_customer_mobile',
                'customer_mobile_number': 'txn_customer_mobile',
                'customer_id': 'txn_customer_id',
                # Employee/staff
                'employee_id': 'txn_employee_id',
                'employee_name': 'txn_employee_name',
                'employee_level': 'txn_employee_level',
                'employee_percent': 'txn_employee_percent',
                # Payment
                'payment_mode_id': 'txn_payment_mode_id',
                'payment_id': 'txn_payment_id',
                'payment_method': 'txn_payment_method',
                'payment_mode_name': 'txn_payment_mode_name',
            }
            for col_name, alias in header_mappings.items():
                if col_name in txn_cols.keys():
                    txn_select_cols.append(txn_cols[col_name].label(alias))
            # timestamps
            if 'created_at' in txn_cols.keys():
                txn_select_cols.append(txn_cols.created_at.label('txn_created_at'))
            if 'updated_at' in txn_cols.keys():
                txn_select_cols.append(txn_cols.updated_at.label('txn_updated_at'))

            txn_stmt = select(*txn_select_cols).where(
                and_(txn_cols.account_code == account_code, txn_cols.retail_code == retail_code)
            )
            if invoice_id:
                txn_stmt = txn_stmt.where(txn_cols.invoice_id == invoice_id)
            
            # Add date filtering to header transactions
            if from_date and 'created_at' in txn_cols.keys():
                try:
                    from datetime import datetime
                    start_dt = datetime.strptime(from_date, '%Y-%m-%d')
                    txn_stmt = txn_stmt.where(txn_cols.created_at >= start_dt)
                except ValueError:
                    logger.warning(f"Invalid from_date format for txn: {from_date}")
            
            if to_date and 'created_at' in txn_cols.keys():
                try:
                    from datetime import datetime, timedelta
                    end_dt = datetime.strptime(to_date, '%Y-%m-%d') + timedelta(days=1)
                    txn_stmt = txn_stmt.where(txn_cols.created_at < end_dt)
                except ValueError:
                    logger.warning(f"Invalid to_date format for txn: {to_date}")
            
            # Order by updated/created desc to align perceived recency
            if 'updated_at' in txn_cols.keys():
                txn_stmt = txn_stmt.order_by(txn_cols.updated_at.desc())
            elif 'created_at' in txn_cols.keys():
                txn_stmt = txn_stmt.order_by(txn_cols.created_at.desc())
            txn_stmt = txn_stmt.limit(limit)

            txn_rows = list(conn.execute(txn_stmt))
            for r in txn_rows:
                m = dict(r._mapping)
                inv_id = m.pop('invoice_id')
                if inv_id not in data_by_invoice:
                    # Placeholder when no line items yet captured
                    data_by_invoice[inv_id] = {
                        'invoice_id': inv_id,
                        'line_count': 0,
                        'raw_subtotal': 0.0,
                        'discount_first_line': 0.0,
                        'discount_sum': 0.0,
                        'tax_amount': 0.0,
                        'grand_total': 0.0,
                    }
                    invoice_order.append(inv_id)
                data_by_invoice[inv_id].update(m)

    # Build ordered list (recent first based on line aggregates order first, then headers not in aggregates)
    result_rows = [data_by_invoice[i] for i in invoice_order]
    # If headers introduced invoices not in original ordering and we want global recency, could sort here – skip for now.
    # Include timezone metadata for clients to interpret timestamps consistently
    # Serialize timestamp fields uniformly
    for row in result_rows:
        for k, v in list(row.items()):
            if k.endswith('_at'):
                row[k] = _serialize_ts(v)
    return {
        "success": True,
        "count": len(result_rows),
        "timezone": "IST",
        "data": result_rows,
    }


def get_customer_wallet_ledger(customer_id: int, account_code: str, retail_code: str, limit: int = 50) -> Dict[str, Any]:
    """Fetch customer wallet ledger data for credit transaction history.
    
    Args:
        customer_id: Customer ID to fetch wallet data for
        account_code: Account code for scoping
        retail_code: Retail code for scoping
        limit: Maximum number of records to return
    
    Returns:
        Dictionary with success status and wallet transaction data
    """
    try:
        from sqlalchemy import MetaData, Table, desc, case
        
        # Check if customer_wallet_ledger table exists
        local_md = MetaData()
        try:
            wallet_tbl = Table('customer_wallet_ledger', local_md, autoload_with=engine)
        except Exception:
            return {
                "success": False,
                "error": "Customer wallet ledger table not found",
                "data": []
            }
        
        wallet_cols = wallet_tbl.c
        
        # Build query to fetch wallet transactions
        stmt = select(wallet_tbl).where(
            and_(
                wallet_cols.customer_id == customer_id,
                wallet_cols.account_code == account_code,
                wallet_cols.retail_code == retail_code
            )
        ).order_by(desc(wallet_cols.entry_date)).limit(limit)
        
        with engine.begin() as conn:
            rows = conn.execute(stmt).fetchall()
            
            # Convert rows to dictionaries and serialize timestamps
            data = []
            for row in rows:
                row_dict = dict(row._mapping)
                # Serialize timestamp fields
                for k, v in list(row_dict.items()):
                    if k.endswith('_date') or k.endswith('_at'):
                        row_dict[k] = _serialize_ts(v)
                data.append(row_dict)
            
            # Calculate net balance based on transaction semantics
            # ADD and PAYMENT increase balance; USE and CREDIT decrease balance
            balance_stmt = select(
                func.sum(
                    case(
                        (wallet_cols.txn_type.in_(['ADD', 'PAYMENT']), wallet_cols.amount),
                        else_=-wallet_cols.amount
                    )
                ).label('balance')
            ).where(
                and_(
                    wallet_cols.customer_id == customer_id,
                    wallet_cols.account_code == account_code,
                    wallet_cols.retail_code == retail_code,
                    wallet_cols.status == 'SUCCESS'
                )
            )
            
            balance_result = conn.execute(balance_stmt).scalar()
            total_balance = float(balance_result or 0)
            
            logger.info(f"[WALLET_LEDGER] Fetched {len(data)} records for customer_id={customer_id}, balance={total_balance}")
            
            return {
                "success": True,
                "count": len(data),
                "total_balance": total_balance,
                "timezone": "IST",
                "data": data
            }
            
    except Exception as e:
        logger.error(f"[WALLET_LEDGER][ERROR] Failed to fetch wallet data: {e}")
        return {
            "success": False,
            "error": str(e),
            "data": []
        }


def list_invoices(
    account_code: str,
    retail_code: str,
    limit: int = 100,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    billstatus: Optional[str] = None,
) -> Dict[str, Any]:
    """List billing transactions with billstatus included.
    
    Args:
        account_code: Account code for scoping
        retail_code: Retail code for scoping
        limit: Maximum number of records to return
        invoice_id: Optional filter by specific invoice ID
        from_date: Optional start date filter (YYYY-MM-DD format)
        to_date: Optional end date filter (YYYY-MM-DD format)
    
        billstatus behavior:
            - Not provided / empty: no billstatus filter (return all)
            - 'n'/'N': filter billstatus='N'
            - anything else: filter billstatus='Y'

    Returns:
        Dictionary with success status and billing transaction data
    """
    try:
        billstatus_raw = (str(billstatus).strip().upper() if billstatus is not None else '')
        apply_billstatus_filter = bool(billstatus_raw)
        effective_billstatus = 'N' if billstatus_raw == 'N' else 'Y'

        # Get both billing_trans_summary and billing_transactions tables
        summary_tbl = _get_table()  # billing_trans_summary
        txn_tbl = _get_txn_table()  # billing_transactions
        
        if txn_tbl is None:
            # Fallback to summary table only if transactions table doesn't exist
            summary_cols = summary_tbl.c
            stmt = select(summary_tbl).where(
                and_(
                    summary_cols.account_code == account_code,
                    summary_cols.retail_code == retail_code
                )
            )

            # Apply billstatus filter only when requested by caller
            if apply_billstatus_filter:
                if 'billstatus' in summary_cols.keys():
                    stmt = stmt.where(func.upper(summary_cols.billstatus) == effective_billstatus)
                elif 'bill_status' in summary_cols.keys():
                    stmt = stmt.where(func.upper(getattr(summary_cols, 'bill_status')) == effective_billstatus)
            
            if invoice_id:
                stmt = stmt.where(summary_cols.invoice_id == invoice_id)
                
            # Add date filtering if provided
            if from_date or to_date:
                date_col = None
                for col_name in ['last_created_at', 'created_at', 'last_updated_at', 'updated_at']:
                    if hasattr(summary_cols, col_name):
                        date_col = getattr(summary_cols, col_name)
                        break
                
                if date_col is not None:
                    if from_date:
                        stmt = stmt.where(func.date(date_col) >= from_date)
                    if to_date:
                        stmt = stmt.where(func.date(date_col) <= to_date)
            
            stmt = stmt.order_by(summary_cols.last_created_at.desc() if hasattr(summary_cols, 'last_created_at') else summary_cols.id.desc()).limit(limit)
            
            with engine.begin() as conn:
                rows = conn.execute(stmt).fetchall()

                # Precompute paid sums from billing_paymode so we can derive outstanding credit per invoice.
                paid_map: Dict[str, float] = {}
                try:
                    pay_tbl = _get_paymode_table()
                    if pay_tbl is not None:
                        link_candidates = ['invoice_id', 'billing_id', 'bill_id', 'reference_id', 'ref_id', 'txn_ref', 'order_id']
                        link_col_name = next((c for c in link_candidates if c in pay_tbl.c.keys()), None)
                        amt_candidates = ['amount', 'paid_amount', 'total_amount', 'payment_amount', 'txn_amount', 'value']
                        amt_col_name = next((c for c in amt_candidates if c in pay_tbl.c.keys()), None)
                        if link_col_name and amt_col_name:
                            invoice_keys: set[str] = set()
                            for r in rows:
                                inv = str(dict(r._mapping).get('invoice_id', '') or '').strip()
                                if not inv:
                                    continue
                                invoice_keys.add(inv)
                                if inv.upper().startswith('INV-'):
                                    raw = inv.split('-', 1)[1]
                                    if raw:
                                        invoice_keys.add(raw)
                                elif inv.isdigit():
                                    invoice_keys.add(f"INV-{inv}")
                            if invoice_keys:
                                link_col = getattr(pay_tbl.c, link_col_name)
                                amt_col = getattr(pay_tbl.c, amt_col_name)
                                p_stmt = select(link_col.label('link_id'), func.sum(func.coalesce(amt_col, 0)).label('paid_sum'))
                                p_stmt = p_stmt.where(link_col.in_(list(invoice_keys)))
                                # strict scope when columns exist
                                if 'account_code' in pay_tbl.c.keys():
                                    p_stmt = p_stmt.where(pay_tbl.c.account_code == account_code)
                                if 'retail_code' in pay_tbl.c.keys():
                                    p_stmt = p_stmt.where(pay_tbl.c.retail_code == retail_code)
                                # only SUCCESS when status column exists
                                status_col_name = next((c for c in ['status', 'payment_status', 'txn_status'] if c in pay_tbl.c.keys()), None)
                                if status_col_name:
                                    sc = getattr(pay_tbl.c, status_col_name)
                                    p_stmt = p_stmt.where(func.upper(sc).like('SUC%'))
                                p_stmt = p_stmt.group_by(link_col)
                                for pr in conn.execute(p_stmt):
                                    m = dict(pr._mapping)
                                    k = str(m.get('link_id') or '').strip()
                                    try:
                                        paid_map[k] = float(m.get('paid_sum') or 0)
                                    except Exception:
                                        paid_map[k] = 0.0
                except Exception:
                    paid_map = {}
                
                # Convert to dictionaries
                data = []
                for row in rows:
                    row_dict = dict(row._mapping)
                    # Set default billstatus if not present
                    if 'billstatus' not in row_dict:
                        row_dict['billstatus'] = 'Y'  # Default to active
                    
                    # Serialize timestamp fields
                    for k, v in list(row_dict.items()):
                        if k.endswith('_at'):
                            row_dict[k] = _serialize_ts(v)

                    # Derive credit_amount = invoice_total - total_paid (never negative)
                    try:
                        inv = str(row_dict.get('invoice_id') or '').strip()
                        paid = float(paid_map.get(inv) or 0.0)
                        if paid <= 0 and inv.upper().startswith('INV-'):
                            paid = float(paid_map.get(inv.split('-', 1)[1]) or 0.0)
                        elif paid <= 0 and inv.isdigit():
                            paid = float(paid_map.get(f"INV-{inv}") or 0.0)
                        total_val = float(
                            row_dict.get('grand_total')
                            or row_dict.get('total_amount')
                            or row_dict.get('total')
                            or 0
                        )
                        row_dict['credit_amount'] = round(max(total_val - paid, 0.0), 2)
                    except Exception:
                        row_dict['credit_amount'] = 0.0

                    data.append(row_dict)
                
                return {
                    "success": True,
                    "count": len(data),
                    "timezone": "IST", 
                    "data": data
                }
        else:
            # Use billing_transactions table which should have billstatus
            txn_cols = txn_tbl.c
            stmt = select(txn_tbl).where(
                and_(
                    txn_cols.account_code == account_code,
                    txn_cols.retail_code == retail_code
                )
            )

            # Apply billstatus filter only when requested by caller.
            if apply_billstatus_filter:
                if 'billstatus' in txn_cols.keys():
                    stmt = stmt.where(func.upper(txn_cols.billstatus) == effective_billstatus)
                elif 'bill_status' in txn_cols.keys():
                    stmt = stmt.where(func.upper(getattr(txn_cols, 'bill_status')) == effective_billstatus)
            
            if invoice_id:
                stmt = stmt.where(txn_cols.invoice_id == invoice_id)
                
            # Add date filtering if provided
            if from_date or to_date:
                date_col = None
                for col_name in ['created_at', 'updated_at', 'last_created_at', 'last_updated_at']:
                    if hasattr(txn_cols, col_name):
                        date_col = getattr(txn_cols, col_name)
                        break
                
                if date_col is not None:
                    if from_date:
                        stmt = stmt.where(func.date(date_col) >= from_date)
                    if to_date:
                        stmt = stmt.where(func.date(date_col) <= to_date)
            
            stmt = stmt.order_by(txn_cols.created_at.desc() if hasattr(txn_cols, 'created_at') else txn_cols.id.desc()).limit(limit)
            
            with engine.begin() as conn:
                rows = conn.execute(stmt).fetchall()

                # Precompute paid sums from billing_paymode so we can derive outstanding credit per invoice.
                paid_map: Dict[str, float] = {}
                try:
                    pay_tbl = _get_paymode_table()
                    if pay_tbl is not None:
                        link_candidates = ['invoice_id', 'billing_id', 'bill_id', 'reference_id', 'ref_id', 'txn_ref', 'order_id']
                        link_col_name = next((c for c in link_candidates if c in pay_tbl.c.keys()), None)
                        amt_candidates = ['amount', 'paid_amount', 'total_amount', 'payment_amount', 'txn_amount', 'value']
                        amt_col_name = next((c for c in amt_candidates if c in pay_tbl.c.keys()), None)
                        if link_col_name and amt_col_name:
                            invoice_keys: set[str] = set()
                            for r in rows:
                                inv = str(getattr(r, '_mapping', {}).get('invoice_id', '') or '').strip()
                                if not inv:
                                    continue
                                invoice_keys.add(inv)
                                if inv.upper().startswith('INV-'):
                                    raw = inv.split('-', 1)[1]
                                    if raw:
                                        invoice_keys.add(raw)
                                elif inv.isdigit():
                                    invoice_keys.add(f"INV-{inv}")
                            if invoice_keys:
                                link_col = getattr(pay_tbl.c, link_col_name)
                                amt_col = getattr(pay_tbl.c, amt_col_name)
                                p_stmt = select(link_col.label('link_id'), func.sum(func.coalesce(amt_col, 0)).label('paid_sum'))
                                p_stmt = p_stmt.where(link_col.in_(list(invoice_keys)))
                                if 'account_code' in pay_tbl.c.keys():
                                    p_stmt = p_stmt.where(pay_tbl.c.account_code == account_code)
                                if 'retail_code' in pay_tbl.c.keys():
                                    p_stmt = p_stmt.where(pay_tbl.c.retail_code == retail_code)
                                status_col_name = next((c for c in ['status', 'payment_status', 'txn_status'] if c in pay_tbl.c.keys()), None)
                                if status_col_name:
                                    sc = getattr(pay_tbl.c, status_col_name)
                                    p_stmt = p_stmt.where(func.upper(sc).like('SUC%'))
                                p_stmt = p_stmt.group_by(link_col)
                                for pr in conn.execute(p_stmt):
                                    m = dict(pr._mapping)
                                    k = str(m.get('link_id') or '').strip()
                                    try:
                                        paid_map[k] = float(m.get('paid_sum') or 0)
                                    except Exception:
                                        paid_map[k] = 0.0
                except Exception:
                    paid_map = {}
                
                # Convert to dictionaries
                data = []
                for row in rows:
                    row_dict = dict(row._mapping)
                    
                    # Ensure billstatus is present (default to 'Y' if missing)
                    if 'billstatus' not in row_dict or row_dict['billstatus'] is None:
                        row_dict['billstatus'] = 'Y'

                    # Derive credit_amount = invoice_total - total_paid (never negative)
                    try:
                        inv = str(row_dict.get('invoice_id') or '').strip()
                        paid = float(paid_map.get(inv) or 0.0)
                        if paid <= 0 and inv.upper().startswith('INV-'):
                            paid = float(paid_map.get(inv.split('-', 1)[1]) or 0.0)
                        elif paid <= 0 and inv.isdigit():
                            paid = float(paid_map.get(f"INV-{inv}") or 0.0)
                        total_val = float(
                            row_dict.get('grand_total')
                            or row_dict.get('total_amount')
                            or row_dict.get('total')
                            or 0
                        )
                        row_dict['credit_amount'] = round(max(total_val - paid, 0.0), 2)
                    except Exception:
                        row_dict['credit_amount'] = 0.0
                    
                    # Serialize timestamp fields
                    for k, v in list(row_dict.items()):
                        if k.endswith('_at'):
                            row_dict[k] = _serialize_ts(v)
                    data.append(row_dict)
                
                return {
                    "success": True,
                    "count": len(data),
                    "timezone": "IST",
                    "data": data
                }
                
    except Exception as e:
        logger.error(f"[LIST_INVOICES][ERROR] Failed to fetch billing data: {e}")
        return {
            "success": False,
            "error": str(e),
            "data": []
        }
