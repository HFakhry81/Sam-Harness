@echo off
setlocal
title Sam-Harness — update from git
cd /d "%~dp0.."
echo   cwd=%CD%
where git >nul 2>&1
if errorlevel 1 (
  echo   [X] git missing.
  pause
  exit /b 1
)
git pull
if errorlevel 1 (
  echo   [!] git pull had issues — resolve then retry.
)
where pnpm >nul 2>&1
if not errorlevel 1 call pnpm install
echo   [OK] Update pass finished.
pause
endlocal
