import random
import string
import hashlib
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any
from sqlalchemy import insert, select, func, update
from db import engine
from auth import get_password_hash
from sqlalchemy import MetaData, Table

def get_next_sequential_code(table_name: str, column_name: str, prefix: str) -> str:
    """Get next sequential code for a given table and column"""
    try:
        table = get_table(table_name)
        
        # Get all existing codes for this prefix
        query = select(getattr(table.c, column_name))
        
        with engine.begin() as conn:
            result = conn.execute(query)
            existing_codes = [row[0] for row in result if row[0] and row[0].startswith(prefix)]
        
        if not existing_codes:
            return f"{prefix}1"
        
        # Extract numbers from existing codes
        numbers = []
        for code in existing_codes:
            try:
                # Remove prefix and convert to number
                number_part = code[len(prefix):]
                if number_part.isdigit():
                    numbers.append(int(number_part))
            except (ValueError, IndexError):
                continue
        
        # Get the next number
        next_number = max(numbers) + 1 if numbers else 1
        return f"{prefix}{next_number}"
        
    except Exception as e:
        print(f"Error getting next sequential code: {e}")
        # Fallback: use timestamp-based code
        timestamp = str(int(datetime.now().timestamp()))[-6:]
        return f"{prefix}{timestamp}"

def get_simple_sequential_code(table_name: str, column_name: str, prefix: str) -> str:
    """Get next sequential code using a simpler approach"""
    try:
        table = get_table(table_name)
        
        # Count existing records for this table
        query = select(func.count(getattr(table.c, column_name)))
        
        with engine.begin() as conn:
            result = conn.execute(query).scalar()
            
        # Use count + 1 as the next number
        next_number = (result or 0) + 1
        return f"{prefix}{next_number}"
        
    except Exception as e:
        print(f"Error getting simple sequential code: {e}")
        # Fallback: use timestamp-based code
        timestamp = str(int(datetime.now().timestamp()))[-6:]
        return f"{prefix}{timestamp}"

def generate_code(prefix: str, length: int = 8) -> str:
    """Generate a unique code with given prefix"""
    random_part = ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))
    return f"{prefix}{random_part}"

def generate_license_key(company_code: str, account_code: str, business_type: str, license_period: str) -> str:
    """Generate a unique license key"""
    # Create a unique string for hashing
    unique_string = f"{company_code}_{account_code}_{business_type}_{license_period}_{datetime.now().isoformat()}"
    
    # Generate hash
    license_hash = hashlib.md5(unique_string.encode()).hexdigest()[:16].upper()
    
    # Format: COMP-ACCT-BUSTYPE-HASH
    return f"{company_code}-{account_code}-{business_type}-{license_hash}"

def generate_license_key_with_expiry(
    company_code: str,
    account_code: str,
    business_code: str,
    retail_code: str,
    license_period: str,
    custom_end_date: Any = None,
) -> str:
    """Generate a unique license key with expiry date information"""
    current_date = datetime.now()

    def _parse_custom_end_date(value: Any):
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            s = value.strip()
            if not s:
                return None
            # Support ISO strings with Z
            try:
                if s.endswith('Z'):
                    s = s[:-1] + '+00:00'
                dt = datetime.fromisoformat(s)
                # Normalize timezone-aware datetimes to naive UTC for comparisons/formatting
                if getattr(dt, 'tzinfo', None) is not None:
                    dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
                return dt
            except Exception:
                pass
            # Support plain YYYY-MM-DD
            try:
                return datetime.strptime(s[:10], '%Y-%m-%d')
            except Exception:
                return None
        return None

    def _calculate_expiry_date(period: Any, custom_end_date_value: Any = None) -> datetime:
        p = (period or '').strip()
        if p == '7-days':
            return current_date + timedelta(days=7)
        if p == '15-days':
            return current_date + timedelta(days=15)
        if p == '1-month':
            return current_date + timedelta(days=30)
        if p == '3-months':
            return current_date + timedelta(days=90)
        if p == '6-months':
            return current_date + timedelta(days=180)
        if p == '1-year':
            return current_date + timedelta(days=365)
        if p == '2-years':
            return current_date + timedelta(days=730)
        if p == '3-years':
            return current_date + timedelta(days=1095)
        if p.lower() in {'custom', 'custom-date'}:
            dt = _parse_custom_end_date(custom_end_date_value)
            if dt and dt > current_date:
                return dt
            # Fallback if custom date is missing/invalid
            return current_date + timedelta(days=365)

        # Default to 1 year
        return current_date + timedelta(days=365)

    expiry_date = _calculate_expiry_date(license_period, custom_end_date)
    
    # Format expiry date as YYYYMMDD
    expiry_date_str = expiry_date.strftime('%Y%m%d')
    
    # Create a unique string for hashing
    unique_string = f"{company_code}_{account_code}_{business_code}_{retail_code}_{license_period}_{expiry_date_str}_{current_date.isoformat()}"
    
    # Generate hash
    license_hash = hashlib.md5(unique_string.encode()).hexdigest()[:12].upper()
    
    # Format: COMP-ACCT-BUS-RETAIL-EXPIRY-HASH
    return f"{company_code}-{account_code}-{business_code}-{retail_code}-{expiry_date_str}-{license_hash}"

