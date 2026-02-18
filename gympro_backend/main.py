from fastapi import FastAPI, HTTPException, Body, Depends, status, Request, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Dict, Any, List, Optional
from sqlalchemy import create_engine, MetaData, Table, select, and_, insert, update as sql_update, delete as sql_delete, func, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.engine import Engine
import os
import sys
import uuid
import shutil
from pathlib import Path
from contextlib import asynccontextmanager
from financetransaction import process_financial_transactions, TransIncomeExpenseRequest, read_financial_transactions
from settlement import router as settlement_router
from reports import router as reports_router
from stock_in import router as stock_in_router
from stock_adjustment import router as stock_adjustment_router
# Ensure the fastapi_backend directory is on sys.path when running via `-m uvicorn fastapi_backend.main:app`
_current_dir = Path(__file__).resolve().parent
if str(_current_dir) not in sys.path:
    sys.path.insert(0, str(_current_dir))
from db import engine, metadata
from crud_create import create_row as crud_create_row
from crud_update import update_row as crud_update_row
from crud_read import read_rows as crud_read_rows
from logger import get_logger
import traceback
from fastapi.security import OAuth2PasswordRequestForm
from auth import (
    User,
    Token,
    get_current_user,
    create_access_token,
    create_refresh_token,
    verify_refresh_token,
    verify_password,
    get_user,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    REFRESH_TOKEN_EXPIRE_DAYS
)
from auth import get_password_hash
from datetime import timedelta, datetime, timezone
from license_processor import process_license_request, extend_license
from sqlalchemy import Table
from sqlalchemy import insert as sql_insert
from sqlalchemy import inspect as sqlalchemy_inspect
from pydantic import BaseModel
from typing import Optional
from decimal import Decimal
# Import enquiry functions
from enquiries import (
    EnquiryCreate,
    EnquiryUpdate,
    create_enquiry_api,
    get_enquiries_api,
    get_enquiry_by_id_api,
    update_enquiry_api,
    delete_enquiry_api
)

from provider_credits import (
    ensure_provider_credits_tables,
    create_marketing_campaign_and_debit,
    list_marketing_campaigns,
    list_whatsapp_campaign_types,
    list_whatsapp_templates,
    get_provider_credits_balance,
    topup_provider_credits,
    list_provider_credits_ledger,
)
from razorpay_integration import create_order, verify_payment_signature

logger = get_logger()

# --- File Upload Utilities ---

# Define upload directories (legacy, inside backend)
UPLOAD_BASE_DIR = Path(__file__).parent / "upload"
IMAGES_DIR = UPLOAD_BASE_DIR / "images"
DOCUMENTS_DIR = UPLOAD_BASE_DIR / "doc"

# Public media uploads directory (recommended outside backend folder)
# Defaults to <project_root>/media_uploads but can be overridden via env:
#   MEDIA_UPLOADS_DIR=/absolute/path/to/media_uploads
# or
#   MEDIA_UPLOADS_DIR=relative/path/from/project_root
PROJECT_ROOT = Path(__file__).resolve().parents[1]
_media_uploads_env = (os.getenv("MEDIA_UPLOADS_DIR") or "").strip()
if _media_uploads_env:
    _p = Path(_media_uploads_env)
    MEDIA_UPLOADS_DIR = (_p if _p.is_absolute() else (PROJECT_ROOT / _p)).resolve()
else:
    MEDIA_UPLOADS_DIR = PROJECT_ROOT / "media_uploads"

# Ensure upload directories exist
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Dedicated subfolder for company logos inside media_uploads
LOGO_DIR = MEDIA_UPLOADS_DIR / "logo"
LOGO_DIR.mkdir(parents=True, exist_ok=True)

# Allowed file types
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}
ALLOWED_DOCUMENT_TYPES = {
    "application/pdf",
    "application/msword", 
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"
}

# Max file sizes (in bytes)
MAX_IMAGE_SIZE = 10 * 1024 * 1024  # 10MB
MAX_DOCUMENT_SIZE = 50 * 1024 * 1024  # 50MB

MEDIA_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
}


def _public_base_url(req: Request) -> str:
    """Best-effort public base URL detection for externally reachable links.

    Prefers explicit PUBLIC_BASE_URL/PUBLIC_ORIGIN, then common proxy headers,
    and finally falls back to request.base_url.
    """
    explicit = (os.getenv("PUBLIC_BASE_URL") or os.getenv("PUBLIC_ORIGIN") or "").strip()
    if explicit:
        return explicit.rstrip("/")

    def _is_loopback_or_local(hostname: str) -> bool:
        h = (hostname or "").strip().lower()
        return h in {"127.0.0.1", "localhost", "0.0.0.0", "::1"}

    def _first_header(name: str) -> str:
        v = (req.headers.get(name) or "").strip()
        return v.split(",")[0].strip() if v else ""

    def _parse_forwarded(value: str) -> tuple[str, str]:
        """Parse RFC 7239 Forwarded header. Returns (proto, host)."""
        # Example: Forwarded: for=1.2.3.4;proto=https;host=example.com
        if not value:
            return "", ""
        first = value.split(",")[0].strip()
        proto = ""
        host = ""
        for part in first.split(";"):
            part = part.strip()
            if not part or "=" not in part:
                continue
            k, v = part.split("=", 1)
            k = k.strip().lower()
            v = v.strip().strip('"')
            if k == "proto":
                proto = v
            elif k == "host":
                host = v
        return proto, host

    # Standard Forwarded header
    fwd = _first_header("forwarded")
    fwd_proto, fwd_host = _parse_forwarded(fwd)

    # Common proxy headers
    xf_proto = _first_header("x-forwarded-proto") or _first_header("x-original-proto")
    xf_host = (
        _first_header("x-forwarded-host")
        or _first_header("x-original-host")
        or _first_header("x-host")
        or _first_header("x-forwarded-server")
    )
    xf_port = _first_header("x-forwarded-port")

    # Some proxies only send a boolean HTTPS indicator
    https_on = (
        (_first_header("x-forwarded-ssl").lower() == "on")
        or (_first_header("front-end-https").lower() == "on")
    )

    proto = (
        fwd_proto
        or xf_proto
        or ("https" if https_on else "")
        or getattr(req.url, "scheme", "http")
    )
    host = fwd_host or xf_host or (req.headers.get("host") or "").strip()

    if host:
        # If port forwarded separately and host doesn't already include it
        if xf_port and ":" not in host and xf_port not in ("80", "443"):
            host = f"{host}:{xf_port}"
        base = f"{proto}://{host}".rstrip("/")

        # If we still ended up with loopback, emit a helpful warning
        hostname_only = host.split(":", 1)[0]
        if _is_loopback_or_local(hostname_only):
            logger.warning(
                "[PUBLIC_URL] Resolved loopback host '%s'. Set PUBLIC_BASE_URL or configure proxy to pass Forwarded/X-Forwarded-Host and X-Forwarded-Proto.",
                host,
            )
        return base

    base = str(req.base_url).rstrip("/")
    try:
        hostname_only = (getattr(req.url, "hostname", "") or "").strip()
        if _is_loopback_or_local(hostname_only):
            logger.warning(
                "[PUBLIC_URL] Falling back to req.base_url='%s'. Set PUBLIC_BASE_URL or configure proxy headers.",
                base,
            )
    except Exception:
        pass
    return base

def validate_file(file: UploadFile, file_type: str = "image") -> tuple[bool, str]:
    """Validate uploaded file type and size."""
    if not file.filename:
        return False, "No filename provided"
    
    if file_type == "image":
        if file.content_type not in ALLOWED_IMAGE_TYPES:
            return False, f"Invalid image type. Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}"
        if file.size and file.size > MAX_IMAGE_SIZE:
            return False, f"Image too large. Max size: {MAX_IMAGE_SIZE / (1024*1024):.1f}MB"
    elif file_type == "document":
        if file.content_type not in ALLOWED_DOCUMENT_TYPES:
            return False, f"Invalid document type. Allowed: {', '.join(ALLOWED_DOCUMENT_TYPES)}"
        if file.size and file.size > MAX_DOCUMENT_SIZE:
            return False, f"Document too large. Max size: {MAX_DOCUMENT_SIZE / (1024*1024):.1f}MB"
    
    return True, "Valid"

def generate_unique_filename(account_code: str, original_filename: str, retail_code: str = None, customer_id: str = None, customer_name: str = None) -> str:
    """Generate unique filename with account code prefix or custom format."""
    # Extract file extension
    file_ext = Path(original_filename).suffix.lower()
    
    def _safe_alnum(value: str, default: str = "") -> str:
        s = "".join(c for c in str(value or "") if c.isalnum())
        return s or default

    # If custom naming parameters are provided, use the requested format: retailcode+id+name (without '+')
    if retail_code and customer_id and customer_name:
        safe_retail_code = _safe_alnum(retail_code, default="R")
        safe_customer_id = _safe_alnum(customer_id, default="0")
        safe_customer_name = _safe_alnum(customer_name, default="customer")[:20]  # Limit length
        # Create filename: retailcodeidname (no separators)
        filename = f"{safe_retail_code}{safe_customer_id}{safe_customer_name}{file_ext}"
        return filename
    
    # Default format: {account_code}_{timestamp}_{unique_id}.{ext}
    unique_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{account_code}_{timestamp}_{unique_id}{file_ext}"
    
    return filename

async def save_uploaded_file(file: UploadFile, account_code: str, file_type: str = "image", retail_code: str = None, customer_id: str = None, customer_name: str = None) -> tuple[bool, str, str]:
    """Save uploaded file and return success status, message, and filename."""
    try:
        # Validate file
        is_valid, validation_msg = validate_file(file, file_type)
        if not is_valid:
            return False, validation_msg, ""
        
        # Generate unique filename
        filename = generate_unique_filename(account_code, file.filename, retail_code, customer_id, customer_name)
        
        # Determine target directory
        target_dir = IMAGES_DIR if file_type == "image" else DOCUMENTS_DIR
        file_path = target_dir / filename
        
        # Save file
        contents = await file.read()
        with open(file_path, "wb") as f:
            f.write(contents)
        
        logger.info(f"[FILE_UPLOAD] Saved {file_type}: {filename} for account: {account_code}")
        return True, "File uploaded successfully", filename
        
    except Exception as e:
        logger.error(f"[FILE_UPLOAD] Error saving file: {str(e)}")
        return False, f"Error saving file: {str(e)}", ""

def delete_uploaded_file(filename: str, file_type: str = "image") -> tuple[bool, str]:
    """Delete uploaded file."""
    try:
        if not filename:
            return True, "No filename to delete"
        
        # Determine file path
        target_dir = IMAGES_DIR if file_type == "image" else DOCUMENTS_DIR
        file_path = target_dir / filename
        
        if file_path.exists():
            file_path.unlink()
            logger.info(f"[FILE_DELETE] Deleted {file_type}: {filename}")
            return True, "File deleted successfully"
        else:
            logger.warning(f"[FILE_DELETE] File not found: {filename}")
            return True, "File not found (already deleted)"
            
    except Exception as e:
        logger.error(f"[FILE_DELETE] Error deleting file {filename}: {str(e)}")
        return False, f"Error deleting file: {str(e)}"

# --- Utilities: customer activity logging ---
def _log_customer_activity(account_code: str | None, retail_code: str | None, status_value: str) -> None:
    """Insert a row into customer_activity_log via a raw INSERT query.

    - Dynamically includes only columns that exist.
    - If created_at exists, uses NOW() on the server.
    """
    try:
        md = MetaData()
        tbl = Table('customer_activity_log', md, autoload_with=engine)
        cols = {c.name for c in tbl.columns}

        # Build dynamic column list and values
        insert_cols: list[str] = []
        insert_vals: list[str] = []
        params: dict = {}

        if 'account_code' in cols:
            insert_cols.append('account_code')
            insert_vals.append(':account_code')
            params['account_code'] = account_code
        if 'retail_code' in cols:
            insert_cols.append('retail_code')
            insert_vals.append(':retail_code')
            params['retail_code'] = retail_code
        if 'status' in cols:
            insert_cols.append('status')
            insert_vals.append(':status')
            params['status'] = status_value

        if not insert_cols:
            return  # nothing to insert safely

        sql = f"INSERT INTO customer_activity_log ({', '.join(insert_cols)}) VALUES ({', '.join(insert_vals)})"
        with engine.begin() as conn:
            conn.execute(text(sql), params)
    except Exception as e:
        # Log detailed context to diagnose duplicate key or constraint issues on subsequent logins
        try:
            logger.warning(
                "[ACTIVITY_LOG] Insert failed: %s | sql=%s | params=%s",
                str(e), sql, params, exc_info=True
            )
        except Exception:
            logger.debug("[ACTIVITY_LOG] Failed to write activity row", exc_info=True)

# Helper to mask sensitive info
def mask_sensitive(data):
    if not isinstance(data, dict):
        return data
    masked = data.copy()
    for k in masked:
        if 'password' in k.lower() or 'secret' in k.lower():
            masked[k] = '***MASKED***'
    return masked


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle hooks.

    Ensures WhatsApp credits wallet + ledger tables exist.
    """

    strict_startup = (os.getenv("STARTUP_DB_STRICT", "true") or "true").lower() == "true"

    try:
        ensure_provider_credits_tables()
    except Exception:
        logger.exception("Failed to ensure provider credits tables")
        if strict_startup:
            raise

    yield


app = FastAPI(lifespan=lifespan)

# Public static serving for uploaded media
app.mount("/uploads", StaticFiles(directory=str(MEDIA_UPLOADS_DIR)), name="uploads")

# Add CORS middleware
def _csv_env(name: str) -> list[str]:
    raw = os.getenv(name, "")
    if not raw:
        return []
    return [p.strip() for p in raw.split(",") if p.strip()]


DEFAULT_CORS_ORIGINS = [
    "https://retailpro.techiesmagnifier.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:8081",
    "http://127.0.0.1:8081",
]

cors_origins = list(dict.fromkeys(DEFAULT_CORS_ORIGINS + _csv_env("CORS_ALLOW_ORIGINS")))
cors_origin_regex = os.getenv("CORS_ALLOW_ORIGIN_REGEX", "").strip() or None

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)
 
@app.get("/")
def read_root():
    return {"message": "Welcome to the API"}


def _resolve_scope_from_user(user: User, account_code: Optional[str], retail_code: Optional[str]) -> tuple[str, str]:
    acct = (account_code or user.account_code or "").strip()
    retail = (retail_code or user.retail_code or "").strip()
    if not acct or not retail:
        raise HTTPException(status_code=400, detail="account_code and retail_code are required")
    # If token has scope values, enforce they match
    if user.account_code and acct != user.account_code:
        raise HTTPException(status_code=403, detail="account_code not allowed")
    if user.retail_code and retail != user.retail_code:
        raise HTTPException(status_code=403, detail="retail_code not allowed")
    return acct, retail


class WhatsAppCampaignSendRequest(BaseModel):
    account_code: Optional[str] = None
    retail_code: Optional[str] = None
    channel: str = "whatsapp"
    campaign_name: str
    campaign_type: Optional[str] = None
    recipients_count: int = Field(..., ge=1)
    attachment_type: Optional[str] = None
    schedule_mode: Optional[str] = None
    schedule_at: Optional[datetime] = None
    # Extended details
    template_id: Optional[str] = None
    template_name: Optional[str] = None
    template_variables: Optional[Dict[str, str]] = None
    media_file_url: Optional[str] = None
    customers: Optional[List[Dict[str, Any]]] = None


@app.post("/whatsapp-campaigns/send")
def send_whatsapp_campaign(payload: WhatsAppCampaignSendRequest, user: User = Depends(get_current_user)):
    acct, retail = _resolve_scope_from_user(user, payload.account_code, payload.retail_code)
    
    # We pass extended details to the credit/campaign creation function.
    # Note: create_marketing_campaign_and_debit may need updates to store these, 
    # or we can just log/pass them if the underlying function supports **kwargs.
    # For now, we will pass explicit arguments if supported, otherwise we might need to update provider_credits.py
    
    result = create_marketing_campaign_and_debit(
        account_code=acct,
        retail_code=retail,
        channel=payload.channel,
        campaign_name=payload.campaign_name,
        campaign_type=payload.campaign_type,
        recipients_count=payload.recipients_count,
        attachment_type=payload.attachment_type,    
        schedule_mode=payload.schedule_mode,
        schedule_at=payload.schedule_at,
        created_by=getattr(user, "username", None),
        # Pass extended details
        template_id=payload.template_id,
        template_name=payload.template_name,
        template_variables=payload.template_variables,
        media_file_url=payload.media_file_url,
        customers=payload.customers,
    )
    return {"ok": True, **result}


@app.get("/campaign-history")
def campaign_history(
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None,
    channel: str = "whatsapp",
    limit: int = 50,
    user: User = Depends(get_current_user),
):
    acct, retail = _resolve_scope_from_user(user, account_code, retail_code)
    items = list_marketing_campaigns(account_code=acct, retail_code=retail, channel=channel, limit=limit)
    return {"items": items}


@app.get("/whatsapp-campaign-types")
def whatsapp_campaign_types(
    status: str = "ACTIVE",
    user: User = Depends(get_current_user),
):
    """Return WhatsApp campaign types for the UI.

    Backed by the whatsapp_campaign_types table.
    """
    _ = user  # auth required
    items = list_whatsapp_campaign_types(status=status)
    return {"items": items}


@app.get("/whatsapp-templates")
def whatsapp_templates(
    status: str = "ACTIVE",
    category_code: str = "",
    user: User = Depends(get_current_user),
):
    """Return WhatsApp templates for the UI.

    Backed by the whatsapp_templates table.
    Use category_code to filter templates by the chosen campaign type.
    """
    _ = user  # auth required
    items = list_whatsapp_templates(status=status, category_code=category_code)
    return {"items": items}

# Register routers
app.include_router(settlement_router)
app.include_router(reports_router)
app.include_router(stock_in_router)
app.include_router(stock_adjustment_router)

# -----------------------------
# Employee Incentive Utilities
# -----------------------------
from typing import Tuple
from sqlalchemy import Table as _SATable

def _reflect_table(name: str) -> _SATable:
    md = MetaData()
    return _SATable(name, md, autoload_with=engine)

def _normalize_effective_from(month_str: str) -> str:
    """Convert YYYY-MM (or YYYY-MM-01) to YYYY-MM-01 string for DATE column."""
    try:
        if len(month_str) == 7:
            return f"{month_str}-01"
        if len(month_str) >= 10:
            return month_str[:10]
    except Exception:
        pass
    # Fallback to current month start
    return datetime.now(timezone.utc).strftime('%Y-%m-01')

# -----------------------------
# Employee Advances
# -----------------------------
class EmployeeAdvanceAdd(BaseModel):
    account_code: str
    retail_code: str
    employee_id: int
    month: str  # YYYY-MM
    date: str   # YYYY-MM-DD
    amount: Decimal
    note: Optional[str] = None

def _ensure_employee_advances_table():
    md = MetaData()
    try:
        Table('employee_advances', md, autoload_with=engine)
        return
    except Exception:
        pass
    ddl = (
        """
        CREATE TABLE IF NOT EXISTS `employee_advances` (
            `id` INT AUTO_INCREMENT PRIMARY KEY,
            `account_code` VARCHAR(50) NOT NULL,
            `retail_code` VARCHAR(50) NOT NULL,
            `employee_id` INT NOT NULL,
            `month` VARCHAR(7) NOT NULL,
            `date` VARCHAR(10) NOT NULL,
            `amount` DECIMAL(14,2) NOT NULL DEFAULT 0,
            `note` VARCHAR(255) NULL,
            `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY `idx_scope_month` (`account_code`, `retail_code`, `month`),
            KEY `idx_emp` (`employee_id`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        """
    )
    with engine.begin() as conn:
        conn.exec_driver_sql(ddl)

def _normalize_month(month: str) -> str:
    try:
        # Accept YYYY-MM or YYYY-MM-01
        parts = month.strip()[:7]
        y, m = parts.split('-')
        return f"{int(y):04d}-{int(m):02d}"
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")
def _normalize_date_for_month(month: str, date_str: str) -> str:
    # Returns YYYY-MM-DD, clamped to provided month prefix
    m = _normalize_month(month)
    want_prefix = m + "-"
    s = (date_str or '').strip()[:10]
    if not s:
        # default to 01
        return want_prefix + "01"
    # If only day provided (e.g., '7' or '07')
    if len(s) <= 2 and s.isdigit():
        return want_prefix + str(int(s)).zfill(2)
    # Normalize 'YYYY-MM-DD'
    if len(s) >= 10:
        s = s[:10]
    if not s.startswith(want_prefix):
        # Force into the given month; keep the day component if present
        try:
            day = int(s.split('-')[-1])
        except Exception:
            day = 1
        return want_prefix + str(max(1, min(31, day))).zfill(2)
    return s

@app.get("/employee-advance/list", tags=["payroll"], summary="List advances for a date range (or month for compatibility)")
def list_employee_advances(
    account_code: str,
    retail_code: str,
    month: Optional[str] = None,
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """List employee advance entries.

    Preferred filter is by [fromdate, todate] inclusive. If not provided, falls back to `month` (YYYY-MM).
    """
    _ensure_employee_advances_table()
    tbl = Table('employee_advances', MetaData(), autoload_with=engine)

    use_range = bool(fromdate and todate)
    if use_range:
        f = _normalize_day(fromdate or '')
        t = _normalize_day(todate or '')
        if f > t:
            raise HTTPException(status_code=400, detail="fromdate cannot be after todate")
        cond = and_(
            tbl.c.account_code == account_code,
            tbl.c.retail_code == retail_code,
            tbl.c.date >= f,
            tbl.c.date <= t,
        )
    else:
        if not month:
            raise HTTPException(status_code=400, detail="Provide either fromdate/todate or month")
        m = _normalize_month(month)
        cond = and_(
            tbl.c.account_code == account_code,
            tbl.c.retail_code == retail_code,
            tbl.c.month == m,
        )

    stmt = (
        select(tbl.c.id, tbl.c.employee_id, tbl.c.date, tbl.c.amount, tbl.c.note, tbl.c.month)
        .where(cond)
        .order_by(tbl.c.employee_id.asc(), tbl.c.date.asc(), tbl.c.id.asc())
    )
    with engine.begin() as conn:
        rows = [dict(r._mapping) for r in conn.execute(stmt)]
    return {"success": True, "data": rows}

@app.post("/employee-advance/add", tags=["payroll"], summary="Add an advance entry")
def add_employee_advance(req: EmployeeAdvanceAdd, current_user: User = Depends(get_current_user)):
    _ensure_employee_advances_table()
    m = _normalize_month(req.month)
    d = _normalize_date_for_month(m, req.date)
    if req.amount is None:
        raise HTTPException(status_code=400, detail="'amount' is required")
    try:
        amt = req.amount
    except Exception:
        raise HTTPException(status_code=400, detail="'amount' must be a number")
    
    tbl = Table('employee_advances', MetaData(), autoload_with=engine)
    ins = sql_insert(tbl).values(
        account_code=req.account_code,
        retail_code=req.retail_code,
        employee_id=int(req.employee_id),
        month=m,
        date=d,
        amount=amt,
        note=req.note or None,
    )
    with engine.begin() as conn:
        res = conn.execute(ins)
        new_id = None
        try:
            if getattr(res, 'inserted_primary_key', None):
                new_id = res.inserted_primary_key[0]
        except Exception:
            new_id = None
        if new_id is None:
            try:
                new_id = int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar() or 0)
            except Exception:
                new_id = 0
    return {"success": True, "id": new_id}

@app.delete("/employee-advance/delete", tags=["payroll"], summary="Delete an advance entry")
def delete_employee_advance(id: int, account_code: str, retail_code: str, current_user: User = Depends(get_current_user)):
    _ensure_employee_advances_table()
    tbl = Table('employee_advances', MetaData(), autoload_with=engine)
    stmt = sql_delete(tbl).where(and_(tbl.c.id == id, tbl.c.account_code == account_code, tbl.c.retail_code == retail_code))
    with engine.begin() as conn:
        res = conn.execute(stmt)
    return {"success": True, "deleted": getattr(res, 'rowcount', 0)}

# -----------------------------
# Employee Salary Provisioning
# -----------------------------
class ProvideSalaryRequest(BaseModel):
    account_code: str
    retail_code: str
    employee_id: int
    # Switch to date range instead of month (keep month optional for compatibility)
    fromdate: str  # YYYY-MM-DD
    todate: str    # YYYY-MM-DD
    month: Optional[str] = None  # derived from fromdate if not provided
    actual_salary: Decimal
    suggested_salary: Decimal
    custom_salary: Optional[Decimal] = None
    note: Optional[str] = None

def _ensure_employee_salary_table():
    md = MetaData()
    # If table does not exist, create with date range columns
    table_exists = True
    try:
        Table('employee_salary_provided', md, autoload_with=engine)
    except Exception:
        table_exists = False

    if not table_exists:
        ddl = (
            """
            CREATE TABLE IF NOT EXISTS `employee_salary_provided` (
                `id` INT AUTO_INCREMENT PRIMARY KEY,
                `account_code` VARCHAR(50) NOT NULL,
                `retail_code` VARCHAR(50) NOT NULL,
                `employee_id` INT NOT NULL,
                `from_date` VARCHAR(10) NOT NULL,
                `to_date` VARCHAR(10) NOT NULL,
                `month` VARCHAR(7) NULL,
                `actual_salary` DECIMAL(14,2) NOT NULL DEFAULT 0,
                `suggested_salary` DECIMAL(14,2) NOT NULL DEFAULT 0,
                `custom_salary` DECIMAL(14,2) NULL,
                `final_salary` DECIMAL(14,2) NOT NULL DEFAULT 0,
                `note` VARCHAR(255) NULL,
                `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY `idx_scope_range` (`account_code`, `retail_code`, `from_date`, `to_date`),
                KEY `idx_emp` (`employee_id`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )
        with engine.begin() as conn:
            conn.exec_driver_sql(ddl)
        return

    # Table exists: ensure from_date/to_date columns are present for range support
    try:
        insp = sqlalchemy_inspect(engine)
        cols = {c['name'] for c in insp.get_columns('employee_salary_provided')}
        alters = []
        if 'from_date' not in cols:
            alters.append("ADD COLUMN `from_date` VARCHAR(10) NULL AFTER `employee_id`")
        if 'to_date' not in cols:
            alters.append("ADD COLUMN `to_date` VARCHAR(10) NULL AFTER `from_date`")
        if alters:
            with engine.begin() as conn:
                conn.exec_driver_sql(f"ALTER TABLE `employee_salary_provided` {', '.join(alters)}")
    except Exception:
        # non-fatal
        pass

def _normalize_salary_month(month: str) -> str:
    return _normalize_month(month)

def _normalize_day(date_str: str) -> str:
    try:
        s = (date_str or '').strip()[:10]
        y, m, d = s.split('-')
        return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

@app.post("/employee-salary/provide", tags=["payroll"], summary="Record provided salary for an employee for a date range")
def provide_employee_salary(req: ProvideSalaryRequest, current_user: User = Depends(get_current_user)):
    _ensure_employee_salary_table()
    # Normalize date range
    f = _normalize_day(req.fromdate)
    t = _normalize_day(req.todate)
    if f > t:
        raise HTTPException(status_code=400, detail="fromdate cannot be after todate")
    # Derive month for compatibility (first month of fromdate)
    m = (req.month or f[:7]) if req.month is not None or f else None
    # Determine final salary: use custom if given, else suggested, else actual
    try:
        actual = Decimal(req.actual_salary)
    except Exception:
        raise HTTPException(status_code=400, detail="actual_salary must be a number")
    try:
        suggested = Decimal(req.suggested_salary)
    except Exception:
        raise HTTPException(status_code=400, detail="suggested_salary must be a number")
    custom_val: Optional[Decimal] = None
    if req.custom_salary is not None:
        try:
            custom_val = Decimal(req.custom_salary)
        except Exception:
            raise HTTPException(status_code=400, detail="custom_salary must be a number")
    final_salary = custom_val if custom_val is not None else suggested if suggested is not None else actual

    tbl = Table('employee_salary_provided', MetaData(), autoload_with=engine)
    cols = set(tbl.c.keys())
    values = {
        'account_code': req.account_code,
        'retail_code': req.retail_code,
        'employee_id': int(req.employee_id),
        'actual_salary': actual,
        'suggested_salary': suggested,
        'custom_salary': custom_val,
        'final_salary': final_salary,
        'note': req.note or None,
    }
    if 'from_date' in cols:
        values['from_date'] = f
    if 'to_date' in cols:
        values['to_date'] = t
    if 'month' in cols and m:
        values['month'] = m
    ins = sql_insert(tbl).values(**values)
    with engine.begin() as conn:
        res = conn.execute(ins)
        new_id = None
        try:
            if getattr(res, 'inserted_primary_key', None):
                new_id = res.inserted_primary_key[0]
        except Exception:
            new_id = None
        if new_id is None:
            try:
                new_id = int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar() or 0)
            except Exception:
                new_id = 0
    return {"success": True, "id": new_id, "final_salary": str(final_salary)}

@app.get("/employee-salary/provided", tags=["payroll"], summary="List provided salaries for a date range")
def list_salary_provided(account_code: str, retail_code: str, fromdate: str, todate: str, employee_id: Optional[int] = None, current_user: User = Depends(get_current_user)):
    """Return rows in employee_salary_provided that match the given account+retail and exact date range.

    - If the table doesn't have from_date/todata yet, fall back to month = YYYY-MM(fromdate).
    - Optionally filter by employee_id when provided.
    """
    _ensure_employee_salary_table()
    f = _normalize_day(fromdate)
    t = _normalize_day(todate)
    tbl = Table('employee_salary_provided', MetaData(), autoload_with=engine)
    cols = {c.name for c in tbl.columns}
    stmt = select(tbl.c.id, tbl.c.employee_id, tbl.c.final_salary)
    conds = [tbl.c.account_code == account_code, tbl.c.retail_code == retail_code]
    if 'from_date' in cols and 'to_date' in cols:
        conds.append(tbl.c.from_date == f)
        conds.append(tbl.c.to_date == t)
    elif 'month' in cols:
        conds.append(tbl.c.month == f[:7])
    if employee_id is not None:
        conds.append(tbl.c.employee_id == int(employee_id))
    stmt = stmt.where(and_(*conds))
    with engine.begin() as conn:
        rows = [dict(r._mapping) for r in conn.execute(stmt)]
    return {"success": True, "data": rows}


from invoice import (
    InvoiceBulkCreate,
    InvoiceBulkUpdate,
    create_invoice_lines,
    get_invoice_lines,
    update_invoice_lines,
    list_invoices,
    get_customer_wallet_ledger,
    record_customer_credit_payment,
)
from appointment_transactions import (
    AppointmentTransactionBulkCreate,
    AppointmentTransactionUpdate,
    AppointmentTransactionCreate,
    create_appointment_transactions,
    get_appointment_transactions,
    update_appointment_transactions,
    list_appointment_transactions,
)
from fastapi import Body
from pydantic import ValidationError


def _filter_services_for_response(details: dict) -> list:
    """Return the list used for response `services`.

    The invoice engine stores all billable rows in `data` (billing_trans_summary),
    including synthetic IDs like `inv:<id>` (inventory) and `pkg:<id>` (packages).

    When dedicated arrays exist (`inventory` / `packages`), clients expect those
    items to NOT appear under `services`.
    """
    data = details.get('data') or []
    if not isinstance(data, list):
        return []

    has_inventory = isinstance(details.get('inventory'), list) and len(details.get('inventory') or []) > 0
    has_packages = isinstance(details.get('packages'), list) and len(details.get('packages') or []) > 0

    # Only filter synthetic rows when the dedicated arrays exist, so we don't
    # accidentally hide data in environments where those tables are absent.
    if not (has_inventory or has_packages):
        return data

    filtered: list = []
    for row in data:
        if not isinstance(row, dict):
            continue
        sid = str(row.get('service_id') or '')
        if has_inventory and sid.startswith('inv:'):
            continue
        if has_packages and sid.startswith('pkg:'):
            continue
        filtered.append(row)
    return filtered

def _coerce_invoice_bulk(payload: dict) -> InvoiceBulkCreate:
    """Accept either legacy {lines:[...]} or new header+services payload and return InvoiceBulkCreate.

    New accepted shape example:
    {
      account_code: str,
      retail_code: str,
      invoice_id: str,
      tax_rate_percent?: number,
      tax_id?: str,
      customer?: { id?: int|str, name?: str, phone?: str },
      employee?: { id?: str, name?: str, level?: str, percent?: number },
      services: [ { service_id?, service_name, qty?, unit_price, base_price?, discount_amount?, tax_rate_percent?, markup_percent_applied?, markup_amount_per_unit? } ]
    }
    """
    # Prefer new service_lines mapping when present; legacy 'lines' used only if no services provided
    if 'service_lines' in payload:
        services = payload.get('service_lines') or []
        if not isinstance(services, list) or not services:
            # Backward-compatible: allow package-only / inventory-only invoices.
            pkg_lines = payload.get('package_lines') or []
            inv_lines = payload.get('inventory_lines') or []
            derived: list = []
            if isinstance(pkg_lines, list) and pkg_lines:
                for p in pkg_lines:
                    if not isinstance(p, dict):
                        continue
                    derived.append({
                        'service_id': f"pkg:{p.get('package_id')}" if p.get('package_id') not in (None, '') else None,
                        'service_name': p.get('package_name') or 'Package',
                        'qty': p.get('qty') or 1,
                        'unit_price': p.get('unit_price') or 0,
                        'tax_id': p.get('tax_id'),
                        'tax_rate_percent': p.get('tax_rate_percent'),
                        'discount_amount': p.get('discount_amount', 0),
                        'tax_amount': p.get('tax_amount'),
                        'grand_total': p.get('grand_total'),
                        'employee_id': p.get('employee_id'),
                        'employee_name': p.get('employee_name'),
                        'account_code': p.get('account_code') or payload.get('account_code'),
                        'retail_code': p.get('retail_code') or payload.get('retail_code'),
                        'invoice_id': p.get('invoice_id') or payload.get('invoice_id'),
                    })
            elif isinstance(inv_lines, list) and inv_lines:
                for p in inv_lines:
                    if not isinstance(p, dict):
                        continue
                    derived.append({
                        'service_id': f"inv:{p.get('product_id')}" if p.get('product_id') not in (None, '') else None,
                        'service_name': p.get('product_name') or 'Product',
                        'qty': p.get('qty') or 1,
                        'unit_price': p.get('unit_price') or 0,
                        'tax_id': p.get('tax_id'),
                        'tax_rate_percent': p.get('tax_rate_percent'),
                        'discount_amount': p.get('discount_amount', 0),
                        'tax_amount': p.get('tax_amount'),
                        'grand_total': p.get('grand_total'),
                        'employee_id': p.get('employee_id'),
                        'employee_name': p.get('employee_name'),
                        'account_code': p.get('account_code') or payload.get('account_code'),
                        'retail_code': p.get('retail_code') or payload.get('retail_code'),
                        'invoice_id': p.get('invoice_id') or payload.get('invoice_id'),
                    })

            if derived:
                services = derived
            else:
                raise HTTPException(status_code=400, detail="'service_lines' must be a non-empty array")
        # Try to pull header-context from provided lines[0] if available
        hdr = (payload.get('lines') or [{}])[0]
        acc = payload.get('account_code') or hdr.get('account_code') or services[0].get('account_code')
        ret = payload.get('retail_code') or hdr.get('retail_code') or services[0].get('retail_code')
        inv = payload.get('invoice_id') or hdr.get('invoice_id') or services[0].get('invoice_id')
        if not all([acc, ret, inv]):
            raise HTTPException(status_code=400, detail="account_code, retail_code, invoice_id required at root or in header line when using service_lines")
        lines: list = []
        for idx, svc in enumerate(services):
            ln = {
                'account_code': acc,
                'retail_code': ret,
                'invoice_id': inv,
                'service_id': svc.get('service_id'),
                'service_name': svc.get('service_name'),
                'qty': svc.get('qty') or 1,
                'unit_price': svc.get('unit_price') or 0,
                'base_price': svc.get('base_price'),
                'tax_id': svc.get('tax_id'),
                'tax_rate_percent': svc.get('tax_rate_percent'),
                'discount_amount': svc.get('discount_amount', 0),
                # totals per line if provided
                'tax_amount': svc.get('tax_amount'),
                'grand_total': svc.get('grand_total'),
            }
            # Per-service employee assignment (do not rely only on header)
            try:
                svc_emp_id = svc.get('employee_id')
                svc_emp_name = svc.get('employee_name')
                svc_emp_level = svc.get('employee_level')
                svc_emp_percent = svc.get('employee_percent')
                if svc_emp_id is not None:
                    ln['employee_id'] = svc_emp_id
                if svc_emp_name is not None:
                    ln['employee_name'] = svc_emp_name
                if svc_emp_level is not None:
                    ln['employee_level'] = svc_emp_level
                if svc_emp_percent is not None:
                    ln['employee_percent'] = svc_emp_percent
            except Exception:
                pass
            # Attach employee/customer fields from header to first line only
            if idx == 0 and isinstance(hdr, dict):
                for k in ['employee_id','employee_name','employee_level','employee_percent','customer_id','customer_name','customer_number','custumer_number','membership_id','membership_cardno','birthday_date','anniversary_date','address','additional_notes','notes','from_appointment','created_by','updated_by','age','height_cm','weight_kg']:
                    if hdr.get(k) is not None and ln.get(k) in (None, ''):
                        # Only fill from header when service-level value is absent
                        ln[k] = hdr.get(k)
                # also summary numbers if present
                for k in ['subtotal_amount','total_cgst','total_sgst','total_igst','tax_amount_total','grand_total','rounded_total','round_off']:
                    if hdr.get(k) is not None:
                        ln[k] = hdr.get(k)
            lines.append(ln)
        try:
            return InvoiceBulkCreate(
                lines=lines,
                package_lines=payload.get('package_lines') if 'package_lines' in payload else None,
                inventory_lines=payload.get('inventory_lines') if 'inventory_lines' in payload else None,
                customer_lines=payload.get('customer_lines') if 'customer_lines' in payload else None,
                payment_modes=payload.get('payment_modes') if 'payment_modes' in payload else None,
                credit_amount=payload.get('credit_amount') if 'credit_amount' in payload else None,
                invoice_status=payload.get('invoice_status') if 'invoice_status' in payload else None,
            )
        except ValidationError as ve:
            raise HTTPException(status_code=400, detail=f"Validation failed: {ve}")
    elif 'lines' in payload:
        # Legacy shape: lightly sanitize and normalize common fields, PRESERVE per-line employee_id
        try:
            norm_lines = []
            for ln in payload.get('lines') or []:
                if not isinstance(ln, dict):
                    continue
                ln2 = dict(ln)
                # Normalize legacy typo 'custumer_number' and ensure it's a string
                if 'custumer_number' in ln2 and ln2.get('custumer_number') is not None:
                    try:
                        ln2['custumer_number'] = str(ln2['custumer_number'])
                    except Exception:
                        pass
                    # If canonical field missing, mirror into customer_number
                    if ln2.get('customer_number') in (None, ''):
                        ln2['customer_number'] = ln2.get('custumer_number')
                # Ensure canonical customer_number is a string when numeric provided
                if 'customer_number' in ln2 and ln2.get('customer_number') is not None and not isinstance(ln2.get('customer_number'), str):
                    try:
                        ln2['customer_number'] = str(ln2['customer_number'])
                    except Exception:
                        pass
                
                # IMPORTANT: Preserve per-line employee_id (don't override it with header semantics)
                # The frontend sends different employee_id for each service line
                if 'employee_id' in ln2 and ln2.get('employee_id') is not None:
                    # Ensure employee_id is properly formatted
                    try:
                        ln2['employee_id'] = str(ln2['employee_id']) if ln2['employee_id'] != '' else None
                        logger.info(f"[COERCE/EMPLOYEE] Legacy line: service={ln2.get('service_name')}, employee_id={ln2['employee_id']}")
                    except Exception:
                        pass
                
                norm_lines.append(ln2)
            return InvoiceBulkCreate(
                lines=norm_lines,
                package_lines=payload.get('package_lines') if 'package_lines' in payload else None,
                inventory_lines=payload.get('inventory_lines') if 'inventory_lines' in payload else None,
                payment_modes=payload.get('payment_modes') if 'payment_modes' in payload else None,
                credit_amount=payload.get('credit_amount') if 'credit_amount' in payload else None,
                invoice_status=payload.get('invoice_status') if 'invoice_status' in payload else None,
            )
        except ValidationError as ve:
            raise HTTPException(status_code=400, detail=f"Validation failed: {ve}")
    # Accept either 'services' (legacy/new) or 'service_lines' (new separation)
    if 'services' not in payload and 'service_lines' not in payload:
        raise HTTPException(status_code=400, detail="Payload must include 'services' or 'service_lines' or 'lines'")
    services = payload.get('services') or payload.get('service_lines') or []
    if not isinstance(services, list) or not services:
        raise HTTPException(status_code=400, detail="'services' must be a non-empty array")
    acc = payload.get('account_code') or services[0].get('account_code')
    ret = payload.get('retail_code') or services[0].get('retail_code')
    inv = payload.get('invoice_id') or services[0].get('invoice_id')
    if not all([acc, ret, inv]):
        raise HTTPException(status_code=400, detail="account_code, retail_code, invoice_id required at root or per service")
    cust = payload.get('customer') or {}
    emp = payload.get('employee') or {}
    header_tax_rate = payload.get('tax_rate_percent')
    header_tax_id = payload.get('tax_id')
    cust_id = cust.get('id') if isinstance(cust, dict) else None
    cust_name = (cust.get('name') or cust.get('customer_name')) if isinstance(cust, dict) else None
    cust_phone = (cust.get('phone') or cust.get('mobile')) if isinstance(cust, dict) else None
    # Additional customer details (optional) sent from frontend
    cust_membership_id = cust.get('membership_id') if isinstance(cust, dict) else None
    cust_membership_cardno = cust.get('membership_cardno') if isinstance(cust, dict) else None
    cust_birthday = cust.get('birthday_date') if isinstance(cust, dict) else None
    cust_anniversary = cust.get('anniversary_date') if isinstance(cust, dict) else None
    cust_address = cust.get('address') if isinstance(cust, dict) else None
    emp_id = emp.get('id') if isinstance(emp, dict) else None
    emp_name = emp.get('name') if isinstance(emp, dict) else None
    emp_level = emp.get('level') if isinstance(emp, dict) else None
    emp_percent = emp.get('percent') if isinstance(emp, dict) else None
    lines = []
    for idx, svc in enumerate(services):
        if 'service_name' not in svc:
            raise HTTPException(status_code=400, detail=f"services[{idx}].service_name required")
        line = {
            'account_code': acc,
            'retail_code': ret,
            'invoice_id': inv,
            'service_id': svc.get('service_id'),
            'service_name': svc['service_name'],
            'qty': svc.get('qty') or 1,
            'unit_price': svc.get('unit_price') or 0,
            'base_price': svc.get('base_price'),
            'tax_id': svc.get('tax_id') or header_tax_id,
            'tax_rate_percent': svc.get('tax_rate_percent', header_tax_rate),
            'discount_amount': svc.get('discount_amount', 0),
            'markup_percent_applied': svc.get('markup_percent_applied'),
            'markup_amount_per_unit': svc.get('markup_amount_per_unit'),
        }
        
        # Attach customer info only on first line (header semantics)
        if idx == 0:
            if cust_id is not None:
                try:
                    line['customer_id'] = int(cust_id)
                except Exception:
                    line['customer_id'] = 0
            line['customer_name'] = cust_name
            line['customer_number'] = cust_phone
            # propagate optional details so downstream can upsert to master_customer
            if cust_membership_id is not None:
                line['membership_id'] = cust_membership_id
            if cust_membership_cardno not in (None, ''):
                line['membership_cardno'] = cust_membership_cardno
            if cust_birthday not in (None, ''):
                line['birthday_date'] = cust_birthday
            if cust_anniversary not in (None, ''):
                line['anniversary_date'] = cust_anniversary
            if cust_address not in (None, ''):
                line['address'] = cust_address
        
        # Handle employee assignment per service (not just first line)
        # Check if this service has its own employee data, otherwise fall back to header employee
        service_emp_id = svc.get('employee_id')
        service_emp_name = svc.get('employee_name')
        service_emp_level = svc.get('employee_level')
        service_emp_percent = svc.get('employee_percent')
        
        # Use per-service employee data if available, otherwise use header employee data
        line['employee_id'] = service_emp_id if service_emp_id is not None else emp_id
        line['employee_name'] = service_emp_name if service_emp_name is not None else emp_name
        line['employee_level'] = service_emp_level if service_emp_level is not None else emp_level
        line['employee_percent'] = service_emp_percent if service_emp_percent is not None else emp_percent
        
        # Log employee assignment for debugging
        if line.get('employee_id'):
            logger.info(f"[COERCE/EMPLOYEE] Services format: service={svc['service_name']}, employee_id={line['employee_id']}, employee_name={line.get('employee_name')}")
        lines.append(line)
    try:
        return InvoiceBulkCreate(
            lines=lines,
            package_lines=payload.get('package_lines') if 'package_lines' in payload else None,
            inventory_lines=payload.get('inventory_lines') if 'inventory_lines' in payload else None,
            customer_lines=payload.get('customer_lines') if 'customer_lines' in payload else None,
            payment_modes=payload.get('payment_modes') if 'payment_modes' in payload else None,
            credit_amount=payload.get('credit_amount') if 'credit_amount' in payload else None,
            invoice_status=payload.get('invoice_status') if 'invoice_status' in payload else None,
        )
    except ValidationError as ve:
        raise HTTPException(status_code=400, detail=f"Validation failed: {ve}")

