@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or later is required.
  echo Install the free Node.js LTS release, then run this file again.
  echo https://nodejs.org/
  pause
  exit /b 1
)
for /f "tokens=1 delims=v" %%v in ('node --version') do set NODE_VERSION=%%v
start "PokeDrop Local Monitor" http://127.0.0.1:8787
node server.mjs
if errorlevel 1 echo The local monitor stopped with an error.
pause