def get_table(table_name: str):
    """Get table object"""
    try:
        metadata = MetaData()
        table = Table(table_name, metadata, autoload_with=engine)
        print(f"Table {table_name} columns: {[col.name for col in table.columns]}")
        return table
    except Exception as e:
        raise Exception(f"Table '{table_name}' not found: {str(e)}")

def insert_record(table_name: str, data: Dict[str, Any]) -> bool:
    """Insert record directly using SQLAlchemy"""
    try:
        table = get_table(table_name)
        # Filter out any keys that are not actual columns to prevent 'Unconsumed column names' errors
        valid_columns = {col.name for col in table.columns}
        filtered_data = {k: v for k, v in data.items() if k in valid_columns}
        dropped_keys = [k for k in data.keys() if k not in valid_columns]
        if dropped_keys:
            print(f"Warning: Dropping unknown columns for {table_name}: {dropped_keys}")
        print(f"Inserting into {table_name} with data: {filtered_data}")
        # Pass mapping (not kwargs) to support column names with spaces (e.g., 'accountant no')
        stmt = insert(table).values(filtered_data)
        with engine.begin() as conn:
            conn.execute(stmt)
        print(f"Successfully inserted into {table_name}")
        return True
    except Exception as e:
        print(f"Error inserting into {table_name}: {e}")
        return False

