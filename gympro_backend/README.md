# FastAPI MySQL Backend

## Setup

1. Create a virtual environment and activate it:
  ```
  python -m venv venv
  venv\Scripts\activate  # On Windows
  source venv/bin/activate  # On Linux/Mac
  ```
2. Install dependencies:
  ```
  pip install -r requirements.txt
  ```
3. Set environment variables for your MySQL connection (or edit in `main.py`):
  - `MYSQL_USER` (default: root)
  - `MYSQL_PASSWORD` (default: password)
  - `MYSQL_HOST` (default: localhost)
  - `MYSQL_PORT` (default: 3306)
  - `MYSQL_DB` (default: testdb)

4. Run the server:
  ```
  uvicorn main:app --reload
  ```

## Schema migration: remove legacy columns

We consolidated bookings to use only primary fields. Drop the legacy secondary columns from `booking`:

- eventdate_2
- event_type_id_2
- slot_id_2
- expected_guests_2

Options:

1) Python (recommended)

   python -m fastapi_backend.migrations.drop_legacy_columns

2) SQL fallback (ensure your MySQL version supports IF EXISTS)

   -- See setup_database.sql
   ALTER TABLE `booking` DROP COLUMN IF EXISTS `eventdate_2`;
   ALTER TABLE `booking` DROP COLUMN IF EXISTS `event_type_id_2`;
   ALTER TABLE `booking` DROP COLUMN IF EXISTS `slot_id_2`;
   ALTER TABLE `booking` DROP COLUMN IF EXISTS `expected_guests_2`;

After migration, restart the API.
# FastAPI MySQL Backend

## Setup

1. Create a virtual environment and activate it:
   ```
   python -m venv venv
   venv\Scripts\activate  # On Windows
   source venv/bin/activate  # On Linux/Mac
   ```
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Set environment variables for your MySQL connection (or edit in `main.py`):
   - `MYSQL_USER` (default: root)
   - `MYSQL_PASSWORD` (default: password)
   - `MYSQL_HOST` (default: localhost)
   - `MYSQL_PORT` (default: 3306)
   - `MYSQL_DB` (default: testdb)

4. Run the server:
   ```
   uvicorn main:app --reload
   ```

## API Endpoints

### Create
- **POST** `/create`
- **Body Example:**
  ```json
  {
    "table": "customer",
    "data": {
      "name": "John",
      "email": "john@example.com",
      "accountcode": "A001",
      "retailcode": "R001"
    }
  }
  ```

### Update
- **PUT** `/update`
- **Body Example:**
  ```json
  {
    "table": "customer",
    "data": {
      "id": 1,
      "email": "newemail@example.com",
      "accountcode": "A001",
      "retailcode": "R001"
    }
  }
  ```

### Read
- **POST** `/read`
- **Body Example:**
  ```json
  {
    "tables": ["customer", "orders"],
    "accountcode": "A001",
    "retailcode": "R001"
  }
  ```

## Notes
- All requests must include `accountcode` and `retailcode`.
- The `/read` endpoint will attempt to join tables on columns with the same name.
- For production, improve join logic and error handling as needed. 