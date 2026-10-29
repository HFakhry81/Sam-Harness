@echo off
setlocal
title Sam-Harness — production gates
cd /d "%~dp0.."
echo   cwd=%CD%
where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [X] pnpm missing.
  pause
  exit /b 1
)
call pnpm run smoke:prod-gates
set "EC=%ERRORLEVEL%"
if not "%EC%"=="0" (
  echo   [X] Gates failed.
  pause
  exit /b %EC%
)
echo   [OK] smoke:prod-gates PASS
pause
endlocal