def process_license_request(license_request_data: Dict[str, Any]) -> Dict[str, Any]:
    """Process license request and save to database using direct SQLAlchemy"""
    try:
        # Extract data from request
        company_name = license_request_data.get('companyName')
        company_phone = license_request_data.get('companyPhone')
        company_email = license_request_data.get('companyEmail')
        selected_business_types = license_request_data.get('selectedBusinessTypes', [])
        businesses = license_request_data.get('businesses', {})
        
        # Generate company code (C1, C2, C3, etc.)
        company_code = get_simple_sequential_code('company_master', 'company_code', 'C')
        
        # Create company record
        company_data = {
            'company_code': company_code,
            'OwnerName': company_name,
            'Phone': company_phone,
            'email': company_email,
            'CreateUsr': 'SYSTEM',
            'CreateDt': datetime.now(),
            'UpdateUsr': None,
            'UpdateDt': datetime.now()
        }
        
        # Insert company record
        if not insert_record('company_master', company_data):
            return {
                "success": False,
                "message": "Failed to create company record"
            }
        
        account_codes = []
        business_codes = []
        license_keys = []
        retail_codes = []
        
        # Process each business type
        for business_type, business_list in businesses.items():
            for idx, business in enumerate(business_list):
                # Use BusCode from payload (or fallback to the dict key business_type)
                business_code = (
                    business.get('BusCode')
                    or business.get('busCode')
                    or str(business_type)
                )
                
                # Per requirement: account_code = company_code + BusCode + 'A1'
                account_code = f"{company_code}{business_code}A1"
                
                # Create account record (without license key)
                account_data = {
                    'account_code': account_code,
                    'company_code': company_code,
                    'BusCode': business_code,
                    'AccountName': business.get('accountName'),
                    'Phone': business.get('accountPhone'),
                    'CreateUsr': 'SYSTEM',
                    'CreateDt': datetime.now(),
                    'UpdateUsr': None,
                    'UpdateDt': datetime.now()
                }
                
                # Insert account record
                if insert_record('account_master', account_data):
                    account_codes.append(account_code)
                    business_codes.append(business_code)
                    
                    # Create retail records based on retailCount
                    retail_count = business.get('retailCount', 1)
                    for retail_idx in range(retail_count):
                        # Generate retail code per account: prefix = account_code + 'R' -> e.g., C1B1A1R1, C1B1A1R2, ...
                        retail_code = get_next_sequential_code('retail_master', 'retail_code', f"{account_code}R")
                        
                        # Generate license key with expiry date for this retail unit
                        # Respect per-unit periods if licenseApplicationType is "each"
                        license_application_type = (business.get('licenseApplicationType') or 'all')
                        license_period = business.get('licensePeriod', '1-year')
                        custom_end_date = business.get('customEndDate')
                        if license_application_type == 'each':
                            retail_periods = business.get('retailUnitPeriods') or []
                            if retail_idx < len(retail_periods) and isinstance(retail_periods[retail_idx], dict):
                                unit = retail_periods[retail_idx]
                                license_period = unit.get('period') or license_period
                                custom_end_date = unit.get('customEndDate') or custom_end_date

                        license_key = generate_license_key_with_expiry(
                            company_code,
                            account_code,
                            business_code,
                            retail_code,
                            str(license_period or '1-year'),
                            custom_end_date=custom_end_date,
                        )
                        
                        # Create retail record with license key and default values
                        retail_data = {
                            'retail_code': retail_code,
                            'account_code': account_code,
                            'RetailName': f"{business.get('accountName')}_retail_{retail_idx + 1}",
                            'licencekey': license_key,
                            'CreateUsr': 'SYSTEM',
                            'CreateDt': datetime.now(),
                            'UpdateUsr': None,
                            'UpdateDt': datetime.now(),
                            'gst_no': '',  # Default empty value
                            'address': '',  # Default empty value
                            'phone1': '',   # Default empty value
                            'accountant no': '',  # Default empty value
                            'phone2': '',   # Default empty value
                            'email': company_email or ''  # Default to company email if available
                        }
                        
                        # Insert retail record
                        if insert_record('retail_master', retail_data):
                            retail_codes.append(retail_code)
                            license_keys.append(license_key)
                            
                            # Create default user for this retail unit
                            retail_name = f"{business.get('accountName')}_retail_{retail_idx + 1}"
                            username = f"{retail_name}{retail_code}"
                            plain_password = username  # Same as username
                            hashed_password = get_password_hash(plain_password)
                            
                            # Get the ID of the inserted retail record
                            try:
                                # Query to get the ID of the just inserted retail record
                                table = get_table('retail_master')
                                query = select(table.c.Id).where(table.c.retail_code == retail_code)
                                
                                with engine.begin() as conn:
                                    result = conn.execute(query)
                                    retail_id = result.scalar()
                                
                                if retail_id:
                                    userid = f"{retail_code}U{retail_id}"
                                    
                                    # Create user record
                                    user_data = {
                                        'user_id': userid,
                                        'username': username,
                                        'hashed_password': hashed_password,  # Properly hashed password
                                        'account_code': account_code,
                                        'retail_code': retail_code,
                                        'create_at': datetime.now(),
                                        'update_at': datetime.now()
                                    }
                                    
                                    # Insert user record
                                    if insert_record('users', user_data):
                                        print(f"Created user: {username} with userid: {userid}")
                                        # Insert default screen access rows for all modules
                                        try:
                                            modules_tbl = get_table('modules')
                                            usa_tbl = get_table('users_screen_access')
                                            # Collect module IDs and existing access rows for this user
                                            with engine.begin() as conn:
                                                mod_ids = [row[0] for row in conn.execute(select(modules_tbl.c.id))]
                                                try:
                                                    existing_res = conn.execute(
                                                        select(usa_tbl.c.screen_id).where(usa_tbl.c.user_id == userid)
                                                    )
                                                    existing = {row[0] for row in existing_res if row[0] is not None}
                                                except Exception:
                                                    existing = set()
                                                now_ts = datetime.now()
                                                allowed_cols = {c.name for c in usa_tbl.columns}
                                                rows = []
                                                for sid in mod_ids:
                                                    if sid in existing:
                                                        continue
                                                    candidate = {
                                                        'user_id': userid,
                                                        'screen_id': int(sid),
                                                        'can_view': 1,
                                                        'can_edit': 1,
                                                        'created_at': now_ts,
                                                        'updated_at': now_ts,
                                                    }
                                                    filtered = {k: v for k, v in candidate.items() if k in allowed_cols}
                                                    rows.append(filtered)
                                                if rows:
                                                    conn.execute(insert(usa_tbl), rows)
                                                    print(f"Inserted {len(rows)} users_screen_access rows for user {userid}")
                                        except Exception as e:
                                            print(f"Error inserting default screen access for user {userid}: {e}")
                                    else:
                                        print(f"Failed to create user for retail: {retail_code}")
                                else:
                                    print(f"Could not get retail ID for: {retail_code}")
                                    
                            except Exception as e:
                                print(f"Error creating user for retail {retail_code}: {e}")
        
        return {
            "success": True,
            "message": "License request processed successfully",
            "summary": {
                "company_code": company_code,
                "total_businesses": len(account_codes),
                "business_types": selected_business_types,
                "business_codes": business_codes,
                "account_codes": account_codes,
                "license_keys": license_keys,
                "retail_codes": retail_codes
            }
        }
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        return {
            "success": False,
            "message": f"Error processing license request: {str(e)}\nDetails: {error_details}"
        }

