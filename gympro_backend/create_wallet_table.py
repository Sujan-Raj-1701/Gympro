#!/usr/bin/env python3
"""
Script to create the customer_wallet_ledger table.
Run this to set up the table before using the wallet ledger functionality.
"""

from sqlalchemy import text
from db import engine
from logger import get_logger

logger = get_logger()

def create_wallet_ledger_table():
    """Create the customer_wallet_ledger table if it doesn't exist."""
    
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS `customer_wallet_ledger` (
        `id` INT AUTO_INCREMENT PRIMARY KEY,
        `account_code` VARCHAR(50) NOT NULL,
        `retail_code` VARCHAR(50) NOT NULL,
        `customer_id` INT NOT NULL,
        `invoice_id` VARCHAR(50) NOT NULL,
        `entry_date` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `txn_type` VARCHAR(20) NOT NULL DEFAULT 'CREDIT',
        `amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
        `status` VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        `notes` TEXT NULL,
        KEY `idx_customer` (`account_code`, `retail_code`, `customer_id`),
        KEY `idx_invoice` (`invoice_id`),
        KEY `idx_entry_date` (`entry_date`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """
    
    try:
        with engine.connect() as conn:
            conn.execute(text(create_table_sql))
            conn.commit()
            logger.info("Successfully created customer_wallet_ledger table")
            print("✓ customer_wallet_ledger table created successfully")
            
    except Exception as e:
        logger.error(f"Failed to create customer_wallet_ledger table: {e}")
        print(f"✗ Failed to create table: {e}")
        raise

if __name__ == "__main__":
    create_wallet_ledger_table()