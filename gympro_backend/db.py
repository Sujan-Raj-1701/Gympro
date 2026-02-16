import os
from sqlalchemy import create_engine, MetaData
from sqlalchemy.engine import Engine

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()

if not DATABASE_URL:
	MYSQL_USER = os.getenv("MYSQL_USER", "root")
	MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "root")
	MYSQL_HOST = os.getenv("MYSQL_HOST", "localhost")
	MYSQL_PORT = os.getenv("MYSQL_PORT", "3306")
	MYSQL_DB = os.getenv("MYSQL_DB", "gympro")
	DATABASE_URL = f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DB}"

MYSQL_CONNECT_TIMEOUT = int(os.getenv("MYSQL_CONNECT_TIMEOUT", "5"))
SQLALCHEMY_POOL_RECYCLE = int(os.getenv("SQLALCHEMY_POOL_RECYCLE", "1800"))

engine: Engine = create_engine(
	DATABASE_URL,
	pool_pre_ping=True,
	pool_recycle=SQLALCHEMY_POOL_RECYCLE,
	connect_args={"connect_timeout": MYSQL_CONNECT_TIMEOUT},
)
metadata = MetaData() 
