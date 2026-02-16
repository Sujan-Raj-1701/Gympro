from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, ROUND_DOWN
from typing import Any, Optional, Dict, List

import urllib.request
import urllib.error
import json
from fastapi import HTTPException
from sqlalchemy import text

from db import engine


# Provider WhatsApp credits are message-count based (NOT currency).
DEFAULT_CURRENCY = "MSG"
DEFAULT_CHANNEL = "whatsapp"

# Legacy (older deployments stored credits in INR using a fixed price-per-recipient).
LEGACY_CURRENCY = "INR"
LEGACY_PRICE_PER_RECIPIENT_INR = Decimal("0.25")


@dataclass
class CreditsBalance:
    balance: Decimal
    currency: str


def _now_utc() -> datetime:
    return datetime.utcnow()


def ensure_provider_credits_tables() -> None:
    """Create credits wallet + ledger tables if missing.

    This app uses SQLAlchemy reflection heavily; for new tables we use explicit DDL.
    """

    ddl_wallet = """
    CREATE TABLE IF NOT EXISTS provider_credits_wallet (
        id BIGINT NOT NULL AUTO_INCREMENT,
        account_code VARCHAR(50) NOT NULL,
        retail_code VARCHAR(50) NOT NULL,
        channel VARCHAR(30) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'MSG',
        balance DECIMAL(14,2) NOT NULL DEFAULT 0,
        created_at DATETIME NULL,
        updated_at DATETIME NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_provider_credits_wallet_scope (account_code, retail_code, channel)
    ) ENGINE=InnoDB;
    """

    ddl_ledger = """
    CREATE TABLE IF NOT EXISTS provider_credits_ledger (
        id BIGINT NOT NULL AUTO_INCREMENT,
        account_code VARCHAR(50) NOT NULL,
        retail_code VARCHAR(50) NOT NULL,
        channel VARCHAR(30) NOT NULL,
        txn_type VARCHAR(20) NOT NULL,
        amount DECIMAL(14,2) NOT NULL,
        balance_after DECIMAL(14,2) NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'MSG',
        reference_type VARCHAR(50) NULL,
        reference_id VARCHAR(100) NULL,
        notes VARCHAR(255) NULL,
        created_by VARCHAR(100) NULL,
        created_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_provider_credits_ledger_scope (account_code, retail_code, channel, id)
    ) ENGINE=InnoDB;
    """

    ddl_campaigns = """
    CREATE TABLE IF NOT EXISTS marketing_campaigns (
        id BIGINT NOT NULL AUTO_INCREMENT,
        account_code VARCHAR(50) NOT NULL,
        retail_code VARCHAR(50) NOT NULL,
        channel VARCHAR(30) NOT NULL,
        campaign_name VARCHAR(150) NOT NULL,
        campaign_type VARCHAR(30) NULL,
        recipients_count INT NOT NULL DEFAULT 0,
        message_text LONGTEXT NULL,
        attachment_type VARCHAR(20) NULL,
        schedule_mode VARCHAR(20) NULL,
        schedule_at DATETIME NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'sent',
        credits_debited DECIMAL(14,2) NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'MSG',
        created_by VARCHAR(100) NULL,
        created_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_marketing_campaigns_scope (account_code, retail_code, channel, id)
    ) ENGINE=InnoDB;
    """

    with engine.begin() as conn:
        conn.exec_driver_sql(ddl_wallet)
        conn.exec_driver_sql(ddl_ledger)
        conn.exec_driver_sql(ddl_campaigns)


def ensure_whatsapp_campaign_types_table() -> None:
    """Create whatsapp_campaign_types table if missing.

    This table is global (not scoped by account/retail) and drives the campaign
    type dropdown in the UI.
    """

    ddl = """
    CREATE TABLE IF NOT EXISTS whatsapp_campaign_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        campaign_code VARCHAR(30) NOT NULL UNIQUE,
        campaign_name VARCHAR(50) NOT NULL,
        `STATUS` VARCHAR(20) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """

    with engine.begin() as conn:
        conn.exec_driver_sql(ddl)


