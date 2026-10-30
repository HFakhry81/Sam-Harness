@echo off
setlocal
title Sam-Harness - one-click install
cd /d "%~dp0..\.."
echo.
echo   Launching PowerShell installer...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set ERR=%ERRORLEVEL%
if not "%ERR%"=="0" (
  echo.
  echo   Install finished with exit code %ERR%
  pause
)
endlocal & exit /b %ERR%
