from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import MetaData, Table, and_, delete, func, insert, select
from sqlalchemy.exc import SQLAlchemyError

from auth import User, get_current_user
from db import engine
from logger import get_logger

logger = get_logger()

router = APIRouter(tags=["stock-in"])


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
        logger.error(f"[STOCK_IN] Missing table '{name}': {e}")
        raise HTTPException(
            status_code=500,
            detail=(
                f"Required table '{name}' not found. "
                "Run salon_fastapi/create_stock_in_tables.py (or apply setup_database.sql) and retry."
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


def _to_float(v: Any, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except Exception:
        return default


def _to_int(v: Any, default: int = 0) -> int:
    try:
        if v is None or v == "":
            return default
        return int(float(v))
    except Exception:
        return default


def _status_from_payment(grand_total: Decimal, paid_total: Decimal) -> str:
    # simple bucketing for list display
    if paid_total <= Decimal("0.0001"):
        return "unpaid"
    if paid_total + Decimal("0.0001") >= grand_total:
        return "paid"
    return "partial"


def _normalize_billstatus(v: Any, default: str = "Y") -> str:
    s = str(v or "").strip().upper()
    if s in {"Y", "N", "C"}:
        return s
    return default


def _preload_master_tax_lookup(acct: str, retail: str) -> Dict[str, Any]:
    """Load master_tax lookup maps.

    Returns dict with:
      - by_name: {lower_name: int_tax_id}
      - by_percent: {rounded_percent_str: int_tax_id}

    Best-effort: if master_tax doesn't exist or columns don't match, returns empty maps.
    """

    out = {"by_name": {}, "by_name_norm": {}, "by_percent": {}}
    try:
        tax_tbl = _reflect_table("master_tax")
    except Exception:
        return out

    cols = set(tax_tbl.c.keys())
    id_col = "tax_id" if "tax_id" in cols else ("id" if "id" in cols else None)
    name_col = None
    for cand in ["tax_name", "name", "tax", "label", "description"]:
        if cand in cols:
            name_col = cand
            break
    pct_col = None
    for cand in ["percentage", "percent", "tax_percent", "tax_rate_percent", "rate", "tax_percentage"]:
        if cand in cols:
            pct_col = cand
            break
    if id_col is None:
        return out

    # Some deployments keep master_tax scoped (account_code/retail_code), while others are global.
    # Also, "status" semantics are inconsistent across DBs. Use a safe fallback strategy.
    scoped_conds = []
    if "account_code" in cols:
        scoped_conds.append(tax_tbl.c.account_code == acct)
    if "retail_code" in cols:
        scoped_conds.append(tax_tbl.c.retail_code == retail)

    with engine.begin() as conn:
        rows: List[Dict[str, Any]] = []
        if scoped_conds:
            try:
                rows = [dict(r._mapping) for r in conn.execute(select(tax_tbl).where(and_(*scoped_conds)))]
            except Exception:
                rows = []

        # Fallback: if no scoped rows found, load all rows (global master_tax).
        if not rows:
            try:
                rows = [dict(r._mapping) for r in conn.execute(select(tax_tbl))]
            except Exception:
                rows = []

    by_name: Dict[str, int] = {}
    by_name_norm: Dict[str, int] = {}
    by_percent: Dict[str, int] = {}

    def _norm_name(v: str) -> str:
        # normalize for fuzzy-ish matching: remove non-alphanumerics
        return re.sub(r"[^a-z0-9]", "", (v or "").strip().lower())
    for r in rows:
        raw_id = r.get(id_col)
        tax_id = _to_int(raw_id, 0)
        if tax_id <= 0:
            continue

        if name_col is not None:
            nm = str(r.get(name_col) or "").strip().lower()
            if nm:
                by_name.setdefault(nm, tax_id)
                by_name_norm.setdefault(_norm_name(nm), tax_id)

        if pct_col is not None:
            pct = _to_decimal(r.get(pct_col), Decimal("0"))
            # Include 0% as well so "NoTax" can resolve to a real tax_id if present.
            if pct >= 0:
                key = str(pct.quantize(Decimal("0.0001")))
                by_percent.setdefault(key, tax_id)

    out["by_name"] = by_name
    out["by_name_norm"] = by_name_norm
    out["by_percent"] = by_percent
    return out


def _resolve_tax_id_for_line(tax_lookup: Dict[str, Any], tax_name: Any, tax_percent: Any) -> Optional[int]:
    by_name: Dict[str, int] = (tax_lookup or {}).get("by_name") or {}
    by_name_norm: Dict[str, int] = (tax_lookup or {}).get("by_name_norm") or {}
    by_percent: Dict[str, int] = (tax_lookup or {}).get("by_percent") or {}

    def _norm_name(v: str) -> str:
        return re.sub(r"[^a-z0-9]", "", (v or "").strip().lower())

    name = str(tax_name or "").strip().lower()
    if name:
        hit = by_name.get(name)
        if hit:
            return hit
        hitn = by_name_norm.get(_norm_name(name))
        if hitn:
            return hitn
        # If the UI sends values like "GST 18%", try extracting percent.
        m = re.search(r"(\d+(?:\.\d+)?)", name)
        if m:
            p = _to_decimal(m.group(1), Decimal("0"))
            if p >= 0:
                hit2 = by_percent.get(str(p.quantize(Decimal("0.0001"))))
                if hit2:
                    return hit2

    pct = _to_decimal(tax_percent, Decimal("0"))
    if pct >= 0:
        hit3 = by_percent.get(str(pct.quantize(Decimal("0.0001"))))
        if hit3:
            return hit3

    # Default: when no match, store 0 instead of NULL.
    return 0


class StockInLineIn(BaseModel):
    inventory_id: Optional[int] = None
    product_id: Optional[str] = None
    item_name: str = Field(..., min_length=1)
    variant_id: Optional[str] = None
    variant_name: Optional[str] = None
    uom_id: Optional[str] = None
    uom: Optional[str] = None
    batch_no: Optional[str] = None
    brand: Optional[str] = None
    hsn_code: Optional[str] = None
    tax_name: Optional[str] = None
    tax_id: Optional[int] = None
    tax_percent: Decimal = Field(default=Decimal("0"), ge=0)
    discount: Decimal = Field(default=Decimal("0"), ge=0)
    quantity: Decimal = Field(default=Decimal("0"), ge=0)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0)


class StockInPaymodeIn(BaseModel):
    pay_mode: str = Field(..., min_length=1)
    amount: Decimal = Field(..., gt=0)


class StockInCreateRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None

    # Stock transaction type:
    # - I: Incoming (Stock In)
    # - O: Outgoing (Stock Out)
    # Defaults to I when omitted.
    stock_type: Optional[str] = None

    # supplier_id is required for Stock In (I). For Stock Out (O) it can be omitted.
    supplier_id: Optional[str] = Field(default=None, min_length=1)
    supplier_name: Optional[str] = None

    received_date: Optional[date] = None
    invoice_date: Optional[date] = None
    invoice_no: Optional[str] = None

    tax_exempt: bool = False
    remarks: Optional[str] = None

    # Billing status on stock_transactions header:
    # - Y: billed
    # - N: on hold
    # - C: cancelled
    billstatus: Optional[str] = None

    discount: Decimal = Field(default=Decimal("0"), ge=0)  # header-level discount

    # Additional header charges
    delivery_charge: Decimal = Field(default=Decimal("0"), ge=0)

    items: List[StockInLineIn] = Field(default_factory=list)
    payments: List[StockInPaymodeIn] = Field(default_factory=list)


class StockInListRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    supplier_id: Optional[str] = None
    stock_type: Optional[str] = None


class StockInGetRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None
    stockin_id: str


class StockInUpdateRequest(StockInCreateRequest):
    stockin_id: str = Field(..., min_length=1)


class StockInClosePendingRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None

    # Identify supplier either by id or name.
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None

    # Optional range (to match what list UI shows)
    from_date: Optional[date] = None
    to_date: Optional[date] = None

    # Defaults to Stock In (I)
    stock_type: Optional[str] = None

    payments: List[StockInPaymodeIn] = Field(default_factory=list)


def _pick_batch_column(line_cols: set) -> Optional[str]:
    """Return the DB column name used for batch number in stock-in lines."""
    if "batch_no" in line_cols:
        return "batch_no"
    if "batchno" in line_cols:
        return "batchno"
    return None


def _allocate_payments_across_pending(
    pending_rows: List[Dict[str, Any]],
    payments_by_mode: Dict[str, Decimal],
) -> Tuple[Dict[str, Decimal], List[Dict[str, Any]]]:
    """Allocate payment amounts across pending stockins (oldest first).

    Returns:
      - total_applied_by_stockin: {stockin_id: applied_amount}
      - paymode_rows: [{stockin_id, pay_mode, amount}]
    """
    # Build quick lookups
    remaining_by_stockin: Dict[str, Decimal] = {
        str(r["stockin_id"]): _to_decimal(r.get("balance_due"), Decimal("0")) for r in pending_rows
    }
    total_applied_by_stockin: Dict[str, Decimal] = {sid: Decimal("0") for sid in remaining_by_stockin.keys()}
    paymode_rows: List[Dict[str, Any]] = []

    # Allocate each payment mode across stockins in order
    for mode, mode_amt in payments_by_mode.items():
        remaining_mode = _to_decimal(mode_amt, Decimal("0"))
        if remaining_mode <= 0:
            continue

        for r in pending_rows:
            if remaining_mode <= 0:
                break
            sid = str(r["stockin_id"])
            pending_amt = remaining_by_stockin.get(sid, Decimal("0"))
            if pending_amt <= 0:
                continue
            apply_amt = pending_amt if pending_amt <= remaining_mode else remaining_mode
            if apply_amt <= 0:
                continue
            remaining_by_stockin[sid] = pending_amt - apply_amt
            total_applied_by_stockin[sid] = total_applied_by_stockin.get(sid, Decimal("0")) + apply_amt
            paymode_rows.append({"stockin_id": sid, "pay_mode": mode, "amount": apply_amt})
            remaining_mode -= apply_amt

        if remaining_mode > Decimal("0.0001"):
            # This should never happen if caller validated total <= total_pending.
            raise HTTPException(status_code=400, detail=f"Unable to allocate full payment for mode '{mode}'")

    return total_applied_by_stockin, paymode_rows


@router.post("/stock-in/create")
def create_stock_in(req: StockInCreateRequest, user: User = Depends(get_current_user)):
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    st = ((req.stock_type or "I").strip()[:1].upper()) if req.stock_type is not None else "I"
    if st not in {"I", "O"}:
        st = "I"

    if st == "I":
        # For incoming stock, supplier is mandatory.
        if not (req.supplier_id or "").strip():
            raise HTTPException(status_code=400, detail="supplier_id is required for Stock In")

    if not req.items:
        raise HTTPException(status_code=400, detail="At least one item is required")

    # Normalize and validate items
    normalized_lines: List[Dict[str, Any]] = []
    line_no = 0
    for line in req.items:
        qty = _to_decimal(line.quantity)
        if qty <= 0:
            continue
        name = (line.item_name or "").strip()
        if not name:
            continue

        # Variant is mandatory for Stock In lines.
        if not (line.variant_id or "").strip():
            raise HTTPException(status_code=400, detail=f"variant_id is required for item '{name}'")

        line_no += 1
        unit_price = _to_decimal(line.unit_price)
        disc = _to_decimal(line.discount)
        tax_percent = _to_decimal(line.tax_percent)

        # Cap discount at gross (qty*rate) so net doesn't go negative
        gross = qty * unit_price
        if disc > gross:
            disc = gross

        net_amount = gross - disc
        normalized_lines.append(
            {
                "line_no": line_no,
                "inventory_id": line.inventory_id,
                "product_id": line.product_id,
                "item_name": name,
                "variant_id": (line.variant_id or "").strip() or None,
                "variant_name": (line.variant_name or "").strip() or None,
                "uom_id": (line.uom_id or "").strip() or None,
                "uom": (line.uom or "").strip() or None,
                "batch_no": (line.batch_no or "").strip() or None,
                "brand": (line.brand or "").strip() or None,
                "hsn_code": (line.hsn_code or "").strip() or None,
                "tax_name": (line.tax_name or "").strip() or None,
                "tax_id": _to_int(line.tax_id, 0) if line.tax_id is not None else None,
                "tax_percent": tax_percent,
                "discount": disc,
                "quantity": qty,
                "unit_price": unit_price,
                "net_amount": net_amount,
            }
        )

    if not normalized_lines:
        raise HTTPException(status_code=400, detail="Add at least one item with Qty > 0")

    discount = _to_decimal(req.discount)
    if discount < 0:
        discount = Decimal("0")

    subtotal = sum((_to_decimal(l["net_amount"]) for l in normalized_lines), Decimal("0"))
    if discount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot be more than subtotal")
    taxable_amount = max(subtotal - discount, Decimal("0"))

    delivery_charge = _to_decimal(getattr(req, "delivery_charge", None), Decimal("0"))
    if delivery_charge < 0:
        delivery_charge = Decimal("0")

    if req.tax_exempt:
        total_tax = Decimal("0")
    else:
        # Keep behavior aligned with frontend: tax is computed on per-line net before header discount.
        total_tax = sum((l["net_amount"] * (l["tax_percent"] / Decimal("100")) for l in normalized_lines), Decimal("0"))

    cgst = total_tax / Decimal("2")
    sgst = total_tax / Decimal("2")
    grand_total_exact = taxable_amount + cgst + sgst + delivery_charge
    grand_total = grand_total_exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    round_off = grand_total - grand_total_exact

    payments_by_mode: Dict[str, Decimal] = {}
    paid_total = Decimal("0")
    for p in req.payments or []:
        mode = (p.pay_mode or "").strip().lower()
        if not mode:
            continue
        amt = _to_decimal(p.amount)
        if amt <= 0:
            raise HTTPException(status_code=400, detail=f"Payment amount must be > 0 for {mode}")
        payments_by_mode[mode] = payments_by_mode.get(mode, Decimal("0")) + amt

    payments: List[Dict[str, Any]] = []
    for mode, amt in payments_by_mode.items():
        payments.append({"pay_mode": mode, "amount": amt})
        paid_total += amt

    if paid_total < 0:
        paid_total = Decimal("0")

    # Prevent over-payment
    if paid_total - grand_total > Decimal("0.0001"):
        raise HTTPException(status_code=400, detail="Paid total cannot be more than total amount")

    balance_due = max(grand_total - paid_total, Decimal("0"))
    status = _status_from_payment(grand_total, paid_total)
    billstatus = "Y"
    if req.billstatus is not None:
        billstatus = _normalize_billstatus(req.billstatus, default="")
        if not billstatus:
            raise HTTPException(status_code=400, detail="billstatus must be one of Y, N, C")

    summary_tbl = _reflect_table("stock_transactions")
    lines_tbl = _reflect_table("stock_transactions_summary")
    pay_tbl = _reflect_table("stock_transactions_paymode")
    tax_lookup = _preload_master_tax_lookup(acct, retail)

    # Supplier name fallback from DB if possible
    supplier_name = (req.supplier_name or "").strip() or None
    if not supplier_name:
        try:
            sup_tbl = _reflect_table("master_supplier")
            cols = set(sup_tbl.c.keys())
            name_col = None
            for cand in ["supplier_name", "name", "vendor_name", "company_name", "business_name"]:
                if cand in cols:
                    name_col = cand
                    break
            if name_col and "id" in cols:
                conditions = [sup_tbl.c.id == req.supplier_id]
                if "account_code" in cols:
                    conditions.append(sup_tbl.c.account_code == acct)
                if "retail_code" in cols:
                    conditions.append(sup_tbl.c.retail_code == retail)
                with engine.begin() as conn:
                    row = conn.execute(select(sup_tbl.c[name_col]).where(and_(*conditions)).limit(1)).first()
                    if row and row[0]:
                        supplier_name = str(row[0])
        except Exception:
            pass

    # Generate stockin_sequence_id scoped to account+retail
    with engine.begin() as conn:
        try:
            seq_col = "stockin_sequence_id" if "stockin_sequence_id" in summary_tbl.c else None
            next_seq = None
            if seq_col is not None:
                q = select(func.max(summary_tbl.c.stockin_sequence_id)).where(
                    and_(
                        summary_tbl.c.account_code == acct,
                        summary_tbl.c.retail_code == retail,
                    )
                )
                current_max = conn.execute(q).scalar()
                next_seq = (_to_int(current_max, 0) + 1) if current_max is not None else 1
            else:
                next_seq = None

            # Stock transaction id string
            base = f"{retail}{'SI' if st == 'I' else 'SO'}"
            stockin_id = f"{base}{next_seq}" if next_seq is not None else f"{base}{int(datetime.utcnow().timestamp())}"

            # Insert summary
            summary_payload: Dict[str, Any] = {
                "account_code": acct,
                "retail_code": retail,
                "stockin_sequence_id": next_seq,
                "stockin_id": stockin_id,
                "stock_type": st,
                "supplier_id": req.supplier_id,
                "supplier_name": supplier_name,
                "received_date": req.received_date,
                "invoice_date": req.invoice_date,
                "invoice_no": req.invoice_no,
                "tax_exempt": 1 if req.tax_exempt else 0,
                "remarks": req.remarks,
                "subtotal": subtotal,
                "discount": discount,
                "taxable_amount": taxable_amount,
                "total_tax": total_tax,
                "cgst": cgst,
                "sgst": sgst,
                "delivery_charge": delivery_charge,
                "grand_total": grand_total,
                "round_off": round_off,
                "paid_total": paid_total,
                "balance_due": balance_due,
                "status": status,
                "billstatus": billstatus,
                "created_by": getattr(user, "username", None),
                "updated_by": getattr(user, "username", None),
            }

            allowed_summary = set(summary_tbl.c.keys())
            summary_payload = {k: v for k, v in summary_payload.items() if k in allowed_summary and v is not None}

            res = conn.execute(insert(summary_tbl).values(**summary_payload))
            inserted_id = getattr(res, "lastrowid", None)

            # Insert lines
            allowed_line = set(lines_tbl.c.keys())
            batch_col = _pick_batch_column(allowed_line)
            line_rows = []
            for l in normalized_lines:
                tax_amount = Decimal("0") if req.tax_exempt else l["net_amount"] * (l["tax_percent"] / Decimal("100"))
                gross_amount = l["net_amount"] + tax_amount
                tax_id = None
                if "tax_id" in allowed_line:
                    # Always write a value (0 when not resolvable) instead of NULL.
                    if req.tax_exempt:
                        tax_id = 0
                    else:
                        provided_raw = l.get("tax_id")
                        provided = _to_int(provided_raw, 0)
                        if provided_raw is not None and str(provided_raw).strip() != "" and provided == 0:
                            tax_id = 0
                        elif provided > 0:
                            tax_id = provided
                        else:
                            tax_id = _resolve_tax_id_for_line(tax_lookup, l.get("tax_name"), l.get("tax_percent"))
                row = {
                    "account_code": acct,
                    "retail_code": retail,
                    "stockin_id": stockin_id,
                    **l,
                    "tax_amount": tax_amount,
                    "gross_amount": gross_amount,
                    "tax_id": tax_id,
                }

                # DB schema compatibility: some installs use `batchno` instead of `batch_no`.
                if batch_col == "batchno" and l.get("batch_no") is not None:
                    row["batchno"] = l.get("batch_no")

                line_rows.append({k: v for k, v in row.items() if k in allowed_line and v is not None})

            conn.execute(insert(lines_tbl), line_rows)

            # Insert payments
            allowed_pay = set(pay_tbl.c.keys())
            if payments:
                pay_rows = []
                for p in payments:
                    row = {
                        "account_code": acct,
                        "retail_code": retail,
                        "stockin_id": stockin_id,
                        "pay_mode": p["pay_mode"],
                        "amount": p["amount"],
                    }
                    pay_rows.append({k: v for k, v in row.items() if k in allowed_pay and v is not None})
                conn.execute(insert(pay_tbl), pay_rows)

            return {
                "success": True,
                "data": {
                    "id": inserted_id,
                    "stockin_id": stockin_id,
                    "stockin_sequence_id": next_seq,
                    "status": status,
                    "grand_total": float(grand_total),
                    "paid_total": float(paid_total),
                    "balance_due": float(balance_due),
                },
            }
        except HTTPException:
            raise
        except SQLAlchemyError as e:
            logger.error(f"[STOCK_IN][CREATE] SQL error: {e}")
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            logger.error(f"[STOCK_IN][CREATE] Unexpected error: {e}")
            raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-in/list")
def list_stock_in(req: StockInListRequest, user: User = Depends(get_current_user)):
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    summary_tbl = _reflect_table("stock_transactions")
    lines_tbl = _reflect_table("stock_transactions_summary")
    cols = set(summary_tbl.c.keys())

    conditions = [summary_tbl.c.account_code == acct, summary_tbl.c.retail_code == retail]

    # Stock In list must show only incoming stock transactions.
    if "stock_type" in cols:
        st = (req.stock_type or "I").strip() if req.stock_type is not None else "I"
        st = st[:1].upper() if st else "I"
        conditions.append(summary_tbl.c.stock_type == st)
    if req.from_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date >= req.from_date)
    if req.to_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date <= req.to_date)
    if req.supplier_id and "supplier_id" in cols:
        conditions.append(summary_tbl.c.supplier_id == req.supplier_id)

    order_col = summary_tbl.c.id if "id" in cols else list(summary_tbl.c)[0]

    # Select only fields needed by the list UI to minimize query + payload.
    wanted = [
        "stockin_id",
        "stockin_sequence_id",
        "received_date",
        "invoice_date",
        "invoice_no",
        "supplier_id",
        "supplier_name",
        "remarks",
        "subtotal",
        "total_tax",
        "grand_total",
        "paid_total",
        "balance_due",
        "status",
        "billstatus",
        "created_at",
    ]

    # For list views we also return items_count + total_qty from the lines table when possible.
    line_totals = None
    try:
        line_cols = set(lines_tbl.c.keys())
        if {"account_code", "retail_code", "stockin_id"}.issubset(line_cols) and ("quantity" in line_cols):
            line_totals = (
                select(
                    lines_tbl.c.stockin_id.label("stockin_id"),
                    func.count().label("items_count"),
                    func.coalesce(func.sum(lines_tbl.c.quantity), 0).label("total_qty"),
                )
                .where(and_(lines_tbl.c.account_code == acct, lines_tbl.c.retail_code == retail))
                .group_by(lines_tbl.c.stockin_id)
                .subquery("line_totals")
            )
    except Exception:
        line_totals = None

    select_cols = [summary_tbl.c[c] for c in wanted if c in cols]
    if line_totals is not None:
        select_cols.append(line_totals.c.items_count)
        select_cols.append(line_totals.c.total_qty)

    if not select_cols:
        select_cols = [summary_tbl.c.stockin_id] if "stockin_id" in cols else [order_col]

    if line_totals is not None and "stockin_id" in cols:
        stmt = (
            select(*select_cols)
            .select_from(summary_tbl.outerjoin(line_totals, line_totals.c.stockin_id == summary_tbl.c.stockin_id))
            .where(and_(*conditions))
            .order_by(order_col.desc())
        )
    else:
        stmt = select(*select_cols).where(and_(*conditions)).order_by(order_col.desc())

    try:
        with engine.begin() as conn:
            rows = [dict(r) for r in conn.execute(stmt).mappings().all()]

        # Normalize some fields for frontend
        out = []
        for r in rows:
            out.append(
                {
                    "stockin_id": r.get("stockin_id"),
                    "stockin_sequence_id": r.get("stockin_sequence_id"),
                    "received_date": r.get("received_date"),
                    "invoice_date": r.get("invoice_date"),
                    "invoice_no": r.get("invoice_no"),
                    "supplier_id": r.get("supplier_id"),
                    "supplier_name": r.get("supplier_name"),
                    "remarks": r.get("remarks"),
                    "subtotal": float(_to_float(r.get("subtotal"), 0.0)),
                    "total_tax": float(_to_float(r.get("total_tax"), 0.0)),
                    "grand_total": float(_to_float(r.get("grand_total"), 0.0)),
                    "paid_total": float(_to_float(r.get("paid_total"), 0.0)),
                    "balance_due": float(_to_float(r.get("balance_due"), 0.0)),
                    "items_count": int(r.get("items_count") or 0),
                    "total_qty": float(_to_float(r.get("total_qty"), 0.0)),
                    "status": r.get("status") or "unpaid",
                    "billstatus": (r.get("billstatus") or "Y"),
                    "created_at": r.get("created_at"),
                }
            )

        return {"success": True, "data": out}
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-in/close-pending")
def close_pending_vendor(req: StockInClosePendingRequest, user: User = Depends(get_current_user)):
    """Close (or partially close) pending balance for a supplier across multiple stock-ins.

    This will:
      - Insert payment splits into stock_transactions_paymode
      - Update paid_total, balance_due, status in stock_transactions for affected stockins
    """

    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    supplier_id = (req.supplier_id or "").strip() or None
    supplier_name = (req.supplier_name or "").strip() or None
    if not supplier_id and not supplier_name:
        raise HTTPException(status_code=400, detail="supplier_id or supplier_name is required")

    st = ((req.stock_type or "I").strip()[:1].upper()) if req.stock_type is not None else "I"
    if st not in {"I", "O"}:
        st = "I"

    if not (req.payments or []):
        raise HTTPException(status_code=400, detail="At least one payment is required")

    # Normalize payments
    payments_by_mode: Dict[str, Decimal] = {}
    total_paid = Decimal("0")
    for p in req.payments or []:
        mode = (p.pay_mode or "").strip().lower()
        if not mode:
            continue
        amt = _to_decimal(p.amount)
        if amt <= 0:
            raise HTTPException(status_code=400, detail=f"Payment amount must be > 0 for {mode}")
        payments_by_mode[mode] = payments_by_mode.get(mode, Decimal("0")) + amt
        total_paid += amt

    if total_paid <= 0:
        raise HTTPException(status_code=400, detail="Payment total must be > 0")

    summary_tbl = _reflect_table("stock_transactions")
    pay_tbl = _reflect_table("stock_transactions_paymode")
    cols = set(summary_tbl.c.keys())

    # Fetch pending stockins for that supplier
    conditions = [summary_tbl.c.account_code == acct, summary_tbl.c.retail_code == retail]

    if "stock_type" in cols:
        conditions.append(summary_tbl.c.stock_type == st)

    if "billstatus" in cols:
        conditions.append(summary_tbl.c.billstatus == "Y")

    if "balance_due" in cols:
        conditions.append(summary_tbl.c.balance_due > 0)

    if supplier_id and "supplier_id" in cols:
        conditions.append(summary_tbl.c.supplier_id == supplier_id)
    elif supplier_name and "supplier_name" in cols:
        conditions.append(summary_tbl.c.supplier_name == supplier_name)
    else:
        raise HTTPException(status_code=400, detail="Supplier filter fields are not available in DB")

    if req.from_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date >= req.from_date)
    if req.to_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date <= req.to_date)

    order_cols = []
    if "received_date" in cols:
        order_cols.append(summary_tbl.c.received_date.asc())
    if "id" in cols:
        order_cols.append(summary_tbl.c.id.asc())
    if not order_cols:
        order_cols = [list(summary_tbl.c)[0]]

    wanted = [
        "stockin_id",
        "grand_total",
        "paid_total",
        "balance_due",
        "status",
    ]
    select_cols = [summary_tbl.c[c] for c in wanted if c in cols]
    if "stockin_id" not in cols:
        raise HTTPException(status_code=500, detail="stockin_id column missing in stock_transactions")
    if not select_cols:
        select_cols = [summary_tbl.c.stockin_id]

    stmt = select(*select_cols).where(and_(*conditions)).order_by(*order_cols)

    try:
        with engine.begin() as conn:
            pending = [dict(r) for r in conn.execute(stmt).mappings().all()]

            if not pending:
                return {
                    "success": True,
                    "data": {
                        "supplier_id": supplier_id,
                        "supplier_name": supplier_name,
                        "total_pending": 0.0,
                        "paid_total": float(total_paid),
                        "remaining_pending": 0.0,
                        "updated_stockins": 0,
                        "message": "No pending balance found for this supplier in the selected range.",
                    },
                }

            total_pending = sum((_to_decimal(r.get("balance_due"), Decimal("0")) for r in pending), Decimal("0"))

            if total_paid - total_pending > Decimal("0.0001"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Payment total ({total_paid}) cannot exceed pending ({total_pending})",
                )

            applied_by_stockin, paymode_rows = _allocate_payments_across_pending(pending, payments_by_mode)

            # Update each affected stockin
            updated = 0
            for r in pending:
                sid = str(r.get("stockin_id"))
                applied = _to_decimal(applied_by_stockin.get(sid), Decimal("0"))
                if applied <= 0:
                    continue

                grand_total = _to_decimal(r.get("grand_total"), Decimal("0"))
                old_paid = _to_decimal(r.get("paid_total"), Decimal("0"))
                old_bal = _to_decimal(r.get("balance_due"), Decimal("0"))
                new_paid = old_paid + applied
                new_bal = max(old_bal - applied, Decimal("0"))
                new_status = _status_from_payment(grand_total, new_paid)

                update_payload: Dict[str, Any] = {}
                if "paid_total" in cols:
                    update_payload["paid_total"] = new_paid
                if "balance_due" in cols:
                    update_payload["balance_due"] = new_bal
                if "status" in cols:
                    update_payload["status"] = new_status
                if "updated_by" in cols:
                    update_payload["updated_by"] = getattr(user, "username", None)

                if update_payload:
                    conn.execute(
                        summary_tbl.update()
                        .where(
                            and_(
                                summary_tbl.c.account_code == acct,
                                summary_tbl.c.retail_code == retail,
                                summary_tbl.c.stockin_id == sid,
                            )
                        )
                        .values(**update_payload)
                    )
                    updated += 1

            # Insert payment mode rows
            allowed_pay = set(pay_tbl.c.keys())
            pay_inserts = []
            for pr in paymode_rows:
                row = {
                    "account_code": acct,
                    "retail_code": retail,
                    "stockin_id": pr["stockin_id"],
                    "pay_mode": pr["pay_mode"],
                    "amount": pr["amount"],
                }
                pay_inserts.append({k: v for k, v in row.items() if k in allowed_pay and v is not None})

            if pay_inserts:
                conn.execute(insert(pay_tbl), pay_inserts)

            remaining_pending = max(total_pending - total_paid, Decimal("0"))

        return {
            "success": True,
            "data": {
                "supplier_id": supplier_id,
                "supplier_name": supplier_name,
                "total_pending": float(total_pending),
                "paid_total": float(total_paid),
                "remaining_pending": float(remaining_pending),
                "updated_stockins": int(updated),
            },
        }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"[STOCK_IN][CLOSE_PENDING] SQL error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[STOCK_IN][CLOSE_PENDING] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-in/get")