# Billing Transition (Invoice) endpoints (renamed from /invoice)
@app.post("/billing-transition", summary="Create billing transition lines", tags=["invoice"])
def create_billing_transition(payload: dict = Body(...), current_user: User = Depends(get_current_user)):
    logger.info(f"[BILLING_TRANSITION] Raw payload keys: {list(payload.keys())}")
    logger.info(f"[BILLING_TRANSITION] package_lines in payload: {payload.get('package_lines')}")
    logger.info(f"[BILLING_TRANSITION] inventory_lines in payload: {payload.get('inventory_lines')}")
    logger.info(f"[BILLING_TRANSITION] customer_lines in payload: {payload.get('customer_lines')}")
    logger.info(f"[BILLING_TRANSITION] payment_modes in payload: {payload.get('payment_modes')}")
    logger.info(f"[BILLING_TRANSITION] credit_amount in payload: {payload.get('credit_amount')}")
    coerced = _coerce_invoice_bulk(payload)
    logger.info(f"[BILLING_TRANSITION] Coerced package_lines: {coerced.package_lines}")
    logger.info(f"[BILLING_TRANSITION] Coerced inventory_lines: {coerced.inventory_lines}")
    logger.info(f"[BILLING_TRANSITION] Coerced customer_lines: {coerced.customer_lines}")
    return create_invoice_lines(coerced, current_user.username)

@app.get("/billing-transition/{invoice_id}", summary="Get billing transition lines", tags=["invoice"])
def read_billing_transition(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    base = get_invoice_lines(invoice_id, account_code, retail_code)
    # Derive simplified services array (unique service_id+name combos)
    services: list = []
    for row in _filter_services_for_response(base):
        services.append({
            'service_id': row.get('service_id'),
            'service_name': row.get('service_name'),
            'qty': row.get('qty'),
            'unit_price': row.get('unit_price'),
            'discount_amount': row.get('discount_amount'),
            'tax_rate_percent': row.get('tax_rate_percent'),
            'tax_amount': row.get('tax_amount'),
            'grand_total': row.get('grand_total'),
        })
    base['services'] = services
    # Enrich with header (billing_transactions) row if present so edit form can populate customer/staff
    try:
        from invoice import _get_txn_table  # local import to avoid circular issues on startup
        txn_tbl = _get_txn_table()
        if txn_tbl is not None:
            stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
            if account_code and 'account_code' in txn_tbl.c.keys():
                stmt = stmt.where(txn_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in txn_tbl.c.keys():
                stmt = stmt.where(txn_tbl.c.retail_code == retail_code)
            with engine.begin() as conn:
                hdr = conn.execute(stmt).first()
                if not hdr and 'sequence_id' in txn_tbl.c.keys():
                    try:
                        if invoice_id.upper().startswith('INV-'):
                            seq_part = invoice_id.split('-',1)[1]
                            if seq_part.isdigit():
                                seq_stmt = select(txn_tbl).where(txn_tbl.c.sequence_id == int(seq_part))
                                if account_code and 'account_code' in txn_tbl.c.keys():
                                    seq_stmt = seq_stmt.where(txn_tbl.c.account_code == account_code)
                                if retail_code and 'retail_code' in txn_tbl.c.keys():
                                    seq_stmt = seq_stmt.where(txn_tbl.c.retail_code == retail_code)
                                hdr = conn.execute(seq_stmt).first()
                    except Exception as _seq_err:  # pragma: no cover
                        logger.debug(f"[GET_INVOICE_API][SEQ_FALLBACK][SKIP] { _seq_err }")
                if not hdr and invoice_id.upper().startswith('INV-'):
                    raw_part = invoice_id.split('-',1)[1]
                    raw_stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == raw_part)
                    if account_code and 'account_code' in txn_tbl.c.keys():
                        raw_stmt = raw_stmt.where(txn_tbl.c.account_code == account_code)
                    if retail_code and 'retail_code' in txn_tbl.c.keys():
                        raw_stmt = raw_stmt.where(txn_tbl.c.retail_code == retail_code)
                    try:
                        hdr2 = conn.execute(raw_stmt).first()
                        if hdr2:
                            hdr = hdr2
                    except Exception as _raw_err:  # pragma: no cover
                        logger.debug(f"[GET_INVOICE_API][RAW_FALLBACK][SKIP] {_raw_err}")
                # Fallback 1: numeric sequence part if header not found and sequence_id column exists
                if not hdr and 'sequence_id' in txn_tbl.c.keys():
                    try:
                        if invoice_id.upper().startswith('INV-'):
                            seq_part = invoice_id.split('-',1)[1]
                            if seq_part.isdigit():
                                seq_stmt = select(txn_tbl).where(txn_tbl.c.sequence_id == int(seq_part))
                                if account_code and 'account_code' in txn_tbl.c.keys():
                                    seq_stmt = seq_stmt.where(txn_tbl.c.account_code == account_code)
                                if retail_code and 'retail_code' in txn_tbl.c.keys():
                                    seq_stmt = seq_stmt.where(txn_tbl.c.retail_code == retail_code)
                                hdr = conn.execute(seq_stmt).first()
                    except Exception as _seq_err:  # pragma: no cover
                        logger.debug(f"[GET_INVOICE][SEQ_FALLBACK][SKIP] { _seq_err }")
                # Fallback 2: raw numeric invoice id without prefix
                if not hdr and invoice_id.upper().startswith('INV-'):
                    raw_part = invoice_id.split('-',1)[1]
                    raw_stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == raw_part)
                    if account_code and 'account_code' in txn_tbl.c.keys():
                        raw_stmt = raw_stmt.where(txn_tbl.c.account_code == account_code)
                    if retail_code and 'retail_code' in txn_tbl.c.keys():
                        raw_stmt = raw_stmt.where(txn_tbl.c.retail_code == retail_code)
                    try:
                        hdr2 = conn.execute(raw_stmt).first()
                        if hdr2:
                            hdr = hdr2
                    except Exception as _raw_err:  # pragma: no cover
                        logger.debug(f"[GET_INVOICE][RAW_FALLBACK][SKIP] {_raw_err}")
            if hdr:
                header_dict = dict(hdr._mapping)
                base['header'] = header_dict
                # Propagate common header fields onto first line if missing (for existing frontend logic)
                if base.get('data'):
                    first_line = base['data'][0]
                    for f in ['customer_name','customerr_name','customer_number','customer_mobile','customer_id','employee_id','employee_name','employee_level','employee_percent','additional_notes','Additional_notes','notes']:
                        if f in header_dict and not first_line.get(f):
                            first_line[f] = header_dict.get(f)
    except Exception as e:  # pragma: no cover - defensive enrichment
        logger.debug(f"[GET_INVOICE][HEADER_ENRICH][SKIP] {e}")
    return base

