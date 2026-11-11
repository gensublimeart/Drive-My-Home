@echo off
cd /d "%~dp0"

where git >nul 2>&1
if errorlevel 1 (
  echo Git is required. Install it from https://git-scm.com/download/win
  pause
  exit /b 1
)

if not exist .git (
  git init -b main
  if errorlevel 1 (
    echo Could not create the git repository.
    pause
    exit /b 1
  )
)

git config --get user.name >nul 2>&1
if errorlevel 1 goto missing_identity
git config --get user.email >nul 2>&1
if errorlevel 1 goto missing_identity

git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Update Drive My Home website"
  if errorlevel 1 (
    echo Commit failed.
    pause
    exit /b 1
  )
) else (
  echo No new changes to commit.
)

git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin https://github.com/gensublimeart/Drive-My-Home.git
) else (
  git remote set-url origin https://github.com/gensublimeart/Drive-My-Home.git
)

echo.
echo Sign in to GitHub. This window does not save the token.
set /p GH_USER=GitHub username: 
set /p GH_TOKEN=GitHub token: 
if "%GH_USER%"=="" goto missing_login
if "%GH_TOKEN%"=="" goto missing_login

set "ASKPASS=%TEMP%\dmh-git-askpass.cmd"
(
  echo @echo off
  echo echo %%* ^| findstr /I "Username" ^>nul
  echo if %%errorlevel%%==0 ^(
  echo   echo %GH_USER%
  echo ^) else ^(
  echo   echo %GH_TOKEN%
  echo ^)
) > "%ASKPASS%"

set "GIT_ASKPASS=%ASKPASS%"
set "GIT_TERMINAL_PROMPT=0"
set "GCM_INTERACTIVE=Never"
git -c credential.helper= push -u origin main
set PUSH_ERR=%ERRORLEVEL%

if not "%PUSH_ERR%"=="0" goto push_failed

powershell -NoProfile -Command "$ErrorActionPreference='Stop'; $h=@{Authorization=('Bearer '+$env:GH_TOKEN);Accept='application/vnd.github+json';'User-Agent'='drive-my-home-upload';'X-GitHub-Api-Version'='2022-11-28'}; $body='{""source"":{""branch"":""main"",""path"":""/""}}'; $u='https://api.github.com/repos/gensublimeart/Drive-My-Home/pages'; $ok=$false; try { Invoke-RestMethod -Method Post -Headers $h -ContentType 'application/json' -Body $body -Uri $u | Out-Null; $ok=$true } catch {}; if (-not $ok) { try { Invoke-RestMethod -Method Put -Headers $h -ContentType 'application/json' -Body $body -Uri $u | Out-Null; $ok=$true } catch {} }; if (-not $ok) { exit 1 }"
set PAGES_ERR=%ERRORLEVEL%
call :cleanup

echo.
echo Site: https://gensublimeart.github.io/Drive-My-Home/
echo GitHub may take a minute to publish.
if not "%PAGES_ERR%"=="0" (
  echo.
  echo Pages was not turned on from here. Open:
  echo   https://github.com/gensublimeart/Drive-My-Home/settings/pages
  echo   Source: Deploy from a branch
  echo   Branch: main
  echo   Folder: / ^(root^)
)
pause
exit /b 0

:push_failed
call :cleanup
echo.
echo Push failed. Check the username and token.
echo Use a classic token with the repo scope:
echo https://github.com/settings/tokens/new
pause
exit /b 1

:missing_login
call :cleanup
echo Username and token are both required.
pause
exit /b 1

:missing_identity
echo Set your Git name and email first, then run this file again:
echo   git config --global user.name "Your Name"
echo   git config --global user.email "you@example.com"
pause
exit /b 1

:cleanup
set "GH_TOKEN="
set "GH_USER="
set "GIT_ASKPASS="
set "GIT_TERMINAL_PROMPT="
set "GCM_INTERACTIVE="
if defined ASKPASS if exist "%ASKPASS%" del /f /q "%ASKPASS%"
exit /b 0
