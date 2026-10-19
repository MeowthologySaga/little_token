@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js and try again.
  pause
  exit /b 1
)
node scripts\play-local.mjs %*
if errorlevel 1 pause
