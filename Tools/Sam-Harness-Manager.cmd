@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sam-Harness Manager
cd /d "%~dp0"
:: Prefer Windows PowerShell 5.1 (not pwsh 7) so double-click works on stock Win10/11
set "PS51=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS51%" set "PS51=powershell"
"%PS51%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0Sam-Harness-Manager.ps1" %*
set "ERR=%ERRORLEVEL%"
if not "%ERR%"=="0" (
  echo.
  echo   [FAIL] exit %ERR%
  if "%SAM_TOOLS_NOPAUSE%"=="" pause
)
endlocal & exit /b %ERR%
