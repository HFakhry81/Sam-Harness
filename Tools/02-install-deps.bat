@echo off
setlocal
title Sam-Harness — install dependencies
cd /d "%~dp0.."
echo   cwd=%CD%
where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [X] pnpm missing — run 01-setup-prereqs.bat first.
  pause
  exit /b 1
)
call pnpm install
if errorlevel 1 (
  echo   [X] pnpm install failed.
  pause
  exit /b 1
)
echo   [OK] Dependencies installed.
pause
endlocal
