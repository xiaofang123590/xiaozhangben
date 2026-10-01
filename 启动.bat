@echo off
title XiaoZhangBen Server
cd /d "%~dp0"
echo Starting XiaoZhangBen local server...
echo (Keep this window open. Close it or press Ctrl+C to stop.)
echo.
node server.js
pause
