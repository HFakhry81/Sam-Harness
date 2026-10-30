@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sam-Harness Manager
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sam-Harness-Manager.ps1" %*
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo   [FAIL] exit %ERR%
  if "%SAM_TOOLS_NOPAUSE%"=="" pause
)
endlocal & exit /b %ERR%
