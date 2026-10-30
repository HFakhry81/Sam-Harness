@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Sam-Harness - setup prerequisites
cd /d "%~dp0"
set "SAM_TOOLS_NOPAUSE=1"
call "%~dp0Sam-Harness-Manager.cmd" -Action setup-prereqs %*
set "ERR=%ERRORLEVEL%"
pause
endlocal & exit /b %ERR%