def get_stock_in(req: StockInGetRequest, user: User = Depends(get_current_user)):
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    summary_tbl = _reflect_table("stock_transactions")
    lines_tbl = _reflect_table("stock_transactions_summary")
    pay_tbl = _reflect_table("stock_transactions_paymode")
    tax_lookup = _preload_master_tax_lookup(acct, retail)

    try:
        with engine.begin() as conn:
            header = conn.execute(
                select(*summary_tbl.c).where(
                    and_(
                        summary_tbl.c.account_code == acct,
                        summary_tbl.c.retail_code == retail,
                        summary_tbl.c.stockin_id == req.stockin_id,
                    )
                ).limit(1)
            ).mappings().first()

            if not header:
                raise HTTPException(status_code=404, detail="Stock In not found")

            lines = conn.execute(
                select(*lines_tbl.c).where(
                    and_(
                        lines_tbl.c.account_code == acct,
                        lines_tbl.c.retail_code == retail,
                        lines_tbl.c.stockin_id == req.stockin_id,
                    )
                ).order_by(lines_tbl.c.line_no.asc())
            ).mappings().all()

            payments = conn.execute(
                select(*pay_tbl.c).where(
                    and_(
                        pay_tbl.c.account_code == acct,
                        pay_tbl.c.retail_code == retail,
                        pay_tbl.c.stockin_id == req.stockin_id,
                    )
                ).order_by(pay_tbl.c.id.asc())
            ).mappings().all()

        items_out: List[Dict[str, Any]] = [dict(x) for x in lines]
        # Normalize batch number field name for the frontend.
        for it in items_out:
            if "batch_no" not in it and "batchno" in it:
                it["batch_no"] = it.get("batchno")

        return {
            "success": True,
            "data": {
                "header": dict(header),
                "items": items_out,
                "payments": [dict(x) for x in payments],
            },
        }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-in/update")
