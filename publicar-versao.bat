@echo off
chcp 65001 >nul
setlocal
title Publicar versao do RecFlow
cd /d "%~dp0"

echo.
echo ==============================================
echo   Publicar uma versao do RecFlow no GitHub
echo   (o GitHub gera o instalador e coloca em Releases)
echo ==============================================
echo.

where git >nul 2>&1 || (echo [ERRO] Git nao encontrado. & goto :erro)
if not exist ".git" (echo [ERRO] Rode primeiro o enviar-git.bat. & goto :erro)

REM --- 1. Nada pendente: tudo precisa estar enviado ---
git add -A
git diff --cached --quiet
if errorlevel 1 (
  echo Ha alteracoes ainda nao enviadas. Rode o enviar-git.bat antes de publicar.
  git reset -q
  goto :erro
)

REM --- 2. Versao atual do package.json ---
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "(Get-Content package.json -Raw | ConvertFrom-Json).version"`) do set "VER=%%v"
echo Versao no package.json: %VER%

git fetch -q --tags origin
git rev-parse -q --verify "refs/tags/v%VER%" >nul
if errorlevel 1 goto :tag
echo.
echo A versao %VER% ja foi publicada.
set "NOVA="
set /p "NOVA=Digite o numero da nova versao (ex.: 1.1.1) ou Enter para cancelar: "
if not defined NOVA goto :erro
powershell -NoProfile -Command "$p='package.json'; $j=[IO.File]::ReadAllText($p); $j=[regex]::Replace($j, '(?<=\x22version\x22: \x22)[^\x22]+', $env:NOVA); [IO.File]::WriteAllText($p, $j)"
set "VER=%NOVA%"
git add package.json
git commit -q -m "Versao %VER%"
git push -q origin HEAD
if errorlevel 1 goto :erro
echo package.json atualizado para %VER%.

:tag
REM --- 3. Cria a tag e envia: isso dispara o GitHub Actions ---
echo.
choice /m "Publicar a versao v%VER% agora"
if errorlevel 2 goto :erro
git tag -a "v%VER%" -m "RecFlow %VER%"
git push origin "v%VER%"
if errorlevel 1 goto :erro

echo.
echo ==============================================
echo   Tag v%VER% enviada!
echo   O GitHub esta gerando o instalador (leva uns 5 a 10 minutos).
echo   Acompanhe em Actions; quando terminar ele aparece em Releases:
echo   https://github.com/hendellacardoso/RecFlow/releases
echo ==============================================
start "" "https://github.com/hendellacardoso/RecFlow/actions"
echo.
pause
exit /b 0

:erro
echo.
echo Publicacao cancelada ou com erro. Leia a mensagem acima.
pause
exit /b 1
