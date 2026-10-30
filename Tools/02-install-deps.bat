@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sam-Harness - install dependencies
cd /d "%~dp0"
set "SAM_TOOLS_NOPAUSE=1"
call "%~dp0Sam-Harness-Manager.cmd" -Action install-deps %*
set "ERR=%ERRORLEVEL%"
pause
endlocal & exit /b %ERR%
