from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date

from sqlalchemy import text, MetaData, Table
from db import engine

router = APIRouter(prefix="/settlement", tags=["settlement"])


class SettlementPaymentLine(BaseModel):
    payment_mode_id: int
    payment_mode_name: Optional[str] = None
    expected_amount: float = 0.0
    actual_amount: float = 0.0
    variance_amount: float = 0.0


class SettlementPayload(BaseModel):
    account_code: str
    retail_code: str
    settlement_date: date

    opening_balance: float = 0.0
    total_income: float = 0.0
    total_expenses: float = 0.0
    net_amount: float = 0.0

    appointment_count: int = 0
    billing_count: int = 0
    settled_appointments: int = 0
    pending_appointments: int = 0

    cash_payments: float = 0.0
    card_payments: float = 0.0
    upi_payments: float = 0.0

    expected_cash: float = 0.0
    expected_card: float = 0.0
    expected_upi: float = 0.0
    expected_total: float = 0.0

    actual_cash: float = 0.0
    actual_card: float = 0.0
    actual_upi: float = 0.0
    actual_total: float = 0.0

    variance_cash: float = 0.0
    variance_card: float = 0.0
    variance_upi: float = 0.0
    variance_total: float = 0.0

    withdrawal_amount: float = 0.0
    next_day_opening_balance: float = 0.0

    closed_by: Optional[str] = None
    closed_at: Optional[datetime] = None
    payments: Optional[List[SettlementPaymentLine]] = None


