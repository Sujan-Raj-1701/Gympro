from typing import List, Optional, Dict, Any
import time
import json
from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import MetaData, Table, insert, select, update as sql_update, and_, func
from sqlalchemy.exc import SQLAlchemyError
from db import engine
from logger import get_logger

logger = get_logger()

_metadata_cache: Optional[MetaData] = None
_table_cache: Optional[Table] = None
_summary_table_cache: Optional[Table] = None
_master_table_cache: Optional[Table] = None

def _get_table() -> Table:
    """Get appointment_transactions table with caching."""
    global _metadata_cache, _table_cache
    
    if _table_cache is not None:
        return _table_cache
        
    try:
        _metadata_cache = MetaData()
        _metadata_cache.reflect(bind=engine)
        
        if 'appointment_transactions' not in _metadata_cache.tables:
            raise HTTPException(status_code=500, detail="appointment_transactions table not found")
            
        _table_cache = _metadata_cache.tables['appointment_transactions']
        logger.info(f"[APPT_TRANS] Table loaded with columns: {list(_table_cache.c.keys())}")
        return _table_cache
        
    except Exception as e:
        logger.error(f"[APPT_TRANS] Failed to load table: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load appointment_transactions table: {str(e)}")

def _get_summary_table() -> Table:
    """Get appointment_trans_summary table with caching."""
    global _metadata_cache, _summary_table_cache
    
    if _summary_table_cache is not None:
        return _summary_table_cache
        
    try:
        if _metadata_cache is None:
            _metadata_cache = MetaData()
            _metadata_cache.reflect(bind=engine)
        
        if 'appointment_trans_summary' not in _metadata_cache.tables:
            raise HTTPException(status_code=500, detail="appointment_trans_summary table not found")
            
        _summary_table_cache = _metadata_cache.tables['appointment_trans_summary']
        logger.info(f"[APPT_TRANS_SUMMARY] Table loaded with columns: {list(_summary_table_cache.c.keys())}")
        return _summary_table_cache
        
    except Exception as e:
        logger.error(f"[APPT_TRANS_SUMMARY] Failed to load table: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load appointment_trans_summary table: {str(e)}")

def _get_master_table() -> Table:
    """Get master_appointment table with caching."""
    global _metadata_cache, _master_table_cache
    
    if _master_table_cache is not None:
        return _master_table_cache
        
    try:
        if _metadata_cache is None:
            _metadata_cache = MetaData()
            _metadata_cache.reflect(bind=engine)
        
        if 'master_appointment' not in _metadata_cache.tables:
            raise HTTPException(status_code=500, detail="master_appointment table not found")
            
        _master_table_cache = _metadata_cache.tables['master_appointment']
        logger.info(f"[MASTER_APPT] Table loaded with columns: {list(_master_table_cache.c.keys())}")
        return _master_table_cache
        
    except Exception as e:
        logger.error(f"[MASTER_APPT] Failed to load table: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to load master_appointment table: {str(e)}")

class AppointmentTransactionCreate(BaseModel):
    """Single appointment transaction line."""
    account_code: str
    retail_code: str
    customer_id: Optional[str] = None
    customer_name: Optional[str] = None
    customer_mobile: Optional[int] = None
    apt_id: str  # Changed from appointment_id to match database schema
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    employee_level: Optional[str] = None
    employee_percent: Optional[float] = 0.0
    service_id: Optional[str] = None
    service_name: Optional[str] = None
    tax_id: Optional[str] = None
    base_price: Optional[float] = 0.0
    markup_percent_applied: Optional[float] = 0.0
    markup_amount_per_unit: Optional[float] = 0.0
    unit_price: Optional[float] = 0.0
    quantity: Optional[float] = 1.0
    subtotal: Optional[float] = 0.0
    discount_amount: Optional[float] = 0.0
    taxable_amount: Optional[float] = 0.0
    tax_rate_percent: Optional[float] = 0.0
    membership_discount: Optional[float] = 0.0
    tax_amount: Optional[float] = 0.0
    total_cgst: Optional[float] = 0.0
    total_sgst: Optional[float] = 0.0
    total_igst: Optional[float] = 0.0
    total_vat: Optional[float] = 0.0
    # New appointment status fields matching database schema
    seq: Optional[int] = None
    status: Optional[str] = 'pending'
    advance_paid: Optional[float] = 0.0
    balance_due: Optional[float] = 0.0
    payment_mode: Optional[str] = None
    sequence_id: Optional[int] = None
    created_by: Optional[str] = None
    updated_by: Optional[str] = None
    sequence_id: Optional[int] = None

