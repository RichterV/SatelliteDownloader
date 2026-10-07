@echo off
rem Roda os testes e, se passarem, faz o commit de tudo com a data de hoje como mensagem
cd /d "%~dp0"
if not exist node_modules call npm install --silent
call npm test --silent
if errorlevel 1 (
  echo.
  echo Testes falharam. Commit cancelado.
  pause
  exit /b 1
)
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set HOJE=%%d
git add -A
git commit -m "%HOJE%"
pause
