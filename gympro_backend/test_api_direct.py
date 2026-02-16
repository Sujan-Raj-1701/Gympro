#!/usr/bin/env python3
"""
Simple test to manually call the billing-payments API and see what happens
"""

def test_billing_payments_api():
    """Test the billing-payments API endpoint directly"""
    
    try:
        import sys
        import os
        
        current_dir = os.path.dirname(os.path.abspath(__file__))
        if current_dir not in sys.path:
            sys.path.insert(0, current_dir)
        
        # Import the function directly
        from main import get_billing_payments
        from auth import User
        
        # Create a mock user
        mock_user = User(
            user_id="test_user", 
            username="test", 
            account_code="C2B1A1", 
            retail_code="C2B1A1R1"
        )
        
        print("Testing billing-payments API function directly...")
        print(f"Account code: C2B1A1")
        print(f"Retail code: C2B1A1R1")
        
        # Call the function directly
        result = get_billing_payments("C2B1A1", "C2B1A1R1", None, None, mock_user)
        
        print("API Response:")
        print(f"Success: {result.get('success')}")
        print(f"Count: {result.get('count')}")
        print(f"Message: {result.get('message', 'None')}")
        
        if result.get('data'):
            print(f"Data length: {len(result['data'])}")
            print("\nFirst few records:")
            for i, record in enumerate(result['data'][:3], 1):
                print(f"{i}. billing_id={record.get('billing_id')}, "
                      f"amount={record.get('amount')}, "
                      f"payment_mode_id={record.get('payment_mode_id')}, "
                      f"payment_method={record.get('payment_method')}")
                      
            # Check for UPI specifically
            upi_records = [r for r in result['data'] if r.get('payment_mode_id') == 8]
            print(f"\nUPI records found: {len(upi_records)}")
            for upi in upi_records:
                print(f"  UPI: billing_id={upi.get('billing_id')}, amount={upi.get('amount')}")
        else:
            print("No data returned!")
            
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    test_billing_payments_api()