@app.get("/debug/invoice-header/{invoice_id}", tags=["debug"])
def debug_invoice_header(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """Return raw header lookup attempts for troubleshooting missing edit metadata."""
    from invoice import _get_txn_table
    txn_tbl = _get_txn_table()
    if txn_tbl is None:
        return {"success": False, "reason": "billing_transactions table not present"}
    attempts = []
    with engine.begin() as conn:
        # Direct match
        stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
        if account_code and 'account_code' in txn_tbl.c.keys():
            stmt = stmt.where(txn_tbl.c.account_code == account_code)
        if retail_code and 'retail_code' in txn_tbl.c.keys():
            stmt = stmt.where(txn_tbl.c.retail_code == retail_code)
        direct = conn.execute(stmt).first()
        attempts.append({"mode": "direct", "found": bool(direct)})
        header = direct
        # Sequence fallback
        if not header and 'sequence_id' in txn_tbl.c.keys() and invoice_id.upper().startswith('INV-'):
            try:
                seq_part = invoice_id.split('-',1)[1]
                if seq_part.isdigit():
                    seq_stmt = select(txn_tbl).where(txn_tbl.c.sequence_id == int(seq_part))
                    if account_code and 'account_code' in txn_tbl.c.keys():
                        seq_stmt = seq_stmt.where(txn_tbl.c.account_code == account_code)
                    if retail_code and 'retail_code' in txn_tbl.c.keys():
                        seq_stmt = seq_stmt.where(txn_tbl.c.retail_code == retail_code)
                    seq_row = conn.execute(seq_stmt).first()
                    attempts.append({"mode": "sequence_id", "found": bool(seq_row)})
                    if seq_row:
                        header = seq_row
            except Exception as e:  # pragma: no cover
                attempts.append({"mode": "sequence_id", "error": str(e)})
        # Raw numeric fallback
        if not header and invoice_id.upper().startswith('INV-'):
            raw_part = invoice_id.split('-',1)[1]
            raw_stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == raw_part)
            if account_code and 'account_code' in txn_tbl.c.keys():
                raw_stmt = raw_stmt.where(txn_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in txn_tbl.c.keys():
                raw_stmt = raw_stmt.where(txn_tbl.c.retail_code == retail_code)
            raw_row = conn.execute(raw_stmt).first()
            attempts.append({"mode": "raw_invoice_id", "found": bool(raw_row)})
            if raw_row:
                header = raw_row
        header_dict = dict(header._mapping) if header else None
    return {"success": True, "invoice_id": invoice_id, "attempts": attempts, "header": header_dict}

@app.put("/billing-transition/{invoice_id}", summary="Bulk update billing transition lines", tags=["invoice"])
def update_billing_transition(invoice_id: str, payload: InvoiceBulkUpdate, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return update_invoice_lines(invoice_id, payload.update_fields, current_user.username, account_code, retail_code)

@app.put("/billing-transition/{invoice_id}/update", summary="Replace entire invoice with new lines", tags=["invoice"])
def replace_billing_transition(invoice_id: str, payload: dict = Body(...), account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """Replace all lines for an invoice with new line data."""
    from invoice import replace_invoice_lines
    coerced = _coerce_invoice_bulk(payload)
    # Ensure the invoice_id matches
    for line in coerced.lines:
        line.invoice_id = invoice_id
    return replace_invoice_lines(invoice_id, coerced, current_user.username, account_code, retail_code)

# --- Alias endpoints for compatibility ---
# Some existing frontend bundles may still call /api/invoice or /invoice.
# Keep these lightweight wrappers so old builds continue to work while new builds use /billing-transition.

@app.post("/api/billing-transition", summary="[Alias] Create billing transition lines", tags=["invoice"])
def create_billing_transition_api(payload: dict = Body(...), current_user: User = Depends(get_current_user)):
    coerced = _coerce_invoice_bulk(payload)
    return create_invoice_lines(coerced, current_user.username)

@app.get("/api/billing-transition/{invoice_id}", summary="[Alias] Get billing transition lines", tags=["invoice"])
def read_billing_transition_api(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    base = get_invoice_lines(invoice_id, account_code, retail_code)
    services: list = []
    for row in base.get('data', []):
        services.append({
            'service_id': row.get('service_id'),
            'service_name': row.get('service_name'),
            'qty': row.get('qty'),
            'unit_price': row.get('unit_price'),
            'discount_amount': row.get('discount_amount'),
            'tax_rate_percent': row.get('tax_rate_percent'),
            'tax_amount': row.get('tax_amount'),
            'grand_total': row.get('grand_total'),
        })
    base['services'] = services
    # Same header enrichment for alias endpoint
    try:
        from invoice import _get_txn_table
        txn_tbl = _get_txn_table()
        if txn_tbl is not None:
            stmt = select(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
            if account_code and 'account_code' in txn_tbl.c.keys():
                stmt = stmt.where(txn_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in txn_tbl.c.keys():
                stmt = stmt.where(txn_tbl.c.retail_code == retail_code)
            with engine.begin() as conn:
                hdr = conn.execute(stmt).first()
            if hdr:
                header_dict = dict(hdr._mapping)
                base['header'] = header_dict
                if base.get('data'):
                    first_line = base['data'][0]
                    for f in ['customer_name','customerr_name','customer_number','customer_mobile','customer_id','employee_id','employee_name','employee_level','employee_percent']:
                        if f in header_dict and not first_line.get(f):
                            first_line[f] = header_dict.get(f)
    except Exception as e:  # pragma: no cover
        logger.debug(f"[GET_INVOICE_API][HEADER_ENRICH][SKIP] {e}")
    return base

@app.put("/api/billing-transition/{invoice_id}", summary="[Alias] Update billing transition lines", tags=["invoice"])
def update_billing_transition_api(invoice_id: str, payload: InvoiceBulkUpdate, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return update_invoice_lines(invoice_id, payload.update_fields, current_user.username, account_code, retail_code)


@app.put("/billing-transition/{invoice_id}/cancel", summary="Cancel invoice (set billstatus='C')", tags=["invoice"])
def cancel_billing_transition(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """Mark an invoice as cancelled by setting billstatus='C' on billing_transactions.
    This updates the header row(s) matched by invoice_id (and optional account/retail filters).
    """
    from invoice import _get_txn_table, _update_customer_visit_billstatus

    txn_tbl = _get_txn_table()
    if txn_tbl is None:
        raise HTTPException(status_code=404, detail="billing_transactions table not found")

    try:
        with engine.begin() as conn:
            # Build WHERE clause on invoice_id + optional account/retail
            upd = sql_update(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
            if account_code and 'account_code' in txn_tbl.c.keys():
                upd = upd.where(txn_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in txn_tbl.c.keys():
                upd = upd.where(txn_tbl.c.retail_code == retail_code)

            if 'billstatus' in txn_tbl.c.keys():
                conn.execute(upd.values(billstatus='C', updated_by=(current_user.username if current_user else 'system')))

            # Try to update related customer_visit_count billstatus if applicable
            try:
                q = select(txn_tbl)
                if 'invoice_id' in txn_tbl.c.keys():
                    q = q.where(txn_tbl.c.invoice_id == invoice_id)
                if account_code and 'account_code' in txn_tbl.c.keys():
                    q = q.where(txn_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in txn_tbl.c.keys():
                    q = q.where(txn_tbl.c.retail_code == retail_code)
                hdr = conn.execute(q).first()
                if hdr:
                    m = hdr._mapping
                    cust_id = m.get('customer_id')
                    if cust_id not in (None, '', 0, '0'):
                        _update_customer_visit_billstatus(conn, account_code, retail_code, cust_id, 'C')
            except Exception:
                # Non-fatal for visit_count update
                pass

    except SQLAlchemyError as e:
        logger.exception("Failed to cancel invoice %s: %s", invoice_id, e)
        raise HTTPException(status_code=500, detail=str(e))

    return {"success": True, "invoice_id": invoice_id, "billstatus": "C"}


@app.put("/billing-transition/{invoice_id}/uncancel", summary="Revert cancelled invoice (set billstatus='Y')", tags=["invoice"])
def uncancel_billing_transition(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    """Revert a cancelled invoice by setting billstatus='Y' on billing_transactions.
    This updates the header row(s) matched by invoice_id (and optional account/retail filters).
    """
    from invoice import _get_txn_table, _update_customer_visit_billstatus

    txn_tbl = _get_txn_table()
    if txn_tbl is None:
        raise HTTPException(status_code=404, detail="billing_transactions table not found")

    try:
        with engine.begin() as conn:
            upd = sql_update(txn_tbl).where(txn_tbl.c.invoice_id == invoice_id)
            if account_code and 'account_code' in txn_tbl.c.keys():
                upd = upd.where(txn_tbl.c.account_code == account_code)
            if retail_code and 'retail_code' in txn_tbl.c.keys():
                upd = upd.where(txn_tbl.c.retail_code == retail_code)

            if 'billstatus' in txn_tbl.c.keys():
                conn.execute(upd.values(billstatus='Y', updated_by=(current_user.username if current_user else 'system')))

            # Try to update related customer_visit_count billstatus if applicable
            try:
                q = select(txn_tbl)
                if 'invoice_id' in txn_tbl.c.keys():
                    q = q.where(txn_tbl.c.invoice_id == invoice_id)
                if account_code and 'account_code' in txn_tbl.c.keys():
                    q = q.where(txn_tbl.c.account_code == account_code)
                if retail_code and 'retail_code' in txn_tbl.c.keys():
                    q = q.where(txn_tbl.c.retail_code == retail_code)
                hdr = conn.execute(q).first()
                if hdr:
                    m = hdr._mapping
                    cust_id = m.get('customer_id')
                    if cust_id not in (None, '', 0, '0'):
                        _update_customer_visit_billstatus(conn, account_code, retail_code, cust_id, 'Y')
            except Exception:
                pass

    except SQLAlchemyError as e:
        logger.exception("Failed to uncancel invoice %s: %s", invoice_id, e)
        raise HTTPException(status_code=500, detail=str(e))

    return {"success": True, "invoice_id": invoice_id, "billstatus": "Y"}

# Legacy invoice routes (soft-deprecated). Remove once all clients migrated.
@app.post("/invoice", summary="[Deprecated] Create invoice lines", tags=["invoice"])
def legacy_create_invoice(payload: InvoiceBulkCreate, current_user: User = Depends(get_current_user)):
    return create_invoice_lines(payload, current_user.username)

@app.get("/invoice/{invoice_id}", summary="[Deprecated] Get invoice lines", tags=["invoice"])
def legacy_read_invoice(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return get_invoice_lines(invoice_id, account_code, retail_code)

@app.put("/invoice/{invoice_id}", summary="[Deprecated] Update invoice lines", tags=["invoice"])
def legacy_update_invoice(invoice_id: str, payload: InvoiceBulkUpdate, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return update_invoice_lines(invoice_id, payload.update_fields, current_user.username, account_code, retail_code)

@app.post("/api/invoice", summary="[Alias Deprecated] Create invoice lines", tags=["invoice"])
def legacy_api_create_invoice(payload: InvoiceBulkCreate, current_user: User = Depends(get_current_user)):
    return create_invoice_lines(payload, current_user.username)

@app.get("/api/invoice/{invoice_id}", summary="[Alias Deprecated] Get invoice lines", tags=["invoice"])
def legacy_api_read_invoice(invoice_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return get_invoice_lines(invoice_id, account_code, retail_code)

@app.put("/api/invoice/{invoice_id}", summary="[Alias Deprecated] Update invoice lines", tags=["invoice"])
def legacy_api_update_invoice(invoice_id: str, payload: InvoiceBulkUpdate, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return update_invoice_lines(invoice_id, payload.update_fields, current_user.username, account_code, retail_code)

@app.get("/invoices", summary="List summarized invoices", tags=["invoice"])
def list_invoices_endpoint(
    account_code: str,
    retail_code: str,
    limit: int = 100,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    billstatus: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    return list_invoices(account_code, retail_code, limit, invoice_id, from_date, to_date, billstatus=billstatus)

@app.get("/billing-transitions", summary="List summarized billing transitions", tags=["invoice"])
def list_billing_transitions_endpoint(
    account_code: str, 
    retail_code: str, 
    limit: int = 100, 
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    billstatus: Optional[str] = None,
    sendalldata: str = "Y",
    include_details: bool = True,
    current_user: User = Depends(get_current_user)
):
    result = list_invoices(account_code, retail_code, limit, invoice_id, from_date, to_date, billstatus=billstatus)

    # Add employeeDetails for each invoice row (comma-separated employee names)
    if isinstance(result, dict) and result.get('success') and isinstance(result.get('data'), list):
        try:
            from invoice import get_employee_details_by_invoice_ids
            invoice_ids = [str(r.get('invoice_id')) for r in (result.get('data') or []) if isinstance(r, dict) and r.get('invoice_id') not in (None, '')]
            emp_details_map = get_employee_details_by_invoice_ids(invoice_ids, account_code, retail_code) or {}
            for row in result.get('data') or []:
                if not isinstance(row, dict):
                    continue
                inv = row.get('invoice_id')
                inv_str = str(inv).strip() if inv not in (None, '') else ''
                row['employeeDetails'] = emp_details_map.get(inv_str, '')
        except Exception as e:
            logger.warning("[billing-transitions][employeeDetails] Failed to enrich employee names: %s", e)

    # Backward compatible behavior:
    # - Default sendalldata='Y' => include all details (existing behavior)
    # - sendalldata='N' => return only invoice summary rows (fast)
    send_all = str(sendalldata or "Y").strip().upper() == "Y"
    effective_include_details = bool(include_details) and send_all

    # If the caller requests detail arrays (or is querying a single invoice), attach
    # services/packages/inventory/payments as separate arrays against each invoice.
    if (effective_include_details or (invoice_id and send_all)) and isinstance(result, dict) and result.get('success') and isinstance(result.get('data'), list):
        from invoice import get_invoice_lines
        for row in result.get('data') or []:
            if not isinstance(row, dict):
                continue
            # Ensure keys always exist in the response
            row.setdefault('services', [])
            row.setdefault('packages', [])
            row.setdefault('inventory', [])
            row.setdefault('payments', [])

            inv = row.get('invoice_id')
            if not inv:
                continue
            try:
                details = get_invoice_lines(str(inv), account_code, retail_code) or {}
                row['services'] = _filter_services_for_response(details)
                row['packages'] = details.get('packages') or []
                row['inventory'] = details.get('inventory') or []
                row['payments'] = details.get('payments') or []
            except Exception as e:
                logger.warning("[billing-transitions][details] Failed to expand invoice_id=%s: %s", inv, e)

    return result

@app.get("/api/invoices", summary="[Alias] List summarized invoices", tags=["invoice"])
def api_list_invoices_endpoint(
    account_code: str, 
    retail_code: str, 
    limit: int = 100, 
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    billstatus: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    return list_invoices(account_code, retail_code, limit, invoice_id, from_date, to_date, billstatus=billstatus)

@app.get("/api/billing-transitions", summary="[Alias] List summarized billing transitions", tags=["invoice"])
def api_list_billing_transitions_endpoint(
    account_code: str, 
    retail_code: str, 
    limit: int = 100, 
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    billstatus: Optional[str] = None,
    sendalldata: str = "Y",
    include_details: bool = True,
    current_user: User = Depends(get_current_user)
):
    result = list_invoices(account_code, retail_code, limit, invoice_id, from_date, to_date, billstatus=billstatus)

    # Add employeeDetails for each invoice row (comma-separated employee names)
    if isinstance(result, dict) and result.get('success') and isinstance(result.get('data'), list):
        try:
            from invoice import get_employee_details_by_invoice_ids
            invoice_ids = [str(r.get('invoice_id')) for r in (result.get('data') or []) if isinstance(r, dict) and r.get('invoice_id') not in (None, '')]
            emp_details_map = get_employee_details_by_invoice_ids(invoice_ids, account_code, retail_code) or {}
            for row in result.get('data') or []:
                if not isinstance(row, dict):
                    continue
                inv = row.get('invoice_id')
                inv_str = str(inv).strip() if inv not in (None, '') else ''
                row['employeeDetails'] = emp_details_map.get(inv_str, '')
        except Exception as e:
            logger.warning("[api/billing-transitions][employeeDetails] Failed to enrich employee names: %s", e)

    send_all = str(sendalldata or "Y").strip().upper() == "Y"
    effective_include_details = bool(include_details) and send_all

    if (effective_include_details or (invoice_id and send_all)) and isinstance(result, dict) and result.get('success') and isinstance(result.get('data'), list):
        from invoice import get_invoice_lines
        for row in result.get('data') or []:
            if not isinstance(row, dict):
                continue
            row.setdefault('services', [])
            row.setdefault('packages', [])
            row.setdefault('inventory', [])
            row.setdefault('payments', [])

            inv = row.get('invoice_id')
            if not inv:
                continue
            try:
                details = get_invoice_lines(str(inv), account_code, retail_code) or {}
                row['services'] = _filter_services_for_response(details)
                row['packages'] = details.get('packages') or []
                row['inventory'] = details.get('inventory') or []
                row['payments'] = details.get('payments') or []
            except Exception as e:
                logger.warning("[api/billing-transitions][details] Failed to expand invoice_id=%s: %s", inv, e)

    return result


@app.get("/billing-trans-services", summary="List service line rows from billing_trans_summary", tags=["invoice"])
def list_billing_trans_services(
    account_code: str,
    retail_code: str,
    limit: int = 2000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    from invoice import list_billing_lines
    return list_billing_lines(
        table_kind="services",
        account_code=account_code,
        retail_code=retail_code,
        limit=limit,
        offset=offset,
        invoice_id=invoice_id,
        from_date=from_date,
        to_date=to_date,
    )


@app.get("/billing-trans-packages", summary="List package line rows from billing_trans_packages", tags=["invoice"])
def list_billing_trans_packages(
    account_code: str,
    retail_code: str,
    limit: int = 2000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    from invoice import list_billing_lines
    return list_billing_lines(
        table_kind="packages",
        account_code=account_code,
        retail_code=retail_code,
        limit=limit,
        offset=offset,
        invoice_id=invoice_id,
        from_date=from_date,
        to_date=to_date,
    )


@app.get("/billing-trans-inventory", summary="List inventory line rows from billing_trans_inventory", tags=["invoice"])
def list_billing_trans_inventory(
    account_code: str,
    retail_code: str,
    limit: int = 2000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    from invoice import list_billing_lines
    return list_billing_lines(
        table_kind="inventory",
        account_code=account_code,
        retail_code=retail_code,
        limit=limit,
        offset=offset,
        invoice_id=invoice_id,
        from_date=from_date,
        to_date=to_date,
    )


@app.get("/api/billing-trans-services", summary="[Alias] List service line rows from billing_trans_summary", tags=["invoice"])
def api_list_billing_trans_services(
    account_code: str,
    retail_code: str,
    limit: int = 2000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    return list_billing_trans_services(account_code, retail_code, limit, offset, invoice_id, from_date, to_date, current_user)


@app.get("/api/billing-trans-packages", summary="[Alias] List package line rows from billing_trans_packages", tags=["invoice"])
def api_list_billing_trans_packages(
    account_code: str,
    retail_code: str,
    limit: int = 2000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    return list_billing_trans_packages(account_code, retail_code, limit, offset, invoice_id, from_date, to_date, current_user)


@app.get("/api/billing-trans-inventory", summary="[Alias] List inventory line rows from billing_trans_inventory", tags=["invoice"])
def api_list_billing_trans_inventory(
    account_code: str,
    retail_code: str,
    limit: int = 2000,
    offset: int = 0,
    invoice_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    return list_billing_trans_inventory(account_code, retail_code, limit, offset, invoice_id, from_date, to_date, current_user)

@app.get("/billing-payments", summary="Get payment data from billing_paymode (strict scoped)", tags=["invoice"])
def get_billing_payments(
    account_code: str,
    retail_code: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Fetch payment data strictly scoped by account_code + retail_code from billing_paymode.

    Changes (2025-11-07):
    - Removed fallback logic that returned broader (account-only or ALL) records.
    - Ensures enrichment lookups (master payment mode tables) also respect account/retail when columns exist.
    - Returns empty data set if no exact scoped rows found.
    """
    from invoice import _get_paymode_table, _get_master_payment_modes_table
    from sqlalchemy import select, and_
    from datetime import datetime, timedelta

    try:
        pay_tbl = _get_paymode_table()
        if pay_tbl is None:
            return {"success": False, "message": "billing_paymode table not available", "data": []}

        with engine.begin() as conn:
            # Strict filter by both account & retail
            conds = [
                pay_tbl.c.account_code == account_code,
                pay_tbl.c.retail_code == retail_code
            ]
            # Optional date filters if columns exist
            date_col = None
            for cname in ['created_at', 'payment_date', 'updated_at', 'date']:
                if cname in pay_tbl.c.keys():
                    date_col = getattr(pay_tbl.c, cname)
                    break
            if date_col is not None:
                # Expecting from_date/to_date as 'YYYY-MM-DD'
                # Use raw column comparisons (index-friendly) with an inclusive day range.
                if from_date:
                    try:
                        from_dt = datetime.strptime(from_date, '%Y-%m-%d')
                    except Exception:
                        from_dt = from_date
                    conds.append(date_col >= from_dt)
                if to_date:
                    try:
                        to_dt_exclusive = datetime.strptime(to_date, '%Y-%m-%d') + timedelta(days=1)
                        conds.append(date_col < to_dt_exclusive)
                    except Exception:
                        conds.append(date_col <= to_date)

            stmt = select(pay_tbl).where(and_(*conds)).order_by(
                getattr(pay_tbl.c, 'created_at', getattr(pay_tbl.c, 'updated_at', getattr(pay_tbl.c, 'billing_id'))).desc()
            )

            rows = [dict(r._mapping) for r in conn.execute(stmt)]
            logger.info(f"[BILLING_PAYMENTS] Scoped fetch rows={len(rows)} account={account_code} retail={retail_code}")

            # Enhance with payment mode names (single batched lookup)
            if rows:
                missing_mode_ids = {
                    r.get('payment_mode_id')
                    for r in rows
                    if r.get('payment_mode_id') not in (None, '', 0, '0') and not r.get('payment_method')
                }

                if missing_mode_ids:
                    pm_tbl = _get_master_payment_modes_table()
                    if pm_tbl is not None:
                        pm_id_col = None
                        for cname in ['payment_mode_id', 'payment_id', 'id']:
                            if cname in pm_tbl.c.keys():
                                pm_id_col = getattr(pm_tbl.c, cname)
                                break

                        name_col = None
                        for cname in ['payment_mode_name', 'paymode_name', 'name']:
                            if cname in pm_tbl.c.keys():
                                name_col = getattr(pm_tbl.c, cname)
                                break

                        if name_col is not None and pm_id_col is not None:
                            pm_conds = [pm_id_col.in_(list(missing_mode_ids))]
                            if 'account_code' in pm_tbl.c.keys():
                                pm_conds.append(pm_tbl.c.account_code == account_code)
                            if 'retail_code' in pm_tbl.c.keys():
                                pm_conds.append(pm_tbl.c.retail_code == retail_code)

                            pm_stmt = select(pm_id_col, name_col).where(and_(*pm_conds))
                            pm_rows = conn.execute(pm_stmt).fetchall()
                            pm_map = {
                                str(r[0]): (str(r[1]) if r[1] not in (None, '') else '')
                                for r in pm_rows
                            }

                            if pm_map:
                                for row in rows:
                                    mode_id = row.get('payment_mode_id')
                                    if mode_id in (None, '', 0, '0') or row.get('payment_method'):
                                        continue
                                    name = pm_map.get(str(mode_id))
                                    if name:
                                        row['payment_method'] = name

            return {
                "success": True,
                "count": len(rows),
                "data": rows,
                "query_info": {"account_code": account_code, "retail_code": retail_code, "from_date": from_date, "to_date": to_date}
            }

    except Exception as e:
        logger.error(f"[BILLING_PAYMENTS] Error: {e}")
        return {"success": False, "message": str(e), "data": []}

@app.get("/api/billing-payments", summary="[Alias] Get payment data from billing_paymode", tags=["invoice"])
def get_billing_payments_alias(
    account_code: str,
    retail_code: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Alias endpoint for frontend /api compatibility."""
    return get_billing_payments(account_code, retail_code, from_date, to_date, current_user)


@app.get("/customer-wallet-ledger", summary="Get customer wallet ledger for credit transaction history", tags=["invoice"])
def get_customer_wallet_ledger_endpoint(
    customer_id: int,
    account_code: str,
    retail_code: str,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    """Get customer wallet ledger data showing credit transaction history.
    
    Args:
        customer_id: Customer ID to fetch wallet data for
        account_code: Account code for scoping
        retail_code: Retail code for scoping  
        limit: Maximum number of records to return (default 50)
    
    Returns:
        Customer wallet transaction history with balance information
    """
    return get_customer_wallet_ledger(customer_id, account_code, retail_code, limit)


@app.get("/api/customer-wallet-ledger", summary="[Alias] Get customer wallet ledger", tags=["invoice"])  
def get_customer_wallet_ledger_alias(
    customer_id: int,
    account_code: str,
    retail_code: str,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    """Alias endpoint for frontend /api compatibility."""
    return get_customer_wallet_ledger(customer_id, account_code, retail_code, limit)


class WalletPaymentCreate(BaseModel):
    customer_id: int
    amount: float
    payment_mode: str
    account_code: str
    retail_code: str
    notes: Optional[str] = None


@app.post("/customer-wallet-payment", summary="Record credit payment in wallet ledger", tags=["invoice"])
def post_customer_wallet_payment(payload: WalletPaymentCreate, current_user: User = Depends(get_current_user)):
    # Reduce master_customer.customer_credit and also insert wallet ledger PAYMENT.
    from invoice import _record_customer_credit_payment
    return _record_customer_credit_payment(
        customer_id=payload.customer_id,
        amount=payload.amount,
        payment_mode=payload.payment_mode,
        account_code=payload.account_code,
        retail_code=payload.retail_code,
        notes=payload.notes,
        username=current_user.username,
    )


@app.post("/api/customer-wallet-payment-ledger", summary="[Legacy Alias] Record credit payment (do not use)", tags=["invoice"])
def post_customer_wallet_payment_alias(payload: WalletPaymentCreate, current_user: User = Depends(get_current_user)):
    # Kept only for backward compatibility; prefer /api/customer-wallet-payment.
    from invoice import _record_customer_credit_payment
    return _record_customer_credit_payment(
        customer_id=payload.customer_id,
        amount=payload.amount,
        payment_mode=payload.payment_mode,
        account_code=payload.account_code,
        retail_code=payload.retail_code,
        notes=payload.notes,
        username=current_user.username,
    )


# Appointment Transactions endpoints
@app.post("/appointment-transactions", summary="Create appointment transaction lines", tags=["appointment"])
def create_appointment_transactions_endpoint(payload: AppointmentTransactionBulkCreate, current_user: User = Depends(get_current_user)):
    return create_appointment_transactions(payload, current_user.username)

@app.get("/appointment-transactions/{appointment_id}", summary="Get appointment transaction lines", tags=["appointment"])
def get_appointment_transactions_endpoint(appointment_id: str, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return get_appointment_transactions(appointment_id, account_code, retail_code)

@app.put("/appointment-transactions/{appointment_id}", summary="Update appointment transaction lines", tags=["appointment"])
def update_appointment_transactions_endpoint(appointment_id: str, payload: AppointmentTransactionUpdate, account_code: Optional[str] = None, retail_code: Optional[str] = None, current_user: User = Depends(get_current_user)):
    return update_appointment_transactions(appointment_id, payload.update_fields, current_user.username, account_code, retail_code)


@app.get("/appointment-transactions", summary="List appointment transactions", tags=["appointment"])
def list_appointment_transactions_endpoint(
    account_code: str,
    retail_code: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    current_user: User = Depends(get_current_user),
):
    eff_from = from_date or fromdate
    eff_to = to_date or todate
    return list_appointment_transactions(account_code, retail_code, eff_from, eff_to)




@app.get("/debug/billing-trans-summary-metadata", tags=["debug"])
def debug_billing_trans_summary_metadata(current_user: User = Depends(get_current_user)):
    """Return reflection metadata for billing_trans_summary to aid debugging (temporary)."""
    try:
        from invoice import _get_table
        tbl = _get_table()
        cols_info = []
        for c in tbl.c:
            cols_info.append({
                'name': c.name,
                'type': str(c.type),
                'nullable': c.nullable,
                'primary_key': c.primary_key,
                'default': bool(c.default is not None),
                'server_default': bool(c.server_default is not None)
            })
        return { 'success': True, 'columns': cols_info }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reflect table: {e}")


# Lightweight health endpoint to aid PaaS debugging (DB + env checks)
# Performance Dashboard Endpoints

@app.get("/api/measurements/history", tags=["measurements"])
def get_measurements_history(client_name: str, account_code: str, retail_code: str, current_user: User = Depends(get_current_user)):
    """Fetch measurement history for a specific client."""
    logger.info(f"[MEASUREMENTS_HIST] Client: {client_name}")
    try:
        from db import engine
        from sqlalchemy import text
        query = text("""
            SELECT * FROM master_performance 
            WHERE client_name = :client_name 
            AND account_code = :account_code 
            AND retail_code = :retail_code
            ORDER BY created_at DESC
        """)
        with engine.connect() as conn:
            result = conn.execute(query, {"client_name": client_name, "account_code": account_code, "retail_code": retail_code})
            rows = [dict(row._mapping) for row in result]
        return {"success": True, "data": rows}
    except Exception as e:
        logger.error(f"[MEASUREMENTS_HIST] Error fetching history: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/measurements/add", tags=["measurements"])
def add_measurement_record(req: dict = Body(...), current_user: User = Depends(get_current_user)):
    """Store new body measurements for a client."""
    logger.info(f"[MEASUREMENTS_ADD] Payload: {req}")
    try:
        from db import engine
        from sqlalchemy import text
        
        # Helper to safely parse float or None
        def safe_float(val):
            if val is None or (isinstance(val, str) and val.strip() == ""):
                return None
            try:
                return float(val)
            except (ValueError, TypeError):
                return None

        # Extract and validate basic presence
        client_name = req.get('client_name')
        if not client_name:
            return {"status": "error", "message": "client_name is required"}

        height = safe_float(req.get('height'))
        weight = safe_float(req.get('weight'))
        
        if height is None or weight is None:
            return {"status": "error", "message": "Height and Weight are required"}
        
        if height <= 0 or weight <= 0:
            return {"status": "error", "message": "Height and Weight must be positive values"}

        # Calculate BMI: Formula: weight (kg) / [height (m)]^2
        bmi = safe_float(req.get('bmi'))
        h_m = height / 100
        calc_bmi = round(weight / (h_m * h_m), 2)
        if bmi is None or bmi == 0:
            bmi = calc_bmi

        # Fallbacks for account/retail
        acc = req.get('account_code') or req.get('accountCode') or getattr(current_user, 'account_code', None)
        ret = req.get('retail_code') or req.get('retailCode') or getattr(current_user, 'retail_code', None)

        data = {
            "account_code": acc,
            "retail_code": ret,
            "client_name": client_name,
            "height": height,
            "weight": weight,
            "bmi": bmi,
            "body_fat": safe_float(req.get('body_fat')),
            "muscle_mass": safe_float(req.get('muscle_mass')),
            "created_by": req.get('created_by') or current_user.username or "admin",
            "updated_by": current_user.username or "admin"
        }
        
        logger.info(f"[MEASUREMENTS_ADD] Final data to insert: {data}")
        
        query = text("""
            INSERT INTO master_performance 
            (account_code, retail_code, client_name, height, weight, bmi, body_fat, muscle_mass, created_by, updated_by)
            VALUES 
            (:account_code, :retail_code, :client_name, :height, :weight, :bmi, :body_fat, :muscle_mass, :created_by, :updated_by)
        """)
        
        with engine.begin() as conn:
            conn.execute(query, data)
            
        return {
            "status": "success", 
            "success": True, 
            "message": "Measurement saved successfully",
            "data": data
        }
    except Exception as e:
        logger.error(f"[MEASUREMENTS_ADD] Failed: {str(e)}", exc_info=True)
        return {"status": "error", "message": f"Server error: {str(e)}"}



@app.get("/health")

def health():
    info: Dict[str, Any] = {"status": "ok", "env": {}, "db": "unknown"}
    # Report presence of common environment variables (non-sensitive echo)
    for name in ['PORT', 'HOST', 'MYSQL_HOST', 'MYSQL_DB', 'MYSQL_USER']:
        info['env'][name] = True if os.getenv(name) else False
    # Try a quick DB check
    try:
        # engine imported from db.py
        with engine.connect() as conn:
            # lightweight query
            conn.execute("SELECT 1")
        info['db'] = 'ok'
    except Exception as e:
        info['db'] = f'error: {str(e)}'
    return info


@app.get("/customer-metrics", summary="Customer visits/new/existing in date range", tags=["customer"])
@app.get("/api/customer-metrics", summary="[Alias] Customer visits/new/existing in date range", tags=["customer"])
def get_customer_metrics(
    account_code: str,
    retail_code: str,
    from_date: str,
    to_date: str,
    current_user: User = Depends(get_current_user),
):
    """Return customer visit metrics for a date range.

    Definitions (based on billed invoices):
      - customer_visits: distinct customers who have >=1 billed invoice in range
      - total_visits: total billed invoices in range (sum of visits per customer)
      - new_customers: customers whose first-ever billed invoice date falls in range
      - existing_customers: customers who billed in range AND first visit is before range

    Notes:
      - Scopes to account_code + retail_code
      - Uses billing_transactions when available
      - Date range is inclusive by day: [from_date 00:00, to_date 23:59]
    """
    # Enforce tenant scope against token (when fields exist on the user)
    try:
        u_acc = getattr(current_user, 'account_code', None)
        u_ret = getattr(current_user, 'retail_code', None)
        if u_acc and str(u_acc) != str(account_code):
            raise HTTPException(status_code=403, detail="account_code mismatch")
        if u_ret and str(u_ret) != str(retail_code):
            raise HTTPException(status_code=403, detail="retail_code mismatch")
    except HTTPException:
        raise
    except Exception:
        # If current_user lacks these fields, do not block
        pass

    from datetime import datetime, timedelta
    try:
        start_dt = datetime.strptime(str(from_date), '%Y-%m-%d')
        end_dt_exclusive = datetime.strptime(str(to_date), '%Y-%m-%d') + timedelta(days=1)
    except Exception:
        raise HTTPException(status_code=400, detail="from_date/to_date must be YYYY-MM-DD")

    # Try to use the invoice header/txn table (most reliable for customer identity)
    try:
        from invoice import _get_txn_table
        txn_tbl = _get_txn_table()
    except Exception:
        txn_tbl = None

    if txn_tbl is None:
        return {
            "success": True,
            "account_code": account_code,
            "retail_code": retail_code,
            "from_date": from_date,
            "to_date": to_date,
            "customer_visits": 0,
            "new_customers": 0,
            "existing_customers": 0,
            "total_visits": 0,
            "warning": "billing_transactions table not found",
        }

    from sqlalchemy import select, func, and_, case, cast, String

    cols = txn_tbl.c

    # Pick a usable timestamp/date column
    date_col_name = None
    for cand in ['created_at', 'updated_at', 'invoice_date', 'date', 'entry_date', 'bill_date']:
        if cand in cols.keys():
            date_col_name = cand
            break
    if not date_col_name:
        return {
            "success": True,
            "account_code": account_code,
            "retail_code": retail_code,
            "from_date": from_date,
            "to_date": to_date,
            "customer_visits": 0,
            "new_customers": 0,
            "existing_customers": 0,
            "total_visits": 0,
            "warning": "No date column found in billing_transactions",
        }
    date_col = getattr(cols, date_col_name)

    # Build a robust customer identifier expression (prefer customer_id, then phone)
    cust_exprs = []
    for name in [
        'customer_id',
        'customer_mobile', 'customer_number', 'customer_phone',
        'mobile', 'phone',
    ]:
        if name in cols.keys():
            cust_exprs.append(cast(getattr(cols, name), String))
    if not cust_exprs:
        return {
            "success": True,
            "account_code": account_code,
            "retail_code": retail_code,
            "from_date": from_date,
            "to_date": to_date,
            "customer_visits": 0,
            "new_customers": 0,
            "existing_customers": 0,
            "total_visits": 0,
            "warning": "No customer identity columns found in billing_transactions",
        }

    cust_key = func.nullif(func.trim(func.coalesce(*cust_exprs)), '')

    where_parts = [cust_key.is_not(None), date_col.is_not(None)]
    if 'account_code' in cols.keys():
        where_parts.append(cols.account_code == account_code)
    if 'retail_code' in cols.keys():
        where_parts.append(cols.retail_code == retail_code)

    # Only billed invoices (ignore hold/cancelled)
    if 'billstatus' in cols.keys():
        where_parts.append(func.upper(cols.billstatus) == 'Y')
    elif 'bill_status' in cols.keys():
        where_parts.append(func.upper(getattr(cols, 'bill_status')) == 'Y')

    visited_flag = case((and_(date_col >= start_dt, date_col < end_dt_exclusive), 1), else_=0)

    stmt = (
        select(
            cust_key.label('customer_key'),
            func.min(date_col).label('first_visit'),
            func.max(visited_flag).label('visited_in_range'),
            func.sum(visited_flag).label('visits_in_range'),
        )
        .select_from(txn_tbl)
        .where(and_(*where_parts))
        .group_by(cust_key)
    )

    customer_visits = 0
    new_customers = 0
    existing_customers = 0
    total_visits = 0

    with engine.begin() as conn:
        rows = conn.execute(stmt).fetchall()
        for r in rows:
            m = dict(r._mapping)
            visited = int(m.get('visited_in_range') or 0)
            if not visited:
                continue

            customer_visits += 1
            total_visits += int(m.get('visits_in_range') or 0)

            first_visit = m.get('first_visit')
            try:
                if first_visit is None:
                    continue
                # Handle both DATE and DATETIME values
                if isinstance(first_visit, datetime):
                    if start_dt <= first_visit < end_dt_exclusive:
                        new_customers += 1
                    elif first_visit < start_dt:
                        existing_customers += 1
                else:
                    # Likely a date object
                    start_d = start_dt.date()
                    end_d_excl = end_dt_exclusive.date()
                    if start_d <= first_visit < end_d_excl:
                        new_customers += 1
                    elif first_visit < start_d:
                        existing_customers += 1
            except Exception:
                # If DB returns strings or an unknown type, keep new/existing stable (0)
                pass

    return {
        "success": True,
        "account_code": account_code,
        "retail_code": retail_code,
        "from_date": from_date,
        "to_date": to_date,
        "customer_visits": int(customer_visits),
        "new_customers": int(new_customers),
        "existing_customers": int(existing_customers),
        "total_visits": int(total_visits),
        "source": f"billing_transactions.{date_col_name}",
    }

# --- Pydantic Schemas ---
class CreateRequest(BaseModel):
    table: str
    data: Dict[str, Any]
    auto_generate: Optional[Dict[str, Any]] = None

class UpdateRequest(BaseModel):
    table: str
    data: Dict[str, Any]


class RetailWhatsAppMessageUpdateRequest(BaseModel):
    manual_whatsappmessage: Optional[str] = None

class ReadRequest(BaseModel):
    tables: List[str]
    account_code: str
    retail_code: str

# ReadMasterRequest removed - use ReadRequest with proper authentication instead

# New: Read by booking_id request model
class ReadByBookingIdRequest(BaseModel):
    tables: List[str]
    account_code: str
    retail_code: str
    booking_id: Any

# Composite booking request (booking + optional service lines + optional payment)
class BookingCompositeRequest(BaseModel):
    booking: Dict[str, Any]
    services: Optional[List[Dict[str, Any]]] = None
    # Accept either a single payment dict or list of payment dicts from frontend
    payment: Optional[Any] = None  # normalized later to list

class BookingUpdateCompositeRequest(BaseModel):
    booking_id: Any
    booking: Dict[str, Any]
    services: Optional[List[Dict[str, Any]]] = None  # full replacement set (if provided)
    payment: Optional[Any] = None  # appended (not replacing existing payments)



# --- Endpoints ---

@app.post("/token")
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = get_user(form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    refresh_token_expires_delta = timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    access_token = create_access_token(
        data={"sub": user.username}, expires_delta=access_token_expires_delta
    )
    refresh_token = create_refresh_token(
        data={"sub": user.username}, expires_delta=refresh_token_expires_delta
    )
    now = datetime.now(timezone.utc)
    # Best-effort activity log for successful login
    try:
        _log_customer_activity(getattr(user, 'account_code', None), getattr(user, 'retail_code', None), 'login')
    except Exception:
        # never fail login on activity log issues
        logger.debug("[ACTIVITY_LOG] login insert failed", exc_info=True)
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "access_token_expires_in": int(access_token_expires_delta.total_seconds()),
        "access_token_expires_at": (now + access_token_expires_delta).isoformat(),
        "refresh_token_expires_in": int(refresh_token_expires_delta.total_seconds()),
        "refresh_token_expires_at": (now + refresh_token_expires_delta).isoformat(),
    }


# Refresh endpoint
from fastapi import Body
from pydantic import BaseModel as _BaseModel  # alias to avoid confusion with other imports

class RefreshTokenRequest(_BaseModel):
    """Request model for /refresh endpoint.

    Frontend sends JSON: {"refresh_token": "<token>"}
    Previously the endpoint expected a raw string body which caused 422 errors,
    breaking silent refresh and forcing users to re-login when the access token expired.
    """
    refresh_token: str

@app.post("/refresh")
async def refresh_token(payload: RefreshTokenRequest):
    """Exchange a valid refresh token for a new access token.

    Returns only a new access token (non-rotating refresh strategy). If you want
    to rotate refresh tokens, also issue a new refresh token here and update the
    frontend to store it.
    """
    username = verify_refresh_token(payload.refresh_token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    access_token_expires_delta = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    new_access_token = create_access_token(data={"sub": username}, expires_delta=access_token_expires_delta)
    now = datetime.now(timezone.utc)
    return {
        "access_token": new_access_token,
        "token_type": "bearer",
        "access_token_expires_in": int(access_token_expires_delta.total_seconds()),
        "access_token_expires_at": (now + access_token_expires_delta).isoformat(),
    }

class LogoutPayload(BaseModel):
    refresh_token: Optional[str] = None
    account_code: Optional[str] = None
    retail_code: Optional[str] = None

@app.post("/logout")
async def logout(request: Request, payload: Optional[LogoutPayload] = None):
    """Stateless logout endpoint.

    Attempts to identify the user via Authorization bearer token; if missing/expired,
    it tries a refresh_token provided in the body, and finally falls back to
    explicit account_code/retail_code fields if present.
    Always returns success and never blocks the client logout flow.
    """
    acc: Optional[str] = None
    ret: Optional[str] = None

    # 1) Try Authorization header (access token)
    try:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.lower().startswith('bearer '):
            token = auth_header.split()[1]
            try:
                decoded = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
                username = decoded.get('sub')
                if username:
                    u = get_user(username)
                    if u:
                        acc, ret = getattr(u, 'account_code', None), getattr(u, 'retail_code', None)
            except Exception:
                pass
    except Exception:
        pass

    # 2) Try refresh token body
    if (not acc or not ret) and payload and payload.refresh_token:
        try:
            username = verify_refresh_token(payload.refresh_token)
            if username:
                u = get_user(username)
                if u:
                    acc, ret = getattr(u, 'account_code', None), getattr(u, 'retail_code', None)
        except Exception:
            pass

    # 3) Fall back to explicit codes in the payload
    if (not acc or not ret) and payload:
        acc = acc or payload.account_code
        ret = ret or payload.retail_code

    try:
        _log_customer_activity(acc, ret, 'logout')
    except Exception:
        logger.debug("[ACTIVITY_LOG] logout insert failed", exc_info=True)
    return {"success": True}

@app.get("/users/me/")
async def read_users_me(current_user: User = Depends(get_current_user)):
    try:
        # Basic user data
        response_data = {
            "user_id": current_user.user_id,
            "username": current_user.username,
            "account_code": current_user.account_code,
            "retail_code": current_user.retail_code,
        }

        # Include retail_master details for the logged-in user's account/retail
        try:
            if engine is not None and (current_user.account_code or current_user.retail_code):
                md_rm = MetaData()
                retail_tbl = Table('retail_master', md_rm, autoload_with=engine)
                cols = {c.name: c for c in retail_tbl.columns}
                stmt = select(retail_tbl)
                conds = []
                if 'account_code' in cols and getattr(current_user, 'account_code', None):
                    conds.append(cols['account_code'] == current_user.account_code)
                if 'retail_code' in cols and getattr(current_user, 'retail_code', None):
                    conds.append(cols['retail_code'] == current_user.retail_code)
                if conds:
                    from sqlalchemy import and_ as _and
                    stmt = stmt.where(_and(*conds))
                # Prefer deterministic single row
                try:
                    if 'id' in cols:
                        stmt = stmt.order_by(cols['id'].asc())
                except Exception:
                    pass
                with engine.begin() as conn:
                    row = conn.execute(stmt).first()
                    if row is not None:
                        response_data['retail_master'] = dict(row._mapping)
                    else:
                        response_data['retail_master'] = None
        except Exception:
            logger.debug(f"[USERS/ME] retail_master lookup failed: {traceback.format_exc()}")

        # Build hierarchical modules joined with user's screen access, ordered by display_order
        try:
            if engine is not None:
                md2 = MetaData()
                modules_tbl = Table('modules', md2, autoload_with=engine)
                usa_tbl = Table('users_screen_access', md2, autoload_with=engine)
                cols = {c.name: c for c in modules_tbl.columns}
                # Determine identifier(s) to match in users_screen_access
                user_identifiers = []
                if getattr(current_user, 'user_id', None) is not None:
                    user_identifiers.append(current_user.user_id)
                if getattr(current_user, 'id', None) is not None:
                    user_identifiers.append(current_user.id)
                # Load user's access rows into a map screen_id -> flags
                from sqlalchemy import or_
                usa_map = {}
                with engine.begin() as conn:
                    if user_identifiers:
                        conds = [usa_tbl.c.user_id == uid for uid in user_identifiers]
                        usa_rows = conn.execute(select(usa_tbl).where(or_(*conds)))
                        for r in usa_rows:
                            m = dict(r._mapping)
                            sid = m.get('screen_id')
                            if sid is None:
                                continue
                            prev = usa_map.get(sid, {"can_view": 0, "can_edit": 0})
                            prev['can_view'] = 1 if (prev.get('can_view') or m.get('can_view')) else 0
                            prev['can_edit'] = 1 if (prev.get('can_edit') or m.get('can_edit')) else 0
                            usa_map[sid] = prev

                modules_tree = []
                if usa_map:
                    with engine.begin() as conn:
                        select_cols = [cols['id'], cols['name']]
                        for opt in ['route', 'icon', 'display_order', 'parent_id']:
                            if opt in cols and cols[opt] not in select_cols:
                                select_cols.append(cols[opt])
                        stmt = select(*select_cols)
                        if 'display_order' in cols:
                            stmt = stmt.order_by(cols['display_order'].asc())
                        else:
                            stmt = stmt.order_by(cols['name'].asc())
                        mod_rows = [dict(r._mapping) for r in conn.execute(stmt)]

                    by_parent = {}
                    for m in mod_rows:
                        pid = m.get('parent_id')
                        by_parent.setdefault(pid, []).append(m)
                    def sort_key(x):
                        return (x.get('display_order') if x.get('display_order') is not None else 9999, str(x.get('name') or ''))
                    for k in by_parent:
                        by_parent[k].sort(key=sort_key)

                    parents = by_parent.get(None, [])
                    for p in parents:
                        pid = p.get('id')
                        children_all = by_parent.get(pid, [])
                        children_in = []
                        for c in children_all:
                            cid = c.get('id')
                            if cid in usa_map:
                                children_in.append({
                                    'id': cid,
                                    'name': c.get('name'),
                                    'route': c.get('route'),
                                    'icon': c.get('icon'),
                                    'display_order': c.get('display_order'),
                                    'can_view': 1 if usa_map[cid].get('can_view') else 0,
                                    'can_edit': 1 if usa_map[cid].get('can_edit') else 0,
                                })
                        parent_has_access = pid in usa_map or len(children_in) > 0
                        if parent_has_access:
                            modules_tree.append({
                                'id': pid,
                                'name': p.get('name'),
                                'route': p.get('route'),
                                'icon': p.get('icon'),
                                'display_order': p.get('display_order'),
                                'can_view': 1 if usa_map.get(pid, {}).get('can_view') else 0,
                                'can_edit': 1 if usa_map.get(pid, {}).get('can_edit') else 0,
                                'children': children_in,
                            })

                response_data['modules'] = modules_tree
        except Exception:
            logger.debug(f"[USERS/ME] failed to build modules tree: {traceback.format_exc()}")
        logger.info(f"[USERS/ME] Success | User: {current_user.username}")
        return response_data
    except Exception as e:
        logger.error(f"[USERS/ME] Error for user {current_user.username}: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to fetch user data")


def _create_appointment_transaction_from_appointment(appointment_data: Dict[str, Any], username: str):
    """Helper function to create appointment transaction records from appointment data."""
    try:
        # Extract necessary data from appointment
        appointment_id = appointment_data.get('appointment_id')
        if not appointment_id:
            logger.warning("[APPT_TRANS_AUTO] No appointment_id found, skipping transaction creation")
            return
        
        account_code = appointment_data.get('account_code')
        retail_code = appointment_data.get('retail_code')
        customer_name = appointment_data.get('customer_name', '')
        customer_phone = appointment_data.get('customer_phone')
        
        # Handle customer phone conversion
        customer_mobile = None
        if customer_phone:
            try:
                phone_str = str(customer_phone).replace('+', '').replace('-', '').replace(' ', '')
                customer_mobile = int(phone_str) if phone_str.isdigit() else None
            except (ValueError, TypeError):
                customer_mobile = None
        
        # Get staff information
        employee_id = str(appointment_data.get('staff_id', ''))
        employee_name = appointment_data.get('staff_name', '')
        employee_percent = float(appointment_data.get('staff_markup_percent', 0))
        
        # Try to get employee level from database
        employee_level = ""
        if employee_id and account_code and retail_code:
            try:
                # Look up employee details from master_employee table
                with engine.begin() as emp_conn:
                    emp_metadata = MetaData()
                    emp_metadata.reflect(bind=engine)
                    if 'master_employee' in emp_metadata.tables:
                        emp_table = emp_metadata.tables['master_employee']
                        emp_stmt = select(emp_table).where(
                            emp_table.c.id == employee_id,
                            emp_table.c.account_code == account_code,
                            emp_table.c.retail_code == retail_code
                        )
                        emp_result = emp_conn.execute(emp_stmt).first()
                        if emp_result:
                            # Try common column names for employee level
                            level_columns = ['level', 'employee_level', 'designation', 'position', 'role']
                            for col in level_columns:
                                if hasattr(emp_result, col) and getattr(emp_result, col):
                                    employee_level = str(getattr(emp_result, col))
                                    break
                            # If no level found, use a default based on markup
                            if not employee_level:
                                if employee_percent >= 20:
                                    employee_level = "Senior"
                                elif employee_percent >= 10:
                                    employee_level = "Intermediate"
                                else:
                                    employee_level = "Junior"
            except Exception as e:
                logger.warning(f"[APPT_TRANS_AUTO] Failed to lookup employee level: {e}")
                # Fallback based on markup percentage
                if employee_percent >= 20:
                    employee_level = "Senior"
                elif employee_percent >= 10:
                    employee_level = "Intermediate"
                else:
                    employee_level = "Junior"
        
        # Get membership information
        membership_discount_from_data = float(appointment_data.get('membership_discount', 0))
        membership_discount_percent = float(appointment_data.get('membership_discount_percent', 0))
        
        logger.info(f"[APPT_TRANS_AUTO] Processing appointment {appointment_id}: employee_level='{employee_level}', employee_percent={employee_percent}%, membership_discount_percent={membership_discount_percent}%, membership_discount_amount=₹{membership_discount_from_data}")
        
        # Parse services from appointment data
        services_data = appointment_data.get('services', [])
        if isinstance(services_data, str):
            import json
            try:
                services_data = json.loads(services_data)
            except:
                services_data = []
        
        if not isinstance(services_data, list):
            services_data = []
        
        # Get pricing information
        services_total = float(appointment_data.get('services_total', 0))
        discount = float(appointment_data.get('discount', 0))
        tax_rate = float(appointment_data.get('tax_rate', 0))
        tax_amount = float(appointment_data.get('tax_amount', 0))
        cgst_amount = float(appointment_data.get('cgst_amount', 0))
        sgst_amount = float(appointment_data.get('sgst_amount', 0))
        total_amount = float(appointment_data.get('total_amount', 0))
        membership_discount = float(appointment_data.get('membership_discount', 0))
        
        # Create transaction lines for each service
        transaction_lines = []
        
        if services_data:
            for service in services_data:
                if not isinstance(service, dict):
                    continue
                
                service_name = service.get('name', 'Unknown Service')
                base_price = float(service.get('base_price', 0))
                unit_price = float(service.get('price', 0))
                quantity = float(service.get('quantity', 1))
                markup_percent = float(service.get('markup_percent', 0))
                markup_amount = float(service.get('markup_amount_per_unit', 0))
                service_tax_rate = float(service.get('tax_rate', 0))
                service_cgst = float(service.get('cgst_amount', 0))
                service_sgst = float(service.get('sgst_amount', 0))
                service_tax_amount = float(service.get('tax_amount', 0))
                
                # Calculate subtotal for this service
                subtotal = unit_price * quantity
                
                # Calculate discount allocation for this service
                service_discount = 0
                if services_total > 0:
                    discount_ratio = subtotal / services_total
                    service_discount = discount * discount_ratio
                
                # Calculate membership discount allocation for this service
                service_membership_discount = 0
                if services_total > 0:
                    membership_ratio = subtotal / services_total
                    service_membership_discount = membership_discount * membership_ratio
                
                # Calculate taxable amount
                taxable_amount = max(subtotal - service_discount, 0)
                
                transaction_line = AppointmentTransactionCreate(
                    account_code=account_code,
                    retail_code=retail_code,
                    customer_id=str(appointment_data.get('customer_id', '')),
                    customer_name=customer_name,
                    customer_mobile=customer_mobile,
                    appointment_id=appointment_id,
                    employee_id=employee_id,
                    employee_name=employee_name,
                    employee_level=employee_level,
                    employee_percent=employee_percent,
                    base_price=base_price,
                    markup_percent_applied=markup_percent,
                    markup_amount_per_unit=markup_amount,
                    unit_price=unit_price,
                    quantity=quantity,
                    subtotal=subtotal,
                    discount_amount=service_discount,
                    taxable_amount=taxable_amount,
                    tax_rate_percent=service_tax_rate,
                    membership_discount=service_membership_discount,
                    tax_amount=service_tax_amount,
                    total_cgst=service_cgst,
                    total_sgst=service_sgst,
                    total_igst=0,  # Not used in this system
                    total_vat=0,   # Not used in this system
                    created_by=username,
                    updated_by=username
                )
                
                transaction_lines.append(transaction_line)
        else:
            # No services found, create a single line with appointment totals
            transaction_line = AppointmentTransactionCreate(
                account_code=account_code,
                retail_code=retail_code,
                customer_id=str(appointment_data.get('customer_id', '')),
                customer_name=customer_name,
                customer_mobile=customer_mobile,
                appointment_id=appointment_id,
                employee_id=employee_id,
                employee_name=employee_name,
                employee_level=employee_level,
                employee_percent=employee_percent,
                base_price=services_total,
                markup_percent_applied=0,
                markup_amount_per_unit=0,
                unit_price=services_total,
                quantity=1,
                subtotal=services_total,
                discount_amount=discount,
                taxable_amount=max(services_total - discount, 0),
                tax_rate_percent=tax_rate,
                membership_discount=membership_discount_from_data,
                tax_amount=tax_amount,
                total_cgst=cgst_amount,
                total_sgst=sgst_amount,
                total_igst=0,
                total_vat=0,
                created_by=username,
                updated_by=username
            )
            
            transaction_lines.append(transaction_line)
        
        # Create the transaction records if we have lines
        if transaction_lines:
            bulk_payload = AppointmentTransactionBulkCreate(lines=transaction_lines)
            result = create_appointment_transactions(bulk_payload, username)
            
            logger.info(f"[APPT_TRANS_AUTO] Created {len(transaction_lines)} transaction lines for appointment {appointment_id}")
            return result
        else:
            logger.warning(f"[APPT_TRANS_AUTO] No transaction lines created for appointment {appointment_id}")
            return None
            
    except Exception as e:
        logger.error(f"[APPT_TRANS_AUTO] Error creating appointment transactions: {str(e)}")
        raise e


@app.post("/create")
def create_row(req: CreateRequest, current_user: User = Depends(get_current_user)):
    logger.info(f"[CREATE] Endpoint: /create | Table: {req.table} | Data: {mask_sensitive(req.data)}")
    try:
        # Normalize optional date fields for customer master
        try:
            if req.table == "master_customer" and isinstance(req.data, dict):
                for k in ("birthday_date", "anniversary_date"):
                    if k in req.data and req.data.get(k) == "":
                        req.data[k] = None
        except Exception:
            pass

        # Normalize optional numeric fields for employee master
        try:
            if req.table == "master_employee" and isinstance(req.data, dict):
                if "price_markup_percent" in req.data:
                    v = req.data.get("price_markup_percent")
                    if v in ("", None):
                        req.data["price_markup_percent"] = 0
                    else:
                        try:
                            req.data["price_markup_percent"] = float(v)
                        except Exception:
                            req.data["price_markup_percent"] = 0
        except Exception:
            pass
        resp = crud_create_row(req.table, req.data, req.auto_generate)
        logger.info(f"[CREATE] Success | Table: {req.table} | Status: {resp.get('success')} | Inserted ID: {resp.get('inserted_id')}")
        
        # Auto-create appointment transaction records when appointment is created
        if req.table == "master_appointment" and resp.get('success'):
            try:
                _create_appointment_transaction_from_appointment(req.data, current_user.username)
            except Exception as trans_e:
                logger.warning(f"[CREATE] Failed to create appointment transactions for appointment: {str(trans_e)}")
                # Don't fail the main appointment creation, just log the warning
        
        return resp
    except Exception as e:
        logger.error(f"[CREATE] Error | Table: {req.table} | Data: {mask_sensitive(req.data)} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise


# --- New: Dedicated user creation endpoint ---
class CreateUserRequest(BaseModel):
    username: str = Field(..., min_length=3)
    # Make password optional so the same model can be used for update where password may be omitted
    password: Optional[str] = Field(None, min_length=3)
    account_code: str = Field(...)
    retail_code: str = Field(...)
    # Frontend may send 'email' but the DB column is commonly named 'email_id'
    email: Optional[str] = None
    full_name: Optional[str] = None
    # Optional fields to map directly to DB columns
    role_id: Optional[int] = None
    phone_number: Optional[str] = None
    # User status (active/inactive)
    is_active: Optional[bool] = None
    # Also accept 'status' from clients (boolean); will be normalized to 1/0 in DB
    status: Optional[bool] = None
    screens: Optional[List[Dict[str, Any]]] = None


class UsernameCheckRequest(BaseModel):
    username: str
    account_code: str
    retail_code: str

async def get_current_user_optional(token: Optional[str] = Depends(lambda: None)):
    """Optional authentication - returns None if no token or invalid token"""
    try:
        from fastapi.security import OAuth2PasswordBearer
        from auth import get_current_user, oauth2_scheme
        if token:
            return await get_current_user(token)
        return None
    except:
        return None

@app.post("/check-username")
def check_username_availability(req: UsernameCheckRequest):
    """Check if a username is available for the given account/retail code."""
    try:
        # Use direct SQL query to check username availability
        users_table = Table('users', metadata, autoload_with=engine)
        
        stmt = select(func.count(users_table.c.username)).where(
            and_(
                users_table.c.username == req.username,
                users_table.c.account_code == req.account_code,
                users_table.c.retail_code == req.retail_code
            )
        )
        
        with engine.begin() as conn:
            result = conn.execute(stmt)
            count = result.scalar() or 0
        
        if count > 0:
            return {
                "success": True,
                "data": {
                    "available": False,
                    "message": "Username already exists"
                }
            }
        else:
            return {
                "success": True,
                "data": {
                    "available": True,
                    "message": "Username is available"
                }
            }
            
    except Exception as e:
        logger.error(f"[CHECK_USERNAME] Error checking username {req.username}: {str(e)}")
        return {
            "success": False,
            "message": "Error checking username availability",
            "data": {
                "available": False,
                "message": "Unable to verify username availability"
            }
        }

@app.post("/users", status_code=201)
def create_user(req: CreateUserRequest, current_user: Optional[User] = Depends(get_current_user)):
    """Create a user row. This endpoint replaces using the generic /create for users.

    - Accepts username, password (plain), account_code, retail_code and optional fields.
    - Hashes password and uses `crud_create.create_row` to insert into `users` table.
    - Returns inserted_id and generated user_id on success.
    """
    # Build payload matching database columns; the crud_create will hash password if needed
    # Password is required for creation, but optional for update flows that reuse this model.
    if not req.password:
        raise HTTPException(status_code=400, detail="password is required when creating a user")
    payload = {
        "username": req.username,
        "hashed_password": req.password,  # crud_create will hash if not already a bcrypt hash
        "account_code": req.account_code,
        "retail_code": req.retail_code,
    }
    # Map Pydantic fields into DB column names. crud_create will filter unknown columns.
    if req.email:
        # many schemas use email_id as the users table column name
        payload["email_id"] = req.email
    if req.full_name:
        payload["full_name"] = req.full_name
    if getattr(req, 'role_id', None) is not None:
        payload['role_id'] = req.role_id
    if getattr(req, 'phone_number', None) is not None:
        payload['phone_number'] = req.phone_number
    # Normalize and map active/status flags if provided (prefer explicit 'status' then 'is_active')
    try:
        status_val: Optional[int] = None
        if getattr(req, 'status', None) is not None:
            status_val = 1 if bool(req.status) else 0
        elif getattr(req, 'is_active', None) is not None:
            status_val = 1 if bool(req.is_active) else 0
        if status_val is not None:
            # Set all common variants; crud_create will drop unknown columns
            payload['status'] = status_val
            payload['is_active'] = status_val
            payload['active'] = status_val
    except Exception:
        pass

    logger.info(f"[CREATE_USER] Creating user: {req.username} | account={req.account_code} retail={req.retail_code}")
    try:
        # Before create, try to limit status keys to actual columns if possible
        try:
            users_tbl = Table('users', MetaData(), autoload_with=engine)
            cols_set = set(users_tbl.c.keys())
            # If both 'status' and 'is_active' present but not in table, prefer available ones
            if 'status' in payload or 'is_active' in payload or 'active' in payload:
                val = None
                for k in ('status', 'is_active', 'active'):
                    if k in payload:
                        val = payload[k]
                        break
                # Rebuild with only actual columns
                for k in ('status', 'is_active', 'active'):
                    if k in payload and k not in cols_set:
                        payload.pop(k, None)
                if val is not None:
                    if 'status' in cols_set:
                        payload['status'] = val
                    if 'is_active' in cols_set:
                        payload['is_active'] = val
                    if 'active' in cols_set:
                        payload['active'] = val
        except Exception:
            pass
        result = crud_create_row('users', payload, None)
        logger.info(f"[CREATE_USER] Success | username={req.username} | result={result}")
        # Ensure user_id generated as <retail_code>U<id> in case crud_create didn't set it
        try:
            inserted_id = result.get('inserted_id')
            if inserted_id and engine is not None:
                generated_user_id = f"{req.retail_code}U{inserted_id}"
                try:
                    with engine.begin() as conn:
                        # Only update if user_id is null or empty to avoid overwriting
                        update_sql = text("UPDATE users SET user_id = :user_id WHERE id = :id AND (user_id IS NULL OR user_id = '')")
                        res_upd = conn.execute(update_sql, user_id=generated_user_id, id=inserted_id)
                        logger.info(f"[CREATE_USER] user_id update attempted for users.id={inserted_id}; generated={generated_user_id}; rowcount={getattr(res_upd, 'rowcount', 'n/a')}")
                except Exception as e:
                    logger.debug(f"[CREATE_USER] Failed to update user_id for id={inserted_id}: {e}")
        except Exception:
            logger.debug("[CREATE_USER] Skipping user_id generation fallback")
        # If screens were provided, insert them into users_screen_access using numeric inserted_id
        try:
            inserted_id = result.get('inserted_id')
            # Prefer the canonical string user_id if the create call returned it
            user_identifier = result.get('user_id')
            # If numeric inserted_id missing, try to look it up by username + account_code + retail_code
            if (not inserted_id) and engine is not None:
                try:
                    users_tbl = Table('users', MetaData(), autoload_with=engine)
                    with engine.begin() as conn:
                        sel = select(users_tbl.c.id).where(
                            and_(
                                getattr(users_tbl.c, 'username') == req.username,
                                getattr(users_tbl.c, 'account_code') == req.account_code,
                                getattr(users_tbl.c, 'retail_code') == req.retail_code,
                            )
                        ).limit(1)
                        found = conn.execute(sel).first()
                        if found:
                            inserted_id = found[0]
                            logger.info(f"[CREATE_USER] Resolved inserted_id by lookup: {inserted_id}")
                except Exception as e:
                    logger.debug(f"[CREATE_USER] Could not resolve inserted_id by lookup: {e}")

            # If we don't yet have the string user_id, try to fetch it from the users row by id
            if not user_identifier and inserted_id and engine is not None:
                try:
                    users_tbl = Table('users', MetaData(), autoload_with=engine)
                    with engine.begin() as conn:
                        sel_uid = select(users_tbl.c.user_id).where(users_tbl.c.id == inserted_id).limit(1)
                        found_uid = conn.execute(sel_uid).first()
                        if found_uid and found_uid[0]:
                            user_identifier = found_uid[0]
                            logger.info(f"[CREATE_USER] Resolved user_identifier by id lookup: {user_identifier}")
                except Exception as e:
                    logger.debug(f"[CREATE_USER] Could not resolve user_identifier by id lookup: {e}")

            if req.screens and inserted_id and engine is not None:
                # Avoid full Table autoload (which can trigger FK reflection issues on some MySQL setups).
                # Use the inspector to get column names and run a parameterized INSERT via text().
                try:
                    from sqlalchemy.engine import Inspector
                    insp = sqlalchemy_inspect(engine)
                    cols_info = insp.get_columns('users_screen_access')
                    allowed_cols = {c['name'] for c in cols_info}
                    now = datetime.utcnow()
                    rows = []
                    # ensure we prefer the string user_id; fallback to constructed or numeric id if necessary
                    if not user_identifier and inserted_id and req.retail_code:
                        user_identifier = f"{req.retail_code}U{inserted_id}"

                    for s in req.screens:
                        cand = {
                            'user_id': user_identifier if user_identifier is not None else inserted_id,
                            'screen_id': int(s.get('screen_id')) if s.get('screen_id') is not None else None,
                            'can_view': 1 if s.get('can_view') else 0,
                            'can_edit': 1 if s.get('can_edit') else 0,
                            'created_at': now,
                            'updated_at': now,
                        }
                        row = {k: v for k, v in cand.items() if k in allowed_cols and v is not None}
                        if 'screen_id' in row:
                            rows.append(row)

                    if rows:
                        # Build parameterized INSERT SQL dynamically using available columns
                        col_list = sorted(rows[0].keys())
                        placeholders = ','.join([f":{c}" for c in col_list])
                        col_names = ','.join(col_list)
                        insert_sql = text(f"INSERT INTO users_screen_access ({col_names}) VALUES ({placeholders})")
                        with engine.begin() as conn:
                            for r in rows:
                                # pass the mapping as a single parameter (SQLAlchemy Connection.execute
                                # expects positional parameters or a mapping, not arbitrary kwargs)
                                conn.execute(insert_sql, r)
                        logger.info(f"[CREATE_USER] Inserted {len(rows)} users_screen_access rows for users.id={inserted_id}")
                except Exception as e:
                    logger.error(f"[CREATE_USER] Failed to insert screen access rows: {e} | Trace: {traceback.format_exc()}")
        except Exception:
            # non-fatal: log and continue
            logger.exception("[CREATE_USER] Error while handling screen access insertion")
        return result
    except Exception as e:
        logger.error(f"[CREATE_USER] Failed creating user {req.username}: {str(e)} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/update")
def update_row(req: UpdateRequest, current_user: User = Depends(get_current_user)):
    logger.info(f"[UPDATE] Endpoint: /update | Table: {req.table} | Data: {mask_sensitive(req.data)}")
    try:
        # Normalize optional date fields for customer master
        try:
            if req.table == "master_customer" and isinstance(req.data, dict):
                for k in ("birthday_date", "anniversary_date"):
                    if k in req.data and req.data.get(k) == "":
                        req.data[k] = None
        except Exception:
            pass

        # Normalize optional numeric fields for employee master
        try:
            if req.table == "master_employee" and isinstance(req.data, dict):
                if "price_markup_percent" in req.data:
                    v = req.data.get("price_markup_percent")
                    if v in ("", None):
                        req.data["price_markup_percent"] = 0
                    else:
                        try:
                            req.data["price_markup_percent"] = float(v)
                        except Exception:
                            req.data["price_markup_percent"] = 0
        except Exception:
            pass
        resp = crud_update_row(metadata, req.table, req.data)
        logger.info(f"[UPDATE] Success | Table: {req.table} | Status: {resp.get('success')} | Updated Rows: {resp.get('updated_rows')}")
        return resp
    except Exception as e:
        logger.error(f"[UPDATE] Error | Table: {req.table} | Data: {mask_sensitive(req.data)} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise


@app.put("/retail-master/whatsapp-message")
def update_retail_master_whatsapp_message(
    req: RetailWhatsAppMessageUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    """Update the WhatsApp message template stored in retail_master.manual_whatsappmessage.

    Uses the authenticated user's account_code and retail_code.
    """
    acc = getattr(current_user, 'account_code', None)
    ret = getattr(current_user, 'retail_code', None)
    if not acc or not ret:
        raise HTTPException(status_code=400, detail="Missing account_code/retail_code in user context")

    try:
        tbl = Table('retail_master', metadata, autoload_with=engine)
    except Exception as e:
        logger.error(f"[RETAIL_MASTER] Table reflect failed: {e}")
        raise HTTPException(status_code=500, detail="Could not load retail_master schema")

    if 'manual_whatsappmessage' not in {c.name for c in tbl.columns}:
        raise HTTPException(status_code=400, detail="Column manual_whatsappmessage not found in retail_master")

    pk_cols = [c for c in tbl.columns if c.primary_key]
    pk_col = pk_cols[0] if pk_cols else (tbl.c.Id if 'Id' in tbl.c else None)
    if pk_col is None:
        raise HTTPException(status_code=400, detail="No primary key found for retail_master")

    with engine.begin() as conn:
        row = conn.execute(
            select(pk_col).where(
                and_(
                    tbl.c.account_code == acc,
                    tbl.c.retail_code == ret,
                )
            ).limit(1)
        ).first()

        if not row:
            raise HTTPException(status_code=404, detail="retail_master row not found")

        pk_value = row[0]
        message_value = None
        if req.manual_whatsappmessage is not None:
            trimmed = str(req.manual_whatsappmessage).strip()
            message_value = trimmed if trimmed else None

        result = conn.execute(
            sql_update(tbl)
            .where(
                and_(
                    pk_col == pk_value,
                    tbl.c.account_code == acc,
                    tbl.c.retail_code == ret,
                )
            )
            .values(manual_whatsappmessage=message_value)
        )

    return {"success": True, "updated_rows": int(getattr(result, 'rowcount', 0) or 0)}

@app.post("/read")
def read_rows(req: ReadRequest, current_user: User = Depends(get_current_user)):
    logger.info(f"[READ] Endpoint: /read | Tables: {req.tables} | Account_code: {req.account_code} | Retail_code: {req.retail_code}")
    try:
        resp = crud_read_rows(metadata, req.tables, req.account_code, req.retail_code)
        logger.info(f"[READ] Success | Tables: {req.tables} | Status: {resp.get('success')} | Rows: {len(resp.get('data', []))}")
        return resp
    except Exception as e:
        logger.error(f"[READ] Error | Tables: {req.tables} | Account_code: {req.account_code} | Retail_code: {req.retail_code} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise 

# /readwithoutcredentials endpoint removed - use authenticated /read endpoint instead

@app.post("/read-by-booking")
def read_rows_by_booking_id(req: ReadByBookingIdRequest, current_user: User = Depends(get_current_user)):
    """Read rows from one or more tables filtered by account_code, retail_code, and booking_id.

    Mirrors /read behavior for single vs multiple tables, but also applies a booking_id filter
    when the target table contains a 'booking_id' column (case-insensitive variants also checked).
    """
    logger.info(f"[READ_BY_BOOKING] Tables: {req.tables} | account={req.account_code} retail={req.retail_code} booking_id={req.booking_id}")
    if not req.tables:
        raise HTTPException(status_code=400, detail="At least one table must be specified.")
    try:
        local_md = MetaData()
        def reflect_table(name: str):
            return Table(name, local_md, autoload_with=engine)

        # Helper to build conditions
        def build_conditions(tbl: Table):
            cols = {c.name.lower(): c for c in tbl.columns}
            conds = []
            if 'account_code' in cols:
                conds.append(cols['account_code'] == req.account_code)
            if 'retail_code' in cols:
                conds.append(cols['retail_code'] == req.retail_code)
            # booking id filter (support a few name variants)
            for bk in ['booking_id', 'bookingid', 'bookingID']:
                if bk.lower() in cols:
                    conds.append(cols[bk.lower()] == req.booking_id)
                    break
            return conds

        if len(req.tables) == 1:
            tbl = reflect_table(req.tables[0])
            from sqlalchemy import select as sa_select, and_ as sa_and
            stmt = sa_select(*tbl.columns)
            conds = build_conditions(tbl)
            if conds:
                from sqlalchemy import and_ as _and
                stmt = stmt.where(_and(*conds))
            with engine.begin() as conn:
                result = conn.execute(stmt)
                rows = [dict(r._mapping) for r in result]
            return {"success": True, "data": rows}

        # Multiple tables: return mapping of table -> rows
        from sqlalchemy import select as sa_select, and_ as sa_and
        response_map: Dict[str, Any] = {}
        with engine.begin() as conn:
            for tname in req.tables:
                tbl = reflect_table(tname)
                stmt = sa_select(*tbl.columns)
                conds = build_conditions(tbl)
                if conds:
                    from sqlalchemy import and_ as _and
                    stmt = stmt.where(_and(*conds))
                result = conn.execute(stmt)
                rows = [dict(r._mapping) for r in result]
                response_map[tbl.name] = rows

            # Also include hallbooking_calander rows for this booking (to power invoice views)
            try:
                cal_tbl = Table('hallbooking_calander', local_md, autoload_with=engine)
                cal_cols = {c.name: c for c in cal_tbl.columns}
                cal_conds = []
                if 'account_code' in cal_cols:
                    cal_conds.append(cal_cols['account_code'] == req.account_code)
                if 'retail_code' in cal_cols:
                    cal_conds.append(cal_cols['retail_code'] == req.retail_code)
                # Build booking_id candidate list (handle INV-123 vs 123)
                candidates = [str(req.booking_id)]
                try:
                    import re as _re
                    m = _re.search(r"(\d+)", str(req.booking_id))
                    if m:
                        num = m.group(1)
                        if num not in candidates:
                            candidates.append(num)
                        inv = f"INV-{num}"
                        if inv not in candidates:
                            candidates.append(inv)
                except Exception:
                    pass
                bid_col = None
                for nm in ['booking_id', 'bookingID', 'bookingId']:
                    if nm in cal_cols:
                        bid_col = cal_cols[nm]
                        break
                if bid_col is not None:
                    from sqlalchemy import or_ as _or
                    cal_conds.append(_or(*[bid_col == v for v in candidates]))
                    cal_sel = sa_select(cal_tbl)
                    if cal_conds:
                        cal_sel = cal_sel.where(sa_and(*cal_conds))
                    cal_rows = [dict(r._mapping) for r in conn.execute(cal_sel)]
                    response_map['hallbooking_calander'] = cal_rows
            except Exception as _cal_e:
                logger.debug(f"[READ_BY_BOOKING] hallbooking_calander enrichment skipped: {_cal_e}")

            # Enrich with master_customer details for booking rows, if requested
            try:
                if 'booking' in response_map and response_map.get('booking'):
                    # Collect distinct customer_id values from booking rows
                    booking_rows = response_map.get('booking') or []
                    cust_ids = {str(r.get('customer_id')) for r in booking_rows if r.get('customer_id') not in (None, '')}
                    if cust_ids:
                        # Try to reflect master_customer
                        try:
                            customer_tbl = Table('master_customer', local_md, autoload_with=engine)
                        except Exception:
                            customer_tbl = None
                        if customer_tbl is not None:
                            from sqlalchemy import and_ as sa_and
                            cust_conds = []
                            # Scope by account/retail when columns exist
                            if 'account_code' in customer_tbl.c:
                                cust_conds.append(customer_tbl.c.account_code == req.account_code)
                            if 'retail_code' in customer_tbl.c:
                                cust_conds.append(customer_tbl.c.retail_code == req.retail_code)
                            # Match by business customer_id if present; else fall back to PK id
                            id_col = customer_tbl.c['customer_id'] if 'customer_id' in customer_tbl.c else (customer_tbl.c['id'] if 'id' in customer_tbl.c else None)
                            if id_col is not None:
                                cust_conds.append(id_col.in_(cust_ids))
                                cust_sel = sa_select(customer_tbl)
                                if cust_conds:
                                    cust_sel = cust_sel.where(sa_and(*cust_conds))
                                cust_rows = [dict(r._mapping) for r in conn.execute(cust_sel)]
                                response_map['master_customer'] = cust_rows
            except Exception as enrich_e:
                # Non-fatal enrichment error; log and continue with base response
                logger.error(f"[READ_BY_BOOKING] Customer enrichment failed: {enrich_e}")
        return {"success": True, "data": response_map}
    except Exception as e:
        logger.error(f"[READ_BY_BOOKING] Error | Tables: {req.tables} | Exception: {str(e)} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

def _search_master_customer_core(q: str, limit: int, account_code: Optional[str] = None, retail_code: Optional[str] = None, include_membership: bool = False) -> Dict[str, Any]:
    """Core search logic; tolerant of short queries and returns consistent JSON.

    Behaviour:
      - Empty or whitespace query => empty result (no error)
      - Single char allowed (useful for incremental autocomplete)
      - Numeric query: match only mobile/phone style columns (substring)
      - Alpha/mixed query: case-insensitive match on name columns; if length>=3 also include phone match
      - Dynamically selects only a lightweight subset of columns if available
    """
    q = (q or "").strip()
    limit = max(1, min(limit or 10, 50))
    if not q:
        return {"success": True, "count": 0, "data": []}

    local_md = MetaData()
    try:
        tbl = Table('master_customer', local_md, autoload_with=engine)
        membership_tbl = None
        if include_membership:
            try:
                membership_tbl = Table('master_membership', local_md, autoload_with=engine)
            except Exception:
                # If membership table doesn't exist, continue without membership data
                pass
    except Exception:
        return {"success": False, "count": 0, "data": [], "error": "master_customer table not found"}

    cols = {c.name: c for c in tbl.columns}
    from sqlalchemy import or_, func
    conditions = []
    is_numeric = q.isdigit()
    q_lower = q.lower()

    name_cols = [c for c in ['customer_name', 'full_name', 'name'] if c in cols]
    phone_cols = [c for c in ['customer_mobile', 'mobile', 'phone'] if c in cols]

    if not name_cols and not phone_cols:
        return {"success": False, "count": 0, "data": [], "error": "No searchable columns"}

    if is_numeric:
        like_pattern = f"%{q}%"
        for pc in phone_cols:
            conditions.append(cols[pc].like(like_pattern))
    else:
        name_like = f"%{q_lower}%"
        for nc in name_cols:
            conditions.append(func.lower(cols[nc]).like(name_like))
        # If query length>=3 also allow phone substring match (user might paste part of phone)
        if len(q) >= 3:
            phone_like = f"%{q}%"
            for pc in phone_cols:
                conditions.append(cols[pc].like(phone_like))

    from sqlalchemy import select as sa_select
    # Return ALL columns from master_customer table
    proj_cols = list(cols.values())

    # Ensure visit count and credit are present with expected names
    # Try to alias common variants to 'customer_visitcnt' and 'customer_credit'
    visit_col = None
    for cand in ['customer_visitcnt', 'visit_count', 'customer_visit_count', 'total_visits']:
        if cand in cols:
            visit_col = cols[cand]
            break
    credit_col = None
    for cand in ['customer_credit', 'credit_amount', 'pending_credit', 'wallet_balance']:
        if cand in cols:
            credit_col = cols[cand]
            break
    # Avoid duplicating column names in projection
    proj_names = set(getattr(c, 'name', getattr(c, 'key', None)) for c in proj_cols)
    if visit_col is not None:
        if 'customer_visitcnt' not in proj_names:
            if getattr(visit_col, 'name', '') != 'customer_visitcnt':
                proj_cols.append(visit_col.label('customer_visitcnt'))
            # else: already included by base columns
    if credit_col is not None:
        if 'customer_credit' not in proj_names:
            if getattr(credit_col, 'name', '') != 'customer_credit':
                proj_cols.append(credit_col.label('customer_credit'))
            # else: already included by base columns
    
    # Add membership columns if requested and table exists
    if include_membership and membership_tbl is not None:
        membership_cols = {c.name: c for c in membership_tbl.columns}
        # Add membership data with prefix to avoid column name conflicts
        membership_projection = ['membership_name', 'discount_percent', 'membership_details']
        for mcname in membership_projection:
            if mcname in membership_cols:
                # Use label to distinguish membership columns
                proj_cols.append(membership_cols[mcname].label(f'membership_{mcname}'))

    stmt = sa_select(*proj_cols)
    
    # Add membership join if requested and table exists
    if include_membership and membership_tbl is not None:
        stmt = stmt.select_from(
            tbl.outerjoin(membership_tbl, tbl.c.membership_id == membership_tbl.c.membership_id)
        )
    else:
        stmt = stmt.select_from(tbl)
    
    from sqlalchemy import and_ as sa_and
    filters = []
    if conditions:
        filters.append(or_(*conditions))
    # Apply scoping if columns exist and values provided
    if account_code and 'account_code' in cols:
        filters.append(cols['account_code'] == account_code)
    if retail_code and 'retail_code' in cols:
        filters.append(cols['retail_code'] == retail_code)
    if filters:
        stmt = stmt.where(sa_and(*filters))
    # Order: names first (alphabetical), then phone
    for order_col in ['customer_name', 'full_name', 'name']:
        if order_col in cols:
            stmt = stmt.order_by(cols[order_col].asc())
            break
    stmt = stmt.limit(limit)

    with engine.begin() as conn:
        results = conn.execute(stmt)
        rows = [dict(r._mapping) for r in results]
    return {"success": True, "count": len(rows), "data": rows}


from fastapi import Request
from jose import jwt, JWTError
from auth import SECRET_KEY, ALGORITHM

@app.get("/search-master-customer")
@app.get("/api/search-master-customer")  # alias to support frontend '/api' base
def search_master_customer(q: str = "", limit: int = 10, account_code: Optional[str] = None, retail_code: Optional[str] = None, include_membership: bool = False, request: Request = None):
    """Customer autocomplete search.

    Auth OPTIONAL: If an Authorization header with a valid bearer token is present it is validated; otherwise the
    search still proceeds (so typing in booking form won't break if token missing on a single keystroke request).
    This avoids UX issues where rapid requests sometimes omit headers due to race conditions on the frontend.
    """
    # Optional auth validation
    try:
        auth_header = request.headers.get('Authorization') if request else None
        if auth_header and auth_header.lower().startswith('bearer '):
            token = auth_header.split()[1]
            try:
                jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            except JWTError:
                # If an invalid token was explicitly supplied, return 401 (do not silently allow)
                raise HTTPException(status_code=401, detail="Invalid token")
        return _search_master_customer_core(q, limit, account_code, retail_code, include_membership)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[SEARCH_MASTER_CUSTOMER] Fatal error q='{q}': {e} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Search failed")


# Lightweight alias to fix frontend 404: `/customer-search`
@app.get("/customer-search", summary="Alias: search customers", tags=["customer"])
def customer_search_alias(
    q: str = "",
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None,
    include_membership: bool = True,
    limit: int = 10,
    request: Request = None
):
    """Alias endpoint for customer search used by the frontend.

    Mirrors `/search-master-customer` but under `/customer-search` path.
    """
    try:
        # Optional bearer validation (tolerant), same as core search
        auth_header = request.headers.get('Authorization') if request else None
        if auth_header and auth_header.lower().startswith('bearer '):
            token = auth_header.split()[1]
            try:
                jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            except JWTError:
                raise HTTPException(status_code=401, detail="Invalid token")
        return _search_master_customer_core(q, limit, account_code, retail_code, include_membership)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CUSTOMER_SEARCH_ALIAS] Error q='{q}': {e}")
        raise HTTPException(status_code=500, detail="Search failed")


@app.get("/customer-visit-history/{customer_id}")
def get_customer_visit_history(
    customer_id: int,
    account_code: Optional[str] = None, 
    retail_code: Optional[str] = None,
    request: Request = None
):
    """Get customer visit history from customer_visit_count table.
    
    Returns detailed visit history including visit dates, amounts spent, and summary statistics.
    """
    logger.info(f"[CUSTOMER_VISIT_HISTORY] Fetching history for customer_id={customer_id}")
    
    try:
        with engine.connect() as conn:
            # Try to get the customer_visit_count table
            local_md = MetaData()
            try:
                visit_tbl = Table('customer_visit_count', local_md, autoload_with=engine)
            except Exception:
                logger.warning("[CUSTOMER_VISIT_HISTORY] Table customer_visit_count not found")
                return {
                    "success": False,
                    "message": "Visit history table not found",
                    "customer_id": customer_id,
                    "visits": [],
                    "summary": {
                        "total_visits": 0,
                        "total_spent": 0.0,
                        "first_visit": None,
                        "last_visit": None,
                        "average_spend": 0.0
                    }
                }
            
            # Build query with optional filters
            stmt = select(visit_tbl).where(visit_tbl.c.customer_id == customer_id)
            
            if account_code:
                stmt = stmt.where(visit_tbl.c.account_code == account_code)
            if retail_code:
                stmt = stmt.where(visit_tbl.c.retail_code == retail_code)
                
            # Order by visit_date descending (most recent first)
            stmt = stmt.order_by(visit_tbl.c.visit_date.desc())
            
            result = conn.execute(stmt)
            visits = []
            total_spent = 0.0
            visit_dates = []
            
            for row in result:
                visit_data = {
                    "id": row.id,
                    "visit_date": row.visit_date.isoformat() if row.visit_date else None,
                    "total_spend": float(row.total_spend),
                    "account_code": row.account_code,
                    "retail_code": row.retail_code,
                    "created_at": row.created_at.isoformat() if row.created_at else None
                }
                # Optional: capture invoice id if present in schema
                try:
                    if 'invoice_id' in visit_tbl.c:
                        visit_data['invoice_id'] = getattr(row, 'invoice_id', None)
                    elif 'invoice_no' in visit_tbl.c:
                        visit_data['invoice_id'] = getattr(row, 'invoice_no', None)
                except Exception:
                    pass
                visits.append(visit_data)
                total_spent += float(row.total_spend)
                if row.visit_date:
                    visit_dates.append(row.visit_date)
            
            # Calculate summary statistics
            total_visits = len(visits)
            first_visit = min(visit_dates).isoformat() if visit_dates else None
            last_visit = max(visit_dates).isoformat() if visit_dates else None
            average_spend = round(total_spent / total_visits, 2) if total_visits > 0 else 0.0
            
            return {
                "success": True,
                "customer_id": customer_id,
                "visits": visits,
                "summary": {
                    "total_visits": total_visits,
                    "total_spent": round(total_spent, 2),
                    "first_visit": first_visit,
                    "last_visit": last_visit,
                    "average_spend": average_spend
                }
            }
            
    except Exception as e:
        logger.error(f"[CUSTOMER_VISIT_HISTORY] Error fetching history for customer_id={customer_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch customer visit history: {str(e)}")


@app.post("/process-license")
def process_license(license_request: dict):
    """Process license request and save to database"""
    logger.info(f"[PROCESS_LICENSE] Endpoint: /process-license | Company: {license_request.get('companyName')} | Business Types: {license_request.get('selectedBusinessTypes')}")
    
    try:
        # Process license request using simplified processor
        result = process_license_request(license_request)
        
        if result["success"]:
            logger.info(f"[PROCESS_LICENSE] Success | Company: {license_request.get('companyName')} | Company Code: {result['summary']['company_code']} | Total Businesses: {result['summary']['total_businesses']}")
            
            return {
                "success": True,
                "message": result["message"],
                "companyCode": result["summary"]["company_code"],
                "businessCodes": result["summary"]["business_codes"],
                "accountCodes": result["summary"]["account_codes"],
                "licenseKeys": result["summary"]["license_keys"],
                "retailCodes": result["summary"]["retail_codes"]
            }
        else:
            logger.error(f"[PROCESS_LICENSE] Failed | Company: {license_request.get('companyName')} | Error: {result['message']}")
            
            return {
                "success": False,
                "message": result["message"]
            }

    except Exception as e:
        logger.error(f"[EXTEND_LICENSE] Exception | Error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error extending license: {str(e)}")
           

class ExtendLicenseRequest(BaseModel):
    retail_code: Optional[str] = None
    extension_term: Optional[str] = None
    custom_expiry: Optional[Any] = None


def _normalize_extension_term(term: Optional[str]) -> Optional[str]:
    if term is None:   
        return None
    t = str(term).strip().lower()
    if not t:
        return None
    t = t.replace('_', '-').replace(' ', '-')
    # Normalize common variants to the values used by generate_license_key_with_expiry()
    mapping = {
        '7-day': '7-days',
        '7-days': '7-days',
        '15-day': '15-days',
        '15-days': '15-days',
        '1-months': '1-month',
        '1-month': '1-month',
        '3-month': '3-months',
        '3-months': '3-months',
        '6-month': '6-months',
        '6-months': '6-months',
        '1-year': '1-year',
        '1-years': '1-year',
        '2-year': '2-years',
        '2-years': '2-years',
        '3-year': '3-years',
        '3-years': '3-years',
        'custom': 'custom',
        'custom-date': 'custom',
        'customdate': 'custom',
    }
    return mapping.get(t, t)


@app.post("/retail-master/extend")
@app.put("/retail-master/extend")
@app.post("/api/retail-master/extend")
@app.put("/api/retail-master/extend")
async def extend_license_endpoint(
    payload: ExtendLicenseRequest,
    current_user: User = Depends(get_current_user)
):
    """Extend license for a retail unit.

    Accepts JSON payload:
      {"retail_code": "...", "extension_term": "1-year", "custom_expiry": "YYYY-MM-DD"}

    Notes:
      - retail_code can be omitted; it will default to the authenticated user's retail_code.
      - extension_term accepts variants like "1 year", "2-year", "6 months" etc.
    """
    data = payload.dict() if hasattr(payload, 'dict') else dict(payload)
    # Default retail_code from token if not supplied
    if not data.get('retail_code'):
        data['retail_code'] = getattr(current_user, 'retail_code', None)
    data['extension_term'] = _normalize_extension_term(data.get('extension_term'))

    logger.info(
        f"[EXTEND_LICENSE] Endpoint: /api/retail-master/extend | User: {current_user.username} | Retail: {data.get('retail_code')} | Term: {data.get('extension_term')}"
    )

    result = extend_license(data)
    if result.get("success"):
        logger.info(f"[EXTEND_LICENSE] Success | Retail: {data.get('retail_code')}")
        return result

    logger.error(
        f"[EXTEND_LICENSE] Failed | Retail: {data.get('retail_code')} | Error: {result.get('message')}"
    )
    raise HTTPException(status_code=400, detail=result.get("message") or "Failed to extend license")

@app.get("/license-summary/{company_code}")
def get_license_summary(company_code: str):
    """Get license summary for a company"""
    logger.info(f"[LICENSE_SUMMARY] Endpoint: /license-summary/{company_code}")
    
    try:
        from crud_read import read_rows
        from db import metadata
        
        # Get company details
        company_result = read_rows(metadata, ['company_master'], company_code, company_code)
        if not company_result.get('success') or not company_result.get('data'):
            raise HTTPException(status_code=404, detail="Company not found")
        
        company = company_result['data'][0] if company_result['data'] else None
        
        # Get account details
        accounts_result = read_rows(metadata, ['account_master'], company_code, company_code)
        accounts = accounts_result.get('data', []) if accounts_result.get('success') else []
        
        logger.info(f"[LICENSE_SUMMARY] Success | Company Code: {company_code} | Accounts: {len(accounts)}")
        
        return {
            "success": True,
            "company": company,
            "accounts": accounts,
            "summary": {
                "total_accounts": len(accounts),
                "business_types": list(set([acc["BusCode"] for acc in accounts])),
                "account_codes": [acc["account_code"] for acc in accounts]
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        error_msg = f"Error fetching license summary: {str(e)}"
        logger.error(f"[LICENSE_SUMMARY] Exception | Company: {company_code} | Exception: {error_msg} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)

@app.get("/admin/customers")
def get_all_customers(current_user: User = Depends(get_current_user)):
    """Get all customers (accounts) and their retail units."""
    logger.info(f"[ADMIN_CUSTOMERS] Endpoint: /admin/customers accessed by {current_user.username}")
    
    try:
        md = MetaData()
        # Use reflection to get tables
        account_tbl = Table('account_master', md, autoload_with=engine)
        retail_tbl = Table('retail_master', md, autoload_with=engine)
        users_tbl = Table('users', md, autoload_with=engine)
        
        with engine.connect() as conn:
            # Fetch all accounts
            accounts_query = select(account_tbl)
            accounts_result = conn.execute(accounts_query)
            accounts = [dict(row._mapping) for row in accounts_result]
            
            # Fetch all retails
            retails_query = select(retail_tbl)
            retails_result = conn.execute(retails_query)
            retails = [dict(row._mapping) for row in retails_result]
            
            # Fetch all users
            try:
                users_query = select(users_tbl)
                users_result = conn.execute(users_query)
                users = [dict(row._mapping) for row in users_result]
            except Exception:
                users = []

        # Nest users under retails
        users_map = {}
        for u in users:
            rc = u.get('retail_code')
            if rc:
                if rc not in users_map:
                    users_map[rc] = []
                # Safe mask
                if 'hashed_password' in u:
                    u.pop('hashed_password')
                users_map[rc].append(u)

        # Nest retails under accounts and users under retails
        retail_map = {}
        for r in retails:
            rc = r.get('retail_code')
            r['users'] = users_map.get(rc, [])
            
            ac = r.get('account_code')
            if ac:
                if ac not in retail_map:
                    retail_map[ac] = []
                retail_map[ac].append(r)
            
        for acc in accounts:
            acc['retails'] = retail_map.get(acc.get('account_code'), [])
            
        return {"success": True, "data": accounts}

    except Exception as e:
        logger.error(f"[ADMIN_CUSTOMERS] Error fetching customers: {str(e)}")
        # If tables don't exist yet, return empty list gracefully
        if "doesn't exist" in str(e) or "no such table" in str(e).lower():
             return {"success": True, "data": []}
        return {"success": False, "message": str(e)}
        logger.error(f"[LICENSE_SUMMARY] Exception | Company Code: {company_code} | Exception: {error_msg} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=error_msg)

# --- Booking Composite Endpoint ---
@app.post("/create-booking")
def create_booking(req: BookingCompositeRequest, current_user: User = Depends(get_current_user)):
    """Create a booking with optional service lines and an optional payment in a single transaction.

    The frontend currently expects a booking_id in one of several possible locations. We return multiple
    fields for compatibility: booking_id (top level), data.booking_id, and data.inserted_id.

    This endpoint attempts to gracefully detect related tables (booking_service*, booking_payment*) if present.
    If they don't exist, it will still create the booking record and return success without the extras.
    """
    # Normalize payment(s) to a list for uniform handling
    raw_payment = req.payment
    if raw_payment is None or (isinstance(raw_payment, dict) and not raw_payment):
        payments_list: List[Dict[str, Any]] = []
    elif isinstance(raw_payment, list):
        payments_list = raw_payment
    elif isinstance(raw_payment, dict):
        payments_list = [raw_payment]
    else:
        raise HTTPException(status_code=400, detail="Invalid 'payment' value; expected object or list of objects")

    logger.info(
        f"[BOOKING] Endpoint: /create-booking | booking_keys={list(req.booking.keys())} "
        f"services_count={len(req.services or [])} payments_count={len(payments_list)}"
    )

    # Helper: load a table if it exists
    def _try_load_table(name: str):
        try:
            local_md = MetaData()
            return Table(name, local_md, autoload_with=engine)
        except Exception:
            return None

    # Detect booking table name (assume 'booking')
    booking_table = _try_load_table('booking')
    if booking_table is None:
        logger.error("[BOOKING] booking table not found in database")
        raise HTTPException(status_code=500, detail="'booking' table not found in database")

    # Candidate related tables (first existing will be used)
    service_table = None
    for cand in [
        'booking_service', 'booking_services', 'booking_service_line', 'booking_service_lines',
        'booking_services_line'
    ]:
        service_table = _try_load_table(cand)
        if service_table is not None:
            break

    payment_table = None
    for cand in ['booking_payment', 'booking_payments', 'booking_payment_line', 'booking_payments_line', 'payments']:
        payment_table = _try_load_table(cand)
        if payment_table is not None:
            logger.debug(f"[BOOKING] Using payment table: {cand}")
            break

    # Preserve raw payload for fields not in booking table (e.g., phone) before sanitizing
    raw_booking_payload = dict(req.booking)
    
    # Legacy dual-slot secondary fields are deprecated; do not accept or normalize *_2 keys
    logger.info(f"[BOOKING] Raw payload keys: {list(raw_booking_payload.keys())}")
    logger.info(f"[BOOKING] Customer info in payload - phone: {raw_booking_payload.get('phone') or raw_booking_payload.get('mobile')}, name: {raw_booking_payload.get('customer_name') or raw_booking_payload.get('full_name')}")
    
    # Sanitize booking payload to include only existing columns, and replace 'PENDING' with 'ADVANCED'
    allowed_booking_cols = set(booking_table.c.keys())
    booking_data = {k: (v if str(v).strip().upper() != 'PENDING' else 'ADVANCED') for k, v in raw_booking_payload.items() if k in allowed_booking_cols}
    # Map tax exemption flag into canonical 'tax_exempt' (1/0) when the column exists
    try:
        if 'tax_exempt' in allowed_booking_cols:
            def _to_boolish_int(val: Any) -> int:
                try:
                    if val in (True, False):
                        return 1 if bool(val) else 0
                    s = str(val).strip().lower()
                    return 1 if s in ('1', 'true', 't', 'yes', 'y', 'on') else 0
                except Exception:
                    return 0
            if 'tax_exempt' in raw_booking_payload:
                booking_data['tax_exempt'] = _to_boolish_int(raw_booking_payload.get('tax_exempt'))
            elif 'taxExempt' in raw_booking_payload:
                booking_data['tax_exempt'] = _to_boolish_int(raw_booking_payload.get('taxExempt'))
            elif 'is_tax_exempt' in raw_booking_payload:
                booking_data['tax_exempt'] = _to_boolish_int(raw_booking_payload.get('is_tax_exempt'))
    except Exception:
        pass
    logger.info(f"[BOOKING] Booking table columns: {sorted(allowed_booking_cols)}")
    logger.info(f"[BOOKING] Sanitized booking data keys: {list(booking_data.keys())}")

    # Ensure required scoping / audit columns if present
    if 'account_code' not in booking_data or 'retail_code' not in booking_data:
        raise HTTPException(status_code=400, detail="booking.account_code and booking.retail_code are required")
    # Force audit fields to current user (ignore any client-sent values)
    if 'created_by' in allowed_booking_cols:
        booking_data['created_by'] = current_user.username
    if 'updated_by' in allowed_booking_cols:
        booking_data['updated_by'] = current_user.username

    try:
        result_summary: Dict[str, Any] = {"success": True, "services": [], "payments": []}
        with engine.begin() as conn:
            # --- Scoped booking_sequence_id generation ---
            try:
                if 'booking_sequence_id' in booking_table.c and booking_data.get('booking_sequence_id') in (None, ''):
                    acc_val = booking_data.get('account_code')
                    ret_val = booking_data.get('retail_code')
                    if acc_val is not None and ret_val is not None:
                        from sqlalchemy import select as sa_select, and_ as sa_and, func as sa_func
                        seq_query = sa_select(sa_func.max(booking_table.c.booking_sequence_id)).where(
                            sa_and(
                                booking_table.c.account_code == acc_val,
                                booking_table.c.retail_code == ret_val,
                                booking_table.c.booking_sequence_id.isnot(None)
                            )
                        )
                        current_max = conn.execute(seq_query).scalar()
                        next_seq = (current_max or 0) + 1
                        booking_data['booking_sequence_id'] = next_seq
                        logger.info(f"[BOOKING] Assigned booking_sequence_id={next_seq} (scope account={acc_val} retail={ret_val} max={current_max})")
            except Exception as seq_e:
                logger.error(f"[BOOKING] Failed to generate booking_sequence_id: {seq_e}")
            # --- Derive status based on payments vs totals ---
            # Rules:
            # - If paid_total <= 0 -> ADVANCED (no PENDING status in this system)
            # - Else if paid_total < total -> ADVANCED
            # - Else (paid_total >= total): if services_total > 0 -> SETTLED, else -> PAID
            computed_booking_status = None
            try:
                def _to_num(v: Any, default: float = 0.0) -> float:
                    try:
                        if v is None or v == "":
                            return default
                        return float(v)
                    except Exception:
                        return default

                # Sum services from payload if booking doesn't carry a services_total
                payload_services = req.services or []
                services_total_payload = 0.0
                for s in payload_services:
                    amt = _to_num(s.get('amount'))
                    if amt == 0.0:
                        qty = _to_num(s.get('qty') or s.get('quantity') or 1, 1.0)
                        rate = _to_num(s.get('rate') or s.get('unit_price') or s.get('price') or 0.0)
                        amt = qty * rate
                    services_total_payload += amt

                # Prefer booking-provided services_total if present
                services_total = _to_num(raw_booking_payload.get('services_total'))
                if services_total == 0.0:
                    services_total = _to_num(booking_data.get('services_total'))
                if services_total == 0.0 and payload_services:
                    services_total = services_total_payload

                # Hall amount candidates
                hall_amount = 0.0
                for key in ['hall_rate', 'hallrent', 'hall_amount', 'hall_total', 'hall']:
                    if key in raw_booking_payload:
                        hall_amount = _to_num(raw_booking_payload.get(key))
                        break
                    if key in booking_data:
                        hall_amount = _to_num(booking_data.get(key))
                        break

                discount = _to_num(raw_booking_payload.get('discount') if 'discount' in raw_booking_payload else booking_data.get('discount'))
                cgst = _to_num(raw_booking_payload.get('cgst_amount') if 'cgst_amount' in raw_booking_payload else booking_data.get('cgst_amount'))
                sgst = _to_num(raw_booking_payload.get('sgst_amount') if 'sgst_amount' in raw_booking_payload else booking_data.get('sgst_amount'))

                # Compute total: prefer provided booking totals
                total = 0.0
                for key in ['total_amount', 'grand_total', 'amount', 'total']:
                    if key in raw_booking_payload:
                        total = _to_num(raw_booking_payload.get(key))
                        break
                    if key in booking_data:
                        total = _to_num(booking_data.get(key))
                        break
                if total == 0.0:
                    sub_total = hall_amount + services_total
                    taxable = max(sub_total - discount, 0.0)
                    total = taxable + cgst + sgst

                # Sum paid from incoming payments payload; fallback to booking.advance_payment fields
                paid_total = 0.0
                for p in payments_list:
                    paid_total += _to_num(p.get('amount') or p.get('paid_amount') or p.get('payment_amount'))
                if paid_total == 0.0:
                    for key in ['advance_payment', 'advance', 'paid', 'paid_amount']:
                        if key in raw_booking_payload:
                            paid_total = _to_num(raw_booking_payload.get(key))
                            break
                        if key in booking_data:
                            paid_total = _to_num(booking_data.get(key))
                            break

                # Balance due direct from payload if provided, else compute
                balance_due = None
                for key in ['balance_due', 'balance', 'due']:
                    if key in raw_booking_payload:
                        balance_due = _to_num(raw_booking_payload.get(key))
                        break
                    if key in booking_data:
                        balance_due = _to_num(booking_data.get(key))
                        break
                if balance_due is None:
                    balance_due = max(total - paid_total, 0.0)

                # If paid_total still looks zero but a balance_due was provided along with total,
                # infer paid_total = total - balance_due (covers UIs that only send balance fields)
                if (paid_total == 0.0 or abs(paid_total) < 1e-6) and balance_due is not None and total > 0.0:
                    inferred_paid = total - balance_due
                    if inferred_paid > 0.0:
                        paid_total = inferred_paid

                # Decide status (concept):
                # - If balance_due > 0 and paid_total > 0 -> ADVANCED
                # - If balance_due <= 0 -> full paid: SETTLED when services exist else PAID
                # - Else (no payment) -> ADVANCED
                if balance_due is not None and balance_due <= 0.0:
                    computed_booking_status = 'SETTLED' if services_total > 0.0 else 'PAID'
                elif paid_total > 0.0:
                    computed_booking_status = 'ADVANCED'
                else:
                    computed_booking_status = 'ADVANCED'

                # Persist on booking payload across possible status columns
                if computed_booking_status:
                    for col_name in ['status', 'STATUS', 'booking_status', 'BookingStatus', 'payment_status', 'PaymentStatus']:
                        if col_name in booking_table.c:
                            booking_data[col_name] = computed_booking_status

                # Also persist computed paid_total and balance_due into common columns if present
                for paid_col in ['advance_payment', 'advance', 'paid', 'paid_amount']:
                    if paid_col in booking_table.c:
                        booking_data[paid_col] = paid_total
                for bal_col in ['balance_due', 'balance', 'due']:
                    if bal_col in booking_table.c:
                        booking_data[bal_col] = balance_due
            except Exception as _status_e:
                logger.debug(f"[BOOKING] Status computation skipped due to error: {_status_e}")
            # --- Auto customer creation / lookup by phone ---
            try:
                customer_table = None
                # Attempt to load master_customer table
                try:
                    customer_table = Table('master_customer', MetaData(), autoload_with=engine)
                except Exception:
                    customer_table = None
                if customer_table is not None:
                    # Determine phone value from raw payload (not only sanitized booking_data)
                    phone_field_candidates = ['phone', 'mobile', 'phone_number', 'contact_number', 'customer_phone']
                    phone_value = None
                    booking_phone_key = None
                    for fld in phone_field_candidates:
                        if fld in raw_booking_payload and raw_booking_payload[fld]:
                            phone_value = raw_booking_payload[fld]
                            booking_phone_key = fld
                            break
                    # Only proceed if we have a phone number and the customer table has a matching column
                    if phone_value:
                        customer_phone_col = None
                        for fld in phone_field_candidates:
                            if fld in customer_table.c:
                                customer_phone_col = fld
                                break
                        # Identify customer ID column
                        cust_id_col_name = None
                        for cand in ['customer_id', 'CustomerID', 'cust_id', 'id']:
                            if cand in customer_table.c:
                                cust_id_col_name = cand
                                logger.info(f"[BOOKING] Found customer ID column: {cust_id_col_name}")
                                break
                        logger.info(f"[BOOKING] Customer table columns: {list(customer_table.c.keys())}")
                        if customer_phone_col and cust_id_col_name:
                            # Build select to find existing customer with this phone (and account / retail scoping if present)
                            conditions = [customer_table.c[customer_phone_col] == phone_value]
                            if 'account_code' in customer_table.c:
                                conditions.append(customer_table.c.account_code == booking_data.get('account_code'))
                            if 'retail_code' in customer_table.c:
                                conditions.append(customer_table.c.retail_code == booking_data.get('retail_code'))
                            sel_existing = select(customer_table.c[cust_id_col_name]).where(and_(*conditions)).limit(1)
                            existing_row = conn.execute(sel_existing).first()
                            customer_id_value = None
                            if existing_row:
                                customer_id_value = existing_row[0]
                                logger.info(f"[BOOKING] Found existing customer: {customer_id_value}")
                            else:
                                # Prepare insert for new customer
                                cust_insert_data: Dict[str, Any] = {}
                                cust_insert_data[customer_phone_col] = phone_value
                                # Map possible name fields
                                name_field_candidates = ['customer_name', 'name', 'full_name']
                                for nf in name_field_candidates:
                                    if nf in raw_booking_payload and nf in customer_table.c and raw_booking_payload[nf]:
                                        cust_insert_data[nf] = raw_booking_payload[nf]
                                # Map email using payload synonyms -> first available column in table
                                email_payload_keys = ['email', 'email_id', 'email_address', 'customer_email']
                                email_col_candidates = ['email_id', 'email', 'email_address', 'customer_email']
                                email_val = next((raw_booking_payload[k] for k in email_payload_keys if k in raw_booking_payload and raw_booking_payload[k]), None)
                                if email_val:
                                    for col in email_col_candidates:
                                        if col in customer_table.c:
                                            cust_insert_data[col] = email_val
                                            break
                                # Map address fields
                                address_field_candidates = ['address', 'customer_address', 'full_address']
                                for af in address_field_candidates:
                                    if af in raw_booking_payload and af in customer_table.c and raw_booking_payload[af]:
                                        cust_insert_data[af] = raw_booking_payload[af]
                                # Map GSTIN using payload synonyms -> first available column in table
                                gst_payload_keys = ['gstin', 'gst_number', 'gst_no']
                                gst_col_candidates = ['gstin', 'gst_number', 'gst_no']
                                gst_val = next((raw_booking_payload[k] for k in gst_payload_keys if k in raw_booking_payload and raw_booking_payload[k]), None)
                                if gst_val:
                                    for col in gst_col_candidates:
                                        if col in customer_table.c:
                                            cust_insert_data[col] = gst_val
                                            break
                                # Map Aadhaar using payload synonyms -> first available column in table
                                aadhaar_payload_keys = ['aadhaar', 'aadhar', 'aadhar_no', 'aadhaar_no']
                                aadhaar_col_candidates = ['aadhaar', 'aadhar_no', 'aadhaar_no', 'aadhar']
                                aadhaar_val = next((raw_booking_payload[k] for k in aadhaar_payload_keys if k in raw_booking_payload and raw_booking_payload[k]), None)
                                if aadhaar_val:
                                    for col in aadhaar_col_candidates:
                                        if col in customer_table.c:
                                            cust_insert_data[col] = aadhaar_val
                                            break
                                # Map PAN using payload synonyms -> first available column in table
                                pan_payload_keys = ['pan', 'pan_no', 'pancard', 'pancard_no']
                                pan_col_candidates = ['pan', 'pan_no', 'pancard', 'pancard_no']
                                pan_val = next((raw_booking_payload[k] for k in pan_payload_keys if k in raw_booking_payload and raw_booking_payload[k]), None)
                                if pan_val:
                                    for col in pan_col_candidates:
                                        if col in customer_table.c:
                                            cust_insert_data[col] = pan_val
                                            break
                                # Always scope if columns exist
                                for sc in ['account_code', 'retail_code']:
                                    if sc in customer_table.c and sc in booking_data:
                                        cust_insert_data[sc] = booking_data[sc]
                                # Audit columns
                                if 'created_by' in customer_table.c:
                                    cust_insert_data['created_by'] = current_user.username
                                if 'updated_by' in customer_table.c:
                                    cust_insert_data['updated_by'] = current_user.username
                                
                                # Generate custom customer_id as max + 1 for account/retail scope
                                next_customer_id = None
                                try:
                                    # customer_id should be max(customer_id) WHERE account_code AND retail_code
                                    # Prefer values from sanitized booking_data; fallback to raw payload
                                    acc_val_in = booking_data.get('account_code') or raw_booking_payload.get('account_code')
                                    ret_val_in = booking_data.get('retail_code') or raw_booking_payload.get('retail_code')
                                    has_acc = 'account_code' in customer_table.c and bool(acc_val_in)
                                    has_ret = 'retail_code' in customer_table.c and bool(ret_val_in)
                                    max_result = None
                                    if has_acc and has_ret:
                                        # Normalize comparison on TRIM(UPPER(...)) to avoid whitespace/case mismatches
                                        acc_val = str(acc_val_in).strip().upper()
                                        ret_val = str(ret_val_in).strip().upper()
                                        max_query = select(func.max(customer_table.c[cust_id_col_name])).where(
                                            and_(
                                                func.upper(func.trim(customer_table.c.account_code)) == acc_val,
                                                func.upper(func.trim(customer_table.c.retail_code)) == ret_val,
                                                customer_table.c[cust_id_col_name].isnot(None)
                                            )
                                        )
                                        max_result = conn.execute(max_query).scalar()
                                    else:
                                        # Fallback to global max if scope not available in table or payload
                                        max_query = select(func.max(customer_table.c[cust_id_col_name])).where(
                                            customer_table.c[cust_id_col_name].isnot(None)
                                        )
                                        max_result = conn.execute(max_query).scalar()

                                    next_customer_id = (max_result or 0) + 1
                                    logger.info(
                                        f"[BOOKING] Generated customer_id (scoped by account+retail when possible): {next_customer_id} | "
                                        f"account={booking_data.get('account_code')} retail={booking_data.get('retail_code')} max={max_result}"
                                    )

                                except Exception as id_gen_error:
                                    logger.error(f"[BOOKING] Failed to generate customer_id: {id_gen_error}")
                                    next_customer_id = None
                                
                                # For customer_id column, set the calculated value directly
                                if next_customer_id:
                                    cust_insert_data[cust_id_col_name] = next_customer_id
                                    logger.info(f"[BOOKING] Customer insert data with customer_id: {cust_insert_data}")
                                else:
                                    logger.info(f"[BOOKING] Customer insert data (no customer_id): {cust_insert_data}")
                                
                                try:
                                    # Insert customer record with all data (may or may not include customer_id)
                                    ins_res = conn.execute(sql_insert(customer_table).values(**cust_insert_data))
                                    auto_id = ins_res.inserted_primary_key[0] if ins_res.inserted_primary_key else None

                                    # If we failed to generate next_customer_id, back-fill customer_id with auto PK (if available)
                                    if not next_customer_id and cust_id_col_name != 'id' and cust_id_col_name in customer_table.c:
                                        try:
                                            if 'id' in customer_table.c and auto_id is not None:
                                                # Update by primary key id
                                                upd_stmt = sql_update(customer_table).where(customer_table.c.id == auto_id).values({cust_id_col_name: auto_id})
                                                conn.execute(upd_stmt)
                                                logger.info(f"[BOOKING] Back-filled {cust_id_col_name} with auto_id={auto_id} for new customer")
                                            elif customer_phone_col:
                                                # Fallback update by phone + scope
                                                acc_val_bf = booking_data.get('account_code') or raw_booking_payload.get('account_code')
                                                ret_val_bf = booking_data.get('retail_code') or raw_booking_payload.get('retail_code')
                                                conditions = [customer_table.c[customer_phone_col] == phone_value]
                                                if 'account_code' in customer_table.c and acc_val_bf is not None:
                                                    conditions.append(customer_table.c.account_code == acc_val_bf)
                                                if 'retail_code' in customer_table.c and ret_val_bf is not None:
                                                    conditions.append(customer_table.c.retail_code == ret_val_bf)
                                                upd_stmt = sql_update(customer_table).where(and_(*conditions)).values({cust_id_col_name: auto_id})
                                                conn.execute(upd_stmt)
                                                logger.info(f"[BOOKING] Back-filled {cust_id_col_name} with auto_id={auto_id} via phone-scope match")
                                        except Exception as backfill_e:
                                            logger.error(f"[BOOKING] Failed to back-fill {cust_id_col_name}: {backfill_e}")

                                    # Choose value for downstream usage (prefer explicit next id else auto id)
                                    if next_customer_id:
                                        customer_id_value = next_customer_id
                                        logger.info(f"[BOOKING] Customer created with customer_id: {customer_id_value}, auto_id: {auto_id}")
                                    else:
                                        customer_id_value = auto_id
                                        logger.info(f"[BOOKING] Customer created with auto_id: {customer_id_value}")

                                except Exception as ce:
                                    logger.error(f"[BOOKING] Failed creating new customer: {ce}")
                                    customer_id_value = None


                                # --------------------
                                # Income/Expense API
                                # --------------------
                                from pydantic import BaseModel as PydBaseModel

                                class TransItem(PydBaseModel):
                                    description: str
                                    qty: Optional[int] = 1
                                    price: Optional[float] = 0
                                    amount: Optional[float] = None
                                    remarks: Optional[str] = None

                                class TransIncomeExpenseRequest(PydBaseModel):
                                    account_code: str
                                    retail_code: str
                                    entry_date: str  # yyyy-mm-dd
                                    type: str  # 'inflow' | 'outflow' | 'Income' | 'Expense'
                                    payment_method: str
                                    items: List[TransItem]
                                    created_by: Optional[str] = None

                                @app.post("/trans-income-expense", status_code=201)
                                def create_trans_income_expense(req: TransIncomeExpenseRequest, current_user: Optional[User] = Depends(get_current_user)):
                                    """Insert one row per item into trans_income_expense.

                                    Expects a payload with top-level fields and an items array. Returns inserted ids and count.
                                    """
                                    try:
                                        md = MetaData()
                                        tbl = Table('trans_income_expense', md, autoload_with=engine)
                                        inserted_ids: List[Any] = []
                                        with engine.begin() as conn:
                                            for it in req.items:
                                                amt = it.amount if it.amount is not None else (float(it.qty or 0) * float(it.price or 0))
                                                row = {
                                                    'account_code': req.account_code,
                                                    'retail_code': req.retail_code,
                                                    'entry_date': req.entry_date,
                                                    'TYPE': req.type,
                                                    'payment_method': req.payment_method,
                                                    'description': it.description,
                                                    'qty': it.qty or 1,
                                                    'price': it.price or 0,
                                                    'amount': amt,
                                                    'remarks': it.remarks,
                                                }
                                                # audit columns if present
                                                creator = req.created_by or getattr(current_user, 'username', None) or getattr(current_user, 'user_id', None)
                                                if 'created_by' in tbl.c.keys() and creator is not None:
                                                    row['created_by'] = str(creator)
                                                if 'updated_by' in tbl.c.keys() and creator is not None:
                                                    row['updated_by'] = str(creator)

                                                result = conn.execute(sql_insert(tbl).values(row))
                                                try:
                                                    pk = result.inserted_primary_key[0]
                                                except Exception:
                                                    pk = None
                                                inserted_ids.append(pk)

                                        return { 'success': True, 'inserted_count': len(inserted_ids), 'inserted_ids': inserted_ids }
                                    except SQLAlchemyError as e:
                                        logger.error(f"[TRANS I/E] SQL error: {str(e)} | Traceback: {traceback.format_exc()}")
                                        raise HTTPException(status_code=500, detail="Database error while inserting income/expense")
                                    except Exception as e:
                                        logger.error(f"[TRANS I/E] Error: {str(e)} | Traceback: {traceback.format_exc()}")
                                        raise HTTPException(status_code=500, detail="Failed to insert income/expense")
                            # Inject customer id into booking_data if possible
                            if customer_id_value is not None:
                                for cand in ['customer_id', 'CustomerID', 'customerID', 'cust_id']:
                                    if cand in booking_table.c:
                                        booking_data[cand] = customer_id_value
                                        logger.info(f"[BOOKING] Set booking.{cand} = {customer_id_value}")
                                        break
            except Exception as cust_e:
                logger.error(f"[BOOKING] Customer lookup/creation skipped due to error: {cust_e}")

            # --- Booking code generation based on account_code + retail_code ---
            # Booking code generation removed per requirement (use booking_id instead)

            # Insert booking
            booking_result = conn.execute(sql_insert(booking_table).values(**booking_data))
            try:
                inserted_pk = booking_result.inserted_primary_key[0]
            except Exception:
                inserted_pk = None

            # Fallback: if PK unresolved and 'id' column exists, fetch last inserted
            if inserted_pk is None and 'id' in booking_table.c:
                try:
                    sel = select(booking_table.c.id).order_by(booking_table.c.id.desc()).limit(1)
                    inserted_pk = conn.execute(sel).scalar()
                except Exception:
                    pass

            # Derive booking_id value based on booking_sequence_id (INV-<seq>) if possible
            final_booking_identifier: Any = inserted_pk
            try:
                seq_val = booking_data.get('booking_sequence_id')
                inv_code = None
                if seq_val is not None:
                    inv_code = f"INV-{seq_val}"
                    final_booking_identifier = inv_code
                if 'booking_id' in booking_table.c and inv_code:
                    try:
                        # Persist the string code; if column numeric this will fail silently and we fall back
                        if 'id' in booking_table.c and inserted_pk is not None:
                            conn.execute(sql_update(booking_table).where(booking_table.c.id == inserted_pk).values(booking_id=inv_code))
                        else:
                            conn.execute(sql_update(booking_table).where(booking_table.c.booking_sequence_id == seq_val).values(booking_id=inv_code))
                    except Exception as persist_seq_id_e:
                        logger.debug(f"[BOOKING] booking_id update (INV-seq) skipped: {persist_seq_id_e}")
                elif 'booking_id' in booking_table.c and 'booking_id' in booking_data:
                    # If payload already supplied booking_id keep it
                    final_booking_identifier = booking_data.get('booking_id')
            except Exception as bid_logic_e:
                logger.error(f"[BOOKING] booking_id (INV-seq) assignment error: {bid_logic_e}")

            # Clean up deprecated booking_code field
            booking_data.pop('booking_code', None)

            # booking_display_id now mirrors booking_id (INV-seq) if generated, else INV-PK fallback
            booking_display_id = None
            try:
                if isinstance(final_booking_identifier, str) and final_booking_identifier.startswith('INV-'):
                    booking_display_id = final_booking_identifier
                elif inserted_pk is not None:
                    booking_display_id = f"INV-{inserted_pk}"
            except Exception:
                booking_display_id = None

            result_summary.update({
                "booking_id": final_booking_identifier,  # numeric internal id
                "booking_display_id": booking_display_id,
                "data": {"booking_id": final_booking_identifier, "booking_display_id": booking_display_id, "inserted_id": inserted_pk}
            })

            # Canonical booking id to be used for related inserts (service/payment/calendar)
            # Prefer the human-friendly display id if available, else fallback to numeric/internal id
            fk_booking_id_value = str(booking_display_id or final_booking_identifier or inserted_pk)

            # Insert calendar record(s) for the new booking if table exists
            try:
                calendar_table = _try_load_table('hallbooking_calander')
                if calendar_table is not None:
                    allowed_calendar_cols = set(calendar_table.c.keys())

                    # Helper: normalize date string
                    def _normalize_date_str(val: Any) -> Any:
                        try:
                            if isinstance(val, str) and len(val) >= 10:
                                return val[:10]
                        except Exception:
                            pass
                        return val

                    # Base row applied to each calendar entry
                    def _base_cal_row() -> Dict[str, Any]:
                        row: Dict[str, Any] = {}
                        for fld in ['account_code', 'retail_code']:
                            if fld in allowed_calendar_cols and fld in booking_data:
                                row[fld] = booking_data.get(fld)
                        if 'booking_id' in allowed_calendar_cols:
                            row['booking_id'] = str(booking_display_id or final_booking_identifier or inserted_pk)
                        # customer_id
                        if 'customer_id' in allowed_calendar_cols:
                            cust_val = None
                            # Try sanitized then raw payload variants
                            for src in (booking_data, raw_booking_payload):
                                for cand in ['customer_id', 'CustomerID', 'customerID', 'cust_id', 'customerId']:
                                    if cand in src and src[cand] not in (None, ''):
                                        cust_val = src[cand]
                                        break
                                if cust_val is not None:
                                    break
                            if cust_val is None and inserted_pk is not None and 'id' in booking_table.c and 'customer_id' in booking_table.c:
                                try:
                                    sel_cust = select(booking_table.c.customer_id).where(booking_table.c.id == inserted_pk).limit(1)
                                    row_db = conn.execute(sel_cust).first()
                                    if row_db:
                                        cust_val = row_db[0]
                                except Exception:
                                    pass
                            if cust_val is not None:
                                row['customer_id'] = str(cust_val)
                        # status
                        if 'status' in allowed_calendar_cols:
                            status_val = computed_booking_status or None
                            if not status_val:
                                for src in (raw_booking_payload, booking_data):
                                    for cand in ['status', 'STATUS', 'booking_status', 'BookingStatus']:
                                        if cand in src and src[cand] not in (None, ''):
                                            status_val = src[cand]
                                            break
                                    if status_val is not None:
                                        break
                            row['status'] = str(status_val or 'ADVANCED')
                        return row

                    # Collect items to insert: prefer multiSlots list, else slotIds list, else single
                    items: List[Dict[str, Any]] = []
                    # 1) multiSlots can be list or JSON string
                    ms_val = raw_booking_payload.get('multiSlots')
                    if isinstance(ms_val, str):
                        try:
                            import json as _json
                            parsed = _json.loads(ms_val)
                            if isinstance(parsed, list):
                                ms_val = parsed
                        except Exception:
                            ms_val = None
                    if isinstance(ms_val, list):
                        for it in ms_val:
                            if not isinstance(it, dict):
                                continue
                            items.append({
                                'eventdate': it.get('date') or it.get('eventdate') or it.get('event_date') or raw_booking_payload.get('eventdate') or raw_booking_payload.get('date'),
                                'slot_id': it.get('slotId') or it.get('slot_id') or raw_booking_payload.get('slot_id') or raw_booking_payload.get('slotId') or raw_booking_payload.get('slot'),
                                'hall_id': it.get('hallId') or it.get('hall_id') or booking_data.get('hall_id') or raw_booking_payload.get('hall_id') or raw_booking_payload.get('hallId'),
                                'event_type_id': it.get('eventTypeId') or it.get('event_type_id') or raw_booking_payload.get('event_type_id') or raw_booking_payload.get('eventTypeId'),
                                'expected_guests': it.get('attendees') or it.get('expected_guests') or raw_booking_payload.get('expected_guests') or raw_booking_payload.get('attendees'),
                            })
                    # 2) slotIds CSV with a single date
                    if not items:
                        slot_ids_csv = raw_booking_payload.get('slotIds') or raw_booking_payload.get('slot_ids')
                        if isinstance(slot_ids_csv, str) and slot_ids_csv.strip():
                            base_date = None
                            for cand in ['eventdate', 'event_date', 'date', 'start_date']:
                                if raw_booking_payload.get(cand):
                                    base_date = raw_booking_payload.get(cand)
                                    break
                            sids = [s.strip() for s in slot_ids_csv.split(',') if s.strip()]
                            for sid in sids:
                                items.append({
                                    'eventdate': base_date,
                                    'slot_id': sid,
                                    'hall_id': booking_data.get('hall_id') or raw_booking_payload.get('hall_id') or raw_booking_payload.get('hallId'),
                                    'event_type_id': raw_booking_payload.get('event_type_id') or raw_booking_payload.get('eventTypeId'),
                                    'expected_guests': raw_booking_payload.get('expected_guests') or raw_booking_payload.get('attendees'),
                                })
                    # 3) Fallback single from payload
                    if not items:
                        single_date = None
                        for cand in ['eventdate', 'event_date', 'date', 'start_date', 'start_datetime', 'event_start_datetime']:
                            if raw_booking_payload.get(cand):
                                single_date = raw_booking_payload.get(cand)
                                break
                        items.append({
                            'eventdate': single_date,
                            'slot_id': raw_booking_payload.get('slot_id') or raw_booking_payload.get('slotId') or raw_booking_payload.get('slot') or booking_data.get('slot_id'),
                            'hall_id': booking_data.get('hall_id') or raw_booking_payload.get('hall_id') or raw_booking_payload.get('hallId'),
                            'event_type_id': raw_booking_payload.get('event_type_id') or raw_booking_payload.get('eventTypeId'),
                            'expected_guests': raw_booking_payload.get('expected_guests') or raw_booking_payload.get('attendees'),
                        })

                    inserted_count = 0
                    for it in items:
                        cal_row = _base_cal_row()
                        # Per-item overrides
                        if 'hall_id' in allowed_calendar_cols and it.get('hall_id') not in (None, ''):
                            cal_row['hall_id'] = str(it['hall_id'])
                        if 'slot_id' in allowed_calendar_cols:
                            # Prefer per-item slot
                            if it.get('slot_id') not in (None, ''):
                                cal_row['slot_id'] = str(it['slot_id'])
                            else:
                                # Fallback to booking payload variants
                                for src in (booking_data, raw_booking_payload):
                                    for cand in ['slot_id', 'SlotID', 'slotID', 'slotId', 'slot']:
                                        if cand in src and src[cand] not in (None, ''):
                                            cal_row['slot_id'] = str(src[cand])
                                            break
                                    if 'slot_id' in cal_row:
                                        break
                        if 'eventdate' in allowed_calendar_cols and it.get('eventdate') not in (None, ''):
                            cal_row['eventdate'] = _normalize_date_str(it['eventdate'])
                        # Optional enrich if columns exist
                        if 'event_type_id' in allowed_calendar_cols:
                            if it.get('event_type_id') not in (None, ''):
                                cal_row['event_type_id'] = str(it['event_type_id'])
                            else:
                                # Fallback from payload/booking
                                for src in (raw_booking_payload, booking_data):
                                    for cand in ['event_type_id', 'eventTypeId']:
                                        if cand in src and src[cand] not in (None, ''):
                                            cal_row['event_type_id'] = str(src[cand])
                                            break
                                    if 'event_type_id' in cal_row:
                                        break
                        if 'expected_guests' in allowed_calendar_cols:
                            if it.get('expected_guests') not in (None, ''):
                                cal_row['expected_guests'] = it['expected_guests']
                            else:
                                for src in (raw_booking_payload, booking_data):
                                    for cand in ['expected_guests', 'attendees']:
                                        if cand in src and src[cand] not in (None, ''):
                                            cal_row['expected_guests'] = src[cand]
                                            break
                                    if 'expected_guests' in cal_row:
                                        break
                        # Ensure hall_id present if column exists (fallback from raw payload)
                        if 'hall_id' in allowed_calendar_cols and 'hall_id' not in cal_row:
                            for src in (raw_booking_payload, booking_data):
                                for cand in ['hall_id', 'hallId']:
                                    if cand in src and src[cand] not in (None, ''):
                                        cal_row['hall_id'] = str(src[cand])
                                        break
                                if 'hall_id' in cal_row:
                                    break

                        required_missing = [
                            c for c in ['account_code', 'retail_code', 'booking_id']
                            if c in allowed_calendar_cols and (c not in cal_row or cal_row[c] in (None, ''))
                        ]
                        if required_missing:
                            logger.warning(f"[BOOKING] Skipping calendar insert (item) due to missing required: {required_missing} | row={cal_row} | allowed={list(allowed_calendar_cols)}")
                            continue
                        conn.execute(sql_insert(calendar_table).values(**cal_row))
                        inserted_count += 1

                    logger.info(f"[BOOKING] Calendar rows inserted: {inserted_count}")
                else:
                    logger.debug("[BOOKING] hallbooking_calander table not found; skipping calendar insert")
            except Exception as cal_e:
                # Do not fail the booking transaction if calendar insert has issues; just log
                logger.error(f"[BOOKING] Failed to insert hallbooking_calander rows: {cal_e}")

            # Insert services if table & payload present
            if service_table is not None and req.services:
                allowed_service_cols = set(service_table.c.keys())
                # Helper: coerce various truthy values into 1/0
                def _boolish_int(val: Any) -> int:
                    try:
                        if val in (True, False):
                            return 1 if bool(val) else 0
                        s = str(val).strip().lower()
                        return 1 if s in ("1", "true", "t", "yes", "y", "on") else 0
                    except Exception:
                        return 0
                for svc in req.services:
                    # Start with only columns that exist in target table
                    svc_row = {k: v for k, v in svc.items() if k in allowed_service_cols}

                    # Normalize per-line tax exemption flag into the column that actually exists
                    try:
                        # Find destination column supported by table
                        dest_tax_exempt_col = None
                        for cand in [
                            'taxexampted', 'tax_exampted',  # handle DB typo variants first
                            'taxexempted', 'tax_exempt', 'is_tax_exempt', 'exempt'
                        ]:
                            if cand in allowed_service_cols:
                                dest_tax_exempt_col = cand
                                break
                        if dest_tax_exempt_col:
                            # Source value from any common alias in payload
                            src_val = None
                            for key in ['taxexempted', 'tax_exempt', 'taxExempt', 'is_tax_exempt', 'exempt', 'taxexampted', 'tax_exampted']:
                                if key in svc and svc.get(key) is not None:
                                    src_val = svc.get(key)
                                    break
                            if src_val is not None and dest_tax_exempt_col not in svc_row:
                                svc_row[dest_tax_exempt_col] = _boolish_int(src_val)
                    except Exception:
                        pass

                    # Provide foreign key & scope if columns exist
                    for fk in ['booking_id', 'bookingID', 'bookingId']:
                        if fk in allowed_service_cols and fk not in svc_row and fk_booking_id_value is not None:
                            svc_row[fk] = fk_booking_id_value
                    for col in ['account_code', 'retail_code']:
                        if col in allowed_service_cols and col not in svc_row:
                            svc_row[col] = booking_data.get(col)
                    if 'created_by' in allowed_service_cols:
                        svc_row['created_by'] = current_user.username
                    if 'updated_by' in allowed_service_cols:
                        svc_row['updated_by'] = current_user.username
                    try:
                        svc_res = conn.execute(sql_insert(service_table).values(**svc_row))
                        inserted_id = None
                        try:
                            inserted_id = svc_res.inserted_primary_key[0]
                        except Exception:
                            pass
                        result_summary['services'].append({"success": True, "inserted_id": inserted_id})
                    except Exception as e:
                        logger.error(f"[BOOKING] Service insert failed: {str(e)} | Data: {svc_row}")
                        result_summary['services'].append({"success": False, "error": str(e)})
            elif req.services:
                logger.warning("[BOOKING] Service payload provided but no service table detected; skipping")

            # Insert payment if table & payload present
            if payment_table is not None and payments_list:
                allowed_payment_cols = set(payment_table.c.keys())
                # Detect payment mode id and status columns if they exist
                paymode_col = None
                for cand in ['payment_mode_id', 'paymode_id', 'payment_id', 'mode_id', 'paymentModeId']:
                    if cand in payment_table.c:
                        paymode_col = cand
                        break
                status_col = None
                for cand in ['status', 'STATUS', 'payment_status', 'PaymentStatus']:
                    if cand in payment_table.c:
                        status_col = cand
                        break
                for pay in payments_list:
                    pay_row = {k: v for k, v in pay.items() if payment_table is not None and k in allowed_payment_cols}
                    # --- Normalize reference fields (UPI / Cheque) to match available columns (always before insert) ---
                    if payment_table is not None:
                        try:
                            # UPI normalization: always set upi_transaction_id if any known key is present
                            upi_keys = ['transaction_id', 'upi_transaction_id', 'upi_transaction_no', 'upi_reference', 'reference_no', 'ref_no', 'txn_id', 'utr']
                            upi_val = None
                            for key in upi_keys:
                                if key in pay and pay.get(key) not in (None, ''):
                                    upi_val = str(pay.get(key))
                                    break
                            if upi_val and 'upi_transaction_id' in allowed_payment_cols:
                                pay_row['upi_transaction_id'] = upi_val
                            # Cheque normalization: always set cheque_no if any known key is present
                            chq_keys = ['cheque_no', 'cheque_number', 'check_no', 'check_number']
                            chq_val = None
                            for key in chq_keys:
                                if key in pay and pay.get(key) not in (None, ''):
                                    chq_val = str(pay.get(key))
                                    break
                            if chq_val and 'cheque_no' in allowed_payment_cols:
                                pay_row['cheque_no'] = chq_val
                        except Exception as _upd_norm_ref_e:
                            logger.debug(f"[BOOKING_UPDATE] Payment reference normalization (insert path) skipped: {_upd_norm_ref_e}")
                    # --- Normalize reference fields (UPI / Cheque) to match available columns (insertion path) ---
                    try:
                        tx_val = None
                        for key in ['transaction_id', 'upi_transaction_id', 'upi_transaction_no', 'upi_reference', 'reference_no', 'ref_no', 'txn_id', 'utr']:
                            if key in pay and pay.get(key) not in (None, ''):
                                tx_val = str(pay.get(key))
                                break
                        if tx_val:
                            for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference']:
                                if cand in allowed_payment_cols and cand not in pay_row:
                                    pay_row[cand] = tx_val
                                    break
                        chq_val = None
                        for key in ['cheque_no', 'cheque_number', 'check_no', 'check_number']:
                            if key in pay and pay.get(key) not in (None, ''):
                                chq_val = str(pay.get(key))
                                break
                        if chq_val:
                            for cand in ['cheque_no', 'cheque_number', 'check_no']:
                                if cand in allowed_payment_cols and cand not in pay_row:
                                    pay_row[cand] = chq_val
                                    break
                    except Exception as _upd_norm_pay_ref_e:
                        logger.debug(f"[BOOKING_UPDATE] Payment reference normalization (insert path) skipped: {_upd_norm_pay_ref_e}")
                    # --- Normalize reference fields (UPI / Cheque) to match available columns ---
                    try:
                        # Prefer explicit transaction_id from payload; fallback to any existing UPI/reference value
                        tx_val = None
                        for key in ['transaction_id', 'upi_transaction_id', 'upi_transaction_no', 'upi_reference', 'reference_no', 'ref_no', 'txn_id', 'utr']:
                            if key in pay and pay.get(key) not in (None, ''):
                                tx_val = str(pay.get(key))
                                break
                        if tx_val:
                            for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference']:
                                if cand in allowed_payment_cols and cand not in pay_row:
                                    pay_row[cand] = tx_val
                                    break
                        chq_val = None
                        for key in ['cheque_no', 'cheque_number', 'check_no', 'check_number']:
                            if key in pay and pay.get(key) not in (None, ''):
                                chq_val = str(pay.get(key))
                                break
                        if chq_val:
                            for cand in ['cheque_no', 'cheque_number', 'check_no']:
                                if cand in allowed_payment_cols and cand not in pay_row:
                                    pay_row[cand] = chq_val
                                    break
                    except Exception as _norm_pay_ref_e:
                        logger.debug(f"[BOOKING] Payment reference normalization skipped: {_norm_pay_ref_e}")
                    # Provide foreign key & scope if columns exist
                    for fk in ['booking_id', 'bookingID', 'bookingId']:
                        if fk in allowed_payment_cols and fk not in pay_row and fk_booking_id_value is not None:
                            pay_row[fk] = fk_booking_id_value
                    for col in ['account_code', 'retail_code']:
                        if col in allowed_payment_cols and col not in pay_row:
                            pay_row[col] = booking_data.get(col)
                    if 'created_by' in allowed_payment_cols:
                        pay_row['created_by'] = current_user.username
                    if 'updated_by' in allowed_payment_cols:
                        pay_row['updated_by'] = current_user.username
                    # Timestamps if columns exist (do not set payment_date; let DB default CURRENT_TIMESTAMP handle it)
                    now = datetime.now()
                    for ts_col in ['created_at', 'create_at', 'paid_at']:
                        if ts_col in allowed_payment_cols and ts_col not in pay_row:
                            pay_row[ts_col] = now
                    # Ensure status is set per selected paymode only (this row), avoiding NULLs
                    try:
                        if status_col is not None and status_col not in pay_row:
                            # Prefer explicit status in payload under common keys
                            status_val = None
                            for key in ['status', 'payment_status', 'PaymentStatus', 'STATUS']:
                                if key in pay and pay.get(key) not in (None, ''):
                                    status_val = pay.get(key)
                                    break
                            # Next, align with computed booking status when available
                            if status_val is None:
                                try:
                                    cbs = (computed_booking_status or '').upper() if 'computed_booking_status' in locals() else ''
                                except Exception:
                                    cbs = ''
                                if cbs in ('ADVANCED', 'CANCELLED'):
                                    status_val = cbs
                                elif cbs == 'SETTLED':
                                    status_val = 'SETTLED'
                                elif cbs == 'PAID':
                                    status_val = 'PAID'
                            # Fallback by amount heuristic (paid -> PAID else ADVANCED)
                            if status_val is None:
                                amt = pay.get('amount') or pay.get('paid_amount') or pay.get('payment_amount')
                                try:
                                    amt = float(amt) if amt not in (None, '') else 0.0
                                except Exception:
                                    amt = 0.0
                                status_val = 'PAID' if amt and amt > 0 else 'ADVANCED'
                            pay_row[status_col] = status_val
                    except Exception as _pay_status_e:
                        logger.debug(f"[BOOKING] Payment status defaulting skipped: {_pay_status_e}")
                    # Final ensure: map UPI/Cheque into canonical columns if present and allowed
                    try:
                        # UPI ensure
                        upi_val = None
                        for key in ['transaction_id', 'upi_transaction_id', 'upi_transaction_no', 'upi_reference', 'reference_no', 'ref_no', 'txn_id', 'utr']:
                            if key in pay and pay.get(key) not in (None, ''):
                                upi_val = str(pay.get(key))
                                break
                        if upi_val and 'upi_transaction_id' in allowed_payment_cols:
                            pay_row['upi_transaction_id'] = upi_val
                        # Cheque ensure
                        chq_val = None
                        for key in ['cheque_no', 'cheque_number', 'check_no', 'check_number']:
                            if key in pay and pay.get(key) not in (None, ''):
                                chq_val = str(pay.get(key))
                                break
                        if chq_val and 'cheque_no' in allowed_payment_cols:
                            pay_row['cheque_no'] = chq_val
                    except Exception as _final_norm_e:
                        logger.debug(f"[BOOKING] Final payment reference ensure skipped: {_final_norm_e}")
                    try:
                        logger.debug(f"[BOOKING] Inserting booking_payment row: {pay_row}")
                        pay_res = conn.execute(sql_insert(payment_table).values(**pay_row))
                        payment_id = None
                        try:
                            payment_id = pay_res.inserted_primary_key[0]
                        except Exception:
                            pass
                        result_summary['payments'].append({"success": True, "payment_id": payment_id})
                    except Exception as e:
                        logger.error(f"[BOOKING] Payment insert failed: {str(e)} | Data: {pay_row}")
                        result_summary['payments'].append({"success": False, "error": str(e)})
            elif payments_list:
                logger.warning("[BOOKING] Payment payload provided but no payment table detected; skipping")

        logger.info(
            f"[BOOKING] Success | Booking ID: {result_summary.get('booking_id')} | Services: {len(result_summary['services'])} "
            f"| Payments: {len(result_summary['payments'])}"
        )
        return result_summary
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[BOOKING] Error creating booking: {str(e)} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to create booking: {str(e)}")


# --- Booking Update Endpoint ---
@app.post("/update-booking")
def update_booking(req: BookingUpdateCompositeRequest, current_user: User = Depends(get_current_user)):
    """Update an existing booking.

    Behaviour:
      - Updates the booking row with provided fields (sanitized against existing columns).
      - If 'services' list provided, existing service lines for this booking are deleted then replaced with the new list.
      - If 'payment' provided (single or list), new payment line(s) are appended (does NOT delete old payments).
    """
    # Normalize payment(s)
    raw_payment = req.payment
    if raw_payment is None:
        payments_list: List[Dict[str, Any]] = []
    elif isinstance(raw_payment, list):
        payments_list = raw_payment
    elif isinstance(raw_payment, dict):
        payments_list = [raw_payment]
    else:
        raise HTTPException(status_code=400, detail="Invalid 'payment' value; expected object or list of objects")

    logger.info(
        f"[BOOKING_UPDATE] Endpoint: /update-booking | booking_id={req.booking_id} "
        f"services_count={len(req.services or [])} payments_count={len(payments_list)}"
    )

    def _try_load_table(name: str):
        try:
            local_md = MetaData()
            return Table(name, local_md, autoload_with=engine)
        except Exception:
            return None

    booking_table = _try_load_table('booking')
    if booking_table is None:
        raise HTTPException(status_code=500, detail="'booking' table not found in database")

    # Detect service/payment tables (same logic as create)
    service_table = None
    for cand in [
        'booking_service', 'booking_services', 'booking_service_line', 'booking_service_lines',
        'booking_services_line'
    ]:
        service_table = _try_load_table(cand)
        if service_table is not None:
            break
    payment_table = None
    for cand in ['booking_payment', 'booking_payments', 'booking_payment_line', 'booking_payments_line', 'payments']:
        payment_table = _try_load_table(cand)
        if payment_table is not None:
            break

    # Identify PK / booking id column in booking table
    pk_col = None
    # Prefer numeric surrogate key 'id' if present; fall back to booking_id
    for cand in ['id', 'booking_id']:
        if cand in booking_table.c:
            pk_col = booking_table.c[cand]
            break
    if pk_col is None:
        raise HTTPException(status_code=500, detail="Could not identify primary key column for booking table")

    booking_id_value = req.booking_id
    if booking_id_value is None:
        raise HTTPException(status_code=400, detail="booking_id is required")

    # Sanitize booking update data (secondary *_2 fields deprecated)
    allowed_cols = set(booking_table.c.keys())
    upd_raw = dict(req.booking)
    # Normalize tax exemption alias into canonical column for update path
    try:
        if 'tax_exempt' in allowed_cols:
            def _to_boolish_int_u(val: Any) -> int:
                try:
                    if val in (True, False):
                        return 1 if bool(val) else 0
                    s = str(val).strip().lower()
                    return 1 if s in ('1', 'true', 't', 'yes', 'y', 'on') else 0
                except Exception:
                    return 0
            if 'tax_exempt' in upd_raw:
                upd_raw['tax_exempt'] = _to_boolish_int_u(upd_raw.get('tax_exempt'))
            elif 'taxExempt' in upd_raw:
                upd_raw['tax_exempt'] = _to_boolish_int_u(upd_raw.get('taxExempt'))
            elif 'is_tax_exempt' in upd_raw:
                upd_raw['tax_exempt'] = _to_boolish_int_u(upd_raw.get('is_tax_exempt'))
    except Exception:
        pass
    # No normalization of *_2 fields

    booking_updates = {k: (v if str(v).strip().upper() != 'PENDING' else 'ADVANCED') for k, v in upd_raw.items() if k in allowed_cols and k not in ['booking_id', 'id']}
    # Detect explicit cancellation intent from incoming payload and mark to skip auto status computation
    cancel_intent = False
    try:
        for key in ['status', 'STATUS', 'booking_status', 'BookingStatus', 'payment_status', 'PaymentStatus']:
            if key in upd_raw and upd_raw.get(key) is not None:
                sval = str(upd_raw.get(key)).strip().lower()
                if sval.startswith('cancel'):
                    cancel_intent = True
                    break
        # Also infer from presence of cancellation fields
        if not cancel_intent:
            if any(k in upd_raw for k in ['cancelled_at', 'cancellation_reason', 'cancelled_by']):
                cancel_intent = True
        # If cancelling, force status update across common columns (respect existing schema)
        if cancel_intent:
            for col_name in ['status', 'STATUS', 'booking_status', 'BookingStatus', 'payment_status', 'PaymentStatus']:
                if col_name in allowed_cols:
                    booking_updates[col_name] = 'CANCELLED'
            # Also capture cancel_reason and cancel_date into booking when columns exist
            try:
                # Prefer explicit reason fields from payload
                reason_val = None
                for rk in ['cancel_reason', 'cancellation_reason', 'reason']:
                    if rk in upd_raw and upd_raw.get(rk) not in (None, ''):
                        reason_val = str(upd_raw.get(rk))
                        break
                if 'cancel_reason' in allowed_cols and reason_val not in (None, ''):
                    booking_updates['cancel_reason'] = reason_val

                # Determine date: use provided cancel_date when valid else today's date
                cd_raw = None
                for dk in ['cancel_date', 'cancellation_date']:
                    if dk in upd_raw and upd_raw.get(dk) not in (None, ''):
                        cd_raw = str(upd_raw.get(dk))
                        break
                cd_val = None
                if cd_raw:
                    try:
                        # Accept YYYY-MM-DD or ISO; take the date part
                        import re as _re
                        m = _re.match(r'^(\d{4}-\d{2}-\d{2})', cd_raw.strip())
                        if m:
                            cd_val = m.group(1)
                        else:
                            # Fallback parse via datetime then extract date
                            from datetime import datetime as _dt
                            cd_val = _dt.fromisoformat(cd_raw.replace(' ', 'T')).date().isoformat()
                    except Exception:
                        cd_val = None
                if cd_val is None:
                    # Default to today's date (server time)
                    cd_val = datetime.now().date().isoformat()
                if 'cancel_date' in allowed_cols:
                    booking_updates['cancel_date'] = cd_val

                # Optional: mark cancelled_at/ cancelled_by when columns exist
                if 'cancelled_at' in allowed_cols:
                    booking_updates['cancelled_at'] = datetime.now()
                if 'cancelled_by' in allowed_cols:
                    booking_updates['cancelled_by'] = current_user.username
            except Exception:
                pass
    except Exception:
        # Non-fatal; proceed with normal flow if detection fails
        cancel_intent = False
    if not booking_updates:
        logger.warning("[BOOKING_UPDATE] No valid booking columns supplied for update")
    # Force audit field
    if 'updated_by' in allowed_cols:
        booking_updates['updated_by'] = current_user.username

    # Detect booking fk column names on related tables (prefer booking_id variants; do not use primary key 'id')
    service_fk_name = None
    if service_table is not None:
        for cand in ['booking_id', 'bookingID', 'bookingId']:
            if cand in service_table.c:
                service_fk_name = cand
                break

    try:
        summary: Dict[str, Any] = {"success": True, "booking_id": booking_id_value, "services": [], "payments": []}
        with engine.begin() as conn:
            # Ensure booking exists
            exists_stmt = select(pk_col).where(pk_col == booking_id_value).limit(1)
            exists = conn.execute(exists_stmt).first()
            if not exists:
                raise HTTPException(status_code=404, detail="Booking not found")

            # Preload existing booking row for use across update (FKs, scope, status calc)
            existing_row_all = conn.execute(select(booking_table).where(pk_col == booking_id_value).limit(1)).first()
            existing = dict(existing_row_all._mapping) if existing_row_all else {}

            # Canonical FK value used by related tables: prefer booking.booking_id when present else fallback to numeric pk
            canonical_fk_booking_id_value = str(existing.get('booking_id') or booking_id_value)

            # --- Derive status on update similar to create (unless cancelling explicitly) ---
            try:
                if cancel_intent:
                    # Skip payment-based status logic when explicit cancellation requested
                    raise Exception('skip_status_computation_due_to_cancellation')
                # existing loaded above

                def _to_num(v: Any, default: float = 0.0) -> float:
                    try:
                        if v is None or v == "":
                            return default
                        return float(v)
                    except Exception:
                        return default

                # Totals and components from updates or existing
                def pick(*keys):
                    for k in keys:
                        if k in booking_updates:
                            return booking_updates.get(k)
                        if k in existing:
                            return existing.get(k)
                    return None

                services_total = _to_num(pick('services_total'))
                # If services list provided on update, recompute sum when missing
                if services_total == 0.0 and req.services:
                    sv_sum = 0.0
                    for s in (req.services or []):
                        amt = _to_num(s.get('amount'))
                        if amt == 0.0:
                            qty = _to_num(s.get('qty') or s.get('quantity') or 1, 1.0)
                            rate = _to_num(s.get('rate') or s.get('unit_price') or s.get('price') or 0.0)
                            amt = qty * rate
                        sv_sum += amt
                    services_total = sv_sum

                total = 0.0
                for key in ['total_amount', 'grand_total', 'amount', 'total']:
                    val = pick(key)
                    if val is not None:
                        total = _to_num(val)
                        break
                if total == 0.0:
                    # Recompute minimal total if possible
                    hall_amount = _to_num(pick('hall_rate', 'hallrent', 'hall_amount', 'hall_total', 'hall'))
                    discount = _to_num(pick('discount'))
                    cgst = _to_num(pick('cgst_amount'))
                    sgst = _to_num(pick('sgst_amount'))
                    taxable = max(hall_amount + services_total - discount, 0.0)
                    total = taxable + cgst + sgst

                # Paid: sum new payments or from advance fields or infer from balance
                paid_total = 0.0
                if isinstance(payments_list, list):
                    for pay in payments_list:
                        # Build a payment row constrained to existing columns
                        if 'allowed_payment_cols' in locals():
                            pay_row = {k: v for k, v in pay.items() if k in allowed_payment_cols}
                        else:
                            pay_row = dict(pay)
                        # --- Normalize reference fields (UPI / Cheque) to match available columns ---
                        try:
                            tx_val = None
                            for key in ['transaction_id', 'upi_transaction_id', 'upi_transaction_no', 'upi_reference', 'reference_no', 'ref_no', 'txn_id', 'utr']:
                                if key in pay and pay.get(key) not in (None, ''):
                                    tx_val = str(pay.get(key))
                                    break
                            if tx_val:
                                for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference']:
                                    if cand in allowed_payment_cols and cand not in pay_row:
                                        pay_row[cand] = tx_val
                                        break
                            chq_val = None
                            for key in ['cheque_no', 'cheque_number', 'check_no', 'check_number']:
                                if key in pay and pay.get(key) not in (None, ''):
                                    chq_val = str(pay.get(key))
                                    break
                            if chq_val:
                                for cand in ['cheque_no', 'cheque_number', 'check_no']:
                                    if cand in allowed_payment_cols and cand not in pay_row:
                                        pay_row[cand] = chq_val
                                        break
                        except Exception as _upd_norm_ref_e:
                            logger.debug(f"[BOOKING_UPDATE] Payment reference normalization skipped: {_upd_norm_ref_e}")
                    for key in ['advance_payment', 'advance', 'paid', 'paid_amount']:
                        val = pick(key)
                        if val is not None:
                            paid_total = _to_num(val)
                            break

                balance_due = None
                for key in ['balance_due', 'balance', 'due']:
                    val = pick(key)
                    if val is not None:
                        balance_due = _to_num(val)
                        break
                if balance_due is None:
                    balance_due = max(total - paid_total, 0.0)
                if (paid_total == 0.0 or abs(paid_total) < 1e-6) and balance_due is not None and total > 0.0:
                    inferred_paid = total - balance_due
                    if inferred_paid > 0.0:
                        paid_total = inferred_paid

                # Decide status
                if balance_due is not None and balance_due <= 0.0:
                    status_val = 'SETTLED' if services_total > 0.0 else 'PAID'
                elif paid_total > 0.0:
                    status_val = 'ADVANCED'
                else:
                    status_val = 'ADVANCED'

                # Inject into updates across common status columns
                for col_name in ['status', 'STATUS', 'booking_status', 'BookingStatus', 'payment_status', 'PaymentStatus']:
                    if col_name in allowed_cols:
                        booking_updates[col_name] = status_val
                # Mirror numeric fields if present
                for paid_col in ['advance_payment', 'advance', 'paid', 'paid_amount']:
                    if paid_col in allowed_cols:
                        booking_updates[paid_col] = paid_total
                for bal_col in ['balance_due', 'balance', 'due']:
                    if bal_col in allowed_cols:
                        booking_updates[bal_col] = balance_due
            except Exception as e:
                import traceback
                logger.error(f"[BOOKING_UPDATE] Status computation skipped due to error: {e}\n{traceback.format_exc()}")

            # Update booking
            if booking_updates:
                upd_stmt = sql_update(booking_table).where(pk_col == booking_id_value).values(**booking_updates)
                conn.execute(upd_stmt)
                summary['booking_updated'] = True
            else:
                summary['booking_updated'] = False

            # If cancelled, propagate status to calendar table too (best-effort)
            if cancel_intent:
                try:
                    cal_table = _try_load_table('hallbooking_calander')
                    if cal_table is not None:
                        cal_allowed = set(cal_table.c.keys())
                        # Prefer 'status' column name variants
                        cal_status_col = None
                        for nm in ['status', 'STATUS', 'booking_status', 'BookingStatus']:
                            if nm in cal_allowed:
                                cal_status_col = nm
                                break
                        if cal_status_col and 'booking_id' in cal_allowed:
                            # Try updating by both the incoming numeric id and the existing booking.booking_id (display id) if present
                            try:
                                sel_all = select(booking_table).where(pk_col == booking_id_value).limit(1)
                                existing_row = conn.execute(sel_all).first()
                                existing_bid_val = None
                                if existing_row is not None:
                                    existing = dict(existing_row._mapping)
                                    existing_bid_val = existing.get('booking_id')
                            except Exception:
                                existing_bid_val = None
                            targets = {str(booking_id_value)}
                            if existing_bid_val not in (None, ''):
                                targets.add(str(existing_bid_val))
                            from sqlalchemy import or_ as sa_or
                            cal_upd = sql_update(cal_table).where(sa_or(*[cal_table.c['booking_id'] == t for t in targets])).values(**{cal_status_col: 'CANCELLED'})
                            conn.execute(cal_upd)
                except Exception as _cal_cancel_e:
                    logger.debug(f"[BOOKING_UPDATE] Calendar cancel propagation skipped: {_cal_cancel_e}")

            # Replace services if provided
            if service_table is not None and req.services is not None and (service_fk_name and service_fk_name in service_table.c):
                # Delete existing
                try:
                    del_stmt = sql_delete(service_table).where(service_table.c[service_fk_name] == canonical_fk_booking_id_value)
                    conn.execute(del_stmt)
                except Exception as e:
                    logger.error(f"[BOOKING_UPDATE] Failed deleting old services: {e}")
                allowed_service_cols = set(service_table.c.keys())
                for svc in req.services:
                    svc_row = {k: v for k, v in svc.items() if k in allowed_service_cols}
                    # Normalize per-line tax exemption into whichever column exists on this table
                    try:
                        def _boolish_int(val: Any) -> int:
                            try:
                                if val in (True, False):
                                    return 1 if bool(val) else 0
                                s = str(val).strip().lower()
                                return 1 if s in ("1", "true", "t", "yes", "y", "on") else 0
                            except Exception:
                                return 0
                        dest_col = None
                        for cand in ['taxexampted', 'tax_exampted', 'taxexempted', 'tax_exempt', 'is_tax_exempt', 'exempt']:
                            if cand in allowed_service_cols:
                                dest_col = cand
                                break
                        if dest_col:
                            src_val = None
                            for key in ['taxexempted', 'tax_exempt', 'taxExempt', 'is_tax_exempt', 'exempt', 'taxexampted', 'tax_exampted']:
                                if key in svc and svc.get(key) is not None:
                                    src_val = svc.get(key)
                                    break
                            if src_val is not None and dest_col not in svc_row:
                                svc_row[dest_col] = _boolish_int(src_val)
                    except Exception:
                        pass
                    if service_fk_name in allowed_service_cols:
                        svc_row[service_fk_name] = canonical_fk_booking_id_value
                    for col in ['account_code', 'retail_code']:
                        if col in allowed_service_cols and col not in svc_row:
                            # Preserve scope from booking updates or existing row
                            if col in booking_updates and booking_updates[col] not in (None, ''):
                                svc_row[col] = booking_updates[col]
                            elif col in existing and existing[col] not in (None, ''):
                                svc_row[col] = existing[col]
                    if 'updated_by' in allowed_service_cols:
                        svc_row['updated_by'] = current_user.username
                    if 'created_by' in allowed_service_cols and 'created_by' not in svc_row:
                        svc_row['created_by'] = current_user.username
                    try:
                        ins_res = conn.execute(sql_insert(service_table).values(**svc_row))
                        inserted_id = None
                        try:
                            inserted_id = ins_res.inserted_primary_key[0]
                        except Exception:
                            pass
                        summary['services'].append({"success": True, "inserted_id": inserted_id})
                    except Exception as e:
                        logger.error(f"[BOOKING_UPDATE] Service insert failed: {e} | data={svc_row}")
                        summary['services'].append({"success": False, "error": str(e)})
            elif req.services is not None and service_table is None:
                logger.warning("[BOOKING_UPDATE] Service list provided but no service table found; skipping")

            # Append new payment lines (no deletion) if provided
            if payment_table is not None and payments_list:
                allowed_payment_cols = set(payment_table.c.keys())
                # Detect payment FK column (booking_id variants only)
                pay_fk = None
                for cand in ['booking_id', 'bookingID', 'bookingId']:
                    if cand in payment_table.c:
                        pay_fk = cand
                        break
                # Detect payment mode id column on payment table
                paymode_col = None
                for cand in ['payment_mode_id', 'paymode_id', 'payment_id', 'mode_id', 'paymentModeId']:
                    if cand in payment_table.c:
                        paymode_col = cand
                        break
                # Detect a status column in payment table
                status_col = None
                for cand in ['status', 'STATUS', 'payment_status', 'PaymentStatus']:
                    if cand in payment_table.c:
                        status_col = cand
                        break
                for pay in payments_list:
                    if 'allowed_payment_cols' in locals():
                        pay_row = {k: v for k, v in pay.items() if k in allowed_payment_cols}
                    else:
                        pay_row = dict(pay)
                    if pay_fk and pay_fk in allowed_payment_cols:
                        pay_row[pay_fk] = canonical_fk_booking_id_value
                    for col in ['account_code', 'retail_code']:
                        if col in allowed_payment_cols and col not in pay_row:
                            if col in booking_updates and booking_updates[col] not in (None, ''):
                                pay_row[col] = booking_updates[col]
                            elif col in existing and existing[col] not in (None, ''):
                                pay_row[col] = existing[col]
                    if 'updated_by' in allowed_payment_cols:
                        pay_row['updated_by'] = current_user.username
                    if 'created_by' in allowed_payment_cols and 'created_by' not in pay_row:
                        pay_row['created_by'] = current_user.username
                    # Normalize and force-map UPI/Cheque references into standard columns if present
                    try:
                        # UPI
                        upi_val = None
                        for key in ['transaction_id', 'upi_transaction_id', 'upi_transaction_no', 'upi_reference', 'reference_no', 'ref_no', 'txn_id', 'utr']:
                            if key in pay and pay.get(key) not in (None, ''):
                                upi_val = str(pay.get(key))
                                break
                        if upi_val:
                            if 'upi_transaction_id' in allowed_payment_cols:
                                pay_row['upi_transaction_id'] = upi_val
                            else:
                                logger.warning("[BOOKING_UPDATE] UPI reference present but 'upi_transaction_id' column not available on booking_payment; skipping map")
                        # Cheque
                        chq_val = None
                        for key in ['cheque_no', 'cheque_number', 'check_no', 'check_number']:
                            if key in pay and pay.get(key) not in (None, ''):
                                chq_val = str(pay.get(key))
                                break
                        if chq_val:
                            if 'cheque_no' in allowed_payment_cols:
                                pay_row['cheque_no'] = chq_val
                            else:
                                logger.warning("[BOOKING_UPDATE] Cheque reference present but 'cheque_no' column not available on booking_payment; skipping map")
                    except Exception as _upd_pay_ref_norm_e:
                        logger.debug(f"[BOOKING_UPDATE] UPI/Cheque normalization (append path) skipped: {_upd_pay_ref_norm_e}")
                    now = datetime.now()
                    # Do not set payment_date here; let DB default CURRENT_TIMESTAMP handle it
                    for ts_col in ['updated_at']:
                        if ts_col in allowed_payment_cols and ts_col not in pay_row:
                            pay_row[ts_col] = now
                    # Set created_at if available for new inserts
                    if 'created_at' in allowed_payment_cols and 'created_at' not in pay_row:
                        pay_row['created_at'] = now
                    # Ensure status default on insert path to avoid NULL
                    try:
                        if status_col and status_col not in pay_row:
                            # Prefer explicit status from payload
                            s_val = None
                            for key in ['status', 'payment_status', 'PaymentStatus', 'STATUS']:
                                if key in pay and pay.get(key) not in (None, ''):
                                    s_val = pay.get(key)
                                    break
                            # Next prefer computed booking status from earlier logic
                            if s_val is None:
                                try:
                                    bs = (status_val or '').upper() if 'status_val' in locals() else ''
                                except Exception:
                                    bs = ''
                                if bs in ('ADVANCED', 'CANCELLED'):
                                    s_val = bs
                                elif bs == 'SETTLED':
                                    s_val = 'SETTLED'
                                elif bs == 'PAID':
                                    s_val = 'PAID'
                            # Fallback by amount
                            if s_val is None:
                                amt = pay.get('amount') or pay.get('paid_amount') or pay.get('payment_amount')
                                try:
                                    amt = float(amt) if amt not in (None, '') else 0.0
                                except Exception:
                                    amt = 0.0
                                s_val = 'PAID' if amt and amt > 0 else 'ADVANCED'
                            pay_row[status_col] = s_val
                    except Exception:
                        logger.debug(f"[BOOKING_UPDATE] Payment status defaulting skipped due to error.")
                    # If the intent is to set status against a specific paymode (without inserting a new amount row),
                    # update only that paymode under this booking_id. Fallback to insert if no row exists.
                    try:
                        def _to_num(v):
                            try:
                                return float(v)
                            except Exception:
                                return 0.0

                        has_amount = any(
                            (k in pay and pay[k] not in (None, '')) for k in ['amount', 'paid_amount', 'payment_amount']
                        ) and (_to_num(pay.get('amount') or pay.get('paid_amount') or pay.get('payment_amount')) != 0.0)

                        is_status_only = (status_col is not None) and (status_col in pay_row) and not has_amount and (paymode_col is not None) and (paymode_col in pay_row)

                        if is_status_only and pay_fk and paymode_col:
                            # Perform a targeted update using booking_id + payment_mode_id
                            from sqlalchemy import and_ as sa_and
                            upd_values = {status_col: pay_row.get(status_col)}
                            # Always include UPI/Cheque fields if present (for update path too)
                            for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference', 'cheque_no', 'cheque_number', 'check_no']:
                                if cand in allowed_payment_cols and cand in pay_row and pay_row.get(cand) not in (None, ''):
                                    upd_values[cand] = pay_row.get(cand)
                            # Always include UPI/Cheque fields if present
                            for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference', 'cheque_no', 'cheque_number', 'check_no']:
                                if cand in allowed_payment_cols and cand in pay_row and pay_row.get(cand) not in (None, ''):
                                    upd_values[cand] = pay_row.get(cand)
                            # If reference fields are provided on a status-only update, update those too
                            for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference', 'cheque_no', 'cheque_number', 'check_no']:
                                if cand in allowed_payment_cols and cand in pay_row and pay_row.get(cand) not in (None, ''):
                                    upd_values[cand] = pay_row.get(cand)
                            if 'updated_by' in allowed_payment_cols:
                                upd_values['updated_by'] = current_user.username
                            if 'updated_at' in allowed_payment_cols:
                                upd_values['updated_at'] = now
                            upd_stmt = sql_update(payment_table).where(
                                sa_and(
                                    payment_table.c[pay_fk] == canonical_fk_booking_id_value,
                                    payment_table.c[paymode_col] == pay_row.get(paymode_col)
                                )
                            ).values(**upd_values)
                            result = conn.execute(upd_stmt)
                            if getattr(result, 'rowcount', 0) and result.rowcount > 0:
                                summary['payments'].append({"success": True, "updated": True, "payment_mode_id": str(pay_row.get(paymode_col))})
                            else:
                                # No existing row for that paymode; insert a new one with status scoped to this paymode only
                                ins_row = dict(pay_row)
                                # Ensure only the minimal required fields are included for a status-only insert
                                minimal = {k: ins_row[k] for k in [pay_fk, paymode_col] if k in ins_row}
                                if status_col in ins_row:
                                    minimal[status_col] = ins_row[status_col]
                                # Always include UPI/Cheque fields if present
                                for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference', 'cheque_no', 'cheque_number', 'check_no']:
                                    if cand in allowed_payment_cols and cand in ins_row and ins_row.get(cand) not in (None, ''):
                                        minimal[cand] = ins_row[cand]
                                # carry reference fields if present for this minimal insert
                                for cand in ['upi_transaction_id', 'upi_transaction_no', 'transaction_id', 'reference_no', 'upi_reference', 'cheque_no', 'cheque_number', 'check_no']:
                                    if cand in allowed_payment_cols and cand in ins_row and ins_row.get(cand) not in (None, ''):
                                        minimal[cand] = ins_row[cand]
                                # carry scope and audit
                                for col in ['account_code', 'retail_code', 'created_by', 'updated_by']:
                                    if col in allowed_payment_cols and col in ins_row:
                                        minimal[col] = ins_row[col]
                                # timestamp columns best-effort
                                # Do not set payment_date; rely on DB default CURRENT_TIMESTAMP
                                if 'created_at' in allowed_payment_cols and 'created_at' not in minimal:
                                    minimal['created_at'] = now
                                pay_res = conn.execute(sql_insert(payment_table).values(**minimal))
                                try:
                                    payment_id = pay_res.inserted_primary_key[0]
                                except Exception:
                                    payment_id = None
                                summary['payments'].append({"success": True, "inserted": True, "payment_id": payment_id})
                        else:
                            # Normal path: insert payment row
                            logger.debug(f"[BOOKING_UPDATE] Inserting booking_payment row: {pay_row}")
                            pay_res = conn.execute(sql_insert(payment_table).values(**pay_row))
                            payment_id = None
                            try:
                                payment_id = pay_res.inserted_primary_key[0]
                            except Exception:
                                pass
                            summary['payments'].append({"success": True, "payment_id": payment_id})
                    except Exception as e:
                        logger.error(f"[BOOKING_UPDATE] Payment upsert failed: {e} | data={pay_row}")
                        summary['payments'].append({"success": False, "error": str(e)})
            elif payments_list and payment_table is None:
                logger.warning("[BOOKING_UPDATE] Payment payload provided but no payment table found; skipping")

            # Replace or update calendar rows when multiSlots provided or eventdate/slot/hall likely changed
            try:
                cal_table = _try_load_table('hallbooking_calander')
                if cal_table is not None:
                    cal_allowed = set(cal_table.c.keys())
                    # Detect whether update intends to change calendar
                    calendar_change_intent = False
                    for key in ['multiSlots', 'slotIds', 'slot_ids', 'eventdate', 'event_date', 'date', 'slot_id', 'slotId', 'hall_id', 'hallId', 'event_type_id', 'eventTypeId', 'expected_guests', 'attendees']:
                        if key in upd_raw and upd_raw.get(key) not in (None, ''):
                            calendar_change_intent = True
                            break

                    if calendar_change_intent:
                        # Helper to normalize date to YYYY-MM-DD
                        def _norm_date(val: Any) -> Any:
                            try:
                                s = str(val)
                                if len(s) >= 10:
                                    return s[:10]
                                return s
                            except Exception:
                                return val

                        # Build items from multiSlots if provided; else from single fields
                        items: List[Dict[str, Any]] = []
                        ms_val = upd_raw.get('multiSlots')
                        if isinstance(ms_val, str):
                            try:
                                import json as _json
                                parsed = _json.loads(ms_val)
                                if isinstance(parsed, list):
                                    ms_val = parsed
                            except Exception:
                                ms_val = None
                        if isinstance(ms_val, list):
                            for it in ms_val:
                                if not isinstance(it, dict):
                                    continue
                                items.append({
                                    'eventdate': it.get('date') or it.get('eventdate') or it.get('event_date') or upd_raw.get('eventdate') or upd_raw.get('date'),
                                    'slot_id': it.get('slotId') or it.get('slot_id') or upd_raw.get('slot_id') or upd_raw.get('slotId') or upd_raw.get('slot'),
                                    'hall_id': it.get('hallId') or it.get('hall_id') or booking_updates.get('hall_id') or upd_raw.get('hall_id') or upd_raw.get('hallId') or existing.get('hall_id'),
                                    'event_type_id': it.get('eventTypeId') or it.get('event_type_id') or booking_updates.get('event_type_id') or upd_raw.get('event_type_id') or upd_raw.get('eventTypeId') or existing.get('event_type_id'),
                                    'expected_guests': it.get('attendees') or it.get('expected_guests') or booking_updates.get('expected_guests') or upd_raw.get('expected_guests') or upd_raw.get('attendees') or existing.get('expected_guests'),
                                })
                        else:
                            # Single item path
                            items.append({
                                'eventdate': booking_updates.get('eventdate') or upd_raw.get('eventdate') or upd_raw.get('date') or existing.get('eventdate') or existing.get('date'),
                                'slot_id': booking_updates.get('slot_id') or upd_raw.get('slot_id') or upd_raw.get('slotId') or existing.get('slot_id'),
                                'hall_id': booking_updates.get('hall_id') or upd_raw.get('hall_id') or upd_raw.get('hallId') or existing.get('hall_id'),
                                'event_type_id': booking_updates.get('event_type_id') or upd_raw.get('event_type_id') or upd_raw.get('eventTypeId') or existing.get('event_type_id'),
                                'expected_guests': booking_updates.get('expected_guests') or upd_raw.get('expected_guests') or upd_raw.get('attendees') or existing.get('expected_guests'),
                            })

                        # Filter out invalid rows
                        items = [it for it in items if (it.get('eventdate') not in (None, '')) and (it.get('slot_id') not in (None, ''))]
                        if items:
                            # Delete existing calendar rows for this booking (by canonical booking_id string)
                            try:
                                from sqlalchemy import delete as sa_delete
                                del_stmt = sa_delete(cal_table).where(cal_table.c['booking_id'] == canonical_fk_booking_id_value)
                                conn.execute(del_stmt)
                            except Exception as _del_cal_e:
                                logger.debug(f"[BOOKING_UPDATE] Calendar delete skipped: {_del_cal_e}")

                            # Insert new rows
                            from sqlalchemy import insert as sa_insert
                            inserted = 0
                            for it in items:
                                cal_row: Dict[str, Any] = {}
                                # Scope columns
                                for fld in ['account_code', 'retail_code']:
                                    if fld in cal_allowed:
                                        if fld in booking_updates and booking_updates[fld] not in (None, ''):
                                            cal_row[fld] = booking_updates[fld]
                                        elif fld in existing and existing[fld] not in (None, ''):
                                            cal_row[fld] = existing[fld]
                                # FK
                                if 'booking_id' in cal_allowed:
                                    cal_row['booking_id'] = canonical_fk_booking_id_value
                                # Customer
                                if 'customer_id' in cal_allowed:
                                    cust_val = existing.get('customer_id')
                                    if 'customer_id' in booking_updates and booking_updates['customer_id'] not in (None, ''):
                                        cust_val = booking_updates['customer_id']
                                    if cust_val is not None:
                                        cal_row['customer_id'] = str(cust_val)
                                # Status
                                if 'status' in cal_allowed:
                                    try:
                                        s_val = booking_updates.get('status') or booking_updates.get('STATUS') or locals().get('status_val') or existing.get('status') or existing.get('STATUS')
                                    except Exception:
                                        s_val = None
                                    cal_row['status'] = str(s_val or 'ADVANCED')
                                # Per-item specifics
                                if 'hall_id' in cal_allowed and it.get('hall_id') not in (None, ''):
                                    cal_row['hall_id'] = str(it['hall_id'])
                                if 'slot_id' in cal_allowed and it.get('slot_id') not in (None, ''):
                                    cal_row['slot_id'] = str(it['slot_id'])
                                if 'eventdate' in cal_allowed and it.get('eventdate') not in (None, ''):
                                    cal_row['eventdate'] = _norm_date(it['eventdate'])
                                if 'event_type_id' in cal_allowed and it.get('event_type_id') not in (None, ''):
                                    cal_row['event_type_id'] = str(it['event_type_id'])
                                if 'expected_guests' in cal_allowed and it.get('expected_guests') not in (None, ''):
                                    try:
                                        cal_row['expected_guests'] = int(it['expected_guests'])
                                    except Exception:
                                        pass
                                # Audit
                                for audit_col in ['created_by', 'updated_by']:
                                    if audit_col in cal_allowed:
                                        cal_row[audit_col] = current_user.username
                                try:
                                    conn.execute(sa_insert(cal_table).values(**cal_row))
                                    inserted += 1
                                except Exception as _cal_ins_e:
                                    logger.error(f"[BOOKING_UPDATE] Calendar insert failed: {_cal_ins_e} | row={cal_row}")
                            summary['calendar'] = {'replaced': True, 'inserted_count': inserted}
            except Exception as _cal_upd_e:
                logger.debug(f"[BOOKING_UPDATE] Calendar update skipped: {_cal_upd_e}")

            # If booking is SETTLED and no specific payment status was updated, best-effort propagate to the latest payment row only
            try:
                if payment_table is not None and 'SETTLED' == str(locals().get('status_val', '')).upper():
                    allowed_payment_cols = set(payment_table.c.keys())
                    # Identify booking fk and status columns
                    pay_fk = None
                    for cand in ['booking_id', 'bookingID', 'bookingId']:
                        if cand in payment_table.c:
                            pay_fk = cand
                            break
                    status_col = None
                    for cand in ['status', 'STATUS', 'payment_status', 'PaymentStatus']:
                        if cand in payment_table.c:
                            status_col = cand
                            break
                    pk_col_name = 'id' if 'id' in payment_table.c else None
                    if pay_fk and status_col and pk_col_name:
                        from sqlalchemy import select as sa_select
                        from sqlalchemy import desc as sa_desc
                        # Find latest payment row for this booking
                        sel_cols = [payment_table.c[pk_col_name]]
                        if 'created_at' in payment_table.c:
                            sel_cols.append(payment_table.c.created_at)
                        if 'payment_date' in payment_table.c:
                            sel_cols.append(payment_table.c.payment_date)
                        stmt = sa_select(*sel_cols).where(payment_table.c[pay_fk] == canonical_fk_booking_id_value)
                        # Order by common recency columns
                        order_by = []
                        if 'created_at' in payment_table.c:
                            order_by.append(sa_desc(payment_table.c.created_at))
                        if 'payment_date' in payment_table.c:
                            order_by.append(sa_desc(payment_table.c.payment_date))
                        order_by.append(sa_desc(payment_table.c[pk_col_name]))
                        from sqlalchemy import text as sa_text
                        if order_by:
                            stmt = stmt.order_by(*order_by)
                        stmt = stmt.limit(1)
                        row = conn.execute(stmt).first()
                        if row is not None:
                            latest_id = row[0]
                            upd_vals = {status_col: 'SETTLED'}
                            if 'updated_by' in allowed_payment_cols:
                                upd_vals['updated_by'] = current_user.username
                            if 'updated_at' in allowed_payment_cols:
                                from datetime import datetime as _dt
                                upd_vals['updated_at'] = _dt.now()
                            conn.execute(sql_update(payment_table).where(payment_table.c[pk_col_name] == latest_id).values(**upd_vals))
                            summary['payments'].append({"success": True, "updated": True, "propagated_settled": True, "payment_id": latest_id})
            except Exception as _prop_settled_e:
                logger.debug(f"[BOOKING_UPDATE] Skipped settled propagation to payment row: {_prop_settled_e}")

        logger.info(
            f"[BOOKING_UPDATE] Success | Booking ID: {booking_id_value} | Services: {len(summary['services'])} | Payments: {len(summary['payments'])}"
        )
        return summary
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[BOOKING_UPDATE] Error updating booking {req.booking_id}: {e} | Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to update booking: {str(e)}")

# --- Calendar Read Endpoint ---
@app.get("/calendar-month")
def get_calendar_month(
    account_code: str,
    retail_code: str,
    year: int,
    month: int,
    hall_id: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Return calendar entries for a given month/year scoped by account/retail.

    Rules:
    - Include rows where eventdate falls within the month.
      - Join with booking (on booking_id) to fetch hall_id when available.
      - Join with master_customer (on customer_id best-effort) to enrich with name/phone.
      - Expand dual-date rows into separate items (one per eventdate that falls in range).
    """
    logger.info(f"[CALENDAR_READ] /calendar-month acct={account_code} retail={retail_code} {year}-{month:02d} hall={hall_id or '-'}")

    # Guard month/year
    try:
        year = int(year)
        month = int(month)
        assert 1 <= month <= 12
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid year/month")

    from datetime import date, timedelta as _td
    start = date(year, month, 1)
    # first day of next month then minus 1 day
    if month == 12:
        end = date(year + 1, 1, 1) - _td(days=1)
    else:
        end = date(year, month + 1, 1) - _td(days=1)
    start_s = start.isoformat()
    end_s = end.isoformat()

    # Load tables dynamically
    local_md = MetaData()
    try:
        cal_tbl = Table('hallbooking_calander', local_md, autoload_with=engine)
    except Exception:
        raise HTTPException(status_code=500, detail="'hallbooking_calander' table not found")
    # Optional tables
    booking_tbl = None
    customer_tbl = None
    try:
        booking_tbl = Table('booking', local_md, autoload_with=engine)
    except Exception:
        booking_tbl = None
    try:
        customer_tbl = Table('master_customer', local_md, autoload_with=engine)
    except Exception:
        customer_tbl = None

    from sqlalchemy import or_, and_ as sa_and
    # Base where: scope + month filter on either eventdate field
    conds = []
    if 'account_code' in cal_tbl.c:
        conds.append(cal_tbl.c.account_code == account_code)
    if 'retail_code' in cal_tbl.c:
        conds.append(cal_tbl.c.retail_code == retail_code)

    def _in_month(col):
        # Dates are normalized to YYYY-MM-DD strings, so lexicographic comparison works
        return sa_and(col >= start_s, col <= end_s)

    date_conds = []
    if 'eventdate' in cal_tbl.c:
        date_conds.append(_in_month(cal_tbl.c.eventdate))
    # legacy secondary date removed
    if not date_conds:
        raise HTTPException(status_code=500, detail="Calendar table lacks eventdate columns")
    conds.append(or_(*date_conds))

    # Build select with optional joins
    sel_cols = [cal_tbl]
    from sqlalchemy import select as sa_select
    stmt = sa_select(*sel_cols)

    # Join booking for hall_id if possible
    if booking_tbl is not None and 'booking_id' in booking_tbl.c and 'booking_id' in cal_tbl.c:
        jconds = [booking_tbl.c.booking_id == cal_tbl.c.booking_id]
        if 'account_code' in booking_tbl.c:
            jconds.append(booking_tbl.c.account_code == account_code)
        if 'retail_code' in booking_tbl.c:
            jconds.append(booking_tbl.c.retail_code == retail_code)
        stmt = stmt.select_from(cal_tbl.join(booking_tbl, sa_and(*jconds), isouter=True))
        # Append hall_id if present
        if 'hall_id' in booking_tbl.c:
            stmt = stmt.add_columns(booking_tbl.c.hall_id.label('bk_hall_id'))
    # legacy secondary slot removed
        # Apply hall filter if requested: prefer calendar.hall_id, else booking.hall_id
        if hall_id:
            if 'hall_id' in cal_tbl.c:
                conds.append(cal_tbl.c.hall_id == hall_id)
            elif 'hall_id' in booking_tbl.c:
                conds.append(booking_tbl.c.hall_id == hall_id)
    else:
        # No booking join; still select from calendar
        stmt = stmt.select_from(cal_tbl)
        if hall_id and 'hall_id' in cal_tbl.c:
            conds.append(cal_tbl.c.hall_id == hall_id)

    # Join customer for name/phone if possible
    cust_name_cols = []
    cust_phone_cols = []
    if customer_tbl is not None:
        # Find best id column to match cal_tbl.customer_id
        cal_has_cust = 'customer_id' in cal_tbl.c
        join_on = None
        if cal_has_cust:
            if 'customer_id' in customer_tbl.c:
                join_on = customer_tbl.c.customer_id == cal_tbl.c.customer_id
            elif 'id' in customer_tbl.c:
                join_on = customer_tbl.c.id == cal_tbl.c.customer_id
        if join_on is not None:
            # Scope by account/retail if present
            jconds = [join_on]
            if 'account_code' in customer_tbl.c:
                jconds.append(customer_tbl.c.account_code == account_code)
            if 'retail_code' in customer_tbl.c:
                jconds.append(customer_tbl.c.retail_code == retail_code)
            stmt = stmt.select_from(stmt.froms[0].join(customer_tbl, sa_and(*jconds), isouter=True))
            # Pick candidate columns
            for nm in ['customer_name', 'full_name', 'name']:
                if nm in customer_tbl.c:
                    cust_name_cols.append(customer_tbl.c[nm])
            for ph in ['customer_mobile', 'mobile', 'phone']:
                if ph in customer_tbl.c:
                    cust_phone_cols.append(customer_tbl.c[ph])
            # Add first available as columns
            if cust_name_cols:
                stmt = stmt.add_columns(cust_name_cols[0].label('cust_name'))
            if cust_phone_cols:
                stmt = stmt.add_columns(cust_phone_cols[0].label('cust_phone'))

    # Apply where
    from sqlalchemy import and_ as _and
    stmt = stmt.where(_and(*conds))

    # Order by date for stable output
    if 'eventdate' in cal_tbl.c:
        stmt = stmt.order_by(cal_tbl.c.eventdate.asc())

    try:
        with engine.begin() as conn:
            rs = conn.execute(stmt)
            rows = [dict(r._mapping) for r in rs]
        # Normalize into per-day entries
        def _mk_entry(base: dict, date_key: str) -> dict:
            # Only primary fields are used
            slot_val = base.get('slot_id')
            hall_val = base.get('hall_id') if base.get('hall_id') is not None else base.get('bk_hall_id')
            return {
                "date": base.get(date_key),
                "booking_id": base.get('booking_id'),
                "slot_id": slot_val,
                "customer_id": base.get('customer_id'),
                # Prefer hall_id from calendar table, fallback to joined booking
                "hall_id": hall_val,
                "status": base.get('status') or 'ADVANCED',
                "customer_name": base.get('cust_name'),
                "customer_phone": base.get('cust_phone'),
            }

        data: List[Dict[str, Any]] = []
        for row in rows:
            # expand eventdate when present and in range
            for dk in ['eventdate']:
                dval = row.get(dk)
                if not dval:
                    continue
                if isinstance(dval, str) and (dval < start_s or dval > end_s):
                    continue
                item = {**row}
                data.append(_mk_entry(item, dk))

        logger.info(f"[CALENDAR_READ] Found {len(data)} entries for {year}-{month:02d}")
        return {"success": True, "count": len(data), "data": data}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[CALENDAR_READ] Error: {e} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to read calendar data")

# --- Helper: dedicated user details endpoint for edit UI ---
@app.get("/users/{user_identifier}/details")
def get_user_details(user_identifier: str, current_user: Optional[User] = Depends(get_current_user)):
    """Return the user row and its users_screen_access rows.

    - user_identifier may be the string user_id, numeric id, or username.
    - Scopes the lookup by account_code/retail_code when caller is authenticated.
    - This avoids using the generic /read endpoint from the client for edits.
    """
    try:
        local_md = MetaData()
        users_tbl = Table('users', local_md, autoload_with=engine)
    except Exception:
        raise HTTPException(status_code=500, detail="'users' table not found")

    try:
        with engine.begin() as conn:
            # Try canonical string user_id match first
            stmt = select(users_tbl)
            stmt = stmt.where(users_tbl.c.user_id == user_identifier)
            row = conn.execute(stmt).mappings().first()

            # If not found, try numeric id
            if not row:
                try:
                    nid = int(user_identifier)
                    stmt = select(users_tbl).where(users_tbl.c.id == nid)
                    row = conn.execute(stmt).mappings().first()
                except Exception:
                    row = None

            # If still not found, try username
            if not row:
                stmt = select(users_tbl).where(users_tbl.c.username == user_identifier)
                row = conn.execute(stmt).mappings().first()

            if not row:
                raise HTTPException(status_code=404, detail="User not found")

            user_row = dict(row)

            # Enforce tenant scoping when possible
            if current_user:
                for sc in ('account_code', 'retail_code'):
                    if sc in users_tbl.c and getattr(current_user, sc, None) and user_row.get(sc) != getattr(current_user, sc):
                        raise HTTPException(status_code=403, detail='Forbidden')

            # Fetch related users_screen_access rows (robust to stored user_id format)
            screens: List[Dict[str, Any]] = []
            try:
                usa_tbl = Table('users_screen_access', MetaData(), autoload_with=engine)
                sel = select(usa_tbl)
                from sqlalchemy import or_
                conds = []
                # match by canonical string user_id if present in users row
                if 'user_id' in usa_tbl.c and user_row.get('user_id') is not None:
                    conds.append(usa_tbl.c.user_id == user_row.get('user_id'))
                # also match by numeric id if value present
                if 'user_id' in usa_tbl.c and user_row.get('id') is not None:
                    conds.append(usa_tbl.c.user_id == user_row.get('id'))
                if conds:
                    sel = sel.where(or_(*conds))

                # scope by account/retail if columns exist
                if 'account_code' in usa_tbl.c and user_row.get('account_code'):
                    sel = sel.where(usa_tbl.c.account_code == user_row.get('account_code'))
                if 'retail_code' in usa_tbl.c and user_row.get('retail_code'):
                    sel = sel.where(usa_tbl.c.retail_code == user_row.get('retail_code'))

                res = conn.execute(sel)
                screens = [dict(r._mapping) for r in res]
            except Exception as e:
                logger.debug(f"[USER_DETAILS] Failed to load users_screen_access: {e}", exc_info=True)

            return {"success": True, "user": user_row, "screens": screens}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[USER_DETAILS] Error loading details for '{user_identifier}': {e} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail="Failed to load user details")


# PUT /users - update existing user (or create if missing) and sync screens
@app.put("/users")
async def update_user(req: CreateUserRequest, request: Request, current_user: Optional[User] = Depends(get_current_user)):
    """Update an existing user. The same request model as create is accepted.

    Behaviour:
    - If req contains user_id or id, perform an update; otherwise create via crud_create_row.
    - Sync users_screen_access rows: remove rows not present in incoming screens for this user, upsert provided ones.
    """
    try:
        # Parse raw JSON to pick up keys Pydantic may have ignored (e.g., 'role' or 'user_id')
        raw_json = {}
        try:
            raw_json = await request.json()
        except Exception:
            raw_json = {}

        # Map legacy 'role' -> role_id if provided in raw payload
        if 'role' in raw_json and 'role_id' not in raw_json:
            try:
                rv = raw_json.get('role')
                if isinstance(rv, (int, float)):
                    raw_json['role_id'] = int(rv)
                elif isinstance(rv, str) and rv.isdigit():
                    raw_json['role_id'] = int(rv)
            except Exception:
                pass

        # Determine target user by user_id or id or username
        target_user = None
        with engine.begin() as conn:
            users_tbl = Table('users', MetaData(), autoload_with=engine)
            if raw_json.get('user_id'):
                sel = select(users_tbl).where(users_tbl.c.user_id == raw_json.get('user_id'))
                target_user = conn.execute(sel).mappings().first()
            # allow numeric id in payload
            if not target_user and raw_json.get('id'):
                try:
                    nid = int(raw_json.get('id'))
                    sel = select(users_tbl).where(users_tbl.c.id == nid)
                    target_user = conn.execute(sel).mappings().first()
                except Exception:
                    target_user = None
            # fallback to username lookup
            if not target_user:
                sel = select(users_tbl).where(users_tbl.c.username == req.username)
                target_user = conn.execute(sel).mappings().first()

        payload = {
            'username': req.username,
            'account_code': req.account_code,
            'retail_code': req.retail_code,
        }
        # Only include password if provided (update may omit it).
        # Accept either Pydantic-mapped 'password' or a raw 'hashed_password' sent by older frontends.
        pw_val = None
        if getattr(req, 'password', None):
            pw_val = req.password
        # raw_json may carry 'hashed_password' or 'password' when Pydantic ignored it
        if not pw_val and raw_json.get('hashed_password'):
            pw_val = raw_json.get('hashed_password')
        if not pw_val and raw_json.get('password'):
            pw_val = raw_json.get('password')
        if pw_val:
            payload['hashed_password'] = pw_val
        if req.email:
            payload['email_id'] = req.email
        if getattr(req, 'role_id', None) is not None:
            payload['role_id'] = req.role_id
        if getattr(req, 'phone_number', None) is not None:
            payload['phone_number'] = req.phone_number
        # Map status/is_active flags from either Pydantic model or raw JSON if present
        try:
            status_val: Optional[int] = None
            if getattr(req, 'status', None) is not None:
                status_val = 1 if bool(req.status) else 0
            elif getattr(req, 'is_active', None) is not None:
                status_val = 1 if bool(req.is_active) else 0
            elif 'status' in raw_json:
                status_val = 1 if bool(raw_json.get('status')) else 0
            elif 'is_active' in raw_json:
                status_val = 1 if bool(raw_json.get('is_active')) else 0
            if status_val is not None:
                # Defer exact column names until we know the users table columns below
                payload['__status_numeric__'] = status_val
        except Exception:
            pass

        # If password provided and looks unhashed, hash it
        if 'hashed_password' in payload:
            try:
                val = str(payload.get('hashed_password') or '')
                if val and not val.startswith('$2'):
                    payload['hashed_password'] = get_password_hash(val)
            except Exception:
                payload['hashed_password'] = get_password_hash(str(payload.get('hashed_password') or ''))

        # If target_user exists, update via crud_update_row; else create
        if target_user:
            # Build update data including primary key 'id'
            upd = dict(payload)
            upd['id'] = target_user.get('id')
            # Perform a direct SQLAlchemy update here to avoid reflection/PK detection issues
            try:
                # use module-level Table and MetaData imports (avoid local import which makes Table a local symbol)
                tbl = Table('users', MetaData(), autoload_with=engine)
                pk_value = target_user.get('id')
                update_data = dict(upd)
                update_data.pop('id', None)
                # Normalize status column names depending on schema
                try:
                    cols_set = set(tbl.c.keys())
                    # If we staged a numeric status value, expand to actual available columns
                    if '__status_numeric__' in update_data:
                        val = update_data.pop('__status_numeric__')
                        if 'status' in cols_set:
                            update_data['status'] = val
                        if 'is_active' in cols_set:
                            update_data['is_active'] = val
                        if 'active' in cols_set:
                            update_data['active'] = val
                    # If client sent is_active but table lacks it, try 'active'
                    if 'is_active' in update_data and 'is_active' not in cols_set and 'active' in cols_set:
                        update_data['active'] = update_data.pop('is_active')
                except Exception:
                    pass
                # Ensure account_code/retail_code are present in where clause
                # Update by primary key only. Tenant scoping has already been validated earlier.
                stmt = sql_update(tbl).where(tbl.c.id == pk_value).values(**update_data)
                with engine.begin() as conn:
                    result = conn.execute(stmt)
                resp = {"success": True, "updated_rows": result.rowcount, "inserted_id": pk_value, "user_id": target_user.get('user_id')}
            except Exception as e:
                logger.error(f"[UPDATE_USER] Direct update failed: {e} | Trace: {traceback.format_exc()}")
                raise HTTPException(status_code=500, detail=str(e))
        else:
            resp = crud_create_row('users', payload, None)

        # Now sync screens if provided
        try:
            inserted_id = resp.get('inserted_id') or (target_user.get('id') if target_user else None)
            # Determine canonical user_id string
            user_identifier = None
            if target_user and target_user.get('user_id'):
                user_identifier = target_user.get('user_id')
            elif resp.get('user_id'):
                user_identifier = resp.get('user_id')
            elif inserted_id and req.retail_code:
                user_identifier = f"{req.retail_code}U{inserted_id}"

            # Use screens from raw_json if Pydantic ignored them
            screens_incoming = raw_json.get('screens', req.screens)
            if screens_incoming is not None and engine is not None:
                # load allowed columns and prepare inserts
                insp = sqlalchemy_inspect(engine)
                cols_info = insp.get_columns('users_screen_access')
                allowed_cols = {c['name'] for c in cols_info}
                now = datetime.utcnow()
                with engine.begin() as conn:
                    # Build delete condition: remove all rows for this user (we'll re-insert incoming set)
                    usa_tbl = Table('users_screen_access', MetaData(), autoload_with=engine)
                    from sqlalchemy import or_
                    # Determine user_id column typing to avoid comparing string to numeric (or vice versa)
                    user_id_col = usa_tbl.c.get('user_id') if 'user_id' in usa_tbl.c else None
                    user_id_is_string = False
                    user_id_is_numeric = False
                    if user_id_col is not None:
                        try:
                            from sqlalchemy.sql.sqltypes import String as SAString, Unicode, Text as SAText, Integer as SAInteger, BigInteger, Numeric as SANumeric, Float as SAFloat
                            user_id_is_string = isinstance(user_id_col.type, (SAString, Unicode, SAText))
                            user_id_is_numeric = isinstance(user_id_col.type, (SAInteger, BigInteger, SANumeric, SAFloat))
                        except Exception:
                            pass

                    del_conds = []
                    # Prefer matching the correct type for user_id
                    if user_id_col is not None:
                        if user_id_is_string and user_identifier is not None:
                            del_conds.append(user_id_col == str(user_identifier))
                        elif user_id_is_numeric and inserted_id is not None:
                            try:
                                del_conds.append(user_id_col == int(inserted_id))
                            except Exception:
                                # fallback: skip numeric compare if cannot coerce
                                pass
                        else:
                            # Fallback: try string id first, then numeric
                            if user_identifier is not None:
                                del_conds.append(user_id_col == str(user_identifier))
                            if inserted_id is not None:
                                try:
                                    del_conds.append(user_id_col == int(inserted_id))
                                except Exception:
                                    pass

                    if del_conds:
                        del_stmt = sql_delete(usa_tbl).where(or_(*del_conds))
                        conn.execute(del_stmt)

                    # Insert incoming rows fresh
                    for s in (screens_incoming or []):
                        sid = int(s.get('screen_id')) if s.get('screen_id') is not None else None
                        if sid is None:
                            continue
                        # Choose correct user_id value aligned with column type
                        cand_user_id = None
                        if user_id_col is not None:
                            if user_id_is_string:
                                cand_user_id = str(user_identifier) if user_identifier is not None else (str(inserted_id) if inserted_id is not None else None)
                            elif user_id_is_numeric:
                                try:
                                    cand_user_id = int(inserted_id) if inserted_id is not None else (int(str(user_identifier).replace('\n','').strip()) if user_identifier is not None and str(user_identifier).strip().isdigit() else None)
                                except Exception:
                                    cand_user_id = int(inserted_id) if isinstance(inserted_id, int) else None
                            else:
                                cand_user_id = user_identifier if user_identifier is not None else inserted_id
                        else:
                            cand_user_id = user_identifier if user_identifier is not None else inserted_id

                        cand = {
                            'user_id': cand_user_id,
                            'screen_id': sid,
                            'can_view': 1 if s.get('can_view') else 0,
                            'can_edit': 1 if s.get('can_edit') else 0,
                            'created_at': now,
                            'updated_at': now,
                        }
                        row = {k: v for k, v in cand.items() if k in allowed_cols and v is not None}
                        if row:
                            col_list = sorted(row.keys())
                            placeholders = ','.join([f":{c}" for c in col_list])
                            col_names = ','.join(col_list)
                            insert_sql = text(f"INSERT INTO users_screen_access ({col_names}) VALUES ({placeholders})")
                            conn.execute(insert_sql, row)
        except Exception as e:
            logger.error(f"[UPDATE_USER] Failed to sync users_screen_access: {e} | Trace: {traceback.format_exc()}")

        return {"success": True, "result": resp}
    except Exception as e:
        logger.error(f"[UPDATE_USER] Error: {e} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# =============================
# Attendance endpoints
# =============================
class AttendanceUpsert(BaseModel):
    account_code: str
    retail_code: str
    employee_id: int
    attendance_date: str  # 'YYYY-MM-DD'
    status: str  # Present/Absent/Half Day or present/absent/half-day
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    remarks: Optional[str] = None


def _normalize_attendance_status(val: str) -> str:
    try:
        s = str(val or '').strip().lower()
    except Exception:
        s = 'absent'
    if s in ['present', 'p', '1', 'true', 'yes', 'y']:
        return 'Present'
    if s in ['half day', 'half-day', 'half', 'h', '0.5', '0,5']:
        return 'Half Day'
    return 'Absent'


def _normalize_time_hhmmss(val: Optional[str]) -> Optional[str]:
    if val is None:
        return None
    try:
        s = str(val).strip()
    except Exception:
        return None
    if s == '':
        return None
    # Accept HH:MM and promote to HH:MM:SS
    if len(s) == 5 and s[2] == ':':
        return f"{s}:00"
    return s


def _pick_first_col(cols: set, candidates: list) -> Optional[str]:
    for c in candidates:
        if c in cols:
            return c
    return None


@app.post("/attendance/upsert", tags=["attendance"], summary="Create or update a staff attendance record for a given date")
def upsert_staff_attendance(req: AttendanceUpsert, current_user: User = Depends(get_current_user)):
    """Insert a new attendance record or update the existing one for the employee/date.

    Uniqueness is determined by (account_code, retail_code, employee_id, attendance_date).
    """
    tbl = Table('staff_attendance', MetaData(), autoload_with=engine)
    acc = req.account_code
    ret = req.retail_code
    emp_id = req.employee_id
    att_date = req.attendance_date
    status_val = _normalize_attendance_status(req.status)
    check_in_val = _normalize_time_hhmmss(req.check_in_time)
    check_out_val = _normalize_time_hhmmss(req.check_out_time)

    try:
        with engine.begin() as conn:
            cols = set(tbl.c.keys())
            check_in_col = _pick_first_col(cols, ['check_in_time', 'CheckIn', 'checkin', 'check_in'])
            check_out_col = _pick_first_col(cols, ['check_out_time', 'CheckOut', 'checkout', 'check_out'])
            sel = select(tbl.c.attendance_id).where(
                tbl.c.account_code == acc,
                tbl.c.retail_code == ret,
                tbl.c.employee_id == emp_id,
                tbl.c.attendance_date == att_date,
            )
            existing = conn.execute(sel).first()
            if existing:
                att_id = existing._mapping.get('attendance_id') if hasattr(existing, '_mapping') else existing[0]
                update_values = {}
                if 'status' in cols:
                    update_values['status'] = status_val
                if req.check_in_time is not None and check_in_col is not None:
                    update_values[check_in_col] = check_in_val
                if req.check_out_time is not None and check_out_col is not None:
                    update_values[check_out_col] = check_out_val
                if req.remarks is not None and 'remarks' in cols:
                    update_values['remarks'] = req.remarks

                if update_values:
                    upd = sql_update(tbl).where(tbl.c.attendance_id == att_id).values(**update_values)
                    conn.execute(upd)
                action = 'updated'
                record_id = att_id
            else:
                insert_values = {
                    'account_code': acc,
                    'retail_code': ret,
                    'employee_id': emp_id,
                    'attendance_date': att_date,
                }
                if 'status' in cols:
                    insert_values['status'] = status_val
                if req.check_in_time is not None and check_in_col is not None:
                    insert_values[check_in_col] = check_in_val
                if req.check_out_time is not None and check_out_col is not None:
                    insert_values[check_out_col] = check_out_val
                if req.remarks is not None and 'remarks' in cols:
                    insert_values['remarks'] = req.remarks

                ins = sql_insert(tbl).values(**insert_values)
                res = conn.execute(ins)
                rid = None
                try:
                    if getattr(res, 'inserted_primary_key', None):
                        rid = res.inserted_primary_key[0]
                except Exception:
                    rid = None
                if rid is None:
                    try:
                        rid = getattr(res, 'lastrowid', None)
                    except Exception:
                        rid = None
                record_id = rid
                action = 'created'

            # Return the current record
            sel2 = select(tbl).where(
                tbl.c.account_code == acc,
                tbl.c.retail_code == ret,
                tbl.c.employee_id == emp_id,
                tbl.c.attendance_date == att_date,
            )
            row = conn.execute(sel2).first()
            payload = dict(row._mapping) if row is not None else None
        return {"success": True, "action": action, "attendance_id": record_id, "data": payload}
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=f"Attendance upsert failed: {str(e)}")


class AttendanceByDate(BaseModel):
    account_code: str
    retail_code: str
    attendance_date: str  # 'YYYY-MM-DD'
    employee_ids: Optional[List[int]] = None


@app.post("/attendance/by-date", tags=["attendance"], summary="Fetch staff attendance rows for a specific date")
def get_attendance_by_date(req: AttendanceByDate, current_user: User = Depends(get_current_user)):
    tbl = Table('staff_attendance', MetaData(), autoload_with=engine)
    try:
        from sqlalchemy import and_ as _and
        conds = [
            tbl.c.account_code == req.account_code,
            tbl.c.retail_code == req.retail_code,
            tbl.c.attendance_date == req.attendance_date,
        ]
        if req.employee_ids:
            conds.append(tbl.c.employee_id.in_(req.employee_ids))
        stmt = select(tbl).where(_and(*conds))
        with engine.begin() as conn:
            rows = [dict(r._mapping) for r in conn.execute(stmt)]
        return {"success": True, "data": rows}
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=f"Attendance fetch failed: {str(e)}")


class AttendanceByMonth(BaseModel):
    account_code: str
    retail_code: str
    employee_id: int
    month: str  # 'YYYY-MM'


@app.get("/attendance/by-month", tags=["attendance"], summary="Fetch staff attendance for an employee in a month with store leaves and summary")
def get_attendance_by_month(account_code: str, retail_code: str, employee_id: int, month: str, current_user: User = Depends(get_current_user)):
    # Date window
    try:
        y, m = month.split("-")
        start = f"{y}-{m}-01"
        m_i = int(m)
        y_i = int(y)
        if m_i == 12:
            end = f"{y_i+1}-01-01"
        else:
            end = f"{y}-{m_i+1:02d}-01"
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid month format; expected YYYY-MM")

    # Attendance rows
    try:
        att_tbl = _reflect_table('staff_attendance')
    except Exception:
        return {"success": True, "data": [], "summary": {"present": 0, "half": 0, "absent": 0, "paidDays": 0.0}, "store_leaves": []}
    cols = set(att_tbl.c.keys())
    from sqlalchemy import and_ as _and
    conds = []
    if 'account_code' in cols:
        conds.append(att_tbl.c.account_code == account_code)
    if 'retail_code' in cols:
        conds.append(att_tbl.c.retail_code == retail_code)
    if 'employee_id' in cols:
        conds.append(att_tbl.c.employee_id == str(employee_id))
    if 'attendance_date' in cols:
        conds.append(att_tbl.c.attendance_date >= start)
        conds.append(att_tbl.c.attendance_date < end)
    rows = []
    present = half = absent = 0
    with engine.begin() as conn:
        for r in conn.execute(select(att_tbl).where(_and(*conds)).order_by(att_tbl.c.attendance_date.asc())):
            d = dict(r._mapping)
            status = str(d.get('status') or '').strip().lower()
            if status in ['present','p','1','true','yes','y']:
                present += 1
                norm = 'present'
            elif status in ['half day','half-day','half','h','0.5','0,5']:
                half += 1
                norm = 'half'
            else:
                absent += 1
                norm = 'absent'
            rows.append({
                'date': str(d.get('attendance_date'))[:10],
                'status': norm,
                'raw': d
            })
    paid_days = round(present + 0.5 * half, 2)

    # Store leave days for the month
    _ensure_store_leave_table()
    sl_tbl = _reflect_table('store_leave_days')
    from sqlalchemy import and_ as _and2
    sl_stmt = select(sl_tbl.c.leave_date).where(
        _and2(
            (sl_tbl.c.account_code == account_code) if 'account_code' in sl_tbl.c.keys() else text('1=1'),
            (sl_tbl.c.retail_code == retail_code) if 'retail_code' in sl_tbl.c.keys() else text('1=1'),
            sl_tbl.c.leave_date >= start,
            sl_tbl.c.leave_date < end,
        )
    ).order_by(sl_tbl.c.leave_date.asc())
    leaves = []
    with engine.begin() as conn:
        leaves = [str(r[0])[:10] for r in conn.execute(sl_stmt)]

    return {
        "success": True,
        "data": rows,
        "summary": {"present": present, "half": half, "absent": absent, "paidDays": paid_days},
        "store_leaves": leaves,
        "range": {"start": start, "end": end}
    }


# =============================
# Store Leave Days (shop holidays)
# =============================
class StoreLeaveSaveMonth(BaseModel):
    account_code: str
    retail_code: str
    month: str  # 'YYYY-MM'
    dates: List[str]  # array of 'YYYY-MM-DD'
    note: Optional[str] = None


def _ensure_store_leave_table():
    """Create store_leave_days table if missing."""
    md = MetaData()
    try:
        Table('store_leave_days', md, autoload_with=engine)
        return
    except Exception:
        pass
    with engine.begin() as conn:
        conn.exec_driver_sql(
            """
            CREATE TABLE IF NOT EXISTS store_leave_days (
                id INT AUTO_INCREMENT PRIMARY KEY,
                account_code VARCHAR(50) NOT NULL,
                retail_code VARCHAR(50) NOT NULL,
                leave_date VARCHAR(10) NOT NULL,
                note VARCHAR(255) NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_store_leave (account_code, retail_code, leave_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """
        )


@app.get("/store-leaves/list", tags=["attendance"], summary="List store leave dates for a date range (or month for compatibility)")
def list_store_leaves(
    account_code: str,
    retail_code: str,
    month: Optional[str] = None,
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    _ensure_store_leave_table()
    # Prefer explicit date range, else derive range from month
    if fromdate and todate:
        start = _normalize_day(fromdate)
        end_inclusive = _normalize_day(todate)
        # We'll use <= end_inclusive since dates are stored as YYYY-MM-DD strings
        range_filter = (start, end_inclusive)
    else:
        if not month:
            raise HTTPException(status_code=400, detail="Provide either fromdate/todate or month")
        try:
            y, m = month.split("-")
            start = f"{y}-{m}-01"
            m_i = int(m)
            y_i = int(y)
            if m_i == 12:
                end_next = f"{y_i+1}-01-01"
            else:
                end_next = f"{y}-{m_i+1:02d}-01"
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")
        # For month path we use < next-month-first-day
        range_filter = (start, end_next)

    tbl = Table('store_leave_days', MetaData(), autoload_with=engine)
    from sqlalchemy import and_ as _and
    if fromdate and todate:
        stmt = select(tbl.c.leave_date).where(
            _and(
                tbl.c.account_code == account_code,
                tbl.c.retail_code == retail_code,
                tbl.c.leave_date >= range_filter[0],
                tbl.c.leave_date <= range_filter[1],
            )
        ).order_by(tbl.c.leave_date.asc())
    else:
        stmt = select(tbl.c.leave_date).where(
            _and(
                tbl.c.account_code == account_code,
                tbl.c.retail_code == retail_code,
                tbl.c.leave_date >= range_filter[0],
                tbl.c.leave_date < range_filter[1],
            )
        ).order_by(tbl.c.leave_date.asc())
    with engine.begin() as conn:
        rows = [r[0] for r in conn.execute(stmt)]
    return {"success": True, "data": rows}


@app.post("/store-leaves/save-month", tags=["attendance"], summary="Replace store leave dates for a month")
def save_store_leaves_month(req: StoreLeaveSaveMonth, current_user: User = Depends(get_current_user)):
    _ensure_store_leave_table()
    try:
        y, m = req.month.split("-")
        start = f"{y}-{m}-01"
        m_i = int(m)
        y_i = int(y)
        if m_i == 12:
            end = f"{y_i+1}-01-01"
        else:
            end = f"{y}-{m_i+1:02d}-01"
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid month format. Use YYYY-MM")

    # Normalize incoming dates to this month and proper format
    want_prefix = f"{y}-{m}-"
    dates_norm = []
    for d in req.dates or []:
        s = str(d).strip()[:10]
        if not s:
            continue
        if len(s) == 2:  # day only
            s = want_prefix + s.zfill(2)
        if len(s) == 1:
            s = want_prefix + ("0" + s)
        if not s.startswith(want_prefix):
            # skip out-of-month silently
            continue
        dates_norm.append(s)

    tbl = Table('store_leave_days', MetaData(), autoload_with=engine)
    from sqlalchemy import and_ as _and
    with engine.begin() as conn:
        # Delete existing rows for month
        del_stmt = tbl.delete().where(
            _and(
                tbl.c.account_code == req.account_code,
                tbl.c.retail_code == req.retail_code,
                tbl.c.leave_date >= start,
                tbl.c.leave_date < end,
            )
        )
        conn.execute(del_stmt)
        # Insert new rows
        if dates_norm:
            rows = [
                {
                    'account_code': req.account_code,
                    'retail_code': req.retail_code,
                    'leave_date': d,
                    'note': req.note or None,
                }
                for d in sorted(set(dates_norm))
            ]
            conn.execute(tbl.insert(), rows)
    return {"success": True, "count": len(set(dates_norm))}

# =============================
# Employee Incentive endpoints
# =============================
class IncentiveItem(BaseModel):
    service_id: int
    incentive_type: str  # 'percentage' | 'fixed'
    value: float

class SaveIncentiveMapping(BaseModel):
    account_code: str
    retail_code: str
    employee_id: int
    base_salary: Optional[float] = 0
    effective_from: str  # 'YYYY-MM' or 'YYYY-MM-01'
    pay_cycle: str  # 'monthly' | 'weekly'
    target: Optional[float] = None
    incentive: Optional[float] = None
    # New: explicit per-day leave deduction amount from UI
    leave_deduction_amount: Optional[float] = None
    incentives: List[IncentiveItem]


def _update_employee_base_salary(account_code: str, retail_code: str, employee_id: int, base_salary: Optional[float]):
    if base_salary is None:
        return
    # Try common employee table names
    for tbl_name in ['master_employee', 'employee_master']:
        try:
            tbl = _reflect_table(tbl_name)
            cols = set(tbl.c.keys())
            salary_field = None
            # Prefer 'base_salary' if exists, else 'annual_salary'
            if 'base_salary' in cols:
                salary_field = 'base_salary'
            elif 'annual_salary' in cols:
                salary_field = 'annual_salary'
            if salary_field is None:
                continue
            # If only annual_salary available and pay cycle is monthly, approximate annual = base * 12
            value = base_salary
            if salary_field == 'annual_salary':
                try:
                    value = float(base_salary) * 12.0
                except Exception:
                    pass
            upd = (
                sql_update(tbl)
                .where(
                    and_(
                        (tbl.c.employee_id == employee_id) if 'employee_id' in cols else (tbl.c.id == employee_id),
                        (tbl.c.account_code == account_code) if 'account_code' in cols else text('1=1'),
                        (tbl.c.retail_code == retail_code) if 'retail_code' in cols else text('1=1'),
                    )
                )
                .values({salary_field: value})
            )
            with engine.begin() as conn:
                conn.execute(upd)
            return
        except Exception:
            continue


def _update_master_employee_payroll_fields(account_code: str, retail_code: str, employee_id: int,
                                           base_salary: Optional[float], effective_date: str, pay_cycle: str,
                                           target: Optional[float] = None, incentive: Optional[float] = None,
                                           leave_deduction_amount: Optional[float] = None):
    """Update master_employee fields BaseSalary, EffectiveFrom, PayCycle when those columns exist.

    This handles case-insensitive column names and employee identifier by either
    'employee_id' or 'id' depending on schema.
    """
    try:
        tbl = _reflect_table('master_employee')
    except Exception:
        return  # table not available; skip silently

    cols_actual = list(tbl.c.keys())
    cols_lower_to_actual = {c.lower(): c for c in cols_actual}

    update_vals: Dict[str, Any] = {}
    if 'basesalary' in cols_lower_to_actual and base_salary is not None:
        update_vals[cols_lower_to_actual['basesalary']] = float(base_salary)
    if 'effectivefrom' in cols_lower_to_actual and effective_date:
        update_vals[cols_lower_to_actual['effectivefrom']] = effective_date
    if 'paycycle' in cols_lower_to_actual and pay_cycle:
        # Capitalize for presentation if desired (Monthly/Weekly)
        pretty = 'Monthly' if str(pay_cycle).lower() == 'monthly' else ('Weekly' if str(pay_cycle).lower() == 'weekly' else str(pay_cycle))
        update_vals[cols_lower_to_actual['paycycle']] = pretty
    # Optional Target & Incentive columns
    if 'target' in cols_lower_to_actual and target is not None:
        try:
            update_vals[cols_lower_to_actual['target']] = float(target)
        except Exception:
            pass
    if 'incentive' in cols_lower_to_actual and incentive is not None:
        try:
            update_vals[cols_lower_to_actual['incentive']] = float(incentive)
        except Exception:
            pass
    # Optional Leave Deduction column (case-insensitive). Try multiple naming variants.
    for key in ['leave_deduction_amount', 'leavedeductionamount', 'leave_deduction_per_day', 'leave_per_day']:
        if key in cols_lower_to_actual and leave_deduction_amount is not None:
            try:
                update_vals[cols_lower_to_actual[key]] = float(leave_deduction_amount)
            except Exception:
                pass

    if not update_vals:
        return

    # Build where condition
    from sqlalchemy import and_ as _and
    conds = []
    if 'account_code' in tbl.c.keys():
        conds.append(tbl.c.account_code == account_code)
    if 'retail_code' in tbl.c.keys():
        conds.append(tbl.c.retail_code == retail_code)
    if 'employee_id' in tbl.c.keys():
        conds.append(tbl.c.employee_id == str(employee_id))
    elif 'id' in tbl.c.keys():
        conds.append(tbl.c.id == int(employee_id))

    if not conds:
        return

    stmt = sql_update(tbl).where(_and(*conds)).values(**update_vals)
    try:
        with engine.begin() as conn:
            conn.execute(stmt)
    except Exception:
        # do not fail main operation if this auxiliary update fails
        logger.debug("[INCENTIVE] Skipped updating master_employee payroll fields", exc_info=True)

@app.post("/employee-incentives/save-mapping", tags=["payroll"], summary="Create/replace incentive mapping for an employee and period")
def save_employee_incentive_mapping(req: SaveIncentiveMapping, current_user: User = Depends(get_current_user)):
    tbl = _reflect_table('employee_incentive')
    # Keep effective_from only for updating master_employee (not stored in employee_incentive)
    effective_date = _normalize_effective_from(req.effective_from) if getattr(req, 'effective_from', None) else None

    # Business rule: manual incentive cannot exceed target when both provided
    try:
        if req.incentive is not None and req.target is not None:
            if float(req.incentive) > float(req.target):
                raise HTTPException(status_code=400, detail="Incentive cannot be greater than Target")
    except HTTPException:
        raise
    except Exception:
        pass

    # Normalize type values
    def norm_type(t: str) -> str:
        s = (t or '').strip().lower()
        return 'fixed' if s == 'fixed' else 'percentage'

    try:
        # Deduplicate incoming incentives by service_id
        unique_by_service: Dict[int, IncentiveItem] = {}
        for it in req.incentives:
            try:
                sid = int(it.service_id)
            except Exception:
                continue
            unique_by_service[sid] = it

        with engine.begin() as conn:
            # Remove existing mapping for same employee (mappings are not date-bound on this table)
            del_stmt = sql_delete(tbl).where(
                and_(
                    (tbl.c.account_code == req.account_code) if 'account_code' in tbl.c else text('1=1'),
                    (tbl.c.retail_code == req.retail_code) if 'retail_code' in tbl.c else text('1=1'),
                    tbl.c.employee_id == req.employee_id,
                )
            )
            conn.execute(del_stmt)

            # Insert new rows (no pay_cycle column written)
            for item in unique_by_service.values():
                # Server-side guard: percentage cannot exceed 100 or go below 0
                tnorm = (item.incentive_type or '').lower().strip()
                if tnorm == 'percentage':
                    try:
                        valf = float(item.value or 0)
                    except Exception:
                        valf = 0.0
                    if valf < 0 or valf > 100:
                        raise HTTPException(status_code=400, detail="Percentage value must be between 0 and 100")
                ins = sql_insert(tbl).values(
                    account_code=req.account_code,
                    retail_code=req.retail_code,
                    employee_id=req.employee_id,
                    service_id=int(item.service_id),
                    incentive_type=norm_type(item.incentive_type),
                    value=Decimal(str(min(max(float(item.value or 0), 0.0), 100.0))) if tnorm == 'percentage' else Decimal(str(item.value or 0)),
                    created_by=current_user.username if current_user else None,
                    updated_by=current_user.username if current_user else None,
                )
                conn.execute(ins)

        # Update payroll fields (BaseSalary, EffectiveFrom, PayCycle) on master_employee when available
        try:
            _update_master_employee_payroll_fields(
                req.account_code, req.retail_code, req.employee_id,
                req.base_salary, effective_date or '', req.pay_cycle,
                req.target, req.incentive,
                req.leave_deduction_amount
            )
        except Exception as e:
            logger.debug(f"[INCENTIVE] Skip master_employee payroll update: {e}")

        return {"success": True}
    except Exception as e:
        logger.error(f"[INCENTIVE_SAVE] Error: {e} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/employee-incentives/list", tags=["payroll"], summary="List incentive mappings grouped by employee (filter by date range for totals)")
def list_employee_incentives(
    account_code: str,
    retail_code: str,
    employee_id: Optional[int] = None,
    # Back-compat param (kept): filter incentive mapping rows by their effective_from month (YYYY-MM or YYYY-MM-01)
    effective_from: Optional[str] = None,
    # New optional date window to compute billing/incentive totals and attendance
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    # Back-compat alias sometimes used by frontend; if provided, behaves like effective_from month
    month: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    # Read incentive mappings if table exists; otherwise continue with empty rows
    rows: List[Dict[str, Any]] = []
    try:
        tbl = _reflect_table('employee_incentive')
        with engine.begin() as conn:
            stmt = select(tbl)
            stmt = stmt.where(tbl.c.account_code == account_code, tbl.c.retail_code == retail_code)
            if employee_id is not None:
                stmt = stmt.where(tbl.c.employee_id == employee_id)
            rows = [dict(r._mapping) for r in conn.execute(stmt)]

        # Group in Python into mapping records
        groups: Dict[int, Dict[str, Any]] = {}
        # Try load employee names and payroll fields from master_employee if present
        emp_names: Dict[int, Dict[str, Any]] = {}
        try:
            emp_tbl = _reflect_table('master_employee')
            sel_emp = select(emp_tbl)
            sel_emp = sel_emp.where(
                (emp_tbl.c.account_code == account_code) if 'account_code' in emp_tbl.c else text('1=1'),
                (emp_tbl.c.retail_code == retail_code) if 'retail_code' in emp_tbl.c else text('1=1'),
            )
            with engine.begin() as conn:
                for er in conn.execute(sel_emp):
                    d = dict(er._mapping)
                    key = d.get('employee_id') or d.get('id')
                    if key is not None:
                        # Case-insensitive access to BaseSalary/EffectiveFrom/PayCycle
                        lower = {k.lower(): k for k in d.keys()}
                        base_salary = None
                        if 'basesalary' in lower:
                            try:
                                base_salary = float(d.get(lower['basesalary']) or 0)
                            except Exception:
                                base_salary = 0
                        elif 'base_salary' in lower:
                            try:
                                base_salary = float(d.get(lower['base_salary']) or 0)
                            except Exception:
                                base_salary = 0
                        # Target & Incentive (optional)
                        tgt_val = None
                        if 'target' in lower:
                            try:
                                tgt_val = float(d.get(lower['target']) or 0)
                            except Exception:
                                tgt_val = 0
                        inc_val = None
                        if 'incentive' in lower:
                            try:
                                inc_val = float(d.get(lower['incentive']) or 0)
                            except Exception:
                                inc_val = 0
                        # Leave deduction amount (optional)
                        leave_ded = None
                        for lk in ['leave_deduction_amount','leavedeductionamount','leave_deduction_per_day','leave_per_day']:
                            if lk in lower:
                                try:
                                    leave_ded = float(d.get(lower[lk]) or 0)
                                except Exception:
                                    leave_ded = 0
                                break
                        eff = None
                        if 'effectivefrom' in lower:
                            eff = d.get(lower['effectivefrom'])
                        elif 'effective_from' in lower:
                            eff = d.get(lower['effective_from'])
                        # normalize YYYY-MM for frontend display
                        eff_display = None
                        try:
                            if eff is not None:
                                s = str(eff)
                                eff_display = s[:7]
                        except Exception:
                            eff_display = None
                        pay = None
                        if 'paycycle' in lower:
                            pay = d.get(lower['paycycle'])
                        elif 'pay_cycle' in lower:
                            pay = d.get(lower['pay_cycle'])
                        if isinstance(pay, str):
                            p = pay.strip()
                            pay = 'Monthly' if p.lower() == 'monthly' else ('Weekly' if p.lower() == 'weekly' else p)
                        emp_names[int(key)] = {
                            'name': d.get('employee_name') or d.get('full_name') or d.get('name'),
                            'code': d.get('employee_code'),
                            'base_salary': base_salary if base_salary is not None else 0,
                            'target': tgt_val if tgt_val is not None else 0,
                            'incentive': inc_val if inc_val is not None else 0,
                            'effective_from': eff_display,
                            'pay_cycle': pay,
                            'leave_deduction_amount': leave_ded if leave_ded is not None else 0,
                        }
        except Exception:
            pass

        for r in rows:
            # Group by employee only (table no longer stores effective_from/pay_cycle)
            k = int(r['employee_id'])
            rec = groups.get(k)
            if not rec:
                info = emp_names.get(int(r['employee_id']), {})
                rec = {
                    'employee_id': int(r['employee_id']),
                    'employee_name': info.get('name') or '',
                    'employee_code': info.get('code'),
                    'base_salary': info.get('base_salary', 0),
                    'target': info.get('target', 0),
                    'incentive': info.get('incentive', 0),
                    'pay_cycle': info.get('pay_cycle'),
                    # keep effective_from only for display if present on master_employee
                    'effective_from': info.get('effective_from'),
                    'leave_deduction_amount': info.get('leave_deduction_amount', 0),
                    'incentives': [],
                    'billing_total': 0.0,
                    'incentive_total': 0.0,
                    'line_count': 0,
                }
                groups[k] = rec
            rec['incentives'].append({
                'id': r.get('id'),
                'service_id': r.get('service_id'),
                'incentive_type': r.get('incentive_type'),
                'value': float(r.get('value') or 0),
            })

        # Ensure we return rows even if no incentive mapping exists: seed one per employee
        for emp_key, info in emp_names.items():
            try:
                ek = int(emp_key)
            except Exception:
                continue
            if employee_id is not None and ek != int(employee_id):
                continue
            if ek not in groups:
                groups[ek] = {
                    'employee_id': ek,
                    'employee_name': info.get('name') or '',
                    'employee_code': info.get('code'),
                    'base_salary': info.get('base_salary', 0),
                    'target': info.get('target', 0),
                    'incentive': info.get('incentive', 0),
                    'pay_cycle': info.get('pay_cycle'),
                    'effective_from': info.get('effective_from'),
                    'leave_deduction_amount': info.get('leave_deduction_amount', 0),
                    'incentives': [],  # explicitly empty when unmapped
                    'billing_total': 0.0,
                    'incentive_total': 0.0,
                    'line_count': 0,
                }

        # Determine the computation window for billing/attendance totals
        # Priority: explicit fromdate/todate -> monthly (effective_from or month) -> no totals
        range_start: Optional[str] = None
        range_end_excl: Optional[str] = None
        try:
            from datetime import datetime as _dt, timedelta as _td
            if fromdate and todate:
                # Normalize inputs to YYYY-MM-DD and compute exclusive end as next day
                fd = _dt.strptime(str(fromdate)[:10], "%Y-%m-%d")
                td = _dt.strptime(str(todate)[:10], "%Y-%m-%d")
                if fd > td:
                    # swap if out of order
                    fd, td = td, fd
                range_start = fd.strftime("%Y-%m-%d")
                range_end_excl = (td + _td(days=1)).strftime("%Y-%m-%d")
            else:
                _month_param = effective_from or month
                if _month_param:
                    # Use first day of month as start, and first day of next month as exclusive end
                    mstart = _normalize_effective_from(_month_param)
                    ms = _dt.strptime(mstart, "%Y-%m-%d")
                    if ms.month == 12:
                        next_month = _dt(ms.year + 1, 1, 1)
                    else:
                        next_month = _dt(ms.year, ms.month + 1, 1)
                    range_start = mstart
                    range_end_excl = next_month.strftime("%Y-%m-%d")
        except Exception:
            range_start = None
            range_end_excl = None

        # Reflect billing tables
        try:
            from invoice import _get_table as _get_bsum, _get_txn_table as _get_bhdr
            bsum_tbl = _get_bsum()
            bhdr_tbl = _get_bhdr()
        except Exception:
            bsum_tbl = None
            bhdr_tbl = None

        # Only compute aggregates when we have a valid date window and a billing summary table
        if bsum_tbl is not None and range_start and range_end_excl:
                # Column helpers
                bcols = set(bsum_tbl.c.keys())
                def col(name_list, default=None):
                    for nm in name_list:
                        if nm in bcols:
                            return getattr(bsum_tbl.c, nm)
                    return default

                # Pick candidate columns
                col_invoice_id = col(["invoice_id","invoice","bill_id"])  # optional
                col_service_id = col(["service_id","service","service_code"])  # service id
                col_emp_in_line = col(["employee_id","emp_id","staff_id"])  # employee on line, if exists
                col_date = col(["invoice_date","billing_date","create_date","created_at","date"])  # any date
                col_qty = col(["qty","quantity"])  # optional
                col_unit_price = col(["unit_price","price","rate"])  # optional
                col_discount = col(["discount_amount","discount"])  # optional
                col_grand = col(["grand_total","line_total","total","net_total","amount"])  # best effort
                # Header employee if not on line
                hdr_emp_col = None
                if bhdr_tbl is not None:
                    if "employee_id" in bhdr_tbl.c.keys():
                        hdr_emp_col = bhdr_tbl.c.employee_id

                for emp_id, rec in groups.items():
                    # Build base condition for month range
                    from sqlalchemy import and_ as _and, between
                    conds = [
                        (bsum_tbl.c.account_code == account_code) if 'account_code' in bcols else text('1=1'),
                        (bsum_tbl.c.retail_code == retail_code) if 'retail_code' in bcols else text('1=1'),
                    ]
                    if col_date is not None:
                        # inclusive [range_start, range_end_excl)
                        conds.append(col_date >= range_start)
                        conds.append(col_date < range_end_excl)

                    # Employee filter either on line or through header join
                    join_stmt = None
                    where_stmt = None
                    if col_emp_in_line is not None:
                        where_stmt = select(bsum_tbl).where(_and(*conds, col_emp_in_line == str(emp_id)))
                    elif bhdr_tbl is not None and hdr_emp_col is not None and col_invoice_id is not None and 'invoice_id' in bcols:
                        from sqlalchemy import join
                        j = join(bsum_tbl, bhdr_tbl, bsum_tbl.c.invoice_id == bhdr_tbl.c.invoice_id)
                        join_stmt = select(bsum_tbl).select_from(j).where(_and(*conds, hdr_emp_col == str(emp_id)))
                    else:
                        # Cannot determine employee linkage; skip computation
                        continue

                    # Build set of ABSENT dates for this employee in the range to exclude commission on those days
                    absent_dates: set[str] = set()
                    try:
                        att_tbl = _reflect_table('staff_attendance')
                        att_cols = set(att_tbl.c.keys())
                        att_conds = []
                        if 'account_code' in att_cols:
                            att_conds.append(att_tbl.c.account_code == account_code)
                        if 'retail_code' in att_cols:
                            att_conds.append(att_tbl.c.retail_code == retail_code)
                        if 'employee_id' in att_cols:
                            att_conds.append(att_tbl.c.employee_id == str(emp_id))
                        if 'attendance_date' in att_cols:
                            att_conds.append(att_tbl.c.attendance_date >= range_start)
                            att_conds.append(att_tbl.c.attendance_date < range_end_excl)
                        with engine.begin() as conn:
                            sel_att = select(att_tbl).where(_and(*att_conds)) if att_conds else select(att_tbl)
                            for ar in conn.execute(sel_att):
                                ad = dict(ar._mapping)
                                st = str(ad.get('status') or '').strip().lower()
                                # Normalize to detect absent
                                is_absent = st not in ['present','p','1','true','yes','y','half day','half-day','half','h','0.5','0,5']
                                if is_absent:
                                    try:
                                        dt = str(ad.get('attendance_date') or '')[:10]
                                        if dt:
                                            absent_dates.add(dt)
                                    except Exception:
                                        pass
                    except Exception:
                        # Attendance table missing or reflection failed; proceed without exclusions
                        absent_dates = set()

                    # Fetch per service aggregates for this employee/month (excluding ABSENT dates)
                    agg_by_service: Dict[str, Dict[str, float]] = {}
                    with engine.begin() as conn:
                        q = join_stmt if join_stmt is not None else where_stmt
                        for lr in conn.execute(q):
                            d = dict(lr._mapping)
                            sid = None
                            try:
                                sid = str(d.get('service_id') if 'service_id' in d else d.get('service') or d.get('service_code'))
                            except Exception:
                                pass
                            if not sid:
                                continue
                            # Skip lines that fall on an ABSENT day for this employee
                            try:
                                line_date_val = None
                                if col_date is not None:
                                    line_date_val = d.get(col_date.name)
                                if line_date_val is None:
                                    # best-effort fallback on common names
                                    for nm in ['invoice_date','billing_date','create_date','created_at','date']:
                                        if nm in d and d.get(nm) is not None:
                                            line_date_val = d.get(nm)
                                            break
                                if line_date_val is not None:
                                    line_yyyymmdd = str(line_date_val)[:10]
                                    if line_yyyymmdd in absent_dates:
                                        continue
                            except Exception:
                                # if any issue occurs determining date, do not exclude the line
                                pass
                            # Compute amount for this line
                            amount = 0.0
                            try:
                                if col_grand is not None and 'grand_total' in d:
                                    amount = float(d.get('grand_total') or 0)
                                elif col_grand is not None:
                                    amount = float(d.get(col_grand.name) or 0)
                                else:
                                    qv = float(d.get(col_qty.name) or 1) if col_qty is not None else 1
                                    up = float(d.get(col_unit_price.name) or 0) if col_unit_price is not None else 0
                                    disc = float(d.get(col_discount.name) or 0) if col_discount is not None else 0
                                    amount = max(0.0, qv * up - disc)
                            except Exception:
                                amount = 0.0
                            bucket = agg_by_service.setdefault(sid, { 'amount': 0.0, 'count': 0.0 })
                            bucket['amount'] += amount
                            bucket['count'] += 1

                    # Apply incentives for this employee mapping
                    total_incentive = 0.0
                    billing_total = 0.0
                    total_count = 0
                    for it in rec['incentives']:
                        sid = str(it.get('service_id'))
                        agg = agg_by_service.get(sid)
                        if not agg:
                            continue
                        billing_total += float(agg['amount'] or 0)
                        total_count += int(agg['count'] or 0)
                        if (it.get('incentive_type') or '').lower() == 'fixed':
                            amt = float(it.get('value') or 0) * float(agg['count'] or 0)
                        else:
                            amt = float(agg['amount'] or 0) * (float(it.get('value') or 0) / 100.0)
                        total_incentive += amt
                    rec['billing_total'] = round(billing_total, 2)
                    rec['incentive_total'] = round(total_incentive, 2)
                    rec['line_count'] = int(total_count)

        # Attendance summary per employee for the selected window (if staff_attendance exists)
        try:
            att_tbl = _reflect_table('staff_attendance')
            att_cols = set(att_tbl.c.keys())
            from sqlalchemy import and_ as _and
            for emp_id, rec in groups.items():
                    conds = []
                    if 'account_code' in att_cols:
                        conds.append(att_tbl.c.account_code == account_code)
                    if 'retail_code' in att_cols:
                        conds.append(att_tbl.c.retail_code == retail_code)
                    # employee_id may be stored as string or int
                    if 'employee_id' in att_cols:
                        conds.append(att_tbl.c.employee_id == str(emp_id))
                    # Date window
                    if 'attendance_date' in att_cols and range_start and range_end_excl:
                        conds.append(att_tbl.c.attendance_date >= range_start)
                        conds.append(att_tbl.c.attendance_date < range_end_excl)
                    present = half = absent = 0
                    with engine.begin() as conn:
                        sel = select(att_tbl).where(_and(*conds))
                        for ar in conn.execute(sel):
                            d = dict(ar._mapping)
                            st = str(d.get('status') or '').strip().lower()
                            if st in ['present','p','1','true','yes','y']:
                                present += 1
                            elif st in ['half day','half-day','half','h','0.5','0,5']:
                                half += 1
                            else:
                                absent += 1
                    rec['attendance_present'] = present
                    rec['attendance_half_day'] = half
                    rec['attendance_absent'] = absent
                    rec['attendance_days'] = round(present + 0.5 * half, 2)
        except Exception:
            # table not present or reflection failed; ignore silently
            pass

        return {"success": True, "data": list(groups.values())}
    except Exception as e:
        logger.error(f"[INCENTIVE_LIST] Error: {e} | Trace: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/employee-incentives/by-employee", tags=["payroll"], summary="Get a specific mapping for editing")
def get_employee_mapping(account_code: str, retail_code: str, employee_id: int, current_user: User = Depends(get_current_user)):
    """Return all incentive rows for an employee (not date-bound). Extra query params are ignored."""
    tbl = _reflect_table('employee_incentive')
    try:
        with engine.begin() as conn:
            stmt = select(tbl).where(
                tbl.c.account_code == account_code,
                tbl.c.retail_code == retail_code,
                tbl.c.employee_id == employee_id,
            )
            items = [dict(r._mapping) for r in conn.execute(stmt)]
        return {"success": True, "data": items}
    except Exception as e:
        logger.error(f"[INCENTIVE_GET] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/employee-incentives/delete", tags=["payroll"], summary="Delete mapping for an employee (all incentive rows)")
def delete_employee_mapping(account_code: str, retail_code: str, employee_id: int, current_user: User = Depends(get_current_user)):
    tbl = _reflect_table('employee_incentive')
    try:
        with engine.begin() as conn:
            del_stmt = sql_delete(tbl).where(
                and_(
                    tbl.c.account_code == account_code,
                    tbl.c.retail_code == retail_code,
                    tbl.c.employee_id == employee_id,
                )
            )
            res = conn.execute(del_stmt)
        return {"success": True, "deleted": res.rowcount}
    except Exception as e:
        logger.error(f"[INCENTIVE_DELETE] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Customer Wallet Payment Model and Endpoint
class CustomerWalletPaymentRequest(BaseModel):
    customer_id: int
    amount: float
    payment_mode: str
    account_code: str
    retail_code: str
    notes: Optional[str] = None

@app.post("/api/customer-wallet-payment", tags=["customer"], summary="Process customer credit payment")
def process_customer_wallet_payment(payload: CustomerWalletPaymentRequest, current_user: User = Depends(get_current_user)):
    """Process payment against customer credit and reduce customer_credit in master_customer table."""
    logger.info(f"[WALLET_PAYMENT] ENDPOINT CALLED - Processing payment for customer_id={payload.customer_id}, amount={payload.amount}")
    logger.info(f"[WALLET_PAYMENT] Payload: {payload.dict()}")
    
    try:
        logger.info("[WALLET_PAYMENT] Importing _record_customer_credit_payment function")
        from invoice import _record_customer_credit_payment
        
        logger.info("[WALLET_PAYMENT] Calling _record_customer_credit_payment function")
        result = _record_customer_credit_payment(
            customer_id=payload.customer_id,
            amount=payload.amount,
            payment_mode=payload.payment_mode,
            account_code=payload.account_code,
            retail_code=payload.retail_code,
            notes=payload.notes,
            username=current_user.username
        )
        logger.info(f"[WALLET_PAYMENT] Function returned: {result}")
        logger.info(f"[WALLET_PAYMENT] Success for customer_id={payload.customer_id}, amount={payload.amount}")
        return result
    except ImportError as ie:
        logger.error(f"[WALLET_PAYMENT] Import error: {ie}")
        raise HTTPException(status_code=500, detail=f"Function import failed: {str(ie)}")
    except Exception as e:
        logger.error(f"[WALLET_PAYMENT] Error for customer_id={payload.customer_id}: {e}")
        import traceback
        logger.error(f"[WALLET_PAYMENT] Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to process payment: {str(e)}")

@app.get("/trans-income-expenses")
async def list_trans_income_expenses(
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    account_code: Optional[str] = Depends(lambda: None),
    retail_code: Optional[str] = Depends(lambda: None),
    current_user: Optional[User] = Depends(get_current_user)
):
    """Return income/expense rows (cash flow) in a date range with customer & tax meta."""
    logger.info(f"[TRANS I/E GET] Endpoint: /trans-income-expenses | From: {fromdate} | To: {todate} | Account: {account_code} | Retail: {retail_code}")
    try:
        resp = read_financial_transactions(engine, fromdate, todate, account_code, retail_code, current_user)
        logger.info(f"[TRANS I/E GET] Success | From: {fromdate} | To: {todate} | Records: {len(resp.get('data', []))}")
        return resp
    except Exception as e:
        logger.error(f"[TRANS I/E GET] Error | From: {fromdate} | To: {todate} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise

@app.post("/trans-income-expense", status_code=201)
async def create_trans_income_expense(req: TransIncomeExpenseRequest, current_user: Optional[User] = Depends(get_current_user)):
    logger.info(f"[TRANS I/E] Endpoint: /trans-income-expense | Account: {req.account_code} | Retail: {req.retail_code} | Items: {len(req.items)}")
    try:
        resp = process_financial_transactions(engine, req, current_user)
        logger.info(f"[TRANS I/E] Success | Account: {req.account_code} | Retail: {req.retail_code} | Inserted: {resp.get('inserted_count')}")
        return resp
    except Exception as e:
        logger.error(f"[TRANS I/E] Error | Account: {req.account_code} | Retail: {req.retail_code} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise
        
@app.get("/trans-income-expenses")
async def list_trans_income_expenses(
    fromdate: Optional[str] = None,
    todate: Optional[str] = None,
    account_code: Optional[str] = Depends(lambda: None),
    retail_code: Optional[str] = Depends(lambda: None),
    current_user: Optional[User] = Depends(get_current_user)
):
    """Return income/expense rows (cash flow) in a date range with customer & tax meta."""
    logger.info(f"[TRANS I/E GET] Endpoint: /trans-income-expenses | From: {fromdate} | To: {todate} | Account: {account_code} | Retail: {retail_code}")
    try:
        resp = read_financial_transactions(engine, fromdate, todate, account_code, retail_code, current_user)
        logger.info(f"[TRANS I/E GET] Success | From: {fromdate} | To: {todate} | Records: {len(resp.get('data', []))}")
        return resp
    except Exception as e:
        logger.error(f"[TRANS I/E GET] Error | From: {fromdate} | To: {todate} | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        raise


# --- ENQUIRY MANAGEMENT ENDPOINTS ---

# Enquiry endpoints (using functions from enquiries.py)
@app.post("/enquiries", summary="Create new enquiry", tags=["enquiry"])
async def create_enquiry_primary(enquiry: EnquiryCreate):
    """Create a new enquiry record"""
    return await create_enquiry_api(engine, enquiry)

@app.get("/enquiries", summary="Get all enquiries", tags=["enquiry"])  
async def get_enquiries_primary(
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None,
    limit: int = 100
):
    """Get all enquiries for account and retail code"""
    return await get_enquiries_api(engine, account_code, retail_code, limit)

@app.get("/enquiries/{enquiry_id}", summary="Get enquiry by ID", tags=["enquiry"])
async def get_enquiry_by_id_primary(
    enquiry_id: int,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None
):
    """Get a specific enquiry by ID"""
    return await get_enquiry_by_id_api(engine, enquiry_id, account_code, retail_code)

@app.put("/enquiries/{enquiry_id}", summary="Update enquiry", tags=["enquiry"])
async def update_enquiry_primary(
    enquiry_id: int,
    enquiry: EnquiryUpdate,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None
):
    """Update an existing enquiry"""
    return await update_enquiry_api(engine, enquiry_id, enquiry, account_code, retail_code)

@app.delete("/enquiries/{enquiry_id}", summary="Delete enquiry", tags=["enquiry"])
async def delete_enquiry_primary(
    enquiry_id: int,
    account_code: Optional[str] = None,
    retail_code: Optional[str] = None
):
    """Delete an enquiry (soft delete by setting status to 0)"""
    return await delete_enquiry_api(engine, enquiry_id, account_code, retail_code)

# --- RETAIL MASTER ENDPOINT FOR AUTO-POPULATION ---

@app.get("/api/retail-master", summary="Get retail master data for auto-population", tags=["masters"])
async def get_retail_master():
    """Get retail master data to auto-populate account_code and retail_code"""
    logger.info(f"[RETAIL MASTER] Fetching retail master data for auto-population")
    try:
        # Fetch active retail master records
        results = crud_read_rows(engine, "retail_master", filters={"status": 1})
        
        # Format the results
        formatted_results = []
        for row in results:
            formatted_row = {
                "account_code": row.get("account_code"),
                "retail_code": row.get("retail_code"),
                "description": row.get("description"),
                "status": row.get("status")
            }
            formatted_results.append(formatted_row)
        
        logger.info(f"[RETAIL MASTER] Success | Records found: {len(formatted_results)}")
        return formatted_results
    except Exception as e:
        logger.error(f"[RETAIL MASTER] Error | Exception: {str(e)} | Traceback: {traceback.format_exc()}")
        # Return default data if query fails
        default_data = [{
            "account_code": "C2B1A1",
            "retail_code": "C2B1A1R1",
            "description": "Default Account",
            "status": 1
        }]
        logger.info(f"[RETAIL MASTER] Returning default data due to error")
        return default_data


# --- FILE UPLOAD ENDPOINTS ---

@app.post("/upload-image/")
async def upload_public_image(request: Request, file: UploadFile = File(...)):
    """Upload an image and return a public URL under /uploads."""

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type. Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}",
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large. Max size: {MAX_IMAGE_SIZE / (1024*1024):.1f}MB",
        )

    file_ext = Path(file.filename).suffix.lower()
    if not file_ext:
        file_ext = MEDIA_EXT_BY_MIME.get(file.content_type, "")
    if not file_ext:
        raise HTTPException(status_code=400, detail="Unsupported image extension")

    filename = f"{uuid.uuid4().hex}{file_ext}"
    file_path = MEDIA_UPLOADS_DIR / filename
    try:
        with open(file_path, "wb") as out:
            out.write(contents)
    except Exception as e:
        logger.error(f"[PUBLIC_IMAGE_UPLOAD] Error saving file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save image")

    base_url = _public_base_url(request)
    return {"image_url": f"{base_url}/uploads/{filename}"}


@app.post("/retail-master/logo", summary="Upload company logo and update retail_master", tags=["masters"])
async def upload_retail_logo(
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    """Upload a company logo into media_uploads/logo and persist URL in retail_master.logo.

    Uses the authenticated user's account_code and retail_code to locate the
    correct retail_master row.
    """
    acc = getattr(current_user, "account_code", None)
    ret = getattr(current_user, "retail_code", None)
    if not acc or not ret:
        raise HTTPException(status_code=400, detail="Missing account_code/retail_code in user context")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid image type. Allowed: {', '.join(ALLOWED_IMAGE_TYPES)}",
        )

    contents = await file.read()
    if len(contents) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large. Max size: {MAX_IMAGE_SIZE / (1024*1024):.1f}MB",
        )

    file_ext = Path(file.filename).suffix.lower()
    if not file_ext:
        file_ext = MEDIA_EXT_BY_MIME.get(file.content_type, "")
    if not file_ext:
        raise HTTPException(status_code=400, detail="Unsupported image extension")

    # Prefix with account/retail to make it easier to trace
    safe_acc = "".join(c for c in str(acc) if c.isalnum()) or "ACC"
    safe_ret = "".join(c for c in str(ret) if c.isalnum()) or "R1"
    filename = f"logo_{safe_acc}_{safe_ret}_{uuid.uuid4().hex}{file_ext}"
    file_path = LOGO_DIR / filename

    try:
        with open(file_path, "wb") as out:
            out.write(contents)
    except Exception as e:
        logger.error(f"[RETAIL_MASTER_LOGO] Error saving logo file: {e}")
        raise HTTPException(status_code=500, detail="Failed to save logo image")

    base_url = _public_base_url(request)
    relative_path = f"/uploads/logo/{filename}"
    logo_url = f"{base_url}{relative_path}"

    # Persist the logo URL into retail_master.logo for the current account/retail
    try:
        md_rm = MetaData()
        tbl = Table("retail_master", md_rm, autoload_with=engine)
    except Exception as e:
        logger.error(f"[RETAIL_MASTER_LOGO] Table reflect failed: {e}")
        raise HTTPException(status_code=500, detail="Could not load retail_master schema")

    cols = {c.name for c in tbl.columns}
    if "logo" not in cols:
        logger.warning("[RETAIL_MASTER_LOGO] Column 'logo' not found in retail_master")
        raise HTTPException(status_code=400, detail="Column logo not found in retail_master")

    pk_cols = [c for c in tbl.columns if c.primary_key]
    pk_col = pk_cols[0] if pk_cols else (tbl.c.Id if "Id" in tbl.c else None)
    if pk_col is None:
        raise HTTPException(status_code=400, detail="No primary key found for retail_master")

    try:
        with engine.begin() as conn:
            row = conn.execute(
                select(pk_col).where(
                    and_(
                        tbl.c.account_code == acc,
                        tbl.c.retail_code == ret,
                    )
                ).limit(1)
            ).first()

            if not row:
                raise HTTPException(status_code=404, detail="retail_master row not found")

            pk_value = row[0]

            result = conn.execute(
                sql_update(tbl)
                .where(
                    and_(
                        pk_col == pk_value,
                        tbl.c.account_code == acc,
                        tbl.c.retail_code == ret,
                    )
                )
                .values(logo=logo_url)
            )

            updated_rows = int(getattr(result, "rowcount", 0) or 0)
    except HTTPException:
        # Bubble up explicit HTTP errors raised inside the transaction
        raise
    except Exception as e:
        logger.error(f"[RETAIL_MASTER_LOGO] Error updating retail_master: {e} | account={acc} retail={ret}")
        raise HTTPException(status_code=500, detail="Failed to update company logo")

    logger.info(
        f"[RETAIL_MASTER_LOGO] Success | account={acc} retail={ret} | filename={filename} | updated_rows={updated_rows}"
    )

    return {
        "success": True,
        "logo_url": logo_url,
        "logo_path": relative_path,
        "updated_rows": updated_rows,
    }

@app.post("/upload/image")
async def upload_image(
    account_code: str,
    retail_code: str,
    file: UploadFile = File(...),
    customer_id: Optional[str] = None,
    customer_name: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Upload customer image file with account code prefix."""
    logger.info(f"[IMAGE_UPLOAD] Account: {account_code} | Retail: {retail_code} | File: {file.filename} | Customer: {customer_id}/{customer_name}")
    
    try:
        success, message, filename = await save_uploaded_file(file, account_code, "image", retail_code, customer_id, customer_name)
        
        if not success:
            logger.error(f"[IMAGE_UPLOAD] Failed | Account: {account_code} | Error: {message}")
            raise HTTPException(status_code=400, detail=message)
        
        # Return the relative path for storing in database
        file_url = f"/files/image/{filename}"
        
        logger.info(f"[IMAGE_UPLOAD] Success | Account: {account_code} | File: {filename}")
        return {
            "success": True,
            "message": message,
            "filename": filename,
            "file_url": file_url
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[IMAGE_UPLOAD] Error | Account: {account_code} | Exception: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during image upload")

@app.post("/upload/document")
async def upload_document(
    account_code: str,
    retail_code: str,
    file: UploadFile = File(...),
    customer_id: Optional[str] = None,
    customer_name: Optional[str] = None,
    current_user: User = Depends(get_current_user)
):
    """Upload customer document file with account code prefix."""
    logger.info(f"[DOCUMENT_UPLOAD] Account: {account_code} | Retail: {retail_code} | File: {file.filename} | Customer: {customer_id}/{customer_name}")
    
    try:
        success, message, filename = await save_uploaded_file(file, account_code, "document", retail_code, customer_id, customer_name)
        
        if not success:
            logger.error(f"[DOCUMENT_UPLOAD] Failed | Account: {account_code} | Error: {message}")
            raise HTTPException(status_code=400, detail=message)
        
        # Return the relative path for storing in database
        file_url = f"/files/document/{filename}"
        
        logger.info(f"[DOCUMENT_UPLOAD] Success | Account: {account_code} | File: {filename}")
        return {
            "success": True,
            "message": message,
            "filename": filename,
            "file_url": file_url
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[DOCUMENT_UPLOAD] Error | Account: {account_code} | Exception: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during document upload")

@app.get("/files/image/{filename}")
async def serve_image(
    filename: str,
    token: Optional[str] = None,
    current_user: Optional[User] = Depends(lambda: None)
):
    """Serve uploaded image files."""
    try:
        # Try to authenticate via header first, then via token parameter
        authenticated_user = current_user
        if not authenticated_user and token:
            try:
                from auth import verify_access_token
                payload = verify_access_token(token)
                if payload:
                    authenticated_user = True  # Simple flag for file access
            except Exception:
                pass
        
        if not authenticated_user:
            logger.warning(f"[SERVE_IMAGE] Unauthorized access attempt for {filename}")
            raise HTTPException(status_code=401, detail="Authentication required")
        
        file_path = IMAGES_DIR / filename
        
        if not file_path.exists():
            logger.warning(f"[SERVE_IMAGE] File not found: {filename}")
            raise HTTPException(status_code=404, detail="Image not found")
        
        # Validate filename format (should contain account code or custom format)
        if not (filename.replace(".", "_").replace("-", "_").count("_") >= 2 or "+" in filename or len(filename.split('.')[0]) >= 6):
            logger.warning(f"[SERVE_IMAGE] Invalid filename format: {filename}")
            raise HTTPException(status_code=403, detail="Invalid file access")
        
        logger.info(f"[SERVE_IMAGE] Serving: {filename}")
        return FileResponse(
            path=file_path,
            media_type="image/jpeg",  # Will be auto-detected by FastAPI
            filename=filename
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[SERVE_IMAGE] Error serving {filename}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error serving image")

@app.get("/files/document/{filename}")
async def serve_document(
    filename: str,
    token: Optional[str] = None,
    current_user: Optional[User] = Depends(lambda: None)
):
    """Serve uploaded document files."""
    try:
        # Try to authenticate via header first, then via token parameter
        authenticated_user = current_user
        if not authenticated_user and token:
            try:
                from auth import verify_access_token
                payload = verify_access_token(token)
                if payload:
                    authenticated_user = True  # Simple flag for file access
            except Exception:
                pass
        
        if not authenticated_user:
            logger.warning(f"[SERVE_DOCUMENT] Unauthorized access attempt for {filename}")
            raise HTTPException(status_code=401, detail="Authentication required")
        
        file_path = DOCUMENTS_DIR / filename
        
        if not file_path.exists():
            logger.warning(f"[SERVE_DOCUMENT] File not found: {filename}")
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Validate filename format (should contain account code or custom format)
        if not (filename.replace(".", "_").replace("-", "_").count("_") >= 2 or "+" in filename or len(filename.split('.')[0]) >= 6):
            logger.warning(f"[SERVE_DOCUMENT] Invalid filename format: {filename}")
            raise HTTPException(status_code=403, detail="Invalid file access")
        
        logger.info(f"[SERVE_DOCUMENT] Serving: {filename}")
        
        # Determine media type based on file extension for proper browser handling
        media_type = "application/octet-stream"  # Default
        if filename.lower().endswith('.pdf'):
            media_type = "application/pdf"
        elif filename.lower().endswith(('.jpg', '.jpeg')):
            media_type = "image/jpeg"
        elif filename.lower().endswith('.png'):
            media_type = "image/png"
        elif filename.lower().endswith('.gif'):
            media_type = "image/gif"
        elif filename.lower().endswith('.webp'):
            media_type = "image/webp"
        elif filename.lower().endswith('.doc'):
            media_type = "application/msword"
        elif filename.lower().endswith('.docx'):
            media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        
        return FileResponse(
            path=file_path,
            media_type=media_type,
            filename=filename,
            headers={"Content-Disposition": "inline"} if filename.lower().endswith('.pdf') else None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[SERVE_DOCUMENT] Error serving {filename}: {str(e)}")
        raise HTTPException(status_code=500, detail="Error serving document")

@app.delete("/files/{file_type}/{filename}")
async def delete_file(
    file_type: str,
    filename: str,
    current_user: User = Depends(get_current_user)
):
    """Delete uploaded file (image or document)."""
    logger.info(f"[DELETE_FILE] Type: {file_type} | File: {filename}")
    
    try:
        if file_type not in ["image", "document"]:
            raise HTTPException(status_code=400, detail="Invalid file type. Must be 'image' or 'document'")
        
        success, message = delete_uploaded_file(filename, file_type)
        
        if not success:
            logger.error(f"[DELETE_FILE] Failed | Type: {file_type} | File: {filename} | Error: {message}")
            raise HTTPException(status_code=500, detail=message)
        
        logger.info(f"[DELETE_FILE] Success | Type: {file_type} | File: {filename}")
        return {
            "success": True,
            "message": message
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[DELETE_FILE] Error | Type: {file_type} | File: {filename} | Exception: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error during file deletion")

    
class MockTopupRequest(BaseModel):
    credits_count: int

@app.post("/api/credits/topup")
async def mock_topup(request: MockTopupRequest, current_user: User = Depends(get_current_user)):
    """
    Simulate a topup for testing purposes without real payment.
    Use ONLY in development or testing.
    """
    try:
        if request.credits_count <= 0:
            raise HTTPException(status_code=400, detail="Credits must be positive")
            
        topup_provider_credits(
            account_code=current_user.account_code,
            retail_code=current_user.retail_code,
            channel="whatsapp",
            amount=request.credits_count,
            notes=f"Mock Topup (Test Mode)",
            created_by=current_user.username
        )
        return {"success": True, "message": "Mock credits added successfully"}
    except Exception as e:
        logger.error(f"[MOCK_TOPUP] Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/credits/balance")
def get_credits_balance_endpoint(current_user: User = Depends(get_current_user)):
    """Get the current provider credits balance."""
    try:
        bal_obj = get_provider_credits_balance(
            account_code=current_user.account_code,
            retail_code=current_user.retail_code,
            channel="whatsapp"
        )
        return {"success": True, "balance": bal_obj.balance, "currency": bal_obj.currency}
    except Exception as e:
        logger.error(f"[CREDITS_BALANCE] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/credits/ledger")
def get_credits_ledger_endpoint(limit: int = 50, current_user: User = Depends(get_current_user)):
    """Get the history of credit transactions."""
    try:
        rows = list_provider_credits_ledger(
            account_code=current_user.account_code,
            retail_code=current_user.retail_code,
            channel="whatsapp",
            limit=limit
        )
        return {"success": True, "data": rows}
    except Exception as e:
        logger.error(f"[CREDITS_LEDGER] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class RazorpayOrderRequest(BaseModel):
    amount: float
    currency: str = "INR"
    receipt: Optional[str] = None

@app.post("/api/payment/razorpay/create-order")
async def create_razorpay_order(request: RazorpayOrderRequest, current_user: User = Depends(get_current_user)):
    try:
        # Note: Amount in production should ideally be calculated on server based on items,
        # but here we accept it from frontend for flexibility in this flow.
        order = create_order(request.amount, request.currency, request.receipt)
        return order
    except Exception as e:
        logger.error(f"[RAZORPAY_CREATE] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class RazorpayVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str
    credits_count: int

@app.post("/api/payment/razorpay/verify")
async def verify_razorpay_payment(request: RazorpayVerifyRequest, current_user: User = Depends(get_current_user)):
    try:
        valid = verify_payment_signature(
            request.razorpay_order_id,
            request.razorpay_payment_id,
            request.razorpay_signature
        )
        if not valid:
            raise HTTPException(status_code=400, detail="Invalid signature")
        
        return {"success": True, "message": "Payment verified"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[RAZORPAY_VERIFY] Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    # Bind to 0.0.0.0 and respect PORT env var for PaaS (Railway/Render/Heroku). Fallback to 8000 locally.
    port = int(os.getenv("PORT", "8007"))
    host = os.getenv("HOST", "0.0.0.0")
    reload_flag = os.getenv("UVICORN_RELOAD", "false").lower() == "true"
    log_level = os.getenv("UVICORN_LOG_LEVEL", "debug")
    print(f"Starting FastAPI server on {host}:{port} (reload={reload_flag})...")
    uvicorn.run(app, host=host, port=port, reload=reload_flag, log_level=log_level)
