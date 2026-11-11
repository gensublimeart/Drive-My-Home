@echo off
setlocal
set "NODE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE%" set "NODE=node"
set "LOG=%~dp0server.log"

:loop
echo [%date% %time%] Starting server>> "%LOG%"
"%NODE%" "%~dp0server.js" >> "%LOG%" 2>&1
echo [%date% %time%] Server stopped, restarting in 5 seconds>> "%LOG%"
rem timeout.exe exits immediately when there is no console, as under Task Scheduler
ping -n 6 127.0.0.1 >nul
goto loop
