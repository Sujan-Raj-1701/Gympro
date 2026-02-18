from sqlalchemy import create_engine, inspect
from db import engine

try:
    insp = inspect(engine)
    columns = insp.get_columns('master_performance')
    print("Columns in master_performance:")
    for c in columns:
        print(f"Name: {c['name']}, Type: {c['type']}, Nullable: {c['nullable']}")
except Exception as e:
    print(f"Error: {e}")
