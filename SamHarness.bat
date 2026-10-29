@echo off
setlocal EnableExtensions EnableDelayedExpansion
title UpNexa - Sam-Harness Agency
color 0B
cls

set "PROJECT_DIR=E:\UpNexa.com\Sam-Harness"
set "TARGET_DOCS=E:\UpNexa.com\maw3ed\docs"
set "DOCKER_EXE=%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
set "MODE=agency"
set "EXTRA_ARGS="
set "EXIT_CODE=0"

echo.
echo   ================================================================
echo      UpNexa  -  Sam-Harness  -  AI Agency Platform
echo      Hybrid Local + Cloud  ^|  LangGraph Review  ^|  Delivery OS
echo   ================================================================
echo.
echo   Pipeline ^(architecture^):
echo     Router -^> Intake -^> Evidence -^> Strategist ^<-^> Auditor ^(^<=5^)
echo            -^> Architect -^> Help -^> Marketer -^> Verifier -^> Pack
echo     Level-3 Implementer runs ONLY with explicit GO.
echo.
echo   ----------------------------------------------------------------
echo.

:: ----- Mode menu -----
echo   Choose run mode:
echo     [1] Control Plane UI               ^(default — اكتب المهمة من المتصفح^)
echo     [2] Agency analysis / report pack  ^(CLI — uses current task.ts^)
echo     [3] Agency + Level-3 implement     ^(requires GO — edits target repo^)
echo     [4] Desktop Operator only          ^(L1 tools^)
echo     [5] Smoke checks                   ^(no LLM^)
echo     [6] Legacy linear swarm            ^(AGENCY_MODE=0^)
echo.
set /p "CHOICE=   Enter 1-6 [default=1]: "
if "%CHOICE%"=="" set "CHOICE=1"
if "%CHOICE%"=="1" set "MODE=ui"
if "%CHOICE%"=="2" set "MODE=agency"
if "%CHOICE%"=="3" set "MODE=implement"
if "%CHOICE%"=="4" set "MODE=ops"
if "%CHOICE%"=="5" set "MODE=smoke"
if "%CHOICE%"=="6" set "MODE=legacy"
echo.
echo   Mode selected: %MODE%
echo.

:: ----- Step 1: Docker (optional) -----
echo   [1/4] Docker Desktop ^(optional — not required for agency runs^)
echo.

tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>nul | find /I "Docker Desktop.exe" >nul
if errorlevel 1 (
  echo   [!] Docker not running — skipping ^(OK for Sam-Harness agency^).
) else (
  echo   [OK] Docker Desktop is running.
)
echo.

:: ----- Step 2: Ollama -----
echo   [2/4] Local Ollama engine
echo         Why? Router + local fallback models need Ollama on :11434
echo.

tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul
if errorlevel 1 goto :ollama_missing
echo   [OK] Ollama process is running.
goto :ollama_ping

:ollama_missing
echo   [!] Ollama process not found.
echo       Starting: ollama serve
start "" /MIN ollama serve
timeout /t 4 /nobreak >nul
echo   [OK] Ollama start requested.

:ollama_ping
curl -s -o nul -w "" http://127.0.0.1:11434/api/tags 2>nul
if errorlevel 1 (
  echo   [!] Ollama API not answering yet — first model load may take a moment.
) else (
  echo   [OK] Ollama API reachable at http://127.0.0.1:11434
)
echo.

:: ----- Step 3: Project / Node / pnpm / .env -----
echo   [3/4] Project environment
echo.

if not exist "%PROJECT_DIR%" (
  echo   [X] Project folder not found:
  echo       %PROJECT_DIR%
  echo.
  pause
  exit /b 1
)

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo   [X] Could not open the project folder.
  pause
  exit /b 1
)
echo   [OK] cwd = %CD%

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js not found in PATH. Install Node LTS then retry.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v 2^>nul') do echo   [OK] Node %%v

where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [X] pnpm not found. Try: corepack enable ^&^& corepack prepare pnpm@latest --activate
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('pnpm -v 2^>nul') do echo   [OK] pnpm %%v

if exist "%PROJECT_DIR%\node_modules" (
  echo   [OK] node_modules present
) else (
  echo   [!] node_modules missing — running pnpm install...
  call pnpm install
  if errorlevel 1 (
    echo   [X] pnpm install failed.
    pause
    exit /b 1
  )
)

