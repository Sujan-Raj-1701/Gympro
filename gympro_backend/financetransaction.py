"""
Financial Transaction Processing Module

This module contains helper functions for processing income/expense transactions,
including column mapping, customer management, tax calculations, and bulk operations.
Extracted from main.py to maintain clean architecture.
"""

from typing import Dict, Any, List, Optional, Tuple
from sqlalchemy import MetaData, Table, select, and_
from sqlalchemy.sql import insert as sql_insert
from sqlalchemy.engine import Engine
from fastapi import HTTPException
from pydantic import BaseModel, Field
from auth import User
from logger import get_logger
import traceback
from datetime import datetime

# Initialize logger
logger = get_logger()


# Define the TransIncomeExpenseRequest model locally since it's used by this module
class TransItem(BaseModel):
    description: str
    qty: Optional[int] = 1
    price: Optional[float] = 0
    amount: Optional[float] = None
    remarks: Optional[str] = None
    tax_id: Optional[str] = None
    inclusive_tax: Optional[bool] = None  # whether entered price was tax-inclusive (frontend uses for UX)


class TransIncomeExpenseRequest(BaseModel):
    account_code: str
    retail_code: str
    entry_date: str  # yyyy-mm-dd
    type: str  # 'inflow' | 'outflow' | 'Income' | 'Expense'
    payment_method: str
    items: List[TransItem]
    created_by: Optional[str] = None
    # Optional customer meta for cash invoice
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    customer_address: Optional[str] = None
    customer_gstin: Optional[str] = None


def get_transaction_table_columns(engine: Engine) -> Tuple[Table, Dict[str, Optional[str]]]:
    """
    Get the transaction table and map column names to their actual names in the database.
    
    Args:
        engine: SQLAlchemy engine instance
        
    Returns:
        Tuple of (Table object, column mapping dictionary)
        
    Raises:
        HTTPException: If required columns are missing
    """
    md = MetaData()
    tbl = Table('trans_income_expense', md, autoload_with=engine)
    table_cols = list(tbl.c.keys())

    def pick(*names: str) -> Optional[str]:
        """Pick the first existing column name from alternatives."""
        for n in names:
            if n in tbl.c.keys():
                return n
        return None

    # Core columns mapping
    column_mapping = {
        'account_code': pick('account_code'),
        'retail_code': pick('retail_code'),
        'entry_date': pick('entry_date', 'date'),
        'type': pick('TYPE', 'type'),
        'payment_method': pick('payment_method', 'payment', 'paymode'),
        'description': pick('description', 'desc'),
        'qty': pick('qty', 'quantity'),
        'price': pick('price', 'rate', 'unit_price'),
        'amount': pick('amount', 'total_amount', 'total'),
        'remarks': pick('remarks', 'remark', 'notes'),
        'created_by': pick('created_by'),
        'updated_by': pick('updated_by'),
        'customer_id': pick('customer_id', 'cust_id', 'CustomerID', 'customerId'),
        'customer_name': pick('customer_name', 'cust_name', 'name'),
        'customer_phone': pick('customer_phone', 'phone', 'mobile', 'phone_number'),
        'customer_address': pick('customer_address', 'address', 'addr'),
        'customer_gstin': pick('customer_gstin', 'gstin', 'gst_no', 'gst_number'),
        # Optional tax columns
        'tax_id': pick('tax_id'),
        'tax_amount': pick('tax_amount', 'tax_total', 'tax'),
        'tax_cgst': pick('tax_cgst', 'cgst_amount', 'cgst'),
        'tax_sgst': pick('tax_sgst', 'sgst_amount', 'sgst'),
        'inclusive_tax': pick('inclusive_tax', 'inclusive', 'is_inclusive'),
    }

    # Validate required columns
    required_columns = [
        ('account_code', column_mapping['account_code']),
        ('retail_code', column_mapping['retail_code']),
        ('entry_date', column_mapping['entry_date']),
        ('TYPE/type', column_mapping['type']),
        ('payment_method', column_mapping['payment_method']),
        ('description', column_mapping['description']),
        ('qty', column_mapping['qty']),
        ('price', column_mapping['price']),
        ('amount', column_mapping['amount']),
    ]
    
    missing = [name for name, col in required_columns if col is None]
    if missing:
        logger.error(f"[TRANS I/E] Missing required columns: {missing} (have {table_cols})")
        raise HTTPException(
            status_code=500, 
            detail=f"Server misconfiguration for trans_income_expense: {', '.join(missing)}"
        )

    return tbl, column_mapping