@router.post("/upsert")
def upsert_settlement(payload: SettlementPayload):
    try:
        with engine.begin() as conn:
            business_date = str(payload.settlement_date)

            def _load_paymodes():
                """Load paymodes from master_paymentmodes (no information_schema lookups)."""
                params = {
                    "account_code": payload.account_code,
                    "retail_code": payload.retail_code,
                }

                # User's schema: payment_id + payment_mode_name (+ status, displayorder)
                try:
                    sql = text(
                        "SELECT payment_id AS id, payment_mode_name AS name "
                        "FROM master_paymentmodes "
                        "WHERE account_code=:account_code AND retail_code=:retail_code AND (status=1 OR status='1') "
                        "ORDER BY COALESCE(displayorder, 0) ASC, payment_id ASC"
                    )
                    rows = conn.execute(sql, params).mappings().fetchall()
                    paymodes = [
                        {"id": int(r.get("id")), "name": str(r.get("name") or "")}
                        for r in rows
                        if r.get("id") is not None
                    ]
                    if paymodes:
                        return paymodes
                except Exception:
                    pass

                # Common schema (used elsewhere in this repo): payment_mode_id + payment_mode_name
                try:
                    sql = text(
                        "SELECT payment_mode_id AS id, payment_mode_name AS name "
                        "FROM master_paymentmodes "
                        "WHERE account_code=:account_code AND retail_code=:retail_code AND (status=1 OR status='1') "
                        "ORDER BY payment_mode_id ASC"
                    )
                    rows = conn.execute(sql, params).mappings().fetchall()
                    paymodes = [
                        {"id": int(r.get("id")), "name": str(r.get("name") or "")}
                        for r in rows
                        if r.get("id") is not None
                    ]
                    if paymodes:
                        return paymodes
                except Exception:
                    pass

                # Alternate common schema: paymode_id + paymode_name
                try:
                    sql = text(
                        "SELECT paymode_id AS id, paymode_name AS name "
                        "FROM master_paymentmodes "
                        "WHERE account_code=:account_code AND retail_code=:retail_code AND (status=1 OR status='1') "
                        "ORDER BY paymode_id ASC"
                    )
                    rows = conn.execute(sql, params).mappings().fetchall()
                    paymodes = [
                        {"id": int(r.get("id")), "name": str(r.get("name") or "")}
                        for r in rows
                        if r.get("id") is not None
                    ]
                    if paymodes:
                        return paymodes
                except Exception:
                    pass

                raise HTTPException(
                    status_code=500,
                    detail="Failed to load payment modes from master_paymentmodes. Verify columns (payment_id/payment_mode_name or payment_mode_id/payment_mode_name or paymode_id/paymode_name).",
                )

            def _next_settlement_ref_id() -> int:
                # settlement_ref_id is scoped per (account_code, retail_code)
                next_sql = text(
                    "SELECT COALESCE(MAX(settlement_ref_id), 0) + 1 AS next_id "
                    "FROM daily_settlement_summary WHERE account_code=:account_code AND retail_code=:retail_code"
                )
                return int(conn.execute(next_sql, {
                    "account_code": payload.account_code,
                    "retail_code": payload.retail_code,
                }).scalar() or 1)

            # Check existing summary for this business date
            check_sql = text(
                "SELECT id, settlement_ref_id FROM daily_settlement_summary "
                "WHERE account_code=:account_code AND retail_code=:retail_code AND business_date=:business_date"
            )
            existing_row = conn.execute(check_sql, {
                "account_code": payload.account_code,
                "retail_code": payload.retail_code,
                "business_date": business_date,
            }).fetchone()

            if existing_row:
                summary_id = int(existing_row[0])
                settlement_ref_id = int(existing_row[1])
            else:
                settlement_ref_id = _next_settlement_ref_id()
                insert_sql = text(
                    "INSERT INTO daily_settlement_summary (settlement_ref_id, account_code, retail_code, business_date) "
                    "VALUES (:settlement_ref_id, :account_code, :retail_code, :business_date)"
                )
                conn.execute(insert_sql, {
                    "settlement_ref_id": settlement_ref_id,
                    "account_code": payload.account_code,
                    "retail_code": payload.retail_code,
                    "business_date": business_date,
                })
                summary_id = int(conn.exec_driver_sql("SELECT LAST_INSERT_ID()").scalar())

            update_sql = text(
                "UPDATE daily_settlement_summary SET "
                "opening_balance_amount=:opening_balance_amount, "
                "total_income_amount=:total_income_amount, "
                "total_expense_amount=:total_expense_amount, "
                "net_closing_amount=:net_closing_amount, "
                "total_appointments=:total_appointments, "
                "total_invoices=:total_invoices, "
                "settled_appointments_count=:settled_appointments_count, "
                "pending_appointments_count=:pending_appointments_count, "
                "expected_total_amount=:expected_total_amount, "
                "actual_total_amount=:actual_total_amount, "
                "variance_amount=:variance_amount, "
                "withdrawal_amount=:withdrawal_amount, "
                "next_day_opening_balance=:next_day_opening_balance, "
                "closed_by_user=:closed_by_user, "
                "closed_at=:closed_at "
                "WHERE id=:id"
            )

            conn.execute(update_sql, {
                "id": summary_id,
                "opening_balance_amount": payload.opening_balance,
                "total_income_amount": payload.total_income,
                "total_expense_amount": payload.total_expenses,
                "net_closing_amount": payload.net_amount,
                "total_appointments": payload.appointment_count,
                "total_invoices": payload.billing_count,
                "settled_appointments_count": payload.settled_appointments,
                "pending_appointments_count": payload.pending_appointments,
                "expected_total_amount": payload.expected_total,
                "actual_total_amount": payload.actual_total,
                "variance_amount": payload.variance_total,
                "withdrawal_amount": payload.withdrawal_amount,
                "next_day_opening_balance": payload.next_day_opening_balance,
                "closed_by_user": payload.closed_by,
                "closed_at": payload.closed_at,
            })

            # Upsert payment summary rows (loaded dynamically from master paymodes).
            delete_pay_sql = text(
                "DELETE FROM daily_settlement_payment_summary "
                "WHERE account_code=:account_code AND retail_code=:retail_code "
                "AND business_date=:business_date AND settlement_ref_id=:settlement_ref_id"
            )
            conn.execute(delete_pay_sql, {
                "account_code": payload.account_code,
                "retail_code": payload.retail_code,
                "business_date": business_date,
                "settlement_ref_id": settlement_ref_id,
            })

            pay_insert_sql = text(
                "INSERT INTO daily_settlement_payment_summary ("
                "settlement_ref_id, account_code, retail_code, business_date, "
                "payment_mode_id, payment_mode_name, expected_amount, actual_amount, variance_amount"
                ") VALUES ("
                ":settlement_ref_id, :account_code, :retail_code, :business_date, "
                ":payment_mode_id, :payment_mode_name, :expected_amount, :actual_amount, :variance_amount"
                ")"
            )

            def _mode_key(name: str) -> str:
                n = (name or "").strip().lower()
                if "cash" in n:
                    return "cash"
                if "upi" in n:
                    return "upi"
                if "card" in n:
                    return "card"
                return n or "other"

            # Optional per-paymode lines from caller (preferred)
            payment_lines_by_id = {}
            if payload.payments:
                for line in payload.payments:
                    payment_lines_by_id[int(line.payment_mode_id)] = line

            for pm in _load_paymodes():
                pm_id = int(pm.get("id"))
                if pm_id in payment_lines_by_id:
                    line = payment_lines_by_id[pm_id]
                    expected_amount = float(line.expected_amount or 0)
                    actual_amount = float(line.actual_amount or 0)
                    variance_amount = float(line.variance_amount or (actual_amount - expected_amount))
                else:
                    key = _mode_key(pm.get("name"))
                    if key == "cash":
                        expected_amount = payload.expected_cash
                        actual_amount = payload.actual_cash
                        variance_amount = payload.variance_cash
                    elif key == "card":
                        expected_amount = payload.expected_card
                        actual_amount = payload.actual_card
                        variance_amount = payload.variance_card
                    elif key == "upi":
                        expected_amount = payload.expected_upi
                        actual_amount = payload.actual_upi
                        variance_amount = payload.variance_upi
                    else:
                        expected_amount = 0.0
                        actual_amount = 0.0
                        variance_amount = 0.0

                conn.execute(pay_insert_sql, {
                    "settlement_ref_id": settlement_ref_id,
                    "account_code": payload.account_code,
                    "retail_code": payload.retail_code,
                    "business_date": business_date,
                    "payment_mode_id": pm_id,
                    "payment_mode_name": pm.get("name"),
                    "expected_amount": expected_amount,
                    "actual_amount": actual_amount,
                    "variance_amount": variance_amount,
                })

        return {"success": True, "message": "Settlement saved", "id": summary_id, "settlement_ref_id": settlement_ref_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
def get_settlement_history(account_code: str, retail_code: str, from_date: date, to_date: date):
    """Returns closed-day summaries for a date range (used by the History table)."""
    try:
        with engine.begin() as conn:
            # Fetch summary rows first
            sql = text(
                "SELECT "
                "  s.id, s.settlement_ref_id, s.business_date, "
                "  s.opening_balance_amount, s.total_income_amount, s.total_expense_amount, s.net_closing_amount, "
                "  s.withdrawal_amount, s.next_day_opening_balance, "
                "  s.total_appointments, s.total_invoices, s.settled_appointments_count, s.pending_appointments_count "
                "FROM daily_settlement_summary s "
                "WHERE s.account_code=:account_code AND s.retail_code=:retail_code "
                "  AND s.business_date BETWEEN :from_date AND :to_date "
                "ORDER BY s.business_date DESC"
            )
            rows = conn.execute(sql, {
                "account_code": account_code,
                "retail_code": retail_code,
                "from_date": str(from_date),
                "to_date": str(to_date),
            }).mappings().fetchall()

            # Fetch paymode rows for the same date range
            pay_sql = text(
                "SELECT "
                "  p.business_date, p.settlement_ref_id, "
                "  p.payment_mode_id, p.payment_mode_name, "
                "  p.expected_amount, p.actual_amount, p.variance_amount "
                "FROM daily_settlement_payment_summary p "
                "WHERE p.account_code=:account_code AND p.retail_code=:retail_code "
                "  AND p.business_date BETWEEN :from_date AND :to_date "
                "ORDER BY p.business_date DESC, p.settlement_ref_id DESC, p.payment_mode_id ASC"
            )
            pay_rows = conn.execute(pay_sql, {
                "account_code": account_code,
                "retail_code": retail_code,
                "from_date": str(from_date),
                "to_date": str(to_date),
            }).mappings().fetchall()

            def _num(v):
                try:
                    return float(v or 0)
                except Exception:
                    return 0.0

            by_key = {}
            data = []
            for r in rows:
                d = {
                    "date": r.get("business_date"),
                    "settlement_ref_id": r.get("settlement_ref_id"),
                    "opening_balance": _num(r.get("opening_balance_amount")),
                    "total_income": _num(r.get("total_income_amount")),
                    "total_expenses": _num(r.get("total_expense_amount")),
                    "net_amount": _num(r.get("net_closing_amount")),
                    "withdrawal_amount": _num(r.get("withdrawal_amount")),
                    "next_day_opening_balance": _num(r.get("next_day_opening_balance")),
                    "appointment_count": int(r.get("total_appointments") or 0),
                    "billing_count": int(r.get("total_invoices") or 0),
                    "settled_appointments": int(r.get("settled_appointments_count") or 0),
                    "pending_appointments": int(r.get("pending_appointments_count") or 0),
                    # Backward-compatible totals (filled from payments below)
                    "cash_payments": 0.0,
                    "card_payments": 0.0,
                    "upi_payments": 0.0,
                    # Detailed paymode rows
                    "payments": [],
                }
                key = (d["date"], d["settlement_ref_id"])
                by_key[key] = d
                data.append(d)

            for p in pay_rows:
                key = (p.get("business_date"), p.get("settlement_ref_id"))
                parent = by_key.get(key)
                if not parent:
                    continue

                payment_mode_id = p.get("payment_mode_id")
                expected_amount = _num(p.get("expected_amount"))
                actual_amount = _num(p.get("actual_amount"))
                variance_amount = _num(p.get("variance_amount"))

                parent["payments"].append({
                    "payment_mode_id": payment_mode_id,
                    "payment_mode_name": p.get("payment_mode_name"),
                    "expected_amount": expected_amount,
                    "actual_amount": actual_amount,
                    "variance_amount": variance_amount,
                })

                # Populate backward-compatible totals using payment_mode_name (IDs may differ).
                pm_name = str(p.get("payment_mode_name") or "").lower()
                if "cash" in pm_name:
                    parent["cash_payments"] = expected_amount
                elif "card" in pm_name:
                    parent["card_payments"] = expected_amount
                elif "upi" in pm_name:
                    parent["upi_payments"] = expected_amount

            return {"success": True, "data": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
