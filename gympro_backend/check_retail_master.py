from db import engine
from sqlalchemy import inspect

try:
    insp = inspect(engine)
    cols = insp.get_columns('retail_master')
    for c in cols:
        print(f"{c['name']} ({c['type']})")
except Exception as e:
    print(e)
