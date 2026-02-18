from sqlalchemy import text
from db import engine
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def migrate():
    with engine.connect() as conn:
        logger.info("Dropping client_id from master_performance if exists")
        try:
            # Check if column exists
            res = conn.execute(text("SHOW COLUMNS FROM master_performance LIKE 'client_id'"))
            if res.fetchone():
                conn.execute(text("ALTER TABLE master_performance DROP COLUMN client_id"))
                conn.commit()
                logger.info("Dropped client_id column")
            else:
                logger.info("client_id column does not exist")
        except Exception as e:
            logger.error(f"Error during migration: {e}")

if __name__ == "__main__":
    migrate()
