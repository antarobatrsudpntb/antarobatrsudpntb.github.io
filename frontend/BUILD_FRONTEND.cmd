@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Build MELESAT Frontend
call pnpm.cmd install --frozen-lockfile
if errorlevel 1 goto :fail
call pnpm.cmd build
if errorlevel 1 goto :fail
echo PASS - Frontend selesai dibangun.
pause
exit /b 0
:fail
echo FAIL - lihat pesan di atas.
pause
exit /b 1
