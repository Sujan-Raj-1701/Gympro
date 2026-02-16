"""
Reports API endpoints for Salon POS
Handles all report generation and data retrieval for various business reports
"""
from fastapi import APIRouter, HTTPException, Depends, Query
from typing import List, Optional, Dict, Any
from datetime import datetime, date
from sqlalchemy import text, func
from db import engine
from auth import User, get_current_user
from logger import get_logger
from decimal import Decimal

logger = get_logger()
router = APIRouter(prefix="/reports", tags=["reports"])

def decimal_to_float(obj):
    """Convert Decimal objects to float for JSON serialization"""
    if isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {k: decimal_to_float(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [decimal_to_float(item) for item in obj]
    return obj

@router.get("/monthly-sales")
async def get_monthly_sales(
    salon_id: int = Query(...),
    year: int = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get monthly sales summary for a specific year"""
    try:
        query = text("""
            SELECT 
                DATE_FORMAT(bill_date, '%b %Y') as month,
                YEAR(bill_date) as year,
                SUM(bill_amount) as total_sales,
                COUNT(DISTINCT bill_no) as total_invoices,
                AVG(bill_amount) as avg_invoice_value,
                0 as growth_percent
            FROM bill_master
            WHERE salon_id = :salon_id 
                AND YEAR(bill_date) = :year
                AND bill_status = 'Y'
            GROUP BY YEAR(bill_date), MONTH(bill_date)
            ORDER BY MONTH(bill_date)
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "year": year})
            rows = [dict(row._mapping) for row in result]
            
        # Calculate growth percentages
        for i in range(1, len(rows)):
            if rows[i-1]['total_sales'] > 0:
                rows[i]['growth_percent'] = ((rows[i]['total_sales'] - rows[i-1]['total_sales']) / rows[i-1]['total_sales']) * 100
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching monthly sales: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/payment-mode")
async def get_payment_mode_collection(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get payment mode-wise collection report"""
    try:
        query = text("""
            SELECT 
                COALESCE(pay_mode, 'Cash') as payment_mode,
                SUM(pay_amount) as total_amount,
                COUNT(*) as transaction_count,
                (SUM(pay_amount) / (SELECT SUM(pay_amount) FROM bill_payments WHERE salon_id = :salon_id AND DATE(pay_date) BETWEEN :from_date AND :to_date) * 100) as percentage
            FROM bill_payments
            WHERE salon_id = :salon_id 
                AND DATE(pay_date) BETWEEN :from_date AND :to_date
            GROUP BY pay_mode
            ORDER BY total_amount DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching payment mode data: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/credit-outstanding")
async def get_outstanding_credit(
    salon_id: int = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get customer-wise outstanding credit report"""
    try:
        query = text("""
            SELECT 
                c.id as customer_id,
                CONCAT(c.first_name, ' ', COALESCE(c.last_name, '')) as customer_name,
                c.phone as customer_phone,
                c.email as customer_email,
                SUM(b.pending_amount) as total_credit,
                MIN(b.bill_date) as oldest_credit_date,
                COUNT(b.id) as credit_count
            FROM bill_master b
            JOIN master_customer c ON b.customer_id = c.id
            WHERE b.salon_id = :salon_id 
                AND b.pending_amount > 0
                AND b.bill_status = 'Y'
            GROUP BY c.id, c.first_name, c.last_name, c.phone, c.email
            ORDER BY total_credit DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching outstanding credit: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/staff-performance")
async def get_staff_performance(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get staff performance report"""
    try:
        query = text("""
            SELECT 
                e.id as staff_id,
                CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as staff_name,
                COUNT(DISTINCT bd.id) as total_services,
                SUM(bd.amount) as total_revenue,
                AVG(bd.amount) as avg_service_value,
                COUNT(DISTINCT b.customer_id) as customer_count,
                5.0 as rating
            FROM bill_details bd
            JOIN bill_master b ON bd.bill_id = b.id
            JOIN master_employee e ON bd.stylist_id = e.id
            WHERE b.salon_id = :salon_id 
                AND DATE(b.bill_date) BETWEEN :from_date AND :to_date
                AND b.bill_status = 'Y'
            GROUP BY e.id, e.first_name, e.last_name
            ORDER BY total_revenue DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching staff performance: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/staff-commission")
async def get_staff_commission(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get staff commission report"""
    try:
        query = text("""
            SELECT 
                e.id as staff_id,
                CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) as staff_name,
                COUNT(DISTINCT bd.id) as total_services,
                SUM(bd.amount) as service_amount,
                COALESCE(e.commission_rate, 10) as commission_rate,
                SUM(bd.amount * COALESCE(e.commission_rate, 10) / 100) as commission_earned,
                COALESCE(SUM(pc.amount), 0) as commission_paid,
                (SUM(bd.amount * COALESCE(e.commission_rate, 10) / 100) - COALESCE(SUM(pc.amount), 0)) as commission_pending
            FROM bill_details bd
            JOIN bill_master b ON bd.bill_id = b.id
            JOIN master_employee e ON bd.stylist_id = e.id
            LEFT JOIN payroll_commission pc ON e.id = pc.employee_id AND MONTH(pc.pay_date) = MONTH(b.bill_date) AND YEAR(pc.pay_date) = YEAR(b.bill_date)
            WHERE b.salon_id = :salon_id 
                AND DATE(b.bill_date) BETWEEN :from_date AND :to_date
                AND b.bill_status = 'Y'
            GROUP BY e.id, e.first_name, e.last_name, e.commission_rate
            ORDER BY commission_earned DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching staff commission: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/service-sales")
async def get_service_sales(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get service-wise sales report"""
    try:
        query = text("""
            SELECT 
                s.id as service_id,
                s.service_name,
                COUNT(bd.id) as service_count,
                SUM(bd.amount) as total_revenue,
                AVG(bd.amount) as avg_price,
                COALESCE(SUM(bd.discount), 0) as discount_given
            FROM bill_details bd
            JOIN bill_master b ON bd.bill_id = b.id
            JOIN master_services s ON bd.service_id = s.id
            WHERE b.salon_id = :salon_id 
                AND DATE(b.bill_date) BETWEEN :from_date AND :to_date
                AND b.bill_status = 'Y'
            GROUP BY s.id, s.service_name
            ORDER BY total_revenue DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching service sales: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/customer-visits")
async def get_customer_visits(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get customer visit report (new vs repeat)"""
    try:
        query = text("""
            SELECT 
                DATE(b.bill_date) as visit_date,
                SUM(CASE WHEN b.customer_visit_count = 1 THEN 1 ELSE 0 END) as new_customers,
                SUM(CASE WHEN b.customer_visit_count > 1 THEN 1 ELSE 0 END) as repeat_customers,
                COUNT(DISTINCT b.customer_id) as total_customers,
                SUM(CASE WHEN b.customer_visit_count = 1 THEN b.bill_amount ELSE 0 END) as new_revenue,
                SUM(CASE WHEN b.customer_visit_count > 1 THEN b.bill_amount ELSE 0 END) as repeat_revenue
            FROM bill_master b
            WHERE b.salon_id = :salon_id 
                AND DATE(b.bill_date) BETWEEN :from_date AND :to_date
                AND b.bill_status = 'Y'
            GROUP BY DATE(b.bill_date)
            ORDER BY visit_date
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching customer visits: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/top-customers")
async def get_top_customers(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    limit: int = Query(20),
    current_user: User = Depends(get_current_user)
):
    """Get top customers by revenue"""
    try:
        query = text("""
            SELECT 
                c.id as customer_id,
                CONCAT(c.first_name, ' ', COALESCE(c.last_name, '')) as customer_name,
                c.phone as customer_phone,
                COUNT(b.id) as visit_count,
                SUM(b.bill_amount) as total_spent,
                AVG(b.bill_amount) as avg_invoice_value,
                MAX(b.bill_date) as last_visit_date
            FROM bill_master b
            JOIN master_customer c ON b.customer_id = c.id
            WHERE b.salon_id = :salon_id 
                AND DATE(b.bill_date) BETWEEN :from_date AND :to_date
                AND b.bill_status = 'Y'
            GROUP BY c.id, c.first_name, c.last_name, c.phone
            ORDER BY total_spent DESC
            LIMIT :limit
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date, "limit": limit})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching top customers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/appointment-summary")
async def get_appointment_summary(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get appointment summary report"""
    try:
        query = text("""
            SELECT 
                DATE(a.appointment_date) as appointment_date,
                COUNT(*) as total_appointments,
                SUM(CASE WHEN a.status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
                SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(CASE WHEN a.status = 'no_show' THEN 1 ELSE 0 END) as no_show,
                COALESCE(SUM(b.bill_amount), 0) as revenue_from_appointments
            FROM appointments a
            LEFT JOIN bill_master b ON a.id = b.appointment_id AND b.bill_status = 'Y'
            WHERE a.salon_id = :salon_id 
                AND DATE(a.appointment_date) BETWEEN :from_date AND :to_date
            GROUP BY DATE(a.appointment_date)
            ORDER BY appointment_date
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching appointment summary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stock-summary")
async def get_stock_summary(
    salon_id: int = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get inventory stock summary"""
    try:
        query = text("""
            SELECT 
                p.id as product_id,
                p.product_name,
                p.category,
                COALESCE(p.current_stock, 0) as current_stock,
                COALESCE(p.min_stock_level, 0) as min_stock_level,
                p.unit,
                p.last_purchase_date,
                COALESCE(p.last_purchase_qty, 0) as last_purchase_qty,
                (COALESCE(p.current_stock, 0) * COALESCE(p.unit_price, 0)) as stock_value
            FROM inventory_products p
            WHERE p.salon_id = :salon_id 
                AND p.is_active = 1
            ORDER BY p.product_name
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching stock summary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/product-consumption")
async def get_product_consumption(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get product consumption report"""
    try:
        query = text("""
            SELECT 
                p.id as product_id,
                p.product_name,
                p.category,
                SUM(pc.quantity_used) as quantity_consumed,
                p.unit,
                SUM(pc.quantity_used * p.unit_price) as consumption_value,
                COUNT(DISTINCT pc.service_id) as times_used
            FROM product_consumption pc
            JOIN inventory_products p ON pc.product_id = p.id
            WHERE pc.salon_id = :salon_id 
                AND DATE(pc.consumption_date) BETWEEN :from_date AND :to_date
            GROUP BY p.id, p.product_name, p.category, p.unit
            ORDER BY consumption_value DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching product consumption: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/discounts")
async def get_discount_report(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get discount and offers report"""
    try:
        query = text("""
            SELECT 
                COALESCE(b.discount_type, 'Flat Discount') as discount_type,
                COUNT(*) as discount_count,
                SUM(b.discount_amount) as total_discount_amount,
                SUM(b.bill_amount) as revenue_impact,
                AVG((b.discount_amount / (b.bill_amount + b.discount_amount)) * 100) as avg_discount_percent
            FROM bill_master b
            WHERE b.salon_id = :salon_id 
                AND DATE(b.bill_date) BETWEEN :from_date AND :to_date
                AND b.discount_amount > 0
                AND b.bill_status = 'Y'
            GROUP BY b.discount_type
            ORDER BY total_discount_amount DESC
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching discount report: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/gst-summary")
async def get_gst_summary(
    salon_id: int = Query(...),
    from_date: str = Query(...),
    to_date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get GST summary report"""
    try:
        query = text("""
            SELECT 
                DATE(bill_date) as date,
                SUM(bill_amount) as total_sales,
                SUM(cgst_amount) as cgst,
                SUM(sgst_amount) as sgst,
                SUM(igst_amount) as igst,
                SUM(cgst_amount + sgst_amount + igst_amount) as total_gst,
                SUM(bill_amount - (cgst_amount + sgst_amount + igst_amount)) as taxable_amount
            FROM bill_master
            WHERE salon_id = :salon_id 
                AND DATE(bill_date) BETWEEN :from_date AND :to_date
                AND bill_status = 'Y'
            GROUP BY DATE(bill_date)
            ORDER BY date
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "from_date": from_date, "to_date": to_date})
            rows = [dict(row._mapping) for row in result]
            
        return {"success": True, "data": decimal_to_float(rows)}
    except Exception as e:
        logger.error(f"Error fetching GST summary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/day-closing")
async def get_day_closing(
    salon_id: int = Query(...),
    date: str = Query(...),
    current_user: User = Depends(get_current_user)
):
    """Get day closing report"""
    try:
        query = text("""
            SELECT 
                dc.closing_date as date,
                dc.opening_balance,
                dc.total_sales,
                dc.cash_collected,
                dc.card_collected,
                dc.upi_collected,
                dc.wallet_collected,
                dc.expenses,
                dc.closing_balance,
                dc.variance,
                CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) as closed_by,
                dc.closing_time
            FROM day_closing dc
            LEFT JOIN users u ON dc.closed_by_user_id = u.id
            WHERE dc.salon_id = :salon_id 
                AND DATE(dc.closing_date) = :date
            LIMIT 1
        """)
        
        with engine.connect() as conn:
            result = conn.execute(query, {"salon_id": salon_id, "date": date})
            row = result.fetchone()
            
        if row:
            return {"success": True, "data": decimal_to_float(dict(row._mapping))}
        else:
            # Generate report from daily transactions
            sales_query = text("""
                SELECT 
                    (
                        SELECT COALESCE(SUM(bm.bill_amount), 0)
                        FROM bill_master bm
                        WHERE bm.salon_id = :salon_id
                            AND DATE(bm.bill_date) = :date
                            AND bm.bill_status = 'Y'
                    ) as total_sales,
                    COALESCE(SUM(CASE 
                        WHEN bp.pay_mode IS NULL OR LOWER(bp.pay_mode) LIKE '%cash%' THEN bp.pay_amount
                        ELSE 0
                    END), 0) as cash_collected,
                    COALESCE(SUM(CASE 
                        WHEN LOWER(bp.pay_mode) LIKE '%card%' THEN bp.pay_amount
                        ELSE 0
                    END), 0) as card_collected,
                    COALESCE(SUM(CASE 
                        WHEN LOWER(bp.pay_mode) LIKE '%upi%'
                            OR LOWER(bp.pay_mode) LIKE '%gpay%'
                            OR LOWER(bp.pay_mode) LIKE '%phonepe%'
                            OR LOWER(bp.pay_mode) LIKE '%paytm%'
                        THEN bp.pay_amount
                        ELSE 0
                    END), 0) as upi_collected,
                    COALESCE(SUM(CASE 
                        WHEN LOWER(bp.pay_mode) LIKE '%wallet%' THEN bp.pay_amount
                        ELSE 0
                    END), 0) as wallet_collected
                FROM bill_payments bp
                JOIN bill_master b ON b.id = bp.bill_id
                WHERE b.salon_id = :salon_id
                    AND DATE(b.bill_date) = :date
                    AND b.bill_status = 'Y'
            """)
            
            with engine.connect() as conn:
                result = conn.execute(sales_query, {"salon_id": salon_id, "date": date})
                data = dict(result.fetchone()._mapping) if result else {}
                
            if data and data.get('total_sales'):
                cash_collected = data.get('cash_collected') or 0
                card_collected = data.get('card_collected') or 0
                upi_collected = data.get('upi_collected') or 0
                wallet_collected = data.get('wallet_collected') or 0
                total_collected = cash_collected + card_collected + upi_collected + wallet_collected
                data.update({
                    "date": date,
                    "opening_balance": 0,
                    "expenses": 0,
                    "closing_balance": total_collected,
                    "variance": 0,
                    "closed_by": "System",
                    "closing_time": "N/A"
                })
                return {"success": True, "data": decimal_to_float(data)}
            else:
                raise HTTPException(status_code=404, detail="No data found for this date")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching day closing: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
