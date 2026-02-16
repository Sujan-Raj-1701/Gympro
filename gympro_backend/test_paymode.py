#!/usr/bin/env python3
"""
Quick test script to verify billing_paymode insertion
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from invoice import create_invoice_lines, InvoiceBulkCreate, InvoiceLineCreate

# Resolve account/retail codes dynamically (env vars or CLI args)
ACCOUNT_CODE = os.getenv("ACCOUNT_CODE") or (len(sys.argv) > 1 and sys.argv[1]) or ""
RETAIL_CODE = os.getenv("RETAIL_CODE") or (len(sys.argv) > 2 and sys.argv[2]) or ""

# Test payload from the user (no static codes; inject resolved values)
test_payload = {
    "lines": [
        {
            "account_code": ACCOUNT_CODE,
            "retail_code": RETAIL_CODE, 
            "invoice_id": "TEST-" + str(int(__import__('time').time())),
            "service_id": "1",
            "service_name": "Haircut",
            "qty": 1,
            "customer_id": 13,
            "base_price": 100,
            "unit_price": 100,
            "tax_id": "1",
            "tax_rate_percent": 0,
            "discount_amount": 0,
            "customer_name": "kumar",
            "customer_number": "741852112", 
            "employee_id": "2",
            "employee_name": "Ram",
            "employee_level": "Beginner",
            "markup_amount_per_unit": 0,
            "membership_discount": 0,
            "payment_method": "card",
            "payment_mode_id": "7",
            "grand_total": 100,
            "cgst_rate_percent": 0,
            "sgst_rate_percent": 0,
            "igst_rate_percent": 0,
            "tax_amount": 0,
            "tax_exempted": 1,
            "taxable_amount": 100,
            "total_cgst": 0,
            "total_sgst": 0,
            "total_igst": 0,
            "from_appointment": 0
        }
    ]
}

print("Testing billing_paymode insertion...")
print(f"Invoice ID: {test_payload['lines'][0]['invoice_id']}")
if not ACCOUNT_CODE or not RETAIL_CODE:
    print("Warning: ACCOUNT_CODE/RETAIL_CODE not provided. Set env vars or pass as args.")
    print("Usage: python test_paymode.py <ACCOUNT_CODE> <RETAIL_CODE>")
    print("Or set: ACCOUNT_CODE=... RETAIL_CODE=...")

try:
    # Convert to Pydantic model
    print(f"Raw line data: {test_payload['lines'][0]}")
    line_create = InvoiceLineCreate(**test_payload['lines'][0])
    print(f"After Pydantic conversion - payment_mode_id: {getattr(line_create, 'payment_mode_id', 'MISSING')}")
    print(f"After Pydantic conversion - payment_method: {getattr(line_create, 'payment_method', 'MISSING')}")
    bulk_create = InvoiceBulkCreate(lines=[line_create])
    
    # Call the function
    result = create_invoice_lines(bulk_create, "test_user")
    print(f"Result: {result}")
    
    print("\nCheck the app.log files or console output for [INVOICE/PAYMODE] messages")
    print(f"Look for rows in billing_paymode table with invoice_id: {test_payload['lines'][0]['invoice_id']}")
    
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()