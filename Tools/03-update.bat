@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sam-Harness — update
cd /d "%~dp0"
set "SAM_TOOLS_NOPAUSE=1"
call "%~dp0Sam-Harness-Manager.cmd" -Action update %*
set "ERR=%ERRORLEVEL%"
pause
endlocal & exit /b %ERR%