class AppointmentTransactionBulkCreate(BaseModel):
    """Bulk create request for appointment transactions."""
    lines: List[AppointmentTransactionCreate]
    appointment_metadata: Optional[Dict[str, Any]] = None

class AppointmentTransactionUpdate(BaseModel):
    """Update fields for appointment transactions."""
    update_fields: Dict[str, Any]

def _coerce_numeric(val: Any, default: float = 0.0) -> float:
    """Convert value to float with fallback."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        try:
            return float(val)
        except (ValueError, TypeError):
            return default
    return default

def create_appointment_transactions(payload: AppointmentTransactionBulkCreate, username: str) -> Dict[str, Any]:
    """Create appointment transaction lines."""
    tbl = _get_table()
    cols = set(tbl.c.keys())
    inserted_ids: List[Any] = []
    
    logger.info(f"[APPT_TRANS/CREATE] apt_id={payload.lines[0].apt_id if payload.lines else 'N/A'} lines={len(payload.lines)} user={username}")
    
    with engine.begin() as conn:
        # Generate sequence ID for the appointment
        generated_sequence_id = None
        try:
            if payload.lines:
                seq_first = payload.lines[0]
                acc = getattr(seq_first, 'account_code', None)
                ret = getattr(seq_first, 'retail_code', None)
                
                if acc and ret and 'sequence_id' in cols:
                    # Compute next sequence scoped by account+retail
                    seq_stmt = select(func.max(tbl.c.sequence_id)).where(
                        tbl.c.account_code == acc,
                        tbl.c.retail_code == ret
                    )
                    max_seq = conn.execute(seq_stmt).scalar() or 0
                    generated_sequence_id = max_seq + 1
                    logger.debug(f"[APPT_TRANS/SEQ] Generated sequence_id={generated_sequence_id} for acc={acc} ret={ret}")
        except Exception as e:
            logger.warning(f"[APPT_TRANS/SEQ] Sequence generation failed: {e}")

        # Create master appointment record if metadata provided
        if payload.lines and payload.appointment_metadata:
            try:
                master_tbl = _get_master_table()
                master_cols = set(master_tbl.c.keys())
                seq_first = payload.lines[0]
                apt_id = getattr(seq_first, 'apt_id', None)
                
                if apt_id:
                    master_data = {
                        'account_code': getattr(seq_first, 'account_code', None),
                        'retail_code': getattr(seq_first, 'retail_code', None),
                        'apt_id': apt_id,
                        'appointment_date': payload.appointment_metadata.get('appointment_date'),
                        'slot_from': payload.appointment_metadata.get('slot_from'),
                        'slot_to': payload.appointment_metadata.get('slot_to'),
                        'special_requirements': payload.appointment_metadata.get('special_requirements', ''),
                        'status': payload.appointment_metadata.get('status', 'pending'),
                        'advance_paid': _coerce_numeric(payload.appointment_metadata.get('advance_paid', 0.0)),
                        'balance_due': _coerce_numeric(payload.appointment_metadata.get('balance_due', 0.0)),
                        'payment_mode': payload.appointment_metadata.get('payment_mode', ''),
                        'customer_id': getattr(seq_first, 'customer_id', None),
                        'customer_name': getattr(seq_first, 'customer_name', None),
                        'customer_mobile': getattr(seq_first, 'customer_mobile', None),
                        'employee_id': getattr(seq_first, 'employee_id', None),
                        'employee_name': getattr(seq_first, 'employee_name', None)
                    }
                    
                    # Add audit fields
                    if 'created_by' in master_cols:
                        master_data['created_by'] = username
                    if 'updated_by' in master_cols:
                        master_data['updated_by'] = username
                    if 'created_at' in master_cols:
                        master_data['created_at'] = func.now()
                    if 'updated_at' in master_cols:
                        master_data['updated_at'] = func.now()
                    
                    # Filter and insert master record
                    filtered_master = {k: v for k, v in master_data.items() if k in master_cols and k != 'id'}
                    
                    master_result = conn.execute(insert(master_tbl).values(**filtered_master))
                    master_id = master_result.inserted_primary_key[0] if master_result.inserted_primary_key else None
                    logger.info(f"[MASTER_APPT/CREATE] Created master appointment id={master_id} apt_id={apt_id}")
            except Exception as e:
                logger.warning(f"[MASTER_APPT/CREATE] Failed to create master record: {e}")

        # Insert each transaction line
        for idx, line in enumerate(payload.lines):
            try:
                # Convert line to dict and coerce numeric fields
                data = line.model_dump()
                
                # Keep appointment_id simple (APT-1, APT-2, etc.)
                # Scheduling info will be stored separately
                
                # Ensure numeric fields are properly converted
                numeric_fields = [
                    'customer_mobile', 'employee_percent', 'base_price', 'markup_percent_applied',
                    'markup_amount_per_unit', 'unit_price', 'quantity', 'subtotal', 'discount_amount',
                    'taxable_amount', 'tax_rate_percent', 'membership_discount', 'tax_amount',
                    'total_cgst', 'total_sgst', 'total_igst', 'total_vat', 'advance_paid', 'balance_due'
                ]
                
                for field in numeric_fields:
                    if field in data:
                        if field == 'customer_mobile':
                            # Handle phone number conversion
                            try:
                                if data[field] is not None:
                                    phone_str = str(data[field]).replace('+', '').replace('-', '').replace(' ', '')
                                    data[field] = int(phone_str) if phone_str.isdigit() else None
                                else:
                                    data[field] = None
                            except (ValueError, TypeError):
                                data[field] = None
                        else:
                            data[field] = _coerce_numeric(data[field])

                # Add audit fields
                if 'created_by' in cols:
                    data['created_by'] = username
                if 'updated_by' in cols:
                    data['updated_by'] = username
                if 'created_at' in cols:
                    data['created_at'] = func.now()
                if 'updated_at' in cols:
                    data['updated_at'] = func.now()
                
                # Add new appointment status columns if not already in data
                if 'status' in cols and 'status' not in data:
                    data['status'] = getattr(payload.appointment_metadata, 'status', 'pending')
                if 'advance_paid' in cols and 'advance_paid' not in data:
                    data['advance_paid'] = getattr(payload.appointment_metadata, 'advance_paid', 0)
                if 'balance_due' in cols and 'balance_due' not in data:
                    data['balance_due'] = getattr(payload.appointment_metadata, 'balance_due', 0)
                if 'payment_mode' in cols and 'payment_mode' not in data:
                    data['payment_mode'] = getattr(payload.appointment_metadata, 'payment_mode', None)
                
                # Add sequence ID if generated
                if generated_sequence_id and 'sequence_id' in cols:
                    data['sequence_id'] = generated_sequence_id

                # Remove fields not in table schema
                filtered_data = {k: v for k, v in data.items() if k in cols}
                
                # Insert the record
                ins_res = conn.execute(insert(tbl).values(**filtered_data))
                try:
                    pk = ins_res.inserted_primary_key[0] if ins_res.inserted_primary_key else None
                except Exception:
                    pk = None
                inserted_ids.append(pk)
                
                logger.debug(f"[APPT_TRANS/CREATE] Inserted line {idx+1} with id={pk}")
                
            except Exception as e:
                logger.error(f"[APPT_TRANS/CREATE][ERROR] line_index={idx} apt_id={data.get('apt_id')} error={e}")
                raise HTTPException(status_code=500, detail=f"Failed inserting appointment transaction line {idx+1}: {str(e)}")

        # Create summary records following the billing system pattern EXACTLY
        try:
            summary_tbl = _get_summary_table()
            summary_cols = set(summary_tbl.c.keys())
            
            # Create service summary records EXACTLY like billing_trans_summary
            # Each transaction line becomes one summary row (like billing)
            for line in payload.lines:
                # Extract service information from the transaction line
                service_id = getattr(line, 'service_id', None) or 'SRV-001'
                service_name = getattr(line, 'service_name', None) or 'Service'
                tax_id = getattr(line, 'tax_id', None) or 'TAX-001'
                
                # Calculate service-level summary (like billing)
                qty = int(_coerce_numeric(getattr(line, 'quantity', 1.0)))
                unit_price = _coerce_numeric(getattr(line, 'unit_price', 0.0))
                tax_rate_percent = _coerce_numeric(getattr(line, 'tax_rate_percent', 0.0))
                total_cgst = _coerce_numeric(getattr(line, 'total_cgst', 0.0))
                total_sgst = _coerce_numeric(getattr(line, 'total_sgst', 0.0))
                total_igst = _coerce_numeric(getattr(line, 'total_igst', 0.0))
                total_vat = _coerce_numeric(getattr(line, 'total_vat', 0.0))
                tax_amount = _coerce_numeric(getattr(line, 'tax_amount', 0.0))
                discount_amount = _coerce_numeric(getattr(line, 'discount_amount', 0.0))
                
                # Calculate grand_total exactly like billing: unit_price * qty + tax_amount - discount
                subtotal = unit_price * qty
                grand_total = subtotal + tax_amount - discount_amount
                
                # Create summary record exactly like billing_trans_summary structure
                summary_data = {
                    'account_code': line.account_code,
                    'retail_code': line.retail_code,
                    'apt_id': line.apt_id,  # Simple APT-1, APT-2, etc.
                    'service_id': service_id,
                    'service_name': service_name,
                    'qty': qty,
                    'unit_price': unit_price,
                    'tax_id': tax_id,
                    'tax_rate_percent': tax_rate_percent,
                    'total_cgst': total_cgst,
                    'total_sgst': total_sgst,
                    'total_igst': total_igst,
                    'total_vat': total_vat,
                    'tax_amount': tax_amount,
                    'discount_amount': discount_amount,
                    'grand_total': grand_total
                }
                
                # Add scheduling metadata if available (for first service of the appointment)
                if payload.appointment_metadata:
                    summary_data.update({
                        'appointment_date': payload.appointment_metadata.get('appointment_date'),
                        'slot_from': payload.appointment_metadata.get('slot_from'),
                        'slot_to': payload.appointment_metadata.get('slot_to'),
                        'special_requirements': payload.appointment_metadata.get('special_requirements', ''),
                        'status': payload.appointment_metadata.get('status', 'confirmed'),
                        'advance_paid': _coerce_numeric(payload.appointment_metadata.get('advance_paid', 0.0)),
                        'balance_due': _coerce_numeric(payload.appointment_metadata.get('balance_due', 0.0)),
                        'payment_mode': payload.appointment_metadata.get('payment_mode', '')
                    })
                
                # Add audit fields
                if 'created_by' in summary_cols:
                    summary_data['created_by'] = username
                if 'updated_by' in summary_cols:
                    summary_data['updated_by'] = username
                if 'created_at' in summary_cols:
                    summary_data['created_at'] = func.now()
                if 'updated_at' in summary_cols:
                    summary_data['updated_at'] = func.now()
                
                # Remove fields not in summary table schema and exclude id (let auto_increment handle it)
                filtered_summary = {k: v for k, v in summary_data.items() if k in summary_cols and k != 'id'}
                
                # Insert service summary record (database handles auto_increment id)
                ins_result = conn.execute(insert(summary_tbl).values(**filtered_summary))
                
                # Get the inserted id if possible
                try:
                    summary_id = ins_result.inserted_primary_key[0] if ins_result.inserted_primary_key else None
                    logger.debug(f"[APPT_TRANS_SUMMARY/CREATE] Created service summary id={summary_id} for service={service_id}")
                except Exception:
                    logger.debug(f"[APPT_TRANS_SUMMARY/CREATE] Created service summary for service={service_id}")
            
            logger.info(f"[APPT_TRANS_SUMMARY/CREATE] Created {len(payload.lines)} service summary records (billing pattern) for apt_id={payload.lines[0].apt_id if payload.lines else 'N/A'}")
            
        except Exception as e:
            logger.error(f"[APPT_TRANS_SUMMARY/CREATE][ERROR] Failed to create summary records: {e}")
            import traceback
            traceback.print_exc()
            # Don't fail the entire transaction creation if summary creation fails

    logger.info(f"[APPT_TRANS/CREATE] Successfully created {len(inserted_ids)} lines")
    return {
        "success": True,
        "inserted_count": len(inserted_ids),
        "inserted_ids": inserted_ids,
        "appointment_id": payload.lines[0].apt_id if payload.lines else None,
        "sequence_id": generated_sequence_id
    }

def get_appointment_transactions(appointment_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> Dict[str, Any]:
    """Get appointment transaction using 3-table structure: master_appointment + appointment_transactions + appointment_trans_summary."""
    trans_tbl = _get_table()
    summary_tbl = _get_summary_table()
    master_tbl = _get_master_table()
    
    logger.info(f"[APPT_TRANS/READ] appointment_id={appointment_id} account={account_code} retail={retail_code}")
    
    try:
        with engine.begin() as conn:
            # Use apt_id for all 3 tables
            apt_id = appointment_id
            
            # Get master appointment data
            master_cols = master_tbl.c
            master_stmt = select(
                master_cols.apt_id,
                master_cols.customer_name,
                master_cols.customer_mobile,
                master_cols.employee_name,
                master_cols.employee_id,
                master_cols.appointment_date,
                master_cols.slot_from,
                master_cols.slot_to,
                master_cols.special_requirements,
                master_cols.status,
                master_cols.advance_paid,
                master_cols.balance_due,
                master_cols.payment_mode,
                master_cols.created_at,
                master_cols.updated_at
            ).where(master_cols.apt_id == apt_id)
            
            if account_code:
                master_stmt = master_stmt.where(master_cols.account_code == account_code)
            if retail_code:
                master_stmt = master_stmt.where(master_cols.retail_code == retail_code)
            
            master_result = conn.execute(master_stmt).fetchone()
            if not master_result:
                logger.warning(f"[APPT_TRANS/READ] No master appointment found for apt_id={apt_id}")
                return {"success": False, "message": "Appointment not found"}
            
            master_data = dict(master_result._mapping)
            
            # Get transaction lines with service details from summary table
            summary_cols = summary_tbl.c
            trans_stmt = select(
                summary_cols.id,
                summary_cols.service_id,
                summary_cols.service_name,
                summary_cols.unit_price,
                summary_cols.qty,
                summary_cols.tax_amount,
                summary_cols.discount_amount,
                summary_cols.grand_total,
                summary_cols.status,
                summary_cols.advance_paid,
                summary_cols.balance_due,
                summary_cols.payment_mode,
                summary_cols.created_at
            ).where(summary_cols.apt_id == apt_id)
            
            if account_code:
                trans_stmt = trans_stmt.where(summary_cols.account_code == account_code)
            if retail_code:
                trans_stmt = trans_stmt.where(summary_cols.retail_code == retail_code)
                
            # Order by id since summary table doesn't have seq column
            trans_stmt = trans_stmt.order_by(summary_cols.id)
            
            transaction_lines = []
            total_tax = 0
            total_discount = 0
            total_grand = 0
            total_subtotal = 0
            
            for r in conn.execute(trans_stmt):
                row = dict(r._mapping)
                unit_price = float(row['unit_price'] or 0)
                qty = int(row['qty'] or 1)
                subtotal = unit_price * qty
                tax_amount = float(row['tax_amount'] or 0)
                discount_amount = float(row['discount_amount'] or 0)
                grand_total = float(row['grand_total'] or 0)
                
                transaction_lines.append({
                    'id': row['id'],
                    'service_id': row['service_id'],
                    'service_name': row['service_name'],
                    'unit_price': unit_price,
                    'qty': qty,
                    'seq': row.get('id', 0),  # Use id as sequence since seq column doesn't exist in summary
                    'subtotal': subtotal,
                    'tax_amount': tax_amount,
                    'discount_amount': discount_amount,
                    'grand_total': grand_total,
                    'membership_discount': 0,  # Not available in summary table
                    'status': row.get('status', 'pending'),
                    'advance_paid': float(row.get('advance_paid', 0)),
                    'balance_due': float(row.get('balance_due', 0)),
                    'payment_mode': row.get('payment_mode'),
                    'created_at': row['created_at']
                })
                
                total_subtotal += subtotal
                total_tax += tax_amount
                total_discount += discount_amount
                total_grand += grand_total
            
            # Build complete appointment data
            appointment_data = {
                'appointment_id': master_data['apt_id'],
                'customer_name': master_data['customer_name'],
                'customer_mobile': master_data['customer_mobile'],
                'employee_name': master_data['employee_name'],
                'employee_id': master_data['employee_id'],
                'appointment_date': master_data['appointment_date'],
                'slot_from': master_data['slot_from'],
                'slot_to': master_data['slot_to'],
                'special_requirements': master_data['special_requirements'],
                'status': master_data['status'],
                'advance_paid': float(master_data['advance_paid'] or 0),
                'balance_due': float(master_data['balance_due'] or 0),
                'payment_mode': master_data['payment_mode'],
                'data': transaction_lines,  # Keep 'data' key for API compatibility
                'services': transaction_lines,  # Also provide as 'services'
                'count': len(transaction_lines),
                'service_count': len(transaction_lines),
                'total_subtotal': total_subtotal,
                'total_tax': total_tax,
                'total_discount': total_discount,
                'grand_total': total_grand,
                'created_at': master_data['created_at'],
                'updated_at': master_data['updated_at']
            }
            
            logger.debug(f"[APPT_TRANS/READ] Found appointment with {len(transaction_lines)} services, grand_total={total_grand}")
            
            return {
                "success": True,
                "appointment_id": apt_id,
                "data": appointment_data
            }
            
    except Exception as e:
        logger.error(f"[APPT_TRANS/READ][ERROR] appointment_id={appointment_id} error={e}")
        raise HTTPException(status_code=500, detail=f"Failed retrieving appointment transactions: {str(e)}")

def update_appointment_transactions(appointment_id: str, update_fields: Dict[str, Any], username: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> Dict[str, Any]:
    """Update appointment using 3-table structure: master_appointment + appointment_transactions + appointment_trans_summary."""
    trans_tbl = _get_table()
    summary_tbl = _get_summary_table()
    master_tbl = _get_master_table()
    
    logger.info(f"[APPT_TRANS/UPDATE] appointment_id={appointment_id} fields={list(update_fields.keys())} user={username}")
    
    try:
        with engine.begin() as conn:
            apt_id = appointment_id
            updated_tables = []
            
            # Separate fields by target table
            master_fields = {}
            trans_fields = {}
            summary_fields = {}
            
            master_cols = set(master_tbl.c.keys())
            trans_cols = set(trans_tbl.c.keys())
            summary_cols = set(summary_tbl.c.keys())
            
            # Collect fields per table. We intentionally do NOT use elif so that
            # shared fields (e.g. status, advance_paid, balance_due, payment_mode)
            # propagate to all three tables. Previously status only updated master_appointment.
            for k, v in update_fields.items():
                if k in master_cols and k not in ['apt_id', 'created_at', 'created_by']:
                    master_fields[k] = v
                if k in trans_cols and k not in ['id', 'apt_id', 'created_at', 'created_by']:
                    trans_fields[k] = v
                if k in summary_cols and k not in ['id', 'apt_id', 'created_at', 'created_by']:
                    summary_fields[k] = v
            
            # Update master appointment table
            if master_fields:
                # Add audit fields
                if 'updated_by' in master_cols:
                    master_fields['updated_by'] = username
                if 'updated_at' in master_cols:
                    master_fields['updated_at'] = func.now()
                
                master_where = master_tbl.c.apt_id == apt_id
                if account_code:
                    master_where = and_(master_where, master_tbl.c.account_code == account_code)
                if retail_code:
                    master_where = and_(master_where, master_tbl.c.retail_code == retail_code)
                
                result = conn.execute(sql_update(master_tbl).where(master_where).values(**master_fields))
                if result.rowcount > 0:
                    updated_tables.append(f"master_appointment({result.rowcount})")
                    logger.debug(f"[APPT_TRANS/UPDATE] Updated master_appointment: {result.rowcount} records")
            
            # Update transaction lines
            if trans_fields:
                # Add audit fields
                if 'updated_by' in trans_cols:
                    trans_fields['updated_by'] = username
                if 'updated_at' in trans_cols:
                    trans_fields['updated_at'] = func.now()
                
                trans_where = trans_tbl.c.apt_id == apt_id
                if account_code:
                    trans_where = and_(trans_where, trans_tbl.c.account_code == account_code)
                if retail_code:
                    trans_where = and_(trans_where, trans_tbl.c.retail_code == retail_code)
                
                result = conn.execute(sql_update(trans_tbl).where(trans_where).values(**trans_fields))
                if result.rowcount > 0:
                    updated_tables.append(f"appointment_transactions({result.rowcount})")
                    logger.debug(f"[APPT_TRANS/UPDATE] Updated appointment_transactions: {result.rowcount} records")
            
            # Update summary table  
            if summary_fields:
                # Add audit fields
                if 'updated_by' in summary_cols:
                    summary_fields['updated_by'] = username
                if 'updated_at' in summary_cols:
                    summary_fields['updated_at'] = func.now()
                
                summary_where = summary_tbl.c.apt_id == apt_id
                if account_code:
                    summary_where = and_(summary_where, summary_tbl.c.account_code == account_code)
                if retail_code:
                    summary_where = and_(summary_where, summary_tbl.c.retail_code == retail_code)
                
                result = conn.execute(sql_update(summary_tbl).where(summary_where).values(**summary_fields))
                if result.rowcount > 0:
                    updated_tables.append(f"appointment_trans_summary({result.rowcount})")
                    logger.debug(f"[APPT_TRANS/UPDATE] Updated appointment_trans_summary: {result.rowcount} records")
            
            total_updated = len(updated_tables)
            if total_updated > 0:
                logger.info(f"[APPT_TRANS/UPDATE] Updated {total_updated} table(s): {', '.join(updated_tables)}")
                
                return {
                    "success": True,
                    "appointment_id": apt_id,
                    "updated_count": total_updated,
                    "updated_tables": updated_tables,
                    "updated_fields": list(update_fields.keys())
                }
            else:
                return {
                    "success": True,
                    "appointment_id": apt_id,
                    "updated_count": 0,
                    "message": "No valid fields to update"
                }
                
    except Exception as e:
        logger.error(f"[APPT_TRANS/UPDATE][ERROR] appointment_id={appointment_id} error={e}")
        raise HTTPException(status_code=500, detail=f"Failed updating appointment transactions: {str(e)}")

def list_appointment_transactions(account_code: str, retail_code: str, from_date: Optional[str] = None, to_date: Optional[str] = None) -> Dict[str, Any]:
    """List appointment transactions using 3-table structure: master_appointment, appointment_transactions, appointment_trans_summary."""
    summary_tbl = _get_summary_table()
    master_tbl = _get_master_table()
    
    logger.info(f"[APPT_TRANS/LIST] account={account_code} retail={retail_code} from={from_date} to={to_date}")
    
    try:
        with engine.begin() as conn:
            # Build summary aggregation like invoice system
            summary_cols = summary_tbl.c
            master_cols = master_tbl.c
            
            stmt_cols = [
                summary_cols.apt_id.label('appointment_id'),
                func.count().label('line_count'),
                func.count().label('service_count'),
                func.sum(func.coalesce(summary_cols.tax_amount, 0)).label('total_tax'),
                func.sum(func.coalesce(summary_cols.discount_amount, 0)).label('total_discount'),
                func.sum(func.coalesce(summary_cols.grand_total, 0)).label('grand_total'),
                func.max(summary_cols.created_at).label('latest_created'),
            ]
            
            # Add subtotal calculation
            if 'unit_price' in summary_cols.keys() and 'qty' in summary_cols.keys():
                stmt_cols.append(func.sum(summary_cols.unit_price * summary_cols.qty).label('total_subtotal'))
            else:
                stmt_cols.append(func.sum(func.coalesce(summary_cols.grand_total, 0) - func.coalesce(summary_cols.tax_amount, 0)).label('total_subtotal'))
            
            # Aggregate transactions per appointment (summary table)
            summary_agg = (
                select(*stmt_cols)
                .where(and_(summary_cols.account_code == account_code, summary_cols.retail_code == retail_code))
                .group_by(summary_cols.apt_id)
            ).subquery("appt_summary")

            # Join master appointments for date filtering and core fields
            master_where = and_(master_cols.account_code == account_code, master_cols.retail_code == retail_code)
            if from_date and to_date:
                master_where = and_(master_where, master_cols.appointment_date.between(from_date, to_date))
            elif from_date:
                master_where = and_(master_where, master_cols.appointment_date >= from_date)
            elif to_date:
                master_where = and_(master_where, master_cols.appointment_date <= to_date)

            joined_stmt = (
                select(
                    summary_agg.c.appointment_id,
                    summary_agg.c.line_count,
                    summary_agg.c.service_count,
                    summary_agg.c.total_tax,
                    summary_agg.c.total_discount,
                    summary_agg.c.grand_total,
                    summary_agg.c.latest_created,
                    summary_agg.c.total_subtotal,
                    master_cols.customer_name,
                    master_cols.customer_mobile,
                    master_cols.employee_name,
                    master_cols.employee_id,
                    master_cols.appointment_date,
                    master_cols.slot_from,
                    master_cols.slot_to,
                    master_cols.special_requirements,
                    master_cols.status,
                    master_cols.advance_paid,
                    master_cols.balance_due,
                    master_cols.payment_mode,
                )
                .select_from(summary_agg.join(master_tbl, master_cols.apt_id == summary_agg.c.appointment_id))
                .where(master_where)
                .order_by(master_cols.appointment_date.desc(), summary_agg.c.latest_created.desc())
            )

            rows = [dict(r._mapping) for r in conn.execute(joined_stmt)]
            if not rows:
                return {"success": True, "data": [], "total_count": 0}

            appointment_order: List[str] = [str(r.get("appointment_id")) for r in rows if r.get("appointment_id")]
            data_by_appointment: Dict[str, Dict[str, Any]] = {}
            for r in rows:
                apt_id = str(r.get("appointment_id"))
                # Normalize numeric values
                r["advance_paid"] = float(r.get("advance_paid") or 0)
                r["balance_due"] = float(r.get("balance_due") or 0)
                r["membership_discount"] = 0
                data_by_appointment[apt_id] = r

            # Fetch services for all appointments in one query (avoid N+1)
            services_by_apt: Dict[str, List[Dict[str, Any]]] = {}
            services_stmt = (
                select(
                    summary_cols.apt_id,
                    summary_cols.service_id,
                    summary_cols.service_name,
                    summary_cols.unit_price,
                    summary_cols.qty,
                    summary_cols.tax_amount,
                    summary_cols.grand_total,
                )
                .where(
                    and_(
                        summary_cols.account_code == account_code,
                        summary_cols.retail_code == retail_code,
                        summary_cols.apt_id.in_(appointment_order),
                    )
                )
            )

            for r in conn.execute(services_stmt):
                service_row = dict(r._mapping)
                apt_id = str(service_row.get("apt_id"))
                services_by_apt.setdefault(apt_id, []).append(
                    {
                        "service_id": service_row.get("service_id"),
                        "service_name": service_row.get("service_name"),
                        "unit_price": float(service_row.get("unit_price") or 0),
                        "qty": int(service_row.get("qty") or 1),
                        "subtotal": float(service_row.get("unit_price") or 0) * int(service_row.get("qty") or 1),
                        "tax_amount": float(service_row.get("tax_amount") or 0),
                        "grand_total": float(service_row.get("grand_total") or 0),
                    }
                )

            for apt_id in appointment_order:
                if apt_id in data_by_appointment:
                    data_by_appointment[apt_id]["services"] = services_by_apt.get(apt_id, [])

            # Convert to list maintaining order
            result_list = [data_by_appointment[apt_id] for apt_id in appointment_order if apt_id in data_by_appointment]
            
            logger.info(f"[APPT_TRANS/LIST] Found {len(result_list)} appointments")
            
            return {
                "success": True,
                "data": result_list,
                "total_count": len(result_list)
            }
            
    except Exception as e:
        logger.error(f"[APPT_TRANS/LIST][ERROR] account={account_code} retail={retail_code} error={e}")
        raise HTTPException(status_code=500, detail=f"Failed listing appointment transactions: {str(e)}")

def delete_appointment_transactions(appointment_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None) -> Dict[str, Any]:
    """Delete all transaction lines for an appointment."""
    tbl = _get_table()
    cols = set(tbl.c.keys())
    
    logger.info(f"[APPT_TRANS/DELETE] appointment_id={appointment_id} account={account_code} retail={retail_code}")
    
    try:
        with engine.begin() as conn:
            # Build where clause
            where_clause = tbl.c.appointment_id == appointment_id
            if account_code and 'account_code' in cols:
                where_clause = and_(where_clause, tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in cols:
                where_clause = and_(where_clause, tbl.c.retail_code == retail_code)
            
            # Execute delete
            from sqlalchemy import delete as sql_delete
            result = conn.execute(sql_delete(tbl).where(where_clause))
            deleted_count = result.rowcount
            
            logger.debug(f"[APPT_TRANS/DELETE] Deleted {deleted_count} records")
            
            return {
                "success": True,
                "appointment_id": appointment_id,
                "deleted_count": deleted_count
            }
            
    except Exception as e:
        logger.error(f"[APPT_TRANS/DELETE][ERROR] appointment_id={appointment_id} error={e}")
        raise HTTPException(status_code=500, detail=f"Failed deleting appointment transactions: {str(e)}")