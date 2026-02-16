#!/usr/bin/env python3

from appointment_transactions import engine
from sqlalchemy import text

with engine.begin() as conn:
    # Check transactions table
    result = conn.execute(text("SELECT appointment_id, service_id, service_name FROM appointment_transactions WHERE appointment_id = 'APT-8'"))
    print('Transaction table:')
    for row in result:
        print(f'  apt_id: {row[0]}, service_id: {row[1]}, name: {row[2]}')
    
    print()
    
    # Check summary table  
    result = conn.execute(text("SELECT apt_id, service_id, service_name FROM appointment_trans_summary WHERE apt_id = 'APT-8'"))
    print('Summary table:')
    for row in result:
        print(f'  apt_id: {row[0]}, service_id: {row[1]}, name: {row[2]}')