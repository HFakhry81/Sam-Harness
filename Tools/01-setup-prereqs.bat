@echo off
setlocal EnableExtensions
title Sam-Harness — setup prerequisites (Windows)
cd /d "%~dp0.."
echo.
echo   Sam-Harness Tools — prerequisites
echo   Project: %CD%
echo.

where winget >nul 2>&1
if errorlevel 1 (
  echo   [!] winget not found. Install Node.js LTS + Git manually, then re-run.
) else (
  echo   [1] Node.js LTS via winget...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo   [2] Git via winget...
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
)

echo.
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node still not in PATH — open a NEW terminal after install.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo   [OK] Node %%v

echo   [3] Enable Corepack / pnpm...
call corepack enable
call corepack prepare pnpm@11.23.0 --activate
where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [X] pnpm not available. Try: npm install -g pnpm
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('pnpm -v') do echo   [OK] pnpm %%v

where git >nul 2>&1
if errorlevel 1 (
  echo   [!] Git not in PATH yet — restart terminal after Git install.
) else (
  for /f "tokens=*" %%v in ('git --version') do echo   [OK] %%v
)

where ollama >nul 2>&1
if errorlevel 1 (
  echo.
  echo   [!] Ollama CLI not in PATH.
  echo       Download: https://ollama.com/download
  echo       Or: winget install -e --id Ollama.Ollama
) else (
  echo   [OK] Ollama CLI found
)

if not exist ".env" (
  if exist ".env.example" (
    copy /Y ".env.example" ".env" >nul
    echo   [OK] Created .env from .env.example — edit keys if you use cloud.
  )
)

if not exist "task.ts" (
  if exist "templates\task.seed.ts" (
    copy /Y "templates\task.seed.ts" "task.ts" >nul
    echo   [OK] Seeded task.ts from templates\task.seed.ts
  )
)

echo.
echo   Prerequisites step finished.
pause
endlocal
