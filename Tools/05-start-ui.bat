@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sam-Harness — Control Plane UI
cd /d "%~dp0"
set "SAM_TOOLS_NOPAUSE=1"
call "%~dp0Sam-Harness-Manager.cmd" -Action start-ui %*
set "ERR=%ERRORLEVEL%"
endlocal & exit /b %ERR%