def list_whatsapp_campaign_types(status: str = "ACTIVE") -> list[dict]:
    """List campaign types from whatsapp_campaign_types.

    Returns a list of dicts with keys: id, campaign_code, campaign_name, status, created_at
    """

    ensure_whatsapp_campaign_types_table()
    st = (status or "").strip().upper() if status is not None else ""

    sql = """
        SELECT
            id,
            campaign_code,
            campaign_name,
            display_order,
            `STATUS` AS status,
            created_at
        FROM whatsapp_campaign_types
        WHERE (:status = '' OR UPPER(`STATUS`) = :status)
        ORDER BY campaign_name ASC
    """

    with engine.begin() as conn:
        rows = conn.execute(text(sql), {"status": st}).mappings().all()
        return [dict(r) for r in (rows or [])]


def ensure_whatsapp_templates_table() -> None:
    """Create whatsapp_templates table if missing.

    NOTE: The UI expects templates from the `whatsapp_templates` table.
    """

    ddl = """
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        message_id INT,
        template_name VARCHAR(100),
        category_code VARCHAR(30),
        variable_count INT,
        variable_values VARCHAR(255),
        api_url TEXT,
        api_key TEXT,
        media_required CHAR(1) DEFAULT 'N',
        message_content TEXT,
        `STATUS` VARCHAR(20) DEFAULT 'ACTIVE',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """

    with engine.begin() as conn:
        conn.exec_driver_sql(ddl)
        # Best-effort schema drift handling for older deployments.
        # MySQL versions differ on IF NOT EXISTS for ADD COLUMN, so we catch errors.
        try:
            conn.exec_driver_sql("ALTER TABLE whatsapp_templates ADD COLUMN api_key TEXT")
        except Exception:
            pass
        try:
            conn.exec_driver_sql("ALTER TABLE whatsapp_templates ADD COLUMN media_required CHAR(1) DEFAULT 'N'")
        except Exception:
            pass


def list_whatsapp_templates(
    status: str = "ACTIVE",
    category_code: str = "",
) -> list[dict]:
    """List WhatsApp templates from whatsapp_templates."""

    ensure_whatsapp_templates_table()
    st = (status or "").strip().upper() if status is not None else ""
    cat = (category_code or "").strip()

    sql = """
        SELECT
            id,
            message_id,
            template_name,
            category_code,
            variable_count,
            variable_values,
            api_url,
                        api_key,
                        media_required,
            message_content,
            `STATUS` AS status,
            created_at
                FROM whatsapp_templates
        WHERE (:status = '' OR UPPER(`STATUS`) = :status)
          AND (:category_code = '' OR category_code = :category_code)
        ORDER BY template_name ASC
    """

    with engine.begin() as conn:
        rows = conn.execute(text(sql), {"status": st, "category_code": cat}).mappings().all()
        return [dict(r) for r in (rows or [])]


# Backward-compatible wrapper (older name used during initial wiring)
def list_fast2sms_whatsapp_templates(status: str = "ACTIVE", category_code: str = "") -> list[dict]:
    return list_whatsapp_templates(status=status, category_code=category_code)


def _to_decimal(val: Any) -> Decimal:
    """Coerce DB/JSON numeric values into Decimal.

    Must never return None: several call sites expect a Decimal and call
    `.quantize()`.
    """

    if val is None:
        return Decimal("0")
    if isinstance(val, Decimal):
        return val
    if isinstance(val, bool):
        return Decimal(int(val))
    if isinstance(val, int):
        return Decimal(val)
    if isinstance(val, float):
        # Avoid binary float artifacts.
        return Decimal(str(val))
    if isinstance(val, (bytes, bytearray)):
        val = val.decode("utf-8", errors="ignore")
    if isinstance(val, str):
        s = val.strip()
        if s == "":
            return Decimal("0")
        try:
            return Decimal(s)
        except Exception:
            return Decimal("0")

    try:
        return Decimal(str(val))
    except Exception:
        return Decimal("0")


def _to_message_count(val: Any, *, field: str = "value") -> Decimal:
    """Coerce and validate a whole-number message count."""

    d = _to_decimal(val)
    # Quantize to whole numbers (truncate toward 0) to avoid unexpected rounding up.
    d_int = d.quantize(Decimal("1"), rounding=ROUND_DOWN)
    if d != d_int:
        raise HTTPException(status_code=400, detail=f"{field} must be a whole number")
    return d_int


