@echo off
setlocal
title Sam-Harness — pull Ollama models
echo   Pulling default local models (may take a while)...
where ollama >nul 2>&1
if errorlevel 1 (
  echo   [X] ollama not in PATH. Install from https://ollama.com/download
  pause
  exit /b 1
)
ollama pull qwen2.5-coder:1.5b
ollama pull gemma3:1b
echo.
echo   [OK] Models requested. Optional cloud: set OLLAMA_API_KEY in .env
pause
endlocal
