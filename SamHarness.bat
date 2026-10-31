@echo off
setlocal EnableExtensions EnableDelayedExpansion
title UpNexa - Sam-Harness Agency
color 0B
cls

:: Portable: always the folder that contains this .bat
set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "MODE=agency"
set "EXIT_CODE=0"

echo.
echo   ================================================================
echo      UpNexa  -  Sam-Harness  -  AI Agency Platform
echo      Hybrid Local + Cloud  ^|  LangGraph Review  ^|  Delivery OS
echo   ================================================================
echo.
echo   Project: %PROJECT_DIR%
echo   First-time setup: Tools\Sam-Harness-Manager.cmd  ^(or 01-setup-prereqs then 02-install-deps^)
echo.
echo   ----------------------------------------------------------------
echo.

echo   Choose run mode:
echo     [1] Control Plane UI               ^(default^)
echo     [2] Agency analysis / report pack  ^(CLI — task.ts^)
echo     [3] Agency + Level-3 implement     ^(requires GO^)
echo     [4] Desktop Operator only
echo     [5] Smoke + prod gates
echo     [6] Legacy linear swarm            ^(AGENCY_MODE=0^)
echo     [7] Open Tools folder
echo.
set /p "CHOICE=   Enter 1-7 [default=1]: "
if "%CHOICE%"=="" set "CHOICE=1"
if "%CHOICE%"=="1" set "MODE=ui"
if "%CHOICE%"=="2" set "MODE=agency"
if "%CHOICE%"=="3" set "MODE=implement"
if "%CHOICE%"=="4" set "MODE=ops"
if "%CHOICE%"=="5" set "MODE=smoke"
if "%CHOICE%"=="6" set "MODE=legacy"
if "%CHOICE%"=="7" (
  start "" explorer "%PROJECT_DIR%\Tools"
  goto :footer
)
echo.
echo   Mode: %MODE%
echo.

cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo   [X] Cannot open project folder.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js missing — run Tools\01-setup-prereqs.bat
  pause
  exit /b 1
)
where pnpm >nul 2>&1
if errorlevel 1 (
  echo   [X] pnpm missing — run Tools\01-setup-prereqs.bat
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\node_modules" (
  echo   [!] Installing dependencies...
  call pnpm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "%PROJECT_DIR%\.env" if exist "%PROJECT_DIR%\.env.example" (
  copy /Y "%PROJECT_DIR%\.env.example" "%PROJECT_DIR%\.env" >nul
)
if not exist "%PROJECT_DIR%\task.ts" if exist "%PROJECT_DIR%\templates\task.seed.ts" (
  copy /Y "%PROJECT_DIR%\templates\task.seed.ts" "%PROJECT_DIR%\task.ts" >nul
)

:: Ollama optional ping
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul
if errorlevel 1 (
  echo   [!] Ollama not running — starting ollama serve...
  start "" /MIN ollama serve
  timeout /t 3 /nobreak >nul
) else (
  echo   [OK] Ollama process present
)
echo.

if /I "%MODE%"=="ui" goto :run_ui
if /I "%MODE%"=="smoke" goto :run_smoke
if /I "%MODE%"=="implement" goto :run_implement
if /I "%MODE%"=="ops" goto :run_ops
if /I "%MODE%"=="legacy" goto :run_legacy
goto :run_agency

:run_ui
echo   ^>^> Control Plane UI  http://127.0.0.1:8787/
echo   ^>^> Auth: paste owner token from .controlplane-token ^(or CONTROL_PLANE_TOKEN^)
echo   ^>^> Sandbox: user drives/home allowed; WORKSPACE_ROOTS restricts; WORKSPACE_DENY extends
echo   ^>^> Outputs: %%USERPROFILE%%\Documents\Sam-Harness  ^(or SAM_OUTPUT_HOME^)
call pnpm run ui
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_agency
call pnpm start -- --yes
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_implement
set /p "CONFIRM=   Type YES to allow Level-3 code edits: "
if /I not "!CONFIRM!"=="YES" (
  set "EXIT_CODE=0"
  goto :footer
)
call pnpm start -- --yes --implement --go
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_ops
set /p "OPS_TASK=   Ops task text ^(Enter = use task.ts^): "
if "!OPS_TASK!"=="" (
  call pnpm start -- --yes
) else (
  call pnpm start -- --yes "!OPS_TASK!"
)
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_legacy
set "AGENCY_MODE=0"
call pnpm start -- --yes
set "EXIT_CODE=!ERRORLEVEL!"
goto :after_run

:run_smoke
call pnpm run smoke:prod-gates
set "EXIT_CODE=!ERRORLEVEL!"
goto :footer

:after_run
echo.
if not %EXIT_CODE% EQU 0 (
  echo   [X] Exit %EXIT_CODE% — see docs\AGENCY_OPS.md
) else (
  echo   [OK] Finished. Packs: %USERPROFILE%\Documents\Sam-Harness\reports\Sam-Harness no.X\
)
goto :footer

:footer
echo.
pause
endlocal & exit /b %EXIT_CODE%
