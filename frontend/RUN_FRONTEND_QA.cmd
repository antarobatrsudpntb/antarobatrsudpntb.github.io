@echo off
chcp 65001 >nul
cd /d "%~dp0"
title QA MELESAT Frontend PWA
echo ============================================================
echo   MELESAT - FRONTEND PWA STATIC QA v1.0.0
echo ============================================================
node scripts\verify-frontend.mjs
if errorlevel 1 goto :fail
echo.
echo PASS - paket frontend siap diuji bersama backend UAT yang dipilih.
echo Checklist uji empat peran: QA_FRONTEND_EMULATOR.md
if not defined MELESAT_NO_PAUSE pause
exit /b 0
:fail
echo.
echo FAIL - lihat pesan di atas.
if not defined MELESAT_NO_PAUSE pause
exit /b 1
