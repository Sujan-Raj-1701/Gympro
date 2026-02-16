@echo off
REM Frontend Build and Deploy Script for Windows
REM Usage: deploy.bat [environment]
REM Environments: dev, prod, netlify, railway

setlocal enabledelayedexpansion

set NODE_ENV=%1
if "%NODE_ENV%"=="" set NODE_ENV=prod

echo 🚀 Frontend Build and Deploy Script
echo 📁 Working directory: %CD%
echo 🌍 Environment: %NODE_ENV%

REM Check if package.json exists
if not exist "package.json" (
    echo ❌ Error: package.json not found
    echo    Run this script from the saloon_frontend directory
    pause
    exit /b 1
)

REM Check Node.js and npm
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: Node.js not found. Please install Node.js
    pause
    exit /b 1
)

npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Error: npm not found. Please install npm
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo 📦 Node.js: %NODE_VERSION%
echo 📦 npm: %NPM_VERSION%

REM Set environment variables based on deployment target
if "%NODE_ENV%"=="dev" (
    set VITE_API_BASE_URL=https://hub.techiesmagnifier.com
    set VITE_BACKEND_ORIGIN=https://hub.techiesmagnifier.com
) else if "%NODE_ENV%"=="development" (
    set VITE_API_BASE_URL=https://hub.techiesmagnifier.com
    set VITE_BACKEND_ORIGIN=https://hub.techiesmagnifier.com
) else (
    set VITE_API_BASE_URL=http://localhost:8005/
    set VITE_BACKEND_ORIGIN=http://localhost:8005/
)

echo 🔗 API Base URL: %VITE_API_BASE_URL%

REM Install dependencies
echo 📦 Installing dependencies...
call npm install
if errorlevel 1 (
    echo ❌ Error: npm install failed
    pause
    exit /b 1
)

REM Type checking
echo 🔍 Running type check...
call npm run typecheck
if errorlevel 1 (
    echo ❌ Error: Type check failed
    pause
    exit /b 1
)

REM Build the project
echo 🔨 Building frontend...
call npm run build
if errorlevel 1 (
    echo ❌ Error: Build failed
    pause
    exit /b 1
)

REM Ensure .htaccess is in the build output for Apache SPA routing
if exist "public\.htaccess" (
    if not exist "dist\spa\.htaccess" (
        echo 📄 Copying .htaccess for Apache SPA routing...
        copy "public\.htaccess" "dist\spa\.htaccess" >nul
    )
)

REM Check build output
if not exist "dist\spa" (
    echo ❌ Error: Build failed - dist\spa directory not found
    pause
    exit /b 1
)

echo ✅ Build completed successfully
echo 📁 Build output: dist\spa\
dir dist\spa

REM Environment-specific next steps
if "%NODE_ENV%"=="dev" (
    echo 🚀 Starting development server...
    echo    Frontend: http://localhost:8080
    echo    Backend:  %VITE_API_BASE_URL%
    call npm run dev
) else if "%NODE_ENV%"=="development" (
    echo 🚀 Starting development server...
    echo    Frontend: http://localhost:8080
    echo    Backend:  %VITE_API_BASE_URL%
    call npm run dev
) else (
    echo 🚀 Production build ready
    echo    Serve the dist\spa\ directory with a web server
    echo    Example: cd dist\spa ^&^& python -m http.server 8080
    echo    Example: npx serve dist\spa -l 8080
)

echo ✨ Done!
pause