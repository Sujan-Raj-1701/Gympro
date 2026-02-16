#!/usr/bin/env python3
"""Test script to verify billing-payments endpoint functionality."""

import json
from datetime import datetime

def test_direct_database_query():
    """Test direct database query to see what's in billing_paymode table."""
    print("Testing direct database query...")
    
    try:
        # Import database components
        import sys
        import os
        
        # Add the current directory to Python path
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        
        from invoice import _get_paymode_table
        from db import engine
        from sqlalchemy import select
        
        pay_tbl = _get_paymode_table()
        if pay_tbl is None:
            print("ERROR: billing_paymode table not available")
            return
            
        with engine.begin() as conn:
            # Get all records
            stmt = select(pay_tbl).order_by(pay_tbl.c.created_at.desc()).limit(10)
            rows = [dict(r._mapping) for r in conn.execute(stmt)]
            
            print(f"Found {len(rows)} recent payment records:")
            for i, row in enumerate(rows, 1):
                print(f"\n{i}. Payment Record:")
                print(f"   Billing ID: {row.get('billing_id')}")
                print(f"   Amount: ₹{row.get('amount', 0)}")
                print(f"   Payment Mode ID: {row.get('payment_mode_id')}")
                print(f"   Payment Method: {row.get('payment_method', 'None')}")
                print(f"   Created: {row.get('created_at')}")
                print(f"   Account: {row.get('account_code')}")
                print(f"   Retail: {row.get('retail_code')}")
                
            # Payment mode analysis
            if rows:
                print("\n" + "="*50)
                print("PAYMENT MODE ANALYSIS:")
                
                payment_summary = {}
                unique_accounts = set()
                unique_retails = set()
                
                for row in rows:
                    unique_accounts.add(row.get('account_code'))
                    unique_retails.add(row.get('retail_code'))
                    
                    mode_id = row.get('payment_mode_id')
                    method = row.get('payment_method', 'None')
                    amount = float(row.get('amount', 0))
                    
                    # Create a key for grouping
                    if method and method != 'None':
                        key = f"{method} (ID: {mode_id})"
                    else:
                        # Map common IDs to names
                        id_mapping = {
                            1: 'Cash',
                            2: 'Card',
                            3: 'Credit Card', 
                            4: 'Debit Card',
                            5: 'Net Banking',
                            6: 'Wallet',
                            7: 'Card',
                            8: 'UPI',
                            9: 'Cheque',
                            10: 'Bank Transfer'
                        }
                        mode_name = id_mapping.get(mode_id, f'Unknown_{mode_id}')
                        key = f"{mode_name} (ID: {mode_id})"
                    
                    if key not in payment_summary:
                        payment_summary[key] = {"count": 0, "total": 0}
                    
                    payment_summary[key]["count"] += 1
                    payment_summary[key]["total"] += amount
                
                print(f"\nUnique Account Codes: {list(unique_accounts)}")
                print(f"Unique Retail Codes: {list(unique_retails)}")
                
                print("\nPayment Mode Summary:")
                for mode, summary in payment_summary.items():
                    print(f"  {mode}: {summary['count']} transactions, ₹{summary['total']:.2f}")
                    
                # Check for UPI specifically
                upi_found = any('UPI' in key or '8' in key for key in payment_summary.keys())
                print(f"\nUPI payments found: {'YES' if upi_found else 'NO'}")
                
                if not upi_found:
                    print(">>> This might be why Dashboard is showing only Cash!")
                    print(">>> Check if UPI payments are being saved with payment_mode_id=8")
                else:
                    print(">>> UPI payments are in database. Check Frontend API call!")
                    print(">>> Dashboard should use these account/retail codes:")
                    for acc in unique_accounts:
                        for ret in unique_retails:
                            print(f">>>   account_code={acc}, retail_code={ret}")
                    
    except Exception as e:
        print(f"ERROR in direct database query: {e}")
        import traceback
        traceback.print_exc()

def test_api_endpoint_simulation():
    """Simulate the API endpoint call with the actual database codes."""
    print("\n" + "="*50)
    print("TESTING API ENDPOINT SIMULATION:")
    
    try:
        import sys
        import os
        
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        
        from invoice import _get_paymode_table
        from db import engine
        from sqlalchemy import select, MetaData, Table
        
        pay_tbl = _get_paymode_table()
        if pay_tbl is None:
            print("ERROR: billing_paymode table not available")
            return
        
        # Test with the actual account/retail codes we found
        test_account = "C2B1A1"
        test_retail = "C2B1A1R1"
        
        print(f"Testing API call simulation with account_code={test_account}, retail_code={test_retail}")
        
        with engine.begin() as conn:
            stmt = select(pay_tbl).where(
                pay_tbl.c.account_code == test_account,
                pay_tbl.c.retail_code == test_retail
            ).order_by(pay_tbl.c.created_at.desc())
            
            rows = [dict(r._mapping) for r in conn.execute(stmt)]
            
            print(f"API would return {len(rows)} records:")
            
            # Enhance with payment mode names (like the actual API does)
            for row in rows:
                if row.get('payment_mode_id') and not row.get('payment_method'):
                    mode_id = row['payment_mode_id']
                    # Try to resolve payment mode name
                    try:
                        md_local = MetaData()
                        for pm_table_name in ['master_paymentmodes', 'master_payment_mode', 'master_paymode']:
                            try:
                                pm_tbl = Table(pm_table_name, md_local, autoload_with=engine)
                                pm_stmt = select(pm_tbl).where(pm_tbl.c.payment_mode_id == mode_id)
                                pm_row = conn.execute(pm_stmt).first()
                                if pm_row:
                                    pm_data = dict(pm_row._mapping)
                                    payment_name = (pm_data.get('payment_mode_name') or 
                                                  pm_data.get('paymode_name') or 
                                                  pm_data.get('name') or '')
                                    if payment_name:
                                        row['payment_method'] = str(payment_name)
                                        print(f"  Enhanced mode_id {mode_id} -> {payment_name}")
                                        break
                                break
                            except Exception:
                                continue
                    except Exception:
                        pass
            
            # Show what the API would return
            print("\nAPI Response Data:")
            for i, row in enumerate(rows, 1):
                print(f"{i}. billing_id={row.get('billing_id')}, amount={row.get('amount')}, "
                      f"payment_mode_id={row.get('payment_mode_id')}, "
                      f"payment_method={row.get('payment_method', 'None')}")
            
            return {"success": True, "count": len(rows), "data": rows}
            
    except Exception as e:
        print(f"ERROR in API simulation: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    print("Billing Payments Database Test")
    print("=" * 50)
    
    # Test direct database query
    test_direct_database_query()
    
    # Test API endpoint simulation
    test_api_endpoint_simulation()