from fastapi import HTTPException
from sqlalchemy import insert, select, update, func
from sqlalchemy import Integer
from sqlalchemy.exc import SQLAlchemyError
from typing import Dict, Any, Optional
from db import engine
from sqlalchemy import MetaData, Table
from datetime import datetime, date
import re
from auth import get_password_hash
import logging
from sqlalchemy import text
import json
from sqlalchemy import inspect as sqlalchemy_inspect

logger = logging.getLogger(__name__)


def _coerce_binary_status(value: Any) -> Any:
    """Coerce common UI status values to 0/1.

    Only intended to be used when the DB column is integer-like (TINYINT/INT).
    """
    if value is None:
        return None
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if s == 'active':
            return 1
        if s == 'inactive':
            return 0
        # Accept common boolean-ish strings too
        if s in ('1', 'true', 'yes', 'y', 'on', 'enabled'):
            return 1
        if s in ('0', 'false', 'no', 'n', 'off', 'disabled'):
            return 0
        # Accept numeric strings
        if re.fullmatch(r"-?\d+", s):
            try:
                return int(s)
            except Exception:
                return value
    return value


def _ensure_file_url_columns(table_name: str) -> None:
    """Ensure photo_url/document_url columns exist for masters that support file uploads."""
    try:
        insp = sqlalchemy_inspect(engine)
        cols = {c['name'] for c in insp.get_columns(table_name)}
    except Exception:
        return

    alters = []
    if 'photo_url' not in cols:
        alters.append("ADD COLUMN `photo_url` VARCHAR(500) NULL")
    if 'document_url' not in cols:
        alters.append("ADD COLUMN `document_url` VARCHAR(500) NULL")

    if alters:
        with engine.begin() as conn:
            conn.exec_driver_sql(f"ALTER TABLE `{table_name}` {', '.join(alters)}")

def get_table(table_name: str):
    try:
        metadata = MetaData()
        return Table(table_name, metadata, autoload_with=engine)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Table '{table_name}' not found.")

def auto_generate_field(table: Table, auto_config: Dict[str, Any], data: Dict[str, Any]) -> Any:
    """
    Auto-generate field value based on strategy
    
    Args:
        table: SQLAlchemy table object
        auto_config: Configuration for auto-generation
        data: The data being inserted
    
    Returns:
        Generated value for the field.
    """
    column = auto_config.get('column')
    strategy = auto_config.get('strategy')
    conditions = auto_config.get('conditions', [])
    
    if strategy == 'max+1':
        # ensure column exists on the table
        if column not in table.c:
            raise HTTPException(status_code=400, detail=f"Auto-generate column '{column}' not found on table '{table.name}'")

        # Build query to get max value with optional conditions
        # Cast to Integer to ensure numeric max (handles text-stored numbers)
        query = select(func.max(getattr(table.c, column).cast(Integer)))

        # automatically scope by account_code/retail_code when present
        if 'account_code' in table.c and 'account_code' in data:
            query = query.where(getattr(table.c, 'account_code') == data['account_code'])
        if 'retail_code' in table.c and 'retail_code' in data:
            query = query.where(getattr(table.c, 'retail_code') == data['retail_code'])

        # Add WHERE conditions (only if the condition column exists in table and data)
        for condition_col in conditions:
            if condition_col in data and condition_col in table.c:
                query = query.where(getattr(table.c, condition_col) == data[condition_col])

        try:
            # log the compiled query for debugging
            try:
                logger.debug(f"auto_generate SQL: {str(query)}")
            except Exception:
                pass
            with engine.connect() as conn:
                result = conn.execute(query).scalar()
                logger.debug(f"auto_generate query for {table.name}.{column} returned: {result}")
                # result may be None if no records exist for this account scope
                if result is None:
                    # No records found for this account scope, start from 1
                    next_val = 1
                else:
                    # robust cast: handle numeric strings, Decimal, etc.
                    try:
                        next_val = int(result) + 1
                    except Exception:
                        try:
                            next_val = int(float(result)) + 1
                        except Exception:
                            # As a final fallback scan values and compute max
                            logger.warning(f"Unable to cast max value '{result}' to int for {table.name}.{column}, trying fallback scan")
                            rows = conn.execute(select(getattr(table.c, column))).fetchall()
                            vals = [r[0] for r in rows]
                            num_vals = []
                            for v in vals:
                                try:
                                    num_vals.append(int(v))
                                except Exception:
                                    try:
                                        num_vals.append(int(float(v)))
                                    except Exception:
                                        continue
                            max_val = max(num_vals) if num_vals else 0
                            next_val = max_val + 1

                # Account-scoped ID generation: each account maintains its own sequence
                # No global fallback needed - each account should start from 1
                logger.info(f"auto_generate next value for {table.name}.{column} => {next_val}")
                return next_val
        except Exception as e:
            # Bubble up a clear HTTP error for easier debugging
            logger.error(f"Failed to compute auto-generate value for {table.name}.{column}: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Failed to compute auto-generate value for '{column}': {str(e)}")
    
    # Default fallback
    return 1