def _maybe_migrate_inr_scope_to_messages(*, conn: Any, account_code: str, retail_code: str, channel: str) -> None:
    """One-time migration:

    Older deployments stored provider credits as INR with a fixed price-per-recipient.
    This converts wallet, ledger, and campaign debits to message-count units.
    """

    # If the legacy price is invalid, don't attempt migration.
    if LEGACY_PRICE_PER_RECIPIENT_INR <= 0:
        return

    wallet = conn.execute(
        text(
            """
            SELECT id, balance, currency
            FROM provider_credits_wallet
            WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
            LIMIT 1
            FOR UPDATE
            """
        ),
        {"account_code": account_code, "retail_code": retail_code, "channel": channel},
    ).mappings().first()

    if not wallet:
        return

    cur = str(wallet.get("currency") or "").strip().upper()
    if cur != LEGACY_CURRENCY:
        return

    # Convert wallet balance INR -> messages (truncate toward 0)
    bal_inr = _to_decimal(wallet.get("balance"))
    bal_msg = (bal_inr / LEGACY_PRICE_PER_RECIPIENT_INR).quantize(Decimal("1"), rounding=ROUND_DOWN)
    now = _now_utc()

    conn.execute(
        text("UPDATE provider_credits_wallet SET balance=:balance, currency=:currency, updated_at=:updated_at WHERE id=:id"),
        {"balance": bal_msg, "currency": DEFAULT_CURRENCY, "updated_at": now, "id": int(wallet.get("id"))},
    )

    # Convert ledger amounts/balances in-place for this scope (only legacy rows).
    conn.execute(
        text(
            """
            UPDATE provider_credits_ledger
            SET
              amount = TRUNCATE(amount / :price, 0),
              balance_after = TRUNCATE(balance_after / :price, 0),
              currency = :new_currency
            WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
              AND (currency = :legacy_currency OR currency IS NULL OR currency = '')
            """
        ),
        {
            "price": float(LEGACY_PRICE_PER_RECIPIENT_INR),
            "new_currency": DEFAULT_CURRENCY,
            "account_code": account_code,
            "retail_code": retail_code,
            "channel": channel,
            "legacy_currency": LEGACY_CURRENCY,
        },
    )

    # Convert campaign debit records too.
    conn.execute(
        text(
            """
            UPDATE marketing_campaigns
            SET
              credits_debited = TRUNCATE(credits_debited / :price, 0),
              currency = :new_currency
            WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
              AND (currency = :legacy_currency OR currency IS NULL OR currency = '')
            """
        ),
        {
            "price": float(LEGACY_PRICE_PER_RECIPIENT_INR),
            "new_currency": DEFAULT_CURRENCY,
            "account_code": account_code,
            "retail_code": retail_code,
            "channel": channel,
            "legacy_currency": LEGACY_CURRENCY,
        },
    )


