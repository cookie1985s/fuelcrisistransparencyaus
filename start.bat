@echo off
title AU Commodity Supply Monitor
echo ============================================
echo  AU Commodity Supply Monitor — Strait of Hormuz Crisis Edition
echo  Live ABS data auto-syncs daily. No input required.
echo ============================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Please download and install Node.js from https://nodejs.org
    echo Then re-run this script.
    pause
    exit /b 1
)

echo Node.js found. Checking dependencies...

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo Installing dependencies (first run only — takes ~1 min)...
    call npm install
    if %errorlevel% neq 0 (
        echo ERROR: npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
)

:: Build if dist not present
if not exist "dist\index.cjs" (
    echo Building app for first run...
    call npm run build
    if %errorlevel% neq 0 (
        echo ERROR: Build failed. See output above.
        pause
        exit /b 1
    )
)

echo.
echo Starting server on http://localhost:5000
echo Opening dashboard in your browser...
echo.
echo Press Ctrl+C to stop the server.
echo.

:: Open browser after a short delay
start /b cmd /c "timeout /t 2 >nul && start http://localhost:5000"

:: Start the server
set NODE_ENV=production
node dist\index.cjs
pause