def extend_license(data: Dict[str, Any]) -> Dict[str, Any]:
    """Extend license for a retail unit"""
    try:
        retail_code = data.get('retail_code')
        extension_term = data.get('extension_term')
        custom_expiry = data.get('custom_expiry')
        
        if not retail_code:
            return {"success": False, "message": "Retail code is required"}
            
        # Get details to generate new key
        retail_table = get_table('retail_master')
        account_table = get_table('account_master')
        
        # 1. Get retail details
        query_retail = select(retail_table).where(retail_table.c.retail_code == retail_code)
        
        retail_row = None
        with engine.connect() as conn:
            result = conn.execute(query_retail)
            retail_row = result.fetchone()
            
        if not retail_row:
             return {"success": False, "message": "Retail unit not found"}
             
        # Convert row to dict for easier access
        retail_data = dict(retail_row._mapping)
        account_code = retail_data.get('account_code')
        
        # 2. Get account details
        query_account = select(account_table).where(account_table.c.account_code == account_code)
        
        account_row = None
        with engine.connect() as conn:
            result = conn.execute(query_account)
            account_row = result.fetchone()
            
        if not account_row:
            return {"success": False, "message": "Account not found"}
            
        account_data = dict(account_row._mapping)
        company_code = account_data.get('company_code')
        bus_code = account_data.get('BusCode')
        
        # 3. Generate new license key
        new_license_key = generate_license_key_with_expiry(
            company_code=company_code,
            account_code=account_code,
            business_code=bus_code,
            retail_code=retail_code,
            license_period=extension_term,
            custom_end_date=custom_expiry
        )
        
        # 4. Update retail_master
        stmt = (
            update(retail_table)
            .where(retail_table.c.retail_code == retail_code)
            .values(
                licencekey=new_license_key,
                UpdateUsr='SYSTEM',  # Or passed user
                UpdateDt=datetime.now()
            )
        )
        
        with engine.begin() as conn:
            conn.execute(stmt)
            
        return {
            "success": True, 
            "message": "License extended successfully",
            "data": {
                "new_license_key": new_license_key,
                "retail_code": retail_code
            }
        }
        
    except Exception as e:
        import traceback
        return {
            "success": False, 
            "message": f"Error extending license: {str(e)}",
            "details": traceback.format_exc()
        }