def get_provider_credits_balance(
    account_code: str,
    retail_code: str,
    channel: str = DEFAULT_CHANNEL,
) -> CreditsBalance:
    ensure_provider_credits_tables()

    chan = (channel or DEFAULT_CHANNEL).strip().lower()
    with engine.begin() as conn:
        row = conn.execute(
            text(
                """
                SELECT id, balance, currency
                FROM provider_credits_wallet
                WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"account_code": account_code, "retail_code": retail_code, "channel": chan},
        ).mappings().first()

        if not row:
            # Create a zero-balance wallet row for this scope
            now = _now_utc()
            conn.execute(
                text(
                    """
                    INSERT INTO provider_credits_wallet (account_code, retail_code, channel, currency, balance, created_at, updated_at)
                    VALUES (:account_code, :retail_code, :channel, :currency, :balance, :created_at, :updated_at)
                    """
                ),
                {
                    "account_code": account_code,
                    "retail_code": retail_code,
                    "channel": chan,
                    "currency": DEFAULT_CURRENCY,
                    "balance": Decimal("0"),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            return CreditsBalance(balance=Decimal("0"), currency=DEFAULT_CURRENCY)

        _maybe_migrate_inr_scope_to_messages(conn=conn, account_code=account_code, retail_code=retail_code, channel=chan)

        # Re-read after potential migration
        row2 = conn.execute(
            text(
                """
                SELECT balance, currency
                FROM provider_credits_wallet
                WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                LIMIT 1
                """
            ),
            {"account_code": account_code, "retail_code": retail_code, "channel": chan},
        ).mappings().first()

        bal = _to_decimal((row2 or {}).get("balance"))
        # Message credits are whole numbers.
        bal = bal.quantize(Decimal("1"), rounding=ROUND_DOWN)
        return CreditsBalance(balance=bal, currency=DEFAULT_CURRENCY)


def _apply_wallet_delta(
    *,
    account_code: str,
    retail_code: str,
    channel: str,
    delta: Decimal,
    txn_type: str,
    currency: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_id: Optional[str] = None,
    notes: Optional[str] = None,
    created_by: Optional[str] = None,
) -> CreditsBalance:
    ensure_provider_credits_tables()

    chan = (channel or DEFAULT_CHANNEL).strip().lower()
    delta = _to_decimal(delta)

    if txn_type not in ("TOPUP", "DEBIT", "ADJUST"):
        raise HTTPException(status_code=400, detail=f"Invalid txn_type '{txn_type}'")

    with engine.begin() as conn:
        # Lock row for update (create if missing)
        existing = conn.execute(
            text(
                """
                SELECT id, balance, currency
                FROM provider_credits_wallet
                WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"account_code": account_code, "retail_code": retail_code, "channel": chan},
        ).mappings().first()

        now = _now_utc()
        if not existing:
            cur = (currency or DEFAULT_CURRENCY).strip() if currency else DEFAULT_CURRENCY
            conn.execute(
                text(
                    """
                    INSERT INTO provider_credits_wallet (account_code, retail_code, channel, currency, balance, created_at, updated_at)
                    VALUES (:account_code, :retail_code, :channel, :currency, :balance, :created_at, :updated_at)
                    """
                ),
                {
                    "account_code": account_code,
                    "retail_code": retail_code,
                    "channel": chan,
                    "currency": cur,
                    "balance": Decimal("0"),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            existing = conn.execute(
                text(
                    """
                    SELECT id, balance, currency
                    FROM provider_credits_wallet
                    WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                    LIMIT 1
                    FOR UPDATE
                    """
                ),
                {"account_code": account_code, "retail_code": retail_code, "channel": chan},
            ).mappings().first()

        # Auto-migrate legacy INR credits to message-count credits.
        _maybe_migrate_inr_scope_to_messages(conn=conn, account_code=account_code, retail_code=retail_code, channel=chan)
        existing = conn.execute(
            text(
                """
                SELECT id, balance, currency
                FROM provider_credits_wallet
                WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"account_code": account_code, "retail_code": retail_code, "channel": chan},
        ).mappings().first()

        wallet_id = int(existing["id"])
        current_balance = _to_decimal(existing.get("balance")).quantize(Decimal("1"), rounding=ROUND_DOWN)
        wallet_currency = DEFAULT_CURRENCY

        # Enforce whole-number message credits.
        delta = _to_message_count(delta, field="amount")
        new_balance = (current_balance + delta).quantize(Decimal("1"), rounding=ROUND_DOWN)

        if new_balance < Decimal("0"):
            raise HTTPException(status_code=400, detail="Insufficient credits")

        conn.execute(
            text(
                """
                UPDATE provider_credits_wallet
                SET balance=:balance, updated_at=:updated_at
                WHERE id=:id
                """
            ),
            {"balance": new_balance, "updated_at": now, "id": wallet_id},
        )

        conn.execute(
            text(
                """
                INSERT INTO provider_credits_ledger (
                    account_code, retail_code, channel, txn_type, amount, balance_after, currency,
                    reference_type, reference_id, notes, created_by, created_at
                ) VALUES (
                    :account_code, :retail_code, :channel, :txn_type, :amount, :balance_after, :currency,
                    :reference_type, :reference_id, :notes, :created_by, :created_at
                )
                """
            ),
            {
                "account_code": account_code,
                "retail_code": retail_code,
                "channel": chan,
                "txn_type": txn_type,
                "amount": delta,
                "balance_after": new_balance,
                "currency": wallet_currency,
                "reference_type": reference_type,
                "reference_id": reference_id,
                "notes": notes,
                "created_by": created_by,
                "created_at": now,
            },
        )

        return CreditsBalance(balance=new_balance, currency=wallet_currency)


def topup_provider_credits(
    *,
    account_code: str,
    retail_code: str,
    channel: str,
    amount: Any,
    notes: Optional[str] = None,
    created_by: Optional[str] = None,
) -> CreditsBalance:
    amt = _to_message_count(amount, field="Top-up amount")
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Top-up amount must be > 0")
    return _apply_wallet_delta(
        account_code=account_code,
        retail_code=retail_code,
        channel=channel,
        delta=amt,
        txn_type="TOPUP",
        notes=notes or "Manual top-up",
        created_by=created_by,
    )


def debit_provider_credits_for_campaign(
    *,
    account_code: str,
    retail_code: str,
    channel: str,
    amount: Any,
    campaign_id: str,
    created_by: Optional[str] = None,
) -> CreditsBalance:
    amt = _to_message_count(amount, field="Debit amount")
    if amt <= 0:
        return get_provider_credits_balance(account_code, retail_code, channel)
    return _apply_wallet_delta(
        account_code=account_code,
        retail_code=retail_code,
        channel=channel,
        delta=-amt,
        txn_type="DEBIT",
        reference_type="campaign",
        reference_id=str(campaign_id),
        notes="Campaign send debit",
        created_by=created_by,
    )


def list_provider_credits_ledger(
    *,
    account_code: str,
    retail_code: str,
    channel: str = DEFAULT_CHANNEL,
    limit: int = 50,
) -> list[dict[str, Any]]:
    ensure_provider_credits_tables()
    chan = (channel or DEFAULT_CHANNEL).strip().lower()
    limit = max(1, min(int(limit or 50), 200))
    with engine.begin() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT id, txn_type, amount, balance_after, currency,
                           reference_type, reference_id, notes, created_by, created_at
                    FROM provider_credits_ledger
                    WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {
                    "account_code": account_code,
                    "retail_code": retail_code,
                    "channel": chan,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    # Convert Decimals / datetimes to JSON-friendly
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": int(r.get("id")),
                "txn_type": r.get("txn_type"),
                "amount": int(_to_decimal(r.get("amount")).quantize(Decimal("1"), rounding=ROUND_DOWN)),
                "balance_after": int(_to_decimal(r.get("balance_after")).quantize(Decimal("1"), rounding=ROUND_DOWN)),
                "currency": DEFAULT_CURRENCY,
                "reference_type": r.get("reference_type"),
                "reference_id": r.get("reference_id"),
                "notes": r.get("notes"),
                "created_by": r.get("created_by"),
                "created_at": (r.get("created_at").isoformat() if r.get("created_at") else None),
            }
        )
    return out


def create_marketing_campaign_and_debit(
    *,
    account_code: str,
    retail_code: str,
    channel: str,
    campaign_name: str,
    campaign_type: Optional[str],
    recipients_count: int,
    attachment_type: Optional[str],
    schedule_mode: Optional[str],
    schedule_at: Optional[datetime],
    created_by: Optional[str],
    # Extended details (accepted to support API contract, even if not fully stored yet)
    template_id: Optional[str] = None,
    template_name: Optional[str] = None,
    template_variables: Optional[Dict[str, Any]] = None,
    media_file_url: Optional[str] = None,
    customers: Optional[List[Dict[str, Any]]] = None,
) -> dict[str, Any]:
    """Create a campaign record and debit credits atomically."""

    ensure_provider_credits_tables()

    chan = (channel or DEFAULT_CHANNEL).strip().lower()
    recipients_count = int(recipients_count or 0)
    if recipients_count <= 0:
        raise HTTPException(status_code=400, detail="Recipients count must be > 0")

    # Message-count model: 1 credit == 1 recipient message.
    required = Decimal(recipients_count).quantize(Decimal("1"), rounding=ROUND_DOWN)
    now = _now_utc()

    with engine.begin() as conn:
        # Lock wallet row
        wallet = conn.execute(
            text(
                """
                SELECT id, balance, currency
                FROM provider_credits_wallet
                WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"account_code": account_code, "retail_code": retail_code, "channel": chan},
        ).mappings().first()
        if not wallet:
            # create wallet (locked)
            conn.execute(
                text(
                    """
                    INSERT INTO provider_credits_wallet (account_code, retail_code, channel, currency, balance, created_at, updated_at)
                    VALUES (:account_code, :retail_code, :channel, :currency, :balance, :created_at, :updated_at)
                    """
                ),
                {
                    "account_code": account_code,
                    "retail_code": retail_code,
                    "channel": chan,
                    "currency": DEFAULT_CURRENCY,
                    "balance": Decimal("0"),
                    "created_at": now,
                    "updated_at": now,
                },
            )
            wallet = conn.execute(
                text(
                    """
                    SELECT id, balance, currency
                    FROM provider_credits_wallet
                    WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                    LIMIT 1
                    FOR UPDATE
                    """
                ),
                {"account_code": account_code, "retail_code": retail_code, "channel": chan},
            ).mappings().first()

        current = _to_decimal(wallet.get("balance"))
        currency = str(wallet.get("currency") or DEFAULT_CURRENCY)

        # Auto-migrate legacy INR credits to message credits before comparing.
        _maybe_migrate_inr_scope_to_messages(conn=conn, account_code=account_code, retail_code=retail_code, channel=chan)
        wallet = conn.execute(
            text(
                """
                SELECT id, balance, currency
                FROM provider_credits_wallet
                WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                LIMIT 1
                FOR UPDATE
                """
            ),
            {"account_code": account_code, "retail_code": retail_code, "channel": chan},
        ).mappings().first()

        current = _to_decimal(wallet.get("balance")).quantize(Decimal("1"), rounding=ROUND_DOWN)
        currency = DEFAULT_CURRENCY
        if current < required:
            raise HTTPException(status_code=400, detail="Insufficient credits")

        # Create campaign row
        res = conn.execute(
            text(
                """
                INSERT INTO marketing_campaigns (
                    account_code, retail_code, channel,
                    campaign_name, campaign_type, recipients_count,
                    attachment_type,
                    schedule_mode, schedule_at,
                    status, credits_debited, currency,
                    created_by, created_at
                ) VALUES (
                    :account_code, :retail_code, :channel,
                    :campaign_name, :campaign_type, :recipients_count,
                    :attachment_type,
                    :schedule_mode, :schedule_at,
                    :status, :credits_debited, :currency,
                    :created_by, :created_at
                )
                """
            ),
            {
                "account_code": account_code,
                "retail_code": retail_code,
                "channel": chan,
                "campaign_name": campaign_name,
                "campaign_type": campaign_type,
                "recipients_count": recipients_count,
                "attachment_type": attachment_type,
                "schedule_mode": schedule_mode,
                "schedule_at": schedule_at,
                "status": "sent",
                "credits_debited": required,
                "currency": currency,
                "created_by": created_by,
                "created_at": now,
            },
        )
        campaign_id = res.lastrowid

        # Update wallet balance
        new_balance = (current - required).quantize(Decimal("1"), rounding=ROUND_DOWN)
        conn.execute(
            text("UPDATE provider_credits_wallet SET balance=:balance, updated_at=:updated_at WHERE id=:id"),
            {"balance": new_balance, "updated_at": now, "id": int(wallet.get("id"))},
        )

        # Ledger entry
        conn.execute(
            text(
                """
                INSERT INTO provider_credits_ledger (
                    account_code, retail_code, channel, txn_type, amount, balance_after, currency,
                    reference_type, reference_id, notes, created_by, created_at
                ) VALUES (
                    :account_code, :retail_code, :channel, 'DEBIT', :amount, :balance_after, :currency,
                    'campaign', :reference_id, :notes, :created_by, :created_at
                )
                """
            ),
            {
                "account_code": account_code,
                "retail_code": retail_code,
                "channel": chan,
                "amount": -required,
                "balance_after": new_balance,
                "currency": currency,
                "reference_id": str(campaign_id),
                "notes": "Campaign send debit",
                "created_by": created_by,
                "created_at": now,
            },
        )

        # Prepare result
        result = {
            "campaign_id": int(campaign_id) if campaign_id is not None else None,
            "credits_debited": int(required),
            "currency": currency,
            "balance_after": int(new_balance),
        }

        # Check for template details inside transaction
        send_info = None
        if template_id:
            try:
                # Assuming api_key exists as per user request
                t_row = conn.execute(
                    text("SELECT api_url, api_key, variable_values, variable_count FROM whatsapp_templates WHERE id=:tid"),
                    {"tid": template_id}
                ).mappings().first()
                if t_row:
                    send_info = dict(t_row)
            except Exception:
                # If table structure differs or fetch fails, ignore to prevent transaction rollback
                pass

    # Outside transaction (committed), perform sending
    if send_info and customers:
        try:
            base_url = send_info.get("api_url", "")
            # User specifically asked to replace <YOUR_API_KEY> from api_key column
            my_api_key = send_info.get("api_key", "")
            
            if base_url:
                # 1. Replace API Key
                url_with_key = base_url.replace("<YOUR_API_KEY>", str(my_api_key))

                def _safe_str(v: Any) -> str:
                    return "" if v is None else str(v)

                def _urlencode(v: Any) -> str:
                    from urllib.parse import quote_plus
                    return quote_plus(_safe_str(v))

                def _replace_placeholder(url: str, key: str, value: Any) -> str:
                    """Replace {key} and {{key}} placeholders in the URL, case-insensitively.

                    Some gateways/templates use single braces ({Invoice_id}) while others
                    use double braces ({{Invoice_id}}). Support both to keep templates
                    flexible without changing backend schema.
                    """
                    if not key:
                        return url
                    try:
                        import re
                        encoded = _urlencode(value)
                        # Replace double braces first, then single braces.
                        pattern2 = re.compile(r"\{\{" + re.escape(str(key)) + r"\}\}", re.IGNORECASE)
                        pattern1 = re.compile(r"\{" + re.escape(str(key)) + r"\}", re.IGNORECASE)
                        out = pattern2.sub(encoded, url)
                        out = pattern1.sub(encoded, out)
                        return out
                    except Exception:
                        return url

                def _replace_token(url: str, key: str, value: Any) -> str:
                    """Fallback replacement for legacy URLs that use bare tokens (no braces).

                    Replaces only whole-token matches (non-word boundaries) to reduce
                    accidental replacements inside other strings.
                    """
                    if not key:
                        return url
                    try:
                        import re
                        pattern = re.compile(r"(?<![A-Za-z0-9_])" + re.escape(str(key)) + r"(?![A-Za-z0-9_])", re.IGNORECASE)
                        return pattern.sub(_urlencode(value), url)
                    except Exception:
                        return url
                
                def _pick_ci(mapping: dict, key: str):
                    """Case-insensitive dict lookup."""
                    if not mapping or not key:
                        return None
                    if key in mapping:
                        return mapping.get(key)
                    lk = str(key).lower()
                    for kk, vv in mapping.items():
                        if str(kk).lower() == lk:
                            return vv
                    return None

                def _parse_variable_keys(raw: Any) -> list[str]:
                    if raw is None:
                        return []
                    s = str(raw).strip()
                    if not s:
                        return []
                    # JSON array support
                    try:
                        import json
                        parsed = json.loads(s)
                        if isinstance(parsed, list):
                            return [str(x).strip() for x in parsed if str(x).strip()]
                    except Exception:
                        pass
                    sep = "|" if "|" in s else "," if "," in s else None
                    if not sep:
                        return [s]
                    return [p.strip() for p in s.split(sep) if p.strip()]

                # 2. Iterate customers
                for cust in customers:
                    try:
                        phone = str(cust.get("phone", "") or "").strip()
                        if not phone:
                            continue

                        customer_name = _safe_str(
                            cust.get("name")
                            or cust.get("customer_name")
                            or cust.get("customerName")
                            or cust.get("CustomerName")
                            or ""
                        ).strip()
                        
                        # 3. Replace Mobile
                        # Assuming template uses <MOBILE_NUMBER> placeholder
                        curr_url = url_with_key.replace("<MOBILE_NUMBER>", phone)

                        # Always support common customer placeholders directly.
                        if customer_name:
                            curr_url = _replace_placeholder(curr_url, "customer_name", customer_name)
                            curr_url = _replace_placeholder(curr_url, "Customer_Name", customer_name)
                            curr_url = _replace_token(curr_url, "customer_name", customer_name)
                            curr_url = _replace_token(curr_url, "Customer_Name", customer_name)

                        # If gateway uses Fast2SMS-style variables_values=Var1|Var2|Var3,
                        # replace the entire variables_values param with actual values in order.
                        if "variables_values=" in curr_url and template_variables is not None:
                            import re
                            ordered_keys = _parse_variable_keys(send_info.get("variable_values") if send_info else None)

                            # Fallback: infer Var tokens from URL param value.
                            if not ordered_keys:
                                m = re.search(r"(?:\?|&)variables_values=([^&]*)", curr_url, flags=re.IGNORECASE)
                                if m:
                                    raw_tokens = m.group(1)
                                    ordered_keys = [t for t in raw_tokens.split("|") if t]

                            # Compute ordered values.
                            ordered_vals: list[str] = []
                            for k in ordered_keys:
                                vv = _pick_ci(template_variables, k)
                                if vv is None:
                                    vv = ""
                                if isinstance(vv, str) and vv.strip().lower() == "{customer_name}":
                                    vv = customer_name
                                ordered_vals.append(_safe_str(vv))

                            # If still empty, fall back to template_variables values in insertion order.
                            if ordered_keys and all(v.strip() == "" for v in ordered_vals):
                                fallback_vals: list[str] = []
                                for kk, vv in template_variables.items():
                                    if vv is None:
                                        continue
                                    sv = _safe_str(vv)
                                    if isinstance(vv, str) and vv.strip().lower() == "{customer_name}":
                                        sv = customer_name
                                    fallback_vals.append(sv)
                                if fallback_vals:
                                    ordered_vals = (fallback_vals + [""] * len(ordered_keys))[: len(ordered_keys)]

                            joined = "|".join(_urlencode(v) for v in ordered_vals)
                            curr_url = re.sub(
                                r"((?:\?|&)variables_values=)([^&]*)",
                                lambda mm: mm.group(1) + joined,
                                curr_url,
                                flags=re.IGNORECASE,
                            )
                        
                        # 4. Replace Variables using {key} placeholders.
                        # Supports templates that include placeholders like {Business_Name}, {Business_Phone}, etc.
                        if template_variables:
                            for k, v in template_variables.items():
                                if not k:
                                    continue
                                vv = v
                                # If frontend sends "{customer_name}" as a value, resolve per customer.
                                if isinstance(vv, str) and vv.strip().lower() == "{customer_name}" and customer_name:
                                    vv = customer_name
                                curr_url = _replace_placeholder(curr_url, str(k), vv)
                                curr_url = _replace_token(curr_url, str(k), vv)

                        # 4b. Attach media when provided (template/header media scenarios).
                        if media_file_url:
                            try:
                                from urllib.parse import quote
                                media_val = str(media_file_url)
                                if "<MEDIA_URL>" in curr_url:
                                    curr_url = curr_url.replace("<MEDIA_URL>", quote(media_val, safe=""))
                                elif "media_url=" not in curr_url and "media=" not in curr_url:
                                    sep = "&" if "?" in curr_url else "?"
                                    curr_url = f"{curr_url}{sep}media_url={quote(media_val, safe='')}"
                            except Exception:
                                # If quoting fails, skip media injection.
                                pass
                        
                        # 5. Send Request
                        # Using GET as per api_url structure typical of such SMS/WhatsApp gateways
                        print(f"DEBUG: Executing WhatsApp URL: {curr_url}")
                        try:
                            # Using urllib to avoid external dependency 'requests' if not installed
                            with urllib.request.urlopen(curr_url, timeout=10) as response:
                                status = response.status
                                body = response.read().decode('utf-8')
                                print(f"WhatsApp API Response for {phone}: Status={status}, Body={body}")
                        except urllib.error.URLError as e:
                            print(f"HTTP Error sending WhatsApp to {phone}: {e}")
                            
                    except Exception as e:
                        print(f"Error processing customer {cust.get('phone')}: {e}")

        except Exception as e:
            print(f"Error in campaign batch sending: {e}")

    return result


def list_marketing_campaigns(
    *,
    account_code: str,
    retail_code: str,
    channel: str = DEFAULT_CHANNEL,
    limit: int = 50,
) -> list[dict[str, Any]]:
    ensure_provider_credits_tables()
    chan = (channel or DEFAULT_CHANNEL).strip().lower()
    limit = max(1, min(int(limit or 50), 200))
    with engine.begin() as conn:
        rows = (
            conn.execute(
                text(
                    """
                    SELECT id, campaign_name, campaign_type, recipients_count, status,
                           credits_debited, currency, created_by, created_at
                    FROM marketing_campaigns
                    WHERE account_code=:account_code AND retail_code=:retail_code AND channel=:channel
                    ORDER BY id DESC
                    LIMIT :limit
                    """
                ),
                {
                    "account_code": account_code,
                    "retail_code": retail_code,
                    "channel": chan,
                    "limit": limit,
                },
            )
            .mappings()
            .all()
        )
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": int(r.get("id")),
                "campaign_name": r.get("campaign_name"),
                "campaign_type": r.get("campaign_type"),
                "recipients_count": int(r.get("recipients_count") or 0),
                "status": r.get("status"),
                "credits_debited": int(_to_decimal(r.get("credits_debited")).quantize(Decimal("1"), rounding=ROUND_DOWN)),
                "currency": DEFAULT_CURRENCY,
                "created_by": r.get("created_by"),
                "created_at": (r.get("created_at").isoformat() if r.get("created_at") else None),
            }
        )
    return out
