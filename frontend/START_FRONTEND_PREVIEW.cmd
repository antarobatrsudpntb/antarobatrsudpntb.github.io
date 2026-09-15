@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MELESAT Frontend PWA
echo ============================================================
echo   MELESAT - FRONTEND PWA v1.0.0
echo   Pastikan backend UAT yang dipilih sudah READY
echo ============================================================
if not exist "dist\index.html" (
  echo FAIL - folder dist tidak tersedia.
  pause
  exit /b 1
)
start "" http://127.0.0.1:4173
node preview-server.mjs
pause
