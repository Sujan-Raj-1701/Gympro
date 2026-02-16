#!/usr/bin/env python3
"""
Database Connection Test Script
Tests the database connection and checks for required tables/users
"""

import os
import sys
from pathlib import Path

# Add current directory to path
current_dir = Path(__file__).parent
sys.path.insert(0, str(current_dir))

# Load environment variables
from dotenv import load_dotenv
load_dotenv('.env.production')
load_dotenv('.env')

import pymysql
from sqlalchemy import create_engine, text, MetaData
from sqlalchemy.exc import SQLAlchemyError

def test_pymysql_connection():
    """Test direct PyMySQL connection"""
    print("🔍 Testing direct PyMySQL connection...")
    
    host = os.getenv('MYSQL_HOST', '103.94.27.108')
    user = os.getenv('MYSQL_USER', 'techies@admin')
    password = os.getenv('MYSQL_PASSWORD', 'techies@admin')
    database = os.getenv('MYSQL_DB', 'salonpos')
    port = int(os.getenv('MYSQL_PORT', '3306'))
    
    print(f"  Host: {host}:{port}")
    print(f"  User: {user}")
    print(f"  Database: {database}")
    print(f"  Password: {'*' * len(password)}")
    
    try:
        connection = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=pymysql.cursors.DictCursor
        )
        print("✅ PyMySQL connection successful!")
        
        with connection.cursor() as cursor:
            cursor.execute("SELECT VERSION()")
            version = cursor.fetchone()
            print(f"  MySQL Version: {version['VERSION()']}")
            
            cursor.execute("SELECT DATABASE()")
            db = cursor.fetchone()
            print(f"  Current Database: {db['DATABASE()']}")
            
            cursor.execute("SHOW TABLES")
            tables = cursor.fetchall()
            print(f"  Tables found: {len(tables)}")
            for table in tables[:5]:  # Show first 5 tables
                print(f"    - {list(table.values())[0]}")
            if len(tables) > 5:
                print(f"    ... and {len(tables) - 5} more")
        
        connection.close()
        return True
        
    except Exception as e:
        print(f"❌ PyMySQL connection failed: {e}")
        return False

def test_sqlalchemy_connection():
    """Test SQLAlchemy connection (used by FastAPI)"""
    print("\n🔍 Testing SQLAlchemy connection...")
    
    host = os.getenv('MYSQL_HOST', '103.94.27.108')
    user = os.getenv('MYSQL_USER', 'techies@admin')
    password = os.getenv('MYSQL_PASSWORD', 'techies@admin')
    database = os.getenv('MYSQL_DB', 'salonpos')
    port = os.getenv('MYSQL_PORT', '3306')
    
    # URL encode the username if it contains special characters
    import urllib.parse
    user_encoded = urllib.parse.quote_plus(user)
    password_encoded = urllib.parse.quote_plus(password)
    
    database_url = f"mysql+pymysql://{user_encoded}:{password_encoded}@{host}:{port}/{database}"
    print(f"  Connection URL: mysql+pymysql://{user_encoded}:****@{host}:{port}/{database}")
    
    try:
        engine = create_engine(database_url)
        
        with engine.connect() as connection:
            result = connection.execute(text("SELECT 1"))
            print("✅ SQLAlchemy connection successful!")
            
            # Test users table
            try:
                result = connection.execute(text("SELECT COUNT(*) as count FROM users"))
                count = result.fetchone()
                print(f"  Users table: {count[0]} records found")
                
                # Check if there are any users
                if count[0] > 0:
                    result = connection.execute(text("SELECT username FROM users LIMIT 3"))
                    users = result.fetchall()
                    print("  Sample users:")
                    for user_row in users:
                        print(f"    - {user_row[0]}")
                else:
                    print("  ⚠️  No users found in database - you may need to create admin user")
                    
            except Exception as e:
                print(f"  ⚠️  Users table issue: {e}")
        
        return True
        
    except SQLAlchemyError as e:
        print(f"❌ SQLAlchemy connection failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

def test_auth_requirements():
    """Test if authentication requirements are met"""
    print("\n🔍 Testing authentication requirements...")
    
    access_secret = os.getenv('ACCESS_TOKEN_SECRET')
    refresh_secret = os.getenv('REFRESH_TOKEN_SECRET')
    
    if not access_secret or access_secret == 'your_super_secret_jwt_key_here_change_this_in_production':
        print("❌ ACCESS_TOKEN_SECRET not set or using default value")
        return False
    
    if not refresh_secret or refresh_secret == 'your_super_refresh_jwt_key_here_change_this_in_production':
        print("❌ REFRESH_TOKEN_SECRET not set or using default value")
        return False
    
    if len(access_secret) < 32:
        print("⚠️  ACCESS_TOKEN_SECRET is short - consider using a longer key")
    
    if len(refresh_secret) < 32:
        print("⚠️  REFRESH_TOKEN_SECRET is short - consider using a longer key")
        
    print("✅ JWT secrets configured")
    return True

def main():
    print("🚀 Database Connection Test")
    print("=" * 50)
    
    # Test connections
    pymysql_ok = test_pymysql_connection()
    sqlalchemy_ok = test_sqlalchemy_connection()
    auth_ok = test_auth_requirements()
    
    print("\n📋 Summary:")
    print(f"  PyMySQL: {'✅' if pymysql_ok else '❌'}")
    print(f"  SQLAlchemy: {'✅' if sqlalchemy_ok else '❌'}")
    print(f"  Auth Secrets: {'✅' if auth_ok else '❌'}")
    
    if pymysql_ok and sqlalchemy_ok and auth_ok:
        print("\n🎉 All tests passed! Backend should work correctly.")
        return 0
    else:
        print("\n⚠️  Some tests failed. Check the issues above.")
        return 1

if __name__ == "__main__":
    exit(main())