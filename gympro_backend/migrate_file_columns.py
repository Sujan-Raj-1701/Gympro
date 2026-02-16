"""
Database migration to increase column length for file URLs
"""
import os
import sys
from pathlib import Path

# Add the current directory to sys.path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

from db import engine
from sqlalchemy import text
from logger import get_logger

logger = get_logger()

def update_file_url_columns():
    """Update photo_url and document_url columns to support longer file paths"""
    try:
        with engine.begin() as conn:
            tables = ['master_customer', 'master_employee']

            for table_name in tables:
                logger.info(f"[MIGRATION] Checking current column definitions for {table_name}...")

                result = conn.execute(text("""
                    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME = :table_name
                    AND COLUMN_NAME IN ('photo_url', 'document_url')
                """), {"table_name": table_name})

                columns = list(result)
                logger.info(f"[MIGRATION] {table_name} current columns: {columns}")

                # photo_url
                if any(col[0] == 'photo_url' for col in columns):
                    logger.info(f"[MIGRATION] Updating {table_name}.photo_url to VARCHAR(500)")
                    conn.execute(text(f"""
                        ALTER TABLE {table_name}
                        MODIFY COLUMN photo_url VARCHAR(500) NULL
                    """))
                else:
                    logger.info(f"[MIGRATION] Adding {table_name}.photo_url")
                    conn.execute(text(f"""
                        ALTER TABLE {table_name}
                        ADD COLUMN photo_url VARCHAR(500) NULL
                    """))

                # document_url
                if any(col[0] == 'document_url' for col in columns):
                    logger.info(f"[MIGRATION] Updating {table_name}.document_url to VARCHAR(500)")
                    conn.execute(text(f"""
                        ALTER TABLE {table_name}
                        MODIFY COLUMN document_url VARCHAR(500) NULL
                    """))
                else:
                    logger.info(f"[MIGRATION] Adding {table_name}.document_url")
                    conn.execute(text(f"""
                        ALTER TABLE {table_name}
                        ADD COLUMN document_url VARCHAR(500) NULL
                    """))

                verify = conn.execute(text("""
                    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_NAME = :table_name
                    AND COLUMN_NAME IN ('photo_url', 'document_url')
                """), {"table_name": table_name})
                logger.info(f"[MIGRATION] {table_name} updated columns: {list(verify)}")
            
        logger.info("[MIGRATION] Database migration completed successfully")
        return True
        
    except Exception as e:
        logger.error(f"[MIGRATION] Error updating columns: {str(e)}")
        return False

def main():
    """Run the migration"""
    print("Database Migration: Increasing File URL Column Length")
    print("=" * 60)
    
    print("\nUpdating master_customer and master_employee table columns:")
    print("- photo_url: VARCHAR(500)")
    print("- document_url: VARCHAR(500)")
    
    success = update_file_url_columns()
    
    print("\n" + "=" * 60)
    if success:
        print("✅ Migration completed successfully!")
        print("\nFile upload system is now ready with proper column lengths.")
        print("You can now upload files without the 'Data too long' error.")
    else:
        print("❌ Migration failed!")
        print("Please check the error logs and try again.")
    
    return success

if __name__ == "__main__":
    main()