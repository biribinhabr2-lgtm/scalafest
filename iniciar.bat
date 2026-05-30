@echo off
title EscalaFest — WhatsApp Server
cd /d "%~dp0"
echo.
echo  Iniciando EscalaFest WhatsApp Server...
echo.
node src/server.js
pause