def load_tax_metadata(engine: Engine, req: TransIncomeExpenseRequest) -> Dict[str, Dict[str, Any]]:
    """
    Preload tax metadata for transactions that have tax_id specified.
    
    Args:
        engine: SQLAlchemy engine instance
        req: Transaction request containing items with potential tax_ids
        
    Returns:
        Dictionary mapping tax_id to tax metadata
    """
    tax_meta: Dict[str, Dict[str, Any]] = {}
    
    # Check if any items have tax_id
    has_tax_items = any(getattr(item, 'tax_id', None) for item in req.items)
    if not has_tax_items:
        return tax_meta

    try:
        md = MetaData()
        tax_tbl = Table('master_tax', md, autoload_with=engine)
        
        with engine.begin() as conn_meta:
            for row in conn_meta.execute(select(tax_tbl)):
                meta = dict(row._mapping)
                key = str(meta.get('tax_id') or meta.get('id') or meta.get('code') or '').strip()
                if key:
                    tax_meta[key] = meta
                    
    except Exception:
        logger.warning('[TRANS I/E] Unable to preload master_tax metadata', exc_info=True)
    
    return tax_meta


def create_customer_if_not_exists(engine: Engine, req: TransIncomeExpenseRequest, current_user: Optional[User]) -> Optional[str]:
    """
    Create a new customer record if customer_id is not provided but customer details are available.
    
    Args:
        engine: SQLAlchemy engine instance
        req: Transaction request containing customer details
        current_user: Current authenticated user
        
    Returns:
        New customer ID if created, None otherwise
    """
    # Check if customer creation is needed
    if (req.customer_id and str(req.customer_id).strip() not in ('', '0', 'null')):
        return None
        
    if not (req.customer_name or req.customer_phone):
        return None

    new_customer_id: Optional[str] = None
    
    try:
        md = MetaData()
        cust_tbl = Table('master_customer', md, autoload_with=engine)
        cust_cols = cust_tbl.c.keys()
        
        # Build customer data
        ins_data: Dict[str, Any] = {}
        
        # Basic customer information
        if 'customer_name' in cust_cols and req.customer_name:
            ins_data['customer_name'] = req.customer_name
        if 'customer_phone' in cust_cols and req.customer_phone:
            ins_data['customer_phone'] = req.customer_phone
        if 'customer_address' in cust_cols and req.customer_address:
            ins_data['customer_address'] = req.customer_address
        if 'customer_gstin' in cust_cols and req.customer_gstin:
            ins_data['customer_gstin'] = req.customer_gstin
            
        # Business context
        if 'account_code' in cust_cols:
            ins_data['account_code'] = req.account_code
        if 'retail_code' in cust_cols:
            ins_data['retail_code'] = req.retail_code
            
        # Audit fields
        creator_val = req.created_by or getattr(current_user, 'username', None) or getattr(current_user, 'user_id', None)
        if 'created_by' in cust_cols and creator_val:
            ins_data['created_by'] = str(creator_val)
        if 'updated_by' in cust_cols and creator_val:
            ins_data['updated_by'] = str(creator_val)

        if ins_data:
            with engine.begin() as cconn:
                res_c = cconn.execute(sql_insert(cust_tbl).values(ins_data))
                try:
                    new_customer_id = str(res_c.inserted_primary_key[0])
                except Exception:
                    # Try to refetch last inserted row if primary key column is known
                    pkc = None
                    for c in cust_tbl.columns:
                        if getattr(c, 'primary_key', False):
                            pkc = c
                            break
                    if pkc is not None:
                        try:
                            last_row = cconn.execute(
                                select(cust_tbl).order_by(pkc.desc()).limit(1)
                            ).first()
                            if last_row is not None:
                                new_customer_id = str(last_row._mapping.get(pkc.name))
                        except Exception:
                            pass
                            
    except Exception:
        logger.warning('[TRANS I/E] Could not auto-create customer', exc_info=True)
    
    return new_customer_id


