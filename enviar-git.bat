@echo off
chcp 65001 >nul
setlocal
title Enviar projeto para o GitHub
cd /d "%~dp0"

set "REPO=https://github.com/hendellacardoso/RecFlow.git"
set "BRANCH=main"

echo.
echo ==============================================
echo   Enviar "RecFlow" para o GitHub
echo   %REPO%
echo ==============================================
echo.

REM --- 1. Git instalado? ---
where git >nul 2>&1
if errorlevel 1 (
  echo [ERRO] O Git nao foi encontrado.
  echo        Instale em https://git-scm.com/download/win e rode este arquivo de novo.
  goto :fim_erro
)

REM --- 2. Cria o repositorio local na primeira vez ---
if not exist ".git" (
  echo Criando repositorio local...
  git init -q
  if errorlevel 1 goto :fim_erro
)
REM garante que o ramo se chama "main"
git rev-parse --verify HEAD >nul 2>&1
if errorlevel 1 (
  git symbolic-ref HEAD refs/heads/%BRANCH%
) else (
  git branch -M %BRANCH%
)

REM --- 3. Nome e e-mail do autor (pedidos so se ainda nao estiverem configurados) ---
git config user.name >nul 2>&1
if errorlevel 1 (
  set /p "GITNAME=Seu nome para os commits: "
  call git config user.name "%%GITNAME%%"
)
git config user.email >nul 2>&1
if errorlevel 1 (
  set /p "GITEMAIL=Seu e-mail do GitHub: "
  call git config user.email "%%GITEMAIL%%"
)

REM --- 4. Aponta o "origin" para o seu repositorio ---
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin "%REPO%"
) else (
  git remote set-url origin "%REPO%"
)

REM --- 4b. Workflow do GitHub Actions (gera o instalador em Releases) ---
if exist "ci\release.yml" (
  if not exist ".github\workflows" mkdir ".github\workflows"
  copy /y "ci\release.yml" ".github\workflows\release.yml" >nul
)

REM --- 5. Adiciona os arquivos (node_modules e dist ficam de fora pelo .gitignore) ---
git add -A
git diff --cached --quiet
if not errorlevel 1 (
  echo Nenhuma alteracao nova para enviar. Vou so sincronizar com o GitHub.
  goto :enviar
)

echo.
echo Arquivos que serao enviados:
git status --short
echo.
set "MSG="
set /p "MSG=Mensagem do commit (Enter = data e hora): "
if not defined MSG set "MSG=Atualizacao %date% %time:~0,5%"
git commit -q -m "%MSG%"
if errorlevel 1 goto :fim_erro
echo Commit criado: %MSG%

:enviar
echo.
echo Enviando para o GitHub... (na primeira vez o Windows pode pedir login no navegador)
git push -u origin %BRANCH%
if not errorlevel 1 goto :ok

REM --- 6. O GitHub ja tem commits (ex.: README criado pelo site): junta e tenta de novo ---
echo.
echo O repositorio no GitHub ja tem conteudo. Juntando com o que esta aqui...
git pull --no-rebase --no-edit --allow-unrelated-histories -X ours origin %BRANCH%
if errorlevel 1 (
  echo [ERRO] Nao foi possivel juntar automaticamente. Resolva os conflitos e rode de novo.
  goto :fim_erro
)
git push -u origin %BRANCH%
if errorlevel 1 goto :fim_erro

:ok
echo.
echo ==============================================
echo   Pronto! Projeto enviado:
echo   https://github.com/hendellacardoso/RecFlow
echo ==============================================
echo.
pause
exit /b 0

:fim_erro
echo.
echo Algo deu errado. Leia a mensagem acima.
echo.
pause
exit /b 1