def update_stock_in(req: StockInUpdateRequest, user: User = Depends(get_current_user)):
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    st = ((req.stock_type or "I").strip()[:1].upper()) if req.stock_type is not None else "I"
    if st not in {"I", "O"}:
        st = "I"

    if st == "I":
        if not (req.supplier_id or "").strip():
            raise HTTPException(status_code=400, detail="supplier_id is required for Stock In")

    if not req.items:
        raise HTTPException(status_code=400, detail="At least one item is required")

    # Normalize and validate items
    normalized_lines: List[Dict[str, Any]] = []
    line_no = 0
    for line in req.items:
        qty = _to_decimal(line.quantity)
        if qty <= 0:
            continue
        name = (line.item_name or "").strip()
        if not name:
            continue

        # Variant is mandatory for Stock In lines.
        if not (line.variant_id or "").strip():
            raise HTTPException(status_code=400, detail=f"variant_id is required for item '{name}'")

        line_no += 1
        unit_price = _to_decimal(line.unit_price)
        disc = _to_decimal(line.discount)
        tax_percent = _to_decimal(line.tax_percent)

        gross = qty * unit_price
        if disc > gross:
            disc = gross

        net_amount = gross - disc
        normalized_lines.append(
            {
                "line_no": line_no,
                "inventory_id": line.inventory_id,
                "product_id": line.product_id,
                "item_name": name,
                "variant_id": (line.variant_id or "").strip() or None,
                "variant_name": (line.variant_name or "").strip() or None,
                "uom_id": (line.uom_id or "").strip() or None,
                "uom": (line.uom or "").strip() or None,
                "batch_no": (line.batch_no or "").strip() or None,
                "brand": (line.brand or "").strip() or None,
                "hsn_code": (line.hsn_code or "").strip() or None,
                "tax_name": (line.tax_name or "").strip() or None,
                "tax_id": _to_int(line.tax_id, 0) if line.tax_id is not None else None,
                "tax_percent": tax_percent,
                "discount": disc,
                "quantity": qty,
                "unit_price": unit_price,
                "net_amount": net_amount,
            }
        )

    if not normalized_lines:
        raise HTTPException(status_code=400, detail="Add at least one item with Qty > 0")

    discount = _to_decimal(req.discount)
    if discount < 0:
        discount = Decimal("0")

    subtotal = sum((_to_decimal(l["net_amount"]) for l in normalized_lines), Decimal("0"))
    if discount > subtotal:
        raise HTTPException(status_code=400, detail="Discount cannot be more than subtotal")
    taxable_amount = max(subtotal - discount, Decimal("0"))

    delivery_charge = _to_decimal(getattr(req, "delivery_charge", None), Decimal("0"))
    if delivery_charge < 0:
        delivery_charge = Decimal("0")

    if req.tax_exempt:
        total_tax = Decimal("0")
    else:
        total_tax = sum((l["net_amount"] * (l["tax_percent"] / Decimal("100")) for l in normalized_lines), Decimal("0"))

    cgst = total_tax / Decimal("2")
    sgst = total_tax / Decimal("2")
    grand_total_exact = taxable_amount + cgst + sgst + delivery_charge
    grand_total = grand_total_exact.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    round_off = grand_total - grand_total_exact

    payments_by_mode: Dict[str, Decimal] = {}
    paid_total = Decimal("0")
    for p in req.payments or []:
        mode = (p.pay_mode or "").strip().lower()
        if not mode:
            continue
        amt = _to_decimal(p.amount)
        if amt <= 0:
            raise HTTPException(status_code=400, detail=f"Payment amount must be > 0 for {mode}")
        payments_by_mode[mode] = payments_by_mode.get(mode, Decimal("0")) + amt

    payments: List[Dict[str, Any]] = []
    for mode, amt in payments_by_mode.items():
        payments.append({"pay_mode": mode, "amount": amt})
        paid_total += amt

    if paid_total < 0:
        paid_total = Decimal("0")

    # Prevent over-payment
    if paid_total - grand_total > Decimal("0.0001"):
        raise HTTPException(status_code=400, detail="Paid total cannot be more than total amount")

    balance_due = max(grand_total - paid_total, Decimal("0"))
    status = _status_from_payment(grand_total, paid_total)
    # Only override billstatus when client explicitly sends it.
    billstatus = None
    if req.billstatus is not None:
        billstatus = _normalize_billstatus(req.billstatus, default="")
        if not billstatus:
            raise HTTPException(status_code=400, detail="billstatus must be one of Y, N, C")

    summary_tbl = _reflect_table("stock_transactions")
    lines_tbl = _reflect_table("stock_transactions_summary")
    pay_tbl = _reflect_table("stock_transactions_paymode")
    tax_lookup = _preload_master_tax_lookup(acct, retail)

    # Supplier name fallback from DB if possible
    supplier_name = (req.supplier_name or "").strip() or None
    if not supplier_name:
        try:
            sup_tbl = _reflect_table("master_supplier")
            cols = set(sup_tbl.c.keys())
            name_col = None
            for cand in ["supplier_name", "name", "vendor_name", "company_name", "business_name"]:
                if cand in cols:
                    name_col = cand
                    break
            if name_col and "id" in cols:
                conditions = [sup_tbl.c.id == req.supplier_id]
                if "account_code" in cols:
                    conditions.append(sup_tbl.c.account_code == acct)
                if "retail_code" in cols:
                    conditions.append(sup_tbl.c.retail_code == retail)
                with engine.begin() as conn:
                    row = conn.execute(select(sup_tbl.c[name_col]).where(and_(*conditions)).limit(1)).first()
                    if row and row[0]:
                        supplier_name = str(row[0])
        except Exception:
            pass

    try:
        with engine.begin() as conn:
            existing = conn.execute(
                select(summary_tbl.c.id).where(
                    and_(
                        summary_tbl.c.account_code == acct,
                        summary_tbl.c.retail_code == retail,
                        summary_tbl.c.stockin_id == req.stockin_id,
                    )
                ).limit(1)
            ).first()
            if not existing:
                raise HTTPException(status_code=404, detail="Stock In not found")

            allowed_summary = set(summary_tbl.c.keys())
            summary_payload: Dict[str, Any] = {
                "stock_type": st,
                "supplier_id": req.supplier_id,
                "supplier_name": supplier_name,
                "received_date": req.received_date,
                "invoice_date": req.invoice_date,
                "invoice_no": req.invoice_no,
                "tax_exempt": 1 if req.tax_exempt else 0,
                "remarks": req.remarks,
                "subtotal": subtotal,
                "discount": discount,
                "taxable_amount": taxable_amount,
                "total_tax": total_tax,
                "cgst": cgst,
                "sgst": sgst,
                "delivery_charge": delivery_charge,
                "grand_total": grand_total,
                "round_off": round_off,
                "paid_total": paid_total,
                "balance_due": balance_due,
                "status": status,
                "updated_by": getattr(user, "username", None),
            }
            if billstatus is not None:
                summary_payload["billstatus"] = billstatus
            summary_payload = {k: v for k, v in summary_payload.items() if k in allowed_summary}

            conn.execute(
                summary_tbl.update()
                .where(
                    and_(
                        summary_tbl.c.account_code == acct,
                        summary_tbl.c.retail_code == retail,
                        summary_tbl.c.stockin_id == req.stockin_id,
                    )
                )
                .values(**summary_payload)
            )

            # Replace lines + payments
            conn.execute(
                delete(lines_tbl).where(
                    and_(
                        lines_tbl.c.account_code == acct,
                        lines_tbl.c.retail_code == retail,
                        lines_tbl.c.stockin_id == req.stockin_id,
                    )
                )
            )
            conn.execute(
                delete(pay_tbl).where(
                    and_(
                        pay_tbl.c.account_code == acct,
                        pay_tbl.c.retail_code == retail,
                        pay_tbl.c.stockin_id == req.stockin_id,
                    )
                )
            )

            allowed_line = set(lines_tbl.c.keys())
            batch_col = _pick_batch_column(allowed_line)
            line_rows = []
            for l in normalized_lines:
                tax_amount = Decimal("0") if req.tax_exempt else l["net_amount"] * (l["tax_percent"] / Decimal("100"))
                gross_amount = l["net_amount"] + tax_amount
                tax_id = None
                if "tax_id" in allowed_line:
                    if req.tax_exempt:
                        tax_id = 0
                    else:
                        provided_raw = l.get("tax_id")
                        provided = _to_int(provided_raw, 0)
                        if provided_raw is not None and str(provided_raw).strip() != "" and provided == 0:
                            tax_id = 0
                        elif provided > 0:
                            tax_id = provided
                        else:
                            tax_id = _resolve_tax_id_for_line(tax_lookup, l.get("tax_name"), l.get("tax_percent"))
                row = {
                    "account_code": acct,
                    "retail_code": retail,
                    "stockin_id": req.stockin_id,
                    **l,
                    "tax_amount": tax_amount,
                    "gross_amount": gross_amount,
                    "tax_id": tax_id,
                }

                if batch_col == "batchno" and l.get("batch_no") is not None:
                    row["batchno"] = l.get("batch_no")

                line_rows.append({k: v for k, v in row.items() if k in allowed_line and v is not None})
            conn.execute(insert(lines_tbl), line_rows)

            allowed_pay = set(pay_tbl.c.keys())
            pay_rows = []
            for p in payments:
                row = {
                    "account_code": acct,
                    "retail_code": retail,
                    "stockin_id": req.stockin_id,
                    "pay_mode": p["pay_mode"],
                    "amount": p["amount"],
                }
                pay_rows.append({k: v for k, v in row.items() if k in allowed_pay and v is not None})
            if pay_rows:
                conn.execute(insert(pay_tbl), pay_rows)

        return {
            "success": True,
            "data": {
                "stockin_id": req.stockin_id,
                "status": status,
                "grand_total": float(grand_total),
                "paid_total": float(paid_total),
                "balance_due": float(balance_due),
            },
        }
    except HTTPException:
        raise
    except SQLAlchemyError as e:
        logger.error(f"[STOCK_IN][UPDATE] SQL error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        logger.error(f"[STOCK_IN][UPDATE] Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class SuppliersPendingRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    stock_type: Optional[str] = None


class SupplierInvoicesRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    stock_type: Optional[str] = None


@router.post("/stock-in/suppliers-pending")
def get_suppliers_pending(req: SuppliersPendingRequest, user: User = Depends(get_current_user)):
    """Get list of suppliers with pending balances.
    
    Returns aggregated data per supplier:
    - supplier_id
    - supplier_name
    - total_pending
    - invoice_count
    """
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    st = ((req.stock_type or "I").strip()[:1].upper()) if req.stock_type is not None else "I"
    if st not in {"I", "O"}:
        st = "I"

    summary_tbl = _reflect_table("stock_transactions")
    cols = set(summary_tbl.c.keys())

    conditions = [
        summary_tbl.c.account_code == acct,
        summary_tbl.c.retail_code == retail,
    ]

    if "stock_type" in cols:
        conditions.append(summary_tbl.c.stock_type == st)
    
    if "billstatus" in cols:
        conditions.append(summary_tbl.c.billstatus == "Y")
    
    if "balance_due" in cols:
        conditions.append(summary_tbl.c.balance_due > 0)

    if req.from_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date >= req.from_date)
    if req.to_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date <= req.to_date)

    # Select columns for aggregation
    select_cols = []
    if "supplier_id" in cols:
        select_cols.append(summary_tbl.c.supplier_id)
    if "supplier_name" in cols:
        select_cols.append(summary_tbl.c.supplier_name)
    if "balance_due" in cols:
        select_cols.append(summary_tbl.c.balance_due)
    if "stockin_id" in cols:
        select_cols.append(summary_tbl.c.stockin_id)
    
    if not select_cols:
        raise HTTPException(status_code=500, detail="Required columns not found in database")

    stmt = select(*select_cols).where(and_(*conditions))

    try:
        with engine.begin() as conn:
            rows = conn.execute(stmt).mappings().all()
            
            # Group by supplier
            supplier_map = {}
            for row in rows:
                supplier_id = str(row.get("supplier_id", "")).strip() or None
                supplier_name = str(row.get("supplier_name", "")).strip() or None
                balance_due = _to_decimal(row.get("balance_due"), Decimal("0"))
                
                # Use supplier_id as key, fallback to supplier_name
                key = supplier_id or supplier_name
                if not key:
                    continue
                
                if key not in supplier_map:
                    supplier_map[key] = {
                        "supplier_id": supplier_id,
                        "supplier_name": supplier_name,
                        "total_pending": Decimal("0"),
                        "invoice_count": 0,
                    }
                
                supplier_map[key]["total_pending"] += balance_due
                supplier_map[key]["invoice_count"] += 1
            
            # Convert to list and sort by total_pending descending
            suppliers = [
                {
                    "supplier_id": v["supplier_id"],
                    "supplier_name": v["supplier_name"],
                    "total_pending": float(v["total_pending"]),
                    "invoice_count": v["invoice_count"],
                }
                for v in supplier_map.values()
            ]
            suppliers.sort(key=lambda x: x["total_pending"], reverse=True)
            
            return {
                "success": True,
                "data": suppliers,
            }
    except SQLAlchemyError as e:
        logger.error(f"[STOCK_IN][SUPPLIERS_PENDING] SQL error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/stock-in/supplier-invoices")