def calculate_tax_amounts(item, tax_meta: Dict[str, Dict[str, Any]]) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    """
    Calculate tax amounts (total, CGST, SGST) for a transaction item.
    
    Args:
        item: Transaction item with tax_id and amount details
        tax_meta: Preloaded tax metadata dictionary
        
    Returns:
        Tuple of (tax_total, cgst_amount, sgst_amount)
    """
    if not getattr(item, 'tax_id', None):
        return None, None, None
        
    meta = tax_meta.get(str(item.tax_id).strip())
    if not meta:
        return None, None, None

    def read_rate(keys):
        """Extract tax rate from metadata using multiple possible key names."""
        for k in keys:
            if k in meta and meta[k] is not None:
                try:
                    return float(meta[k])
                except Exception:
                    pass
        return None

    cgst_rate = read_rate(['cgst', 'cgst_rate', 'cgstpercentage', 'cgst_percent'])
    sgst_rate = read_rate(['sgst', 'sgst_rate', 'sgstpercentage', 'sgst_percent'])
    
    base = (item.price or 0) * (item.qty or 0)
    cgst_amt = None
    sgst_amt = None
    tax_total = None
    
    if cgst_rate is not None:
        cgst_amt = round(base * (cgst_rate / 100.0), 2)
    if sgst_rate is not None:
        sgst_amt = round(base * (sgst_rate / 100.0), 2)
        
    if cgst_amt is not None or sgst_amt is not None:
        tax_total = round((cgst_amt or 0) + (sgst_amt or 0), 2)
    
    return tax_total, cgst_amt, sgst_amt


def build_transaction_row(item, req: TransIncomeExpenseRequest, column_mapping: Dict[str, Optional[str]], 
                         tax_meta: Dict[str, Dict[str, Any]], current_user: Optional[User]) -> Dict[str, Any]:
    """
    Build a complete transaction row for database insertion.
    
    Args:
        item: Individual transaction item
        req: Overall transaction request
        column_mapping: Column name mapping dictionary
        tax_meta: Preloaded tax metadata
        current_user: Current authenticated user
        
    Returns:
        Dictionary representing the transaction row
    """
    row: Dict[str, Any] = {}
    
    # Calculate amount (with or without tax)
    amt = item.amount if item.amount is not None else (float(item.qty or 0) * float(item.price or 0))
    
    # Core transaction fields
    row[column_mapping['account_code']] = req.account_code
    row[column_mapping['retail_code']] = req.retail_code
    row[column_mapping['entry_date']] = req.entry_date
    row[column_mapping['type']] = req.type
    row[column_mapping['payment_method']] = req.payment_method
    row[column_mapping['description']] = item.description
    row[column_mapping['qty']] = item.qty or 1
    row[column_mapping['price']] = item.price or 0
    
    # Customer fields
    if column_mapping['customer_id'] and req.customer_id:
        row[column_mapping['customer_id']] = req.customer_id
    if column_mapping['customer_name'] and req.customer_name:
        row[column_mapping['customer_name']] = req.customer_name
    if column_mapping['customer_phone'] and req.customer_phone:
        row[column_mapping['customer_phone']] = req.customer_phone
    if column_mapping['customer_address'] and req.customer_address:
        row[column_mapping['customer_address']] = req.customer_address
    if column_mapping['customer_gstin'] and req.customer_gstin:
        row[column_mapping['customer_gstin']] = req.customer_gstin

    # Tax calculations
    tax_total, cgst_amt, sgst_amt = calculate_tax_amounts(item, tax_meta)
    
    if tax_total is not None:
        base_net = (item.price or 0) * (item.qty or 0)
        amt = round(base_net + tax_total, 2)
    
    row[column_mapping['amount']] = amt
    
    # Tax fields
    if column_mapping['tax_id'] and getattr(item, 'tax_id', None):
        row[column_mapping['tax_id']] = str(item.tax_id)
    if column_mapping['tax_amount'] and tax_total is not None:
        row[column_mapping['tax_amount']] = tax_total
    if column_mapping['tax_cgst'] and cgst_amt is not None:
        row[column_mapping['tax_cgst']] = cgst_amt
    if column_mapping['tax_sgst'] and sgst_amt is not None:
        row[column_mapping['tax_sgst']] = sgst_amt
    if column_mapping['inclusive_tax'] is not None and getattr(item, 'inclusive_tax', None) is not None:
        row[column_mapping['inclusive_tax']] = 1 if bool(item.inclusive_tax) else 0
    
    # Optional fields
    if column_mapping['remarks'] and getattr(item, 'remarks', None) is not None:
        row[column_mapping['remarks']] = item.remarks

    # Audit fields
    creator = req.created_by or getattr(current_user, 'username', None) or getattr(current_user, 'user_id', None)
    if column_mapping['created_by'] and creator is not None:
        row[column_mapping['created_by']] = str(creator)
    if column_mapping['updated_by'] and creator is not None:
        row[column_mapping['updated_by']] = str(creator)

    return row


