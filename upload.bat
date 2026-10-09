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

git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed.
  echo If the browser sign-in did not open, create a classic token at
  echo https://github.com/settings/tokens/new with the repo scope, then run this again.
  echo When Git asks for a password, paste the token. Do not put the token in this file.
  pause
  exit /b 1
)

where gh >nul 2>&1
if errorlevel 1 goto pages_manual
gh auth status >nul 2>&1
if errorlevel 1 goto pages_manual

gh api --method POST -H "Accept: application/vnd.github+json" /repos/gensublimeart/Drive-My-Home/pages -f "source[branch]=main" -f "source[path]=/" >nul 2>&1
if errorlevel 1 (
  gh api --method PUT -H "Accept: application/vnd.github+json" /repos/gensublimeart/Drive-My-Home/pages -f "source[branch]=main" -f "source[path]=/" >nul 2>&1
)

echo.
echo Site: https://gensublimeart.github.io/Drive-My-Home/
echo GitHub may take a minute to publish.
pause
exit /b 0

:missing_identity
echo Set your Git name and email first, then run this file again:
echo   git config --global user.name "Your Name"
echo   git config --global user.email "you@example.com"
pause
exit /b 1

:pages_manual
echo.
echo Code is on GitHub. Turn on Pages once:
echo   https://github.com/gensublimeart/Drive-My-Home/settings/pages
echo   Source: Deploy from a branch
echo   Branch: main
echo   Folder: / (root)
echo.
echo Then open: https://gensublimeart.github.io/Drive-My-Home/
pause
exit /b 0
