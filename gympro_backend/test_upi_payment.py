#!/usr/bin/env python3
"""Test UPI payment creation for Dashboard testing."""

import json
from datetime import datetime

def test_upi_payment_direct():
    """Create a test UPI payment directly using the invoice creation logic."""
    
    try:
        import sys
        import os
        
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        
        from invoice import create_invoice_lines, InvoiceBulkCreate, InvoiceLineCreate
        
        # Test UPI payment data
        test_line_data = {
            "account_code": "C2B1A1",
            "retail_code": "C2B1A1R1",
            "invoice_id": f"TEST-UPI-{int(__import__('time').time())}",
            "service_id": "1",
            "service_name": "Hair Styling",
            "qty": 1,
            "customer_id": 13,
            "base_price": 2000,
            "unit_price": 2000,
            "tax_id": "1",
            "tax_rate_percent": 0,
            "discount_amount": 0,
            "customer_name": "test_customer_upi",
            "customer_number": "9876543210",
            "employee_id": "2",
            "employee_name": "Stylist",
            "employee_level": "Expert",
            "markup_amount_per_unit": 0,
            "membership_discount": 0,
            "payment_method": "UPI",  # This should be UPI
            "payment_mode_id": "8",   # UPI payment mode ID
            "grand_total": 2000,
            "cgst_rate_percent": 0,
            "sgst_rate_percent": 0,
            "igst_rate_percent": 0,
            "tax_amount": 0,
            "tax_exempted": 1,
            "taxable_amount": 2000,
            "total_cgst": 0,
            "total_sgst": 0,
            "total_igst": 0,
            "from_appointment": 0
        }
        
        print("Creating UPI payment test transaction...")
        print(f"Payment Mode: {test_line_data['payment_method']} (ID: {test_line_data['payment_mode_id']})")
        print(f"Amount: ₹{test_line_data['grand_total']}")
        print(f"Invoice ID: {test_line_data['invoice_id']}")
        
        # Create the proper payload structure
        line = InvoiceLineCreate(**test_line_data)
        payload = InvoiceBulkCreate(lines=[line])
        
        # Create the invoice using the same logic as the API
        result = create_invoice_lines(payload, "test_user")
        
        print("SUCCESS! Invoice created:")
        print(json.dumps(result, indent=2, default=str))
        
        if result.get('success'):
            invoice_id = result.get('invoice_id')
            print(f"\nNew Invoice ID: {invoice_id}")
            print("This should now show up in Dashboard with UPI payment!")
            
            # Verify the payment was stored
            from invoice import _get_paymode_table
            from db import engine
            from sqlalchemy import select
            
            pay_tbl = _get_paymode_table()
            if pay_tbl:
                with engine.begin() as conn:
                    stmt = select(pay_tbl).where(pay_tbl.c.billing_id == invoice_id)
                    payment_row = conn.execute(stmt).first()
                    if payment_row:
                        payment_data = dict(payment_row._mapping)
                        print(f"\nPayment verification:")
                        print(f"  Billing ID: {payment_data.get('billing_id')}")
                        print(f"  Amount: ₹{payment_data.get('amount')}")
                        print(f"  Payment Mode ID: {payment_data.get('payment_mode_id')}")
                        print(f"  Payment Method: {payment_data.get('payment_method')}")
                        print(f"  Account/Retail: {payment_data.get('account_code')}/{payment_data.get('retail_code')}")
                    else:
                        print("WARNING: Payment not found in billing_paymode table!")
        else:
            print(f"ERROR: Invoice creation failed: {result}")
            
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_upi_payment_direct()