@echo off
rem Roda os testes e, se passarem, faz o commit de tudo com a data de hoje como mensagem e envia para o GitHub
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
rem sem alterações o commit não acontece, mas o push ainda envia commits pendentes
git diff --cached --quiet || git commit -m "%HOJE%"
git push
if errorlevel 1 (
  echo.
  echo Falha no push. O commit ficou salvo localmente.
  pause
  exit /b 1
)
echo.
echo Commit e push concluidos.
pause
