@echo off
cd /d "%~dp0"
echo ============================================
echo   Drive My Home - Resident Reports Website
echo ============================================
echo.
node server.js
if errorlevel 1 (
  echo.
  echo Node.js is required. Install it from https://nodejs.org/ then run this file again.
  pause
)