def create_row(table: str, data: Dict[str, Any], auto_generate: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    tbl = get_table(table)
    # Require account_code and retail_code to be present
    if 'account_code' not in data or 'retail_code' not in data:
        raise HTTPException(status_code=400, detail="'account_code' and 'retail_code' are required in data.")

    # If file URL fields are present but columns are missing, add them automatically.
    if table in ('master_employee', 'master_customer') and (
        'photo_url' in data or 'document_url' in data
    ):
        allowed_cols_now = set(tbl.c.keys())
        if (
            ('photo_url' in data and 'photo_url' not in allowed_cols_now)
            or ('document_url' in data and 'document_url' not in allowed_cols_now)
        ):
            _ensure_file_url_columns(table)
            tbl = get_table(table)

    # Filter incoming data to only columns that exist on the table to avoid SQLAlchemy CompileError
    allowed_cols = set(tbl.c.keys())
    filtered_data: Dict[str, Any] = {k: v for k, v in data.items() if k in allowed_cols}

    # Validate tax_id for master_service table
    if tbl.name == 'master_service' and 'tax_id' in filtered_data:
        tax_id_value = filtered_data.get('tax_id')
        if tax_id_value in (None, '', '0', 0):
            raise HTTPException(
                status_code=400, 
                detail="tax_id is required for services and cannot be 0. Please select a valid tax rate or ensure HSN code has proper tax mapping."
            )

    # Normalize complex Python types (dict/list) to JSON strings for MySQL inserts.
    # PyMySQL fails when a sequence contains dicts ("TypeError: expected str instance, dict found").
    # By serializing here, we support tables that store JSON in TEXT/LONGTEXT columns too.
    try:
        for col_name, value in list(filtered_data.items()):
            col_obj = tbl.c.get(col_name)
            # Convert dict/list values to JSON string to avoid DBAPI escaping errors
            if isinstance(value, (dict, list)):
                try:
                    filtered_data[col_name] = json.dumps(value, ensure_ascii=False, default=str)
                except Exception:
                    # Last resort string cast
                    filtered_data[col_name] = str(value)
            # Coerce booleans to int(0/1) if column is integer-like
            elif isinstance(value, bool) and col_obj is not None and 'int' in str(col_obj.type).lower():
                filtered_data[col_name] = 1 if value else 0
            # Coerce UI 'Active'/'Inactive' (and similar) to 1/0 for integer status-like columns
            elif col_name in ('status', 'is_active', 'active') and col_obj is not None:
                col_type_str = str(col_obj.type).lower()
                if 'int' in col_type_str or isinstance(col_obj.type, Integer):
                    coerced = _coerce_binary_status(value)
                    # Reject unrecognized string values early to avoid MySQL 1366
                    if isinstance(value, str) and isinstance(coerced, str):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Invalid status value '{value}'. Use 1/0 or 'Active'/'Inactive'."
                        )
                    filtered_data[col_name] = coerced
    except HTTPException:
        # Validation error (e.g. bad status value) should be returned to client
        raise
    except Exception:
        # Non-fatal; continue with whatever we have
        logger.debug("[CREATE] Failed to normalize complex values; proceeding with raw values", exc_info=True)
    
    # Log the original data for debugging customer_id issues
    if tbl.name == 'master_customer':
        logger.info(f"[CUSTOMER_CREATE] Creating master_customer with original data: {data}")
        logger.info(f"[CUSTOMER_CREATE] Filtered data for master_customer: {filtered_data}")
        logger.info(f"[CUSTOMER_CREATE] Auto-generate config: {auto_generate}")
        
        # Disable auto-generation for master_customer if customer_id is explicitly provided
        if 'customer_id' in filtered_data and filtered_data['customer_id'] is not None:
            logger.info(f"[CUSTOMER_CREATE] Disabling auto-generation as customer_id provided: {filtered_data['customer_id']}")
            auto_generate = None

    # Special handling for users table: ensure hashed password and a user_id
    if tbl.name == 'users':
        # Hash password if provided as plain text under 'hashed_password' or 'password'
        # Frontend currently posts the plain password in 'hashed_password'.
        if 'password' in data and 'hashed_password' not in data:
            filtered_data['hashed_password'] = data['password']

        if 'hashed_password' in filtered_data:
            try:
                val = str(filtered_data['hashed_password'] or '')
                # bcrypt hashes start with $2b$ / $2a$ / $2y$; hash when it doesn't look hashed
                if not val.startswith('$2'):
                    filtered_data['hashed_password'] = get_password_hash(val)
            except Exception:
                # On any issue, still try to hash
                filtered_data['hashed_password'] = get_password_hash(str(filtered_data['hashed_password']))

        # Timestamps if columns exist
        if 'create_at' in tbl.c and 'create_at' not in filtered_data:
            filtered_data['create_at'] = datetime.utcnow()
        if 'update_at' in tbl.c:
            filtered_data['update_at'] = datetime.utcnow()

    # Handle datetime fields for all tables - convert ISO strings to proper datetime objects
    for col_name, col_obj in tbl.c.items():
        if col_name in filtered_data and str(col_obj.type).lower().startswith('datetime'):
            value = filtered_data[col_name]
            if isinstance(value, str):
                try:
                    # Handle ISO format strings like '2025-09-24T08:18:04.147Z'
                    if 'T' in value:
                        # Remove 'Z' and convert to datetime object
                        clean_value = value.replace('Z', '').replace('T', ' ')
                        if '.' in clean_value:
                            # Handle microseconds
                            clean_value = clean_value.split('.')[0]
                        from datetime import datetime as dt
                        filtered_data[col_name] = dt.strptime(clean_value, '%Y-%m-%d %H:%M:%S')
                except Exception as e:
                    logger.warning(f"Failed to parse datetime '{value}' for {col_name}, removing field: {e}")
                    # Remove the problematic field to let DB handle it automatically
                    filtered_data.pop(col_name, None)

    # Auto-set timestamps for master_customer if columns exist and not provided
    if tbl.name == 'master_customer':
        current_time = datetime.utcnow()
        if 'created_at' in tbl.c and 'created_at' not in filtered_data:
            filtered_data['created_at'] = current_time
        if 'updated_at' in tbl.c and 'updated_at' not in filtered_data:
            filtered_data['updated_at'] = current_time

    # Handle auto-generation if configured
    if auto_generate:
        column = auto_generate.get('column')
        if column:
            # Validate column exists
            if column not in allowed_cols:
                raise HTTPException(status_code=400, detail=f"Auto-generate column '{column}' not found on table '{table}'")
            # Skip auto-generation for master_customer when customer_id is explicitly provided
            if tbl.name == 'master_customer' and column == 'customer_id' and 'customer_id' in filtered_data and filtered_data['customer_id'] is not None:
                logger.info(f"[CUSTOMER_CREATE] Skipping auto-generation for customer_id, using provided value: {filtered_data['customer_id']}")
            # Only auto-generate if the field is not already provided
            elif column not in filtered_data or filtered_data[column] is None or filtered_data[column] == '':
                generated_value = auto_generate_field(tbl, auto_generate, filtered_data)
                filtered_data[column] = generated_value
            else:
                logger.info(f"Skipping auto-generation for {column} as value already provided: {filtered_data[column]}")
        
    # Special handling for master_customer: preserve explicitly provided customer_id
    if tbl.name == 'master_customer':
        if 'customer_id' in filtered_data and filtered_data['customer_id'] is not None and str(filtered_data['customer_id']).strip() != '':
            logger.info(f"[CUSTOMER_CREATE] Using explicitly provided customer_id: {filtered_data['customer_id']}")
            # Ensure it's treated as the correct type
            try:
                if str(tbl.c.customer_id.type).lower().startswith('int'):
                    filtered_data['customer_id'] = int(filtered_data['customer_id'])
                else:
                    filtered_data['customer_id'] = str(filtered_data['customer_id'])
                logger.info(f"[CUSTOMER_CREATE] Final customer_id after type conversion: {filtered_data['customer_id']}")
            except Exception as e:
                logger.warning(f"[CUSTOMER_CREATE] Failed to cast customer_id: {e}")
        else:
            # Auto-generate only if not provided or empty
            logger.info("[CUSTOMER_CREATE] Auto-generating customer_id as none provided or empty")
            try:
                max_query = select(func.max(tbl.c.customer_id.cast(Integer)))
                # Scope by account/retail if available
                if 'account_code' in filtered_data and 'account_code' in tbl.c:
                    max_query = max_query.where(tbl.c.account_code == filtered_data['account_code'])
                if 'retail_code' in filtered_data and 'retail_code' in tbl.c:
                    max_query = max_query.where(tbl.c.retail_code == filtered_data['retail_code'])
                
                with engine.connect() as conn:
                    max_result = conn.execute(max_query).scalar()
                    next_id = (max_result or 0) + 1
                    filtered_data['customer_id'] = next_id
                    logger.info(f"[CUSTOMER_CREATE] Auto-generated customer_id: {next_id}")
            except Exception as e:
                logger.error(f"[CUSTOMER_CREATE] Failed to auto-generate customer_id: {e}")
                filtered_data['customer_id'] = 1

    try:
        stmt = insert(tbl).values(**filtered_data)
        generated_user_id: Optional[str] = None
        with engine.begin() as conn:
            result = conn.execute(stmt)
            # Try to get inserted primary key in several ways (SQLAlchemy / DBAPI / MySQL fallback)
            inserted_id = None
            try:
                if getattr(result, 'inserted_primary_key', None):
                    inserted_id = result.inserted_primary_key[0]
            except Exception:
                inserted_id = None

            # Fallback to DBAPI lastrowid if available
            if inserted_id is None:
                try:
                    lastrowid = getattr(result, 'lastrowid', None)
                    if lastrowid:
                        inserted_id = int(lastrowid)
                except Exception:
                    pass

            # Final fallback for MySQL: SELECT LAST_INSERT_ID() on the same connection
            if inserted_id is None:
                try:
                    last = conn.execute(text("SELECT LAST_INSERT_ID()")).scalar()
                    if last:
                        inserted_id = int(last)
                except Exception:
                    pass

            # If users table, set user_id = <retail_code>U<id> using a follow-up update
            if tbl.name == 'users' and inserted_id is not None and 'retail_code' in filtered_data:
                generated_user_id = f"{filtered_data['retail_code']}U{inserted_id}"
                try:
                    conn.execute(
                        update(tbl)
                        .where(tbl.c.id == inserted_id)
                        .values(user_id=generated_user_id)
                    )
                except Exception as e:
                    logger.error(f"Failed to update user_id for users.id={inserted_id}: {e}")
                # As a stronger fallback, ensure user_id is set using a DB-side CONCAT in the same transaction
                try:
                    # Use parameterized SQL to avoid quoting issues; this will set user_id to retail_code||'U'||id
                    conn.execute(text("UPDATE users SET user_id = CONCAT(COALESCE(retail_code, ''),'U', :id) WHERE id = :id AND (user_id IS NULL OR user_id = '')"), {"id": inserted_id})
                except Exception as e:
                    logger.debug(f"Failed to enforce user_id via SQL fallback for users.id={inserted_id}: {e}")

            # If master_inventory created, ensure an initial current_stock row exists
            if tbl.name == 'master_inventory':
                try:
                    md_cs = MetaData()
                    current_stock_tbl = Table('current_stock', md_cs, autoload_with=conn)

                    acc = filtered_data.get('account_code')
                    ret = filtered_data.get('retail_code')
                    product_id = filtered_data.get('product_id')
                    product_name = filtered_data.get('product_name')

                    if acc and ret and product_id is not None and product_name:
                        item_id = str(product_id)
                        # Avoid duplicate rows for same account+retail+item
                        exists_q = (
                            select(current_stock_tbl.c.id)
                            .where(current_stock_tbl.c.account_code == acc)
                            .where(current_stock_tbl.c.retail_code == ret)
                            .where(current_stock_tbl.c.item_id == item_id)
                            .limit(1)
                        )
                        exists_row = conn.execute(exists_q).fetchone()
                        if not exists_row:
                            cs_payload: Dict[str, Any] = {
                                'account_code': acc,
                                'retail_code': ret,
                                'item_id': item_id,
                                'item_name': str(product_name),
                                'opening_qty': 0,
                                'purchase_qty': 0,
                                'damage_qty': 0,
                                'audit_qty': 0,
                                'current_qty': 0,
                                'stock_date': date.today(),
                            }
                            # Only include columns that exist (supports slight schema variations)
                            cs_allowed = set(current_stock_tbl.c.keys())
                            cs_filtered = {k: v for k, v in cs_payload.items() if k in cs_allowed}
                            conn.execute(insert(current_stock_tbl).values(**cs_filtered))
                    else:
                        logger.warning(
                            f"[CURRENT_STOCK] Skipping insert (missing fields). account_code={acc}, retail_code={ret}, product_id={product_id}, product_name={product_name}"
                        )
                except HTTPException:
                    raise
                except Exception as e:
                    # Fail inventory creation if current_stock cannot be maintained
                    logger.error(f"[CURRENT_STOCK] Failed to create current_stock row for master_inventory: {e}")
                    raise HTTPException(
                        status_code=500,
                        detail=f"Inventory created but failed to create current_stock entry: {str(e)}"
                    )

        resp: Dict[str, Any] = {"success": True, "inserted_id": inserted_id}
        if generated_user_id:
            resp["user_id"] = generated_user_id
        return resp
    except SQLAlchemyError as e:
        # include table and keys in error for easier debugging
        raise HTTPException(status_code=500, detail=f"Insert failed for table '{table}' with keys {list(filtered_data.keys())}: {str(e)}")