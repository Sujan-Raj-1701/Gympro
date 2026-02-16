from fastapi import HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import func, Table, MetaData, select, and_, text, delete, insert, update
from logger import get_logger
import traceback

logger = get_logger()

# Pydantic models for enquiries
class EnquiryCreate(BaseModel):
    accountCode: str
    retailCode: str
    contact: str
    clientName: str
    email: Optional[str] = None
    address: Optional[str] = None
    enquiryFor: str
    enquiryType: str
    response: Optional[str] = None
    dateToFollow: str
    source: str
    leadRep: Optional[str] = "Admin"
    leadStatus: Optional[str] = "Pending"
    sendSms: Optional[bool] = False
    sendWhatsApp: Optional[bool] = False
    description: Optional[str] = None
    createdBy: Optional[str] = None

class EnquiryUpdate(BaseModel):
    accountCode: Optional[str] = None
    retailCode: Optional[str] = None
    contact: Optional[str] = None
    clientName: Optional[str] = None
    email: Optional[str] = None
    address: Optional[str] = None
    enquiryFor: Optional[str] = None
    enquiryType: Optional[str] = None
    response: Optional[str] = None
    dateToFollow: Optional[str] = None
    source: Optional[str] = None
    leadRep: Optional[str] = None
    leadStatus: Optional[str] = None
    sendSms: Optional[bool] = None
    sendWhatsApp: Optional[bool] = None
    description: Optional[str] = None
    updatedBy: Optional[str] = None

# Enquiry API functions
async def create_enquiry_api(engine, enquiry: EnquiryCreate):
    """Create a new enquiry record"""
    logger.info(f"[ENQUIRY CREATE] Creating enquiry for client: {enquiry.clientName}")
    try:
        # Create a fresh metadata and table reference
        local_md = MetaData()
        table = Table('master_enquiry', local_md, autoload_with=engine)
        
        # Convert camelCase to snake_case for database
        enquiry_data = {
            "account_code": enquiry.accountCode,
            "retail_code": enquiry.retailCode,
            "contact": enquiry.contact,
            "client_name": enquiry.clientName,
            "email": enquiry.email,
            "address": enquiry.address,
            "enquiry_for": enquiry.enquiryFor,
            "enquiry_type": enquiry.enquiryType,
            "response": enquiry.response,
            "date_to_follow": enquiry.dateToFollow,
            "source": enquiry.source,
            "lead_rep": enquiry.leadRep,
            "lead_status": enquiry.leadStatus,
            "send_sms": 1 if enquiry.sendSms else 0,
            "send_whatsapp": 1 if enquiry.sendWhatsApp else 0,
            "description": enquiry.description,
            "created_by": enquiry.createdBy or "system"
        }
        
        # Execute insert query
        insert_query = insert(table).values(**enquiry_data)
        
        with engine.connect() as conn:
            result = conn.execute(insert_query)
            conn.commit()
            new_id = result.lastrowid
            
        logger.info(f"[ENQUIRY CREATE] Success | Client: {enquiry.clientName} | ID: {new_id}")
        return {"success": True, "message": "Enquiry created successfully", "id": new_id}
    except Exception as e:
        logger.error(f"[ENQUIRY CREATE] Error | Client: {enquiry.clientName} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to create enquiry: {str(e)}")

async def get_enquiries_api(
    engine,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None,
    limit: int = 100
):
    """Get all enquiries for account and retail code"""
    logger.info(f"[ENQUIRY LIST] Fetching enquiries | Account: {account_code} | Retail: {retail_code} | Limit: {limit}")
    try:
        # Create a fresh metadata and table reference
        local_md = MetaData()
        table = Table('master_enquiry', local_md, autoload_with=engine)
        
        # Build conditions
        conditions = []
        if account_code:
            conditions.append(table.c.account_code == account_code)
        if retail_code:
            conditions.append(table.c.retail_code == retail_code)
            
        # Build and execute query
        if conditions:
            query = select(table).where(and_(*conditions)).order_by(table.c.created_at.desc()).limit(limit)
        else:
            query = select(table).order_by(table.c.created_at.desc()).limit(limit)
        
        with engine.connect() as conn:
            result = conn.execute(query)
            rows = result.fetchall()
            
        # Convert to list of dictionaries with camelCase field names
        data = []
        for row in rows:
            data.append({
                "id": row.id,
                "accountCode": row.account_code,
                "retailCode": row.retail_code,
                "contact": row.contact,
                "clientName": row.client_name,
                "email": row.email,
                "address": row.address,
                "enquiryFor": row.enquiry_for,
                "enquiryType": row.enquiry_type,
                "response": row.response,
                "dateToFollow": row.date_to_follow,
                "source": row.source,
                "leadRep": row.lead_rep,
                "leadStatus": row.lead_status,
                "sendSms": bool(row.send_sms),
                "sendWhatsApp": bool(row.send_whatsapp),
                "description": row.description,
                "createdAt": str(row.created_at),
                "updatedAt": str(row.updated_at) if row.updated_at else None,
                "createdBy": row.created_by,
                "updatedBy": row.updated_by
            })
            
        logger.info(f"[ENQUIRY LIST] Success | Count: {len(data)}")
        return {"success": True, "data": data}
    except Exception as e:
        logger.error(f"[ENQUIRY LIST] Error | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch enquiries: {str(e)}")

