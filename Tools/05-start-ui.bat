@echo off
setlocal
title Sam-Harness — Control Plane UI
cd /d "%~dp0.."
if not exist "node_modules" (
  echo   [!] node_modules missing — running pnpm install...
  call pnpm install
)
if not exist "task.ts" if exist "templates\task.seed.ts" copy /Y "templates\task.seed.ts" "task.ts" >nul
if not exist ".env" if exist ".env.example" copy /Y ".env.example" ".env" >nul
set "CONTROL_PLANE_PORT=8787"
set "AGENT_PROFILE=hybrid"
echo   Starting UI → http://127.0.0.1:8787/
call pnpm run ui
endlocal
