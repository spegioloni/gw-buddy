@echo off
title GigraWars Flotten-Kommandozentrale
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js wurde nicht gefunden - bitte von https://nodejs.org installieren.
  echo   Die HTML-Datei laesst sich auch ohne Node oeffnen, dann aber ohne Live-API.
  echo.
  pause
  exit /b 1
)
start "" http://localhost:8787
node gw-server.mjs %*
pause