async def get_enquiry_by_id_api(
    engine,
    enquiry_id: int,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None
):
    """Get a specific enquiry by ID"""
    logger.info(f"[ENQUIRY GET] Fetching enquiry | ID: {enquiry_id} | Account: {account_code} | Retail: {retail_code}")
    try:
        # Create a fresh metadata and table reference
        local_md = MetaData()
        table = Table('master_enquiry', local_md, autoload_with=engine)
        
        # Build conditions
        conditions = [table.c.id == enquiry_id]
        if account_code:
            conditions.append(table.c.account_code == account_code)
        if retail_code:
            conditions.append(table.c.retail_code == retail_code)
            
        # Build and execute query
        query = select(table).where(and_(*conditions))
        
        with engine.connect() as conn:
            result = conn.execute(query)
            row = result.fetchone()
            
        if not row:
            raise HTTPException(status_code=404, detail="Enquiry not found")
            
        # Convert to dictionary with camelCase field names
        data = {
            "id": row.id,
            "accountCode": row.account_code,
            "retailCode": row.retail_code,
            "contact": row.contact,
            "clientName": row.client_name,
            "email": row.email,
            "address": row.address,
            "enquiryFor": row.enquiry_for,
            "enquiryType": row.enquiry_type,
            "response": row.response,
            "dateToFollow": row.date_to_follow,
            "source": row.source,
            "leadRep": row.lead_rep,
            "leadStatus": row.lead_status,
            "sendSms": bool(row.send_sms),
            "sendWhatsApp": bool(row.send_whatsapp),
            "description": row.description,
            "createdAt": str(row.created_at),
            "updatedAt": str(row.updated_at) if row.updated_at else None,
            "createdBy": row.created_by,
            "updatedBy": row.updated_by
        }
            
        logger.info(f"[ENQUIRY GET] Success | ID: {enquiry_id}")
        return {"success": True, "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ENQUIRY GET] Error | ID: {enquiry_id} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch enquiry: {str(e)}")

async def update_enquiry_api(
    engine,
    enquiry_id: int,
    enquiry: EnquiryUpdate,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None
):
    """Update an existing enquiry"""
    logger.info(f"[ENQUIRY UPDATE] Updating enquiry | ID: {enquiry_id}")
    try:
        # Create a fresh metadata and table reference
        local_md = MetaData()
        table = Table('master_enquiry', local_md, autoload_with=engine)
        
        # Build update data, only including non-None fields
        update_data = {}
        if enquiry.contact is not None:
            update_data["contact"] = enquiry.contact
        if enquiry.clientName is not None:
            update_data["client_name"] = enquiry.clientName
        if enquiry.email is not None:
            update_data["email"] = enquiry.email
        if enquiry.address is not None:
            update_data["address"] = enquiry.address
        if enquiry.enquiryFor is not None:
            update_data["enquiry_for"] = enquiry.enquiryFor
        if enquiry.enquiryType is not None:
            update_data["enquiry_type"] = enquiry.enquiryType
        if enquiry.response is not None:
            update_data["response"] = enquiry.response
        if enquiry.dateToFollow is not None:
            update_data["date_to_follow"] = enquiry.dateToFollow
        if enquiry.source is not None:
            update_data["source"] = enquiry.source
        if enquiry.leadRep is not None:
            update_data["lead_rep"] = enquiry.leadRep
        if enquiry.leadStatus is not None:
            update_data["lead_status"] = enquiry.leadStatus
        if enquiry.sendSms is not None:
            update_data["send_sms"] = 1 if enquiry.sendSms else 0
        if enquiry.sendWhatsApp is not None:
            update_data["send_whatsapp"] = 1 if enquiry.sendWhatsApp else 0
        if enquiry.description is not None:
            update_data["description"] = enquiry.description
        if enquiry.updatedBy is not None:
            update_data["updated_by"] = enquiry.updatedBy
            
        # Add updated timestamp
        update_data["updated_at"] = func.now()
        
        # Build conditions
        conditions = [table.c.id == enquiry_id]
        if account_code:
            conditions.append(table.c.account_code == account_code)
        if retail_code:
            conditions.append(table.c.retail_code == retail_code)
            
        # Execute update query
        update_query = update(table).where(and_(*conditions)).values(**update_data)
        
        with engine.connect() as conn:
            result = conn.execute(update_query)
            conn.commit()
            
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Enquiry not found or not authorized to update")
        
        logger.info(f"[ENQUIRY UPDATE] Success | ID: {enquiry_id}")
        return {"success": True, "message": "Enquiry updated successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ENQUIRY UPDATE] Error | ID: {enquiry_id} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to update enquiry: {str(e)}")

async def delete_enquiry_api(
    engine,
    enquiry_id: int,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None
):
    """Delete an enquiry (hard delete from database)"""
    logger.info(f"[ENQUIRY DELETE] Deleting enquiry | ID: {enquiry_id}")
    try:
        # Create a fresh metadata and table reference
        local_md = MetaData()
        table = Table('master_enquiry', local_md, autoload_with=engine)
        
        # Build conditions
        conditions = [table.c.id == enquiry_id]
        if account_code:
            conditions.append(table.c.account_code == account_code)
        if retail_code:
            conditions.append(table.c.retail_code == retail_code)
            
        # Execute delete query
        from sqlalchemy import delete
        delete_query = delete(table).where(and_(*conditions))
        
        with engine.connect() as conn:
            result = conn.execute(delete_query)
            conn.commit()
            
        if result.rowcount == 0:
            raise HTTPException(status_code=404, detail="Enquiry not found or not authorized to delete")
        
        logger.info(f"[ENQUIRY DELETE] Success | ID: {enquiry_id}")
        return {"success": True, "message": "Enquiry deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[ENQUIRY DELETE] Error | ID: {enquiry_id} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to delete enquiry: {str(e)}")