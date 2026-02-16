@echo off
REM Simple FastAPI server startup script for Windows
REM Usage: start_server.bat [port]

setlocal

REM Configuration
set DEFAULT_PORT=8000
set PORT=%1
if "%PORT%"=="" set PORT=%DEFAULT_PORT%
if "%HOST%"=="" set HOST=0.0.0.0
set APP_MODULE=fastapi_backend.main:app

echo 🚀 Starting Salon POS FastAPI Backend...
echo 📁 Current directory: %CD%
echo 🌐 Host: %HOST%
echo 🔌 Port: %PORT%
echo 📦 Module: %APP_MODULE%

REM Check if we're in the right directory
if not exist "main.py" (
    echo ❌ Error: main.py not found
    echo    Make sure you're running this from the fastapi_backend directory
    pause
    exit /b 1
)

REM Check for virtual environment
if exist "..\venv\Scripts\activate.bat" (
    echo 🐍 Using virtual environment: ..\venv
    call ..\venv\Scripts\activate.bat
) else if exist "venv\Scripts\activate.bat" (
    echo 🐍 Using virtual environment: .\venv
    call venv\Scripts\activate.bat
) else (
    echo ⚠️  No virtual environment found. Using system Python.
)

REM Check for .env file
if exist ".env" (
    echo ⚙️  Environment file found: .env
) else if exist ".env.production" (
    echo ⚙️  Production environment file found: .env.production
    echo    Consider copying it to .env for local development
) else (
    echo ⚠️  No .env file found. Using default settings.
)

REM Check if uvicorn is available
python -c "import uvicorn" 2>nul
if errorlevel 1 (
    echo ❌ Error: uvicorn not found
    echo    Install it with: pip install uvicorn
    pause
    exit /b 1
)

echo.
echo 🎯 Starting server...
echo    Access at: http://%HOST%:%PORT%
echo    Health check: http://%HOST%:%PORT%/health
echo    API docs: http://%HOST%:%PORT%/docs
echo.
echo Press Ctrl+C to stop the server
echo ----------------------------------------

REM Change to parent directory so imports work correctly
cd ..

REM Start the server
python -m uvicorn %APP_MODULE% --host %HOST% --port %PORT% --reload --log-level info