if exist "%PROJECT_DIR%\.env" (
  findstr /I /C:"OLLAMA_API_KEY=" "%PROJECT_DIR%\.env" >nul 2>&1
  if errorlevel 1 (
    echo   [!] .env found but OLLAMA_API_KEY missing — cloud specialists fall back to local.
  ) else (
    echo   [OK] .env has OLLAMA_API_KEY — cloud specialists enabled when key is valid.
  )
) else (
  echo   [!] No .env — Level-2/Agency specialists use local Ollama only.
)
echo   Tip: task source = task.ts  ^(also refreshes task.md^)
echo   Ops guide: docs\AGENCY_OPS.md
echo.

:: ----- Step 4: Launch -----
echo   [4/4] Start Sam-Harness
echo   ----------------------------------------------------------------
echo.

if /I "%MODE%"=="ui" goto :run_ui
if /I "%MODE%"=="smoke" goto :run_smoke
if /I "%MODE%"=="implement" goto :run_implement
if /I "%MODE%"=="ops" goto :run_ops
if /I "%MODE%"=="legacy" goto :run_legacy
goto :run_agency

:run_ui
echo   ^>^> Control Plane UI
echo   Command: pnpm run ui
echo   Browser: http://127.0.0.1:8787/
echo   Flow: اكتب المهمة -^> احفظ task.ts -^> اختر التشغيل من الواجهة
echo.
call pnpm run ui
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_agency
echo   ^>^> Agency analysis ^(report pack only — no client code edits^)
echo   Command: pnpm start -- --yes
echo.
call pnpm start -- --yes
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_implement
echo   ^>^> Agency + Level-3 implement ^(GO authorized for this run^)
echo   WARNING: May edit files under the target repo from task.ts
echo   Command: pnpm start -- --yes --implement --go
echo.
set /p "CONFIRM=   Type YES to continue: "
if /I not "!CONFIRM!"=="YES" (
  echo   Cancelled. No implement run.
  set "EXIT_CODE=0"
  goto :footer
)
call pnpm start -- --yes --implement --go
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_ops
echo   ^>^> Desktop Operator path
echo   Put an operational task in task.ts ^(route=operational^) or pass text.
echo   For a one-shot ops prompt, edit task.ts then re-run, or:
echo   Command example: pnpm start -- --yes "open Desktop folder"
echo.
set /p "OPS_TASK=   Ops task text ^(Enter = use task.ts^): "
if "!OPS_TASK!"=="" (
  call pnpm start -- --yes
) else (
  call pnpm start -- --yes "!OPS_TASK!"
)
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_legacy
echo   ^>^> Legacy linear Level-2 swarm ^(AGENCY_MODE=0^)
echo.
set "AGENCY_MODE=0"
call pnpm start -- --yes
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_smoke
echo   ^>^> Smoke suite ^(no LLM calls^)
echo.
call pnpm run smoke:agency
if errorlevel 1 set "EXIT_CODE=1"
call pnpm run smoke:delivery
if errorlevel 1 set "EXIT_CODE=1"
call pnpm run smoke:capabilities
if errorlevel 1 set "EXIT_CODE=1"
if "!EXIT_CODE!"=="0" (
  echo.
  echo   [OK] All smoke checks PASS.
) else (
  echo.
  echo   [X] One or more smoke checks failed.
)
goto :footer

:after_run
echo.
echo   ----------------------------------------------------------------
echo.

if not %EXIT_CODE% EQU 0 goto :failed

echo   [OK] Run finished.
echo.
echo   Review locally ^(cwd^):
echo     - engagement.json / evidence-pack.md / DELIVERY_BOARD.md / go-nogo.json
echo     - strategy-v* / audit-v* / rejection-v*  ^(review loop^)
echo     - ceo-draft.md / audit-report.md / execution-plan.md
echo     - help-system-spec.md / marketing-campaign.md / final-report.md
echo.
echo   Numbered pack on target project:
echo     %TARGET_DOCS%\Sam-Harness no.X\
echo.
echo   Next steps:
echo     1^) Open DELIVERY_BOARD.md and the pack folder
echo     2^) If analysis looks good and you want code changes: re-run mode [2]
echo     3^) Guide: %PROJECT_DIR%\docs\AGENCY_OPS.md
goto :footer

:failed
echo   [X] Execution stopped. Exit code: %EXIT_CODE%
echo       Common causes: Ollama down, missing model, bad API key, audit gate FAIL.
echo       Check console output above and docs\AGENCY_OPS.md

:footer
echo.
echo   ================================================================
echo      UpNexa - Sam-Harness  --  launcher finished
echo   ================================================================
echo.
pause
endlocal & exit /b %EXIT_CODE%