def get_supplier_invoices(req: SupplierInvoicesRequest, user: User = Depends(get_current_user)):
    """Get all pending invoices for a specific supplier.
    
    Returns list of stock-in transactions with:
    - stockin_id
    - invoice_no
    - invoice_date
    - received_date
    - grand_total
    - paid_total
    - balance_due
    - status
    """
    acct, retail = _resolve_scope_from_user(user, req.account_code, req.retail_code)

    if not req.supplier_id and not req.supplier_name:
        raise HTTPException(status_code=400, detail="supplier_id or supplier_name is required")

    st = ((req.stock_type or "I").strip()[:1].upper()) if req.stock_type is not None else "I"
    if st not in {"I", "O"}:
        st = "I"

    summary_tbl = _reflect_table("stock_transactions")
    cols = set(summary_tbl.c.keys())

    conditions = [
        summary_tbl.c.account_code == acct,
        summary_tbl.c.retail_code == retail,
    ]

    if "stock_type" in cols:
        conditions.append(summary_tbl.c.stock_type == st)
    
    if "billstatus" in cols:
        conditions.append(summary_tbl.c.billstatus == "Y")
    
    if "balance_due" in cols:
        conditions.append(summary_tbl.c.balance_due > 0)

    # Supplier filter
    if req.supplier_id and "supplier_id" in cols:
        conditions.append(summary_tbl.c.supplier_id == req.supplier_id)
    elif req.supplier_name and "supplier_name" in cols:
        conditions.append(summary_tbl.c.supplier_name == req.supplier_name)
    else:
        raise HTTPException(status_code=400, detail="Supplier filter fields not available in DB")

    if req.from_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date >= req.from_date)
    if req.to_date and "received_date" in cols:
        conditions.append(summary_tbl.c.received_date <= req.to_date)

    # Order by date (oldest first)
    order_cols = []
    if "received_date" in cols:
        order_cols.append(summary_tbl.c.received_date.asc())
    if "id" in cols:
        order_cols.append(summary_tbl.c.id.asc())
    if not order_cols:
        order_cols = [list(summary_tbl.c)[0]]

    # Select relevant columns
    wanted = [
        "stockin_id",
        "invoice_no",
        "invoice_date",
        "received_date",
        "subtotal",
        "total_tax",
        "grand_total",
        "paid_total",
        "balance_due",
        "status",
        "supplier_id",
        "supplier_name",
    ]
    select_cols = [summary_tbl.c[c] for c in wanted if c in cols]
    if not select_cols:
        select_cols = [summary_tbl.c.stockin_id]

    stmt = select(*select_cols).where(and_(*conditions)).order_by(*order_cols)

    try:
        with engine.begin() as conn:
            rows = conn.execute(stmt).mappings().all()
            
            invoices = []
            for row in rows:
                invoices.append({
                    "stockin_id": str(row.get("stockin_id", "")),
                    "invoice_no": str(row.get("invoice_no", "")),
                    "invoice_date": row.get("invoice_date"),
                    "received_date": row.get("received_date"),
                    "subtotal": float(_to_decimal(row.get("subtotal"), Decimal("0"))),
                    "total_tax": float(_to_decimal(row.get("total_tax"), Decimal("0"))),
                    "grand_total": float(_to_decimal(row.get("grand_total"), Decimal("0"))),
                    "paid_total": float(_to_decimal(row.get("paid_total"), Decimal("0"))),
                    "balance_due": float(_to_decimal(row.get("balance_due"), Decimal("0"))),
                    "status": str(row.get("status", "unpaid")),
                    "supplier_id": str(row.get("supplier_id", "")),
                    "supplier_name": str(row.get("supplier_name", "")),
                })
            
            return {
                "success": True,
                "data": invoices,
            }
    except SQLAlchemyError as e:
        logger.error(f"[STOCK_IN][SUPPLIER_INVOICES] SQL error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