def process_financial_transactions(engine: Engine, req: TransIncomeExpenseRequest, current_user: Optional[User]) -> Dict[str, Any]:
    """
    Main function to process financial income/expense transactions.
    
    Args:
        engine: SQLAlchemy engine instance
        req: Transaction request containing all transaction details
        current_user: Current authenticated user
        
    Returns:
        Dictionary with success status and inserted IDs
        
    Raises:
        HTTPException: For various validation and processing errors
    """
    # Get table structure and column mappings
    tbl, column_mapping = get_transaction_table_columns(engine)
    
    # Load tax metadata if needed
    tax_meta = load_tax_metadata(engine, req)
    
    # Create customer if needed and update request
    new_customer_id = create_customer_if_not_exists(engine, req, current_user)
    if new_customer_id:
        req.customer_id = new_customer_id

    # Process transactions
    inserted_ids: List[Any] = []
    table_cols = list(tbl.c.keys())
    
    with engine.begin() as conn:
        for item in req.items:
            # Build complete transaction row
            row = build_transaction_row(item, req, column_mapping, tax_meta, current_user)
            
            # Log debug information
            logger.debug(f"[TRANS I/E] Inserting row into trans_income_expense. Columns={table_cols} ValuesKeys={list(row.keys())}")
            
            # Insert transaction
            res = conn.execute(sql_insert(tbl).values(row))
            try:
                pk = res.inserted_primary_key[0]
            except Exception:
                pk = None
            inserted_ids.append(pk)

    return {
        'success': True,
        'inserted_count': len(inserted_ids),
        'inserted_ids': inserted_ids
    }


def get_read_table_columns(engine: Engine) -> Tuple[Table, Dict[str, Optional[Any]]]:
    """
    Get the transaction table and map column names for reading operations.
    First try trans_income_expense, then fallback to creating it if it doesn't exist.
    
    Args:
        engine: SQLAlchemy engine instance
        
    Returns:
        Tuple of (Table object, column mapping dictionary)
        
    Raises:
        HTTPException: If required columns are missing
    """
    md = MetaData()
    
    # Try to load the table, create it if it doesn't exist
    try:
        tbl = Table('trans_income_expense', md, autoload_with=engine)
    except Exception as e:
        logger.warning(f"Table trans_income_expense doesn't exist, creating it: {e}")
        # Create the table with proper structure
        from sqlalchemy import Column, Integer, String, DateTime, Text, DECIMAL
        
        tbl = Table('trans_income_expense', md,
            Column('entry_id', Integer, primary_key=True, autoincrement=True),
            Column('account_code', String(50), nullable=False),
            Column('retail_code', String(50), nullable=False),
            Column('entry_date', String(10), nullable=False),  # YYYY-MM-DD format
            Column('type', String(20), nullable=False),  # 'Income' or 'Expense'
            Column('payment_method', String(50), nullable=False),  # 'cash', 'card', 'upi'
            Column('description', String(255), nullable=False),
            Column('qty', Integer, default=1),
            Column('price', DECIMAL(10, 2), default=0.00),
            Column('amount', DECIMAL(10, 2), nullable=False),
            Column('remarks', Text, nullable=True),
            Column('created_at', DateTime, nullable=True),
            Column('updated_at', DateTime, nullable=True),
            Column('created_by', String(100), nullable=True),
            Column('updated_by', String(100), nullable=True),
            # Customer fields (optional)
            Column('customer_id', String(50), nullable=True),
            Column('customer_name', String(255), nullable=True),
            Column('customer_phone', String(20), nullable=True),
            Column('customer_address', Text, nullable=True),
            Column('customer_gstin', String(20), nullable=True),
            # Tax fields (optional)
            Column('tax_id', String(10), nullable=True),
            Column('tax_amount', DECIMAL(10, 2), default=0.00),
            Column('tax_cgst', DECIMAL(10, 2), default=0.00),
            Column('tax_sgst', DECIMAL(10, 2), default=0.00),
            Column('inclusive_tax', Integer, default=0)  # 0 = false, 1 = true
        )
        
        # Create the table
        md.create_all(engine)
        logger.info("Created trans_income_expense table successfully")
    
    cols = tbl.c

    def col(*names: str):
        """Pick the first existing column from alternatives."""
        for n in names:
            if n in cols.keys():
                return cols[n]
        return None

    # Column mapping for read operations
    column_mapping = {
        'date_col': col('entry_date', 'date'),
        'amount_col': col('amount', 'total_amount', 'total'),
        'type_col': col('type', 'TYPE'),
        'desc_col': col('description', 'desc'),
        'qty_col': col('qty', 'quantity'),
        'price_col': col('price', 'unit_price', 'base_price'),
        'tax_id_col': col('tax_id'),
        'tax_amt_col': col('tax_amount', 'tax_total'),
        'tax_cgst_col': col('tax_cgst', 'cgst_amount'),
        'tax_sgst_col': col('tax_sgst', 'sgst_amount'),
        'inclusive_col': col('inclusive_tax', 'is_inclusive'),
        'customer_id_col': col('customer_id', 'cust_id', 'CustomerID'),
        'customer_name_col': col('customer_name', 'cust_name', 'name'),
        'customer_phone_col': col('customer_phone', 'phone', 'mobile', 'phone_number'),
        'customer_address_col': col('customer_address', 'address', 'addr'),
        'customer_gstin_col': col('customer_gstin', 'gstin', 'gst_no', 'gst_number'),
    }

    # Validate required columns for read operations
    if column_mapping['date_col'] is None or column_mapping['amount_col'] is None:
        raise HTTPException(
            status_code=500, 
            detail="Server misconfiguration: date/amount columns not found"
        )

    # Detect primary key column
    pk_col = None
    try:
        for c in cols.values():
            if getattr(c, 'primary_key', False):
                pk_col = c
                break
    except Exception:
        pk_col = None
    
    column_mapping['pk_col'] = pk_col
    
    return tbl, column_mapping


