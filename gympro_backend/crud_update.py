from fastapi import HTTPException
from sqlalchemy import update as sql_update, and_
from sqlalchemy import inspect as sqlalchemy_inspect
from sqlalchemy.exc import SQLAlchemyError
from typing import Dict, Any
from db import engine
from sqlalchemy import Integer
import re


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
        if s in ('1', 'true', 'yes', 'y', 'on', 'enabled'):
            return 1
        if s in ('0', 'false', 'no', 'n', 'off', 'disabled'):
            return 0
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

def get_table(metadata, table_name: str):
    from sqlalchemy import Table
    try:
        return Table(table_name, metadata, autoload_with=engine)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Table '{table_name}' not found.")

def get_pk_column(table):
    pks = [col for col in table.columns if col.primary_key]
    if not pks:
        raise HTTPException(status_code=400, detail="No primary key found for update operation.")
    return pks[0]

def update_row(metadata, table: str, data: Dict[str, Any]) -> Dict[str, Any]:
    tbl = get_table(metadata, table)
    table_column_names = {col.name for col in tbl.columns}
    # Some tables are scoped by account_code only (no retail_code). Match /read behavior.
    if 'account_code' in table_column_names and 'account_code' not in data:
        raise HTTPException(status_code=400, detail="'account_code' is required in data.")
    if 'retail_code' in table_column_names and 'retail_code' not in data:
        raise HTTPException(status_code=400, detail="'retail_code' is required in data.")
    pk_col = get_pk_column(tbl)
    if pk_col.name not in data:
        raise HTTPException(status_code=400, detail=f"Primary key '{pk_col.name}' is required in data for update.")
    pk_value = data[pk_col.name]
    update_data = data.copy()
    del update_data[pk_col.name]

    # If file URL fields are present but columns are missing, add them automatically.
    # This is needed for employee/customer masters where DBs may be missing these columns.
    if table in ('master_employee', 'master_customer') and (
        'photo_url' in update_data or 'document_url' in update_data
    ):
        table_column_names = {col.name for col in tbl.columns}
        if (
            ('photo_url' in update_data and 'photo_url' not in table_column_names)
            or ('document_url' in update_data and 'document_url' not in table_column_names)
        ):
            _ensure_file_url_columns(table)
            # Re-reflect after ALTER TABLE
            tbl = get_table(metadata, table)
    
    # Filter update_data to only include columns that exist in the table schema
    filtered_update_data = {k: v for k, v in update_data.items() if k in table_column_names}

    # Normalize status-like columns for integer schemas (masters often store 0/1)
    for col_name, value in list(filtered_update_data.items()):
        if col_name not in ('status', 'is_active', 'active'):
            continue
        col_obj = tbl.c.get(col_name)
        if col_obj is None:
            continue
        col_type_str = str(col_obj.type).lower()
        if 'int' in col_type_str or isinstance(col_obj.type, Integer):
            coerced = _coerce_binary_status(value)
            if isinstance(value, str) and isinstance(coerced, str):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid status value '{value}'. Use 1/0 or 'Active'/'Inactive'."
                )
            filtered_update_data[col_name] = coerced

    # Coerce booleans to int(0/1) for integer-like columns
    for col_name, value in list(filtered_update_data.items()):
        if not isinstance(value, bool):
            continue
        col_obj = tbl.c.get(col_name)
        if col_obj is None:
            continue
        if 'int' in str(col_obj.type).lower() or isinstance(col_obj.type, Integer):
            filtered_update_data[col_name] = 1 if value else 0
    
    # Validate tax_id for master_service table updates
    if table == 'master_service' and 'tax_id' in filtered_update_data:
        tax_id_value = filtered_update_data.get('tax_id')
        if tax_id_value in (None, '', '0', 0):
            raise HTTPException(
                status_code=400, 
                detail="tax_id is required for services and cannot be 0. Please select a valid tax rate or ensure HSN code has proper tax mapping."
            )
    
    # Log any fields that were filtered out for debugging
    filtered_fields = {k: v for k, v in update_data.items() if k not in table_column_names}
    if filtered_fields:
        from logger import get_logger
        logger = get_logger()
        logger.warning(f"[UPDATE] Filtered out non-existent columns for table '{table}': {list(filtered_fields.keys())}")
    
    try:
        where_clauses = [pk_col == pk_value]
        if 'account_code' in table_column_names:
            where_clauses.append(tbl.c.account_code == data['account_code'])
        if 'retail_code' in table_column_names:
            where_clauses.append(tbl.c.retail_code == data['retail_code'])

        stmt = sql_update(tbl).where(and_(*where_clauses)).values(**filtered_update_data)
        with engine.begin() as conn:
            result = conn.execute(stmt)
        return {"success": True, "updated_rows": result.rowcount}
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=str(e)) 