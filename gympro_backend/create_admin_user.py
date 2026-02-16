#!/usr/bin/env python3
"""
Create Admin User Script
Creates an admin user for the salon POS system
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
from datetime import datetime

from auth import get_password_hash

def create_admin_user():
    """Create admin user in the database"""
    
    host = os.getenv('MYSQL_HOST', '103.94.27.108')
    user = os.getenv('MYSQL_USER', 'techies@admin')
    password = os.getenv('MYSQL_PASSWORD', 'techies@admin')
    database = os.getenv('MYSQL_DB', 'salonpos')
    port = int(os.getenv('MYSQL_PORT', '3306'))
    
    # Admin user details
    admin_username = input("Enter admin username (default: admin): ").strip() or "admin"
    admin_password = input("Enter admin password (default: admin123): ").strip() or "admin123"
    account_code = input("Enter account code (default: SALON001): ").strip() or "SALON001"
    retail_code = input("Enter retail code (default: RET001): ").strip() or "RET001"
    
    # Hash the password
    hashed_password = get_password_hash(admin_password)
    
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
        
        print(f"✅ Connected to database")
        
        with connection.cursor() as cursor:
            # Check if user already exists
            cursor.execute("SELECT * FROM users WHERE username = %s", (admin_username,))
            existing_user = cursor.fetchone()
            
            if existing_user:
                print(f"⚠️  User '{admin_username}' already exists")
                update = input("Update password? (y/N): ").lower().startswith('y')
                if update:
                    cursor.execute(
                        "UPDATE users SET hashed_password = %s WHERE username = %s",
                        (hashed_password, admin_username)
                    )
                    connection.commit()
                    print(f"✅ Password updated for user '{admin_username}'")
                else:
                    print("No changes made")
                return
            
            # Create new user
            now = datetime.now()
            user_id = f"{retail_code}U1"  # Simple user ID format
            
            cursor.execute("""
                INSERT INTO users (user_id, username, hashed_password, account_code, retail_code, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (user_id, admin_username, hashed_password, account_code, retail_code, now, now))
            
            connection.commit()
            user_pk = cursor.lastrowid
            
            print(f"✅ Created admin user:")
            print(f"   Username: {admin_username}")
            print(f"   User ID: {user_id}")
            print(f"   Account Code: {account_code}")
            print(f"   Retail Code: {retail_code}")
            print(f"   Database ID: {user_pk}")
            
        connection.close()
        
    except Exception as e:
        print(f"❌ Error creating admin user: {e}")
        return False
    
    return True

def main():
    print("🔧 Create Admin User")
    print("=" * 30)
    
    success = create_admin_user()
    
    if success:
        print("\n🎉 Admin user created successfully!")
        print("You can now log in to the frontend with these credentials.")
    else:
        print("\n❌ Failed to create admin user.")
    
    return 0 if success else 1

if __name__ == "__main__":
    exit(main())