def normalize_date_range_and_user_context(fromdate: Optional[str], todate: Optional[str], 
                                         account_code: Optional[str], retail_code: Optional[str], 
                                         current_user: Optional[User]) -> Tuple[str, str, Optional[str], Optional[str]]:
    """
    Normalize date range and user context for transaction queries.
    
    Args:
        fromdate: Start date (optional)
        todate: End date (optional)
        account_code: Account code (optional)
        retail_code: Retail code (optional)
        current_user: Current authenticated user (optional)
        
    Returns:
        Tuple of (from_date, to_date, account_code, retail_code)
    """
    # Date range (default today)
    from_ = fromdate or datetime.now().date().isoformat()
    to_ = todate or from_

    # Account / retail fallback to user
    acc = account_code or getattr(current_user, 'account_code', None)
    ret = retail_code or getattr(current_user, 'retail_code', None)
    
    return from_, to_, acc, ret


def build_transaction_query(tbl: Table, column_mapping: Dict[str, Optional[Any]], 
                           from_date: str, to_date: str, 
                           account_code: Optional[str], retail_code: Optional[str]) -> Any:
    """
    Build the SQL query for fetching transactions within date range and user scope.
    
    Args:
        tbl: Table object
        column_mapping: Column mapping dictionary
        from_date: Start date for filtering
        to_date: End date for filtering
        account_code: Account code for filtering
        retail_code: Retail code for filtering
        
    Returns:
        SQLAlchemy select statement
    """
    cols = tbl.c
    date_col = column_mapping['date_col']
    
    def has(name: str):
        return name in cols.keys()

    stmt = select(tbl)
    conds = [date_col >= from_date, date_col <= to_date]
    
    if account_code and has('account_code'):
        conds.append(cols['account_code'] == account_code)
    if retail_code and has('retail_code'):
        conds.append(cols['retail_code'] == retail_code)
        
    stmt = stmt.where(and_(*conds)).order_by(date_col.asc())
    
    return stmt


