@echo off
rem Faz o commit de todas as alterações usando a data de hoje como mensagem
cd /d "%~dp0"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set HOJE=%%d
git add -A
git commit -m "%HOJE%"
pause
