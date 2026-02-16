import sys
import traceback

sys.path.insert(0, r"d:\TMT_ONGOING")

from fastapi_backend.crud_create import create_row

payload = {
    "table": "master_uom",
    "data": {"description":"test","displayorder":"0","status":0,"account_code":"C1B1A1","retail_code":"C1B1A1R1"},
    "auto_generate": {"column":"uom_id","strategy":"max+1"}
}

try:
    resp = create_row(payload['table'], payload['data'], payload['auto_generate'])
    print('Response:', resp)
except Exception as e:
    print('Exception:', type(e), e)
    traceback.print_exc()