def transform_transaction_row(row_mapping: Dict[str, Any], column_mapping: Dict[str, Optional[Any]]) -> Dict[str, Any]:
    """
    Transform a database row into the standardized API response format.
    
    Args:
        row_mapping: Raw database row as dictionary
        column_mapping: Column mapping dictionary
        
    Returns:
        Transformed transaction record
    """
    m = row_mapping
    type_col = column_mapping['type_col']
    date_col = column_mapping['date_col']
    desc_col = column_mapping['desc_col']
    amount_col = column_mapping['amount_col']
    pk_col = column_mapping['pk_col']
    
    # Normalize transaction type
    raw_type = str(m.get(getattr(type_col, 'name', 'TYPE')) or '').lower() if type_col is not None else ''
    norm_type = 'inflow' if raw_type in ('income', 'inflow', 'i') else (
        'outflow' if raw_type in ('expense', 'outflow', 'e') else raw_type or 'unknown'
    )
    
    entry_date = m.get(getattr(date_col, 'name', 'entry_date'))
    
    # Build base payload
    payload: Dict[str, Any] = {
        'date': str(entry_date),
        'type': norm_type,
        'description': m.get(getattr(desc_col, 'name', 'description'), ''),
        'amount': float(m.get(getattr(amount_col, 'name', 'amount')) or 0)
    }
    
    # Add primary key if available
    if pk_col is not None:
        payload['id'] = m.get(pk_col.name)
    
    # Add optional fields
    _add_optional_field(payload, m, column_mapping['qty_col'], 'qty', float)
    _add_optional_field(payload, m, column_mapping['price_col'], 'price', float)
    
    # Tax fields
    tax_id_col = column_mapping['tax_id_col']
    if tax_id_col is not None:
        val = m.get(tax_id_col.name)
        if val not in (None, '', '0'):
            payload['tax_id'] = val
    
    _add_optional_field(payload, m, column_mapping['tax_amt_col'], 'tax_amount', float)
    _add_optional_field(payload, m, column_mapping['tax_cgst_col'], 'tax_cgst', float)
    _add_optional_field(payload, m, column_mapping['tax_sgst_col'], 'tax_sgst', float)
    
    # Inclusive tax flag
    inclusive_col = column_mapping['inclusive_col']
    if inclusive_col is not None:
        incv = m.get(inclusive_col.name)
        if incv is not None:
            payload['inclusive'] = bool(incv)
    
    # Customer metadata
    _add_customer_fields(payload, m, column_mapping)
    
    return payload


def _add_optional_field(payload: Dict[str, Any], row_mapping: Dict[str, Any], 
                       column, field_name: str, converter=None):
    """Helper to add optional fields with type conversion."""
    if column is not None:
        value = row_mapping.get(column.name)
        if value is not None:
            try:
                payload[field_name] = converter(value) if converter else value
            except Exception:
                pass


def _add_customer_fields(payload: Dict[str, Any], row_mapping: Dict[str, Any], 
                        column_mapping: Dict[str, Optional[Any]]):
    """Helper to add customer-related fields to the payload."""
    customer_fields = [
        ('customer_id_col', 'customer_id'),
        ('customer_name_col', 'customer_name'),
        ('customer_phone_col', 'customer_phone'),
        ('customer_address_col', 'customer_address'),
        ('customer_gstin_col', 'customer_gstin'),
    ]
    
    for col_key, field_name in customer_fields:
        col = column_mapping[col_key]
        if col is not None:
            value = row_mapping.get(col.name)
            if value and str(value).strip():
                payload[field_name] = value


def read_financial_transactions(engine: Engine, fromdate: Optional[str] = None, todate: Optional[str] = None,
                               account_code: Optional[str] = None, retail_code: Optional[str] = None,
                               current_user: Optional[User] = None) -> Dict[str, Any]:
    """
    Main function to read financial income/expense transactions within a date range.
    
    Args:
        engine: SQLAlchemy engine instance
        fromdate: Start date for filtering (optional, defaults to today)
        todate: End date for filtering (optional, defaults to fromdate)
        account_code: Account code for filtering (optional, falls back to user)
        retail_code: Retail code for filtering (optional, falls back to user)
        current_user: Current authenticated user (optional)
        
    Returns:
        Dictionary with success status and transaction data
        
    Raises:
        HTTPException: For various validation and processing errors
    """
    # Get table structure and column mappings
    tbl, column_mapping = get_read_table_columns(engine)
    
    # Normalize parameters
    from_date, to_date, acc, ret = normalize_date_range_and_user_context(
        fromdate, todate, account_code, retail_code, current_user
    )
    
    # Build query
    stmt = build_transaction_query(tbl, column_mapping, from_date, to_date, acc, ret)
    
    # Execute query and transform results
    items: List[Dict[str, Any]] = []
    with engine.begin() as conn:
        for row in conn.execute(stmt):
            row_mapping = dict(row._mapping)
            transformed_item = transform_transaction_row(row_mapping, column_mapping)
            items.append(transformed_item)

    return {'success': True, 'data': items}
