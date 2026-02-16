from sqlalchemy import create_engine, inspect
import sys
import os

# Add current directory to path so we can import db if needed, or just connect directly
try:
    from db import engine
    
    insp = inspect(engine)
    columns = insp.get_columns('users_screen_access')
    print("Columns in users_screen_access:")
    for c in columns:
        print(f"Name: {c['name']}, Type: {c['type']}")

    u_columns = insp.get_columns('users')
    print("\nColumns in users:")
    for c in u_columns:
        print(f"Name: {c['name']}, Type: {c['type']}")

except Exception as e:
    print(f"Error: {e}")
