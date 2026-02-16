#!/usr/bin/env python3
"""Create WhatsApp provider credits tables.

Creates:
- provider_credits_wallet: current credit balance per (account_code, retail_code, channel)
- provider_credits_ledger: immutable transaction ledger (credit/debit history)
- marketing_campaigns: campaign history including credits debited

Run:
  python create_provider_credits_tables.py

Requires MySQL env vars as in `db.py`:
  MYSQL_HOST, MYSQL_PORT, MYSQL_DB, MYSQL_USER, MYSQL_PASSWORD
"""

from logger import get_logger
from provider_credits import ensure_provider_credits_tables

logger = get_logger()


def main() -> None:
    try:
        ensure_provider_credits_tables()
        print("✓ provider credits tables ensured (wallet, ledger, campaigns)")
    except Exception as e:
        logger.exception("Failed to create provider credits tables")
        print(f"✗ Failed to ensure provider credits tables: {e}")
        raise


if __name__ == "__main__":
    main()
