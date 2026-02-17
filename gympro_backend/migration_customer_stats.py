from sqlalchemy import text
from db import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate():
    columns_to_add = [
        ("age", "INT NULL"),
        ("height_cm", "FLOAT NULL"),
        ("weight_kg", "FLOAT NULL")
    ]
    
    with engine.connect() as conn:
        # Check existing columns
        result = conn.execute(text("SHOW COLUMNS FROM master_customer"))
        existing_cols = {row[0] for row in result.fetchall()}
        
        for col_name, col_type in columns_to_add:
            if col_name not in existing_cols:
                logger.info(f"Adding column {col_name} to master_customer")
                try:
                    conn.execute(text(f"ALTER TABLE master_customer ADD COLUMN {col_name} {col_type}"))
                    conn.commit()
                    logger.info(f"Successfully added {col_name}")
                except Exception as e:
                    logger.error(f"Failed to add {col_name}: {e}")
            else:
                logger.info(f"Column {col_name} already exists in master_customer")

if __name__ == "__main__":
    migrate()
