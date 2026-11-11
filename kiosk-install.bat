@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "SRC=%~dp0"
set "SRC=%SRC:~0,-1%"
set "DEST=C:\DriveMyHome"
set "TASK=DriveMyHome"
set "PORT=8080"
set "URL=http://localhost:%PORT%"
rem Kiosk screen scale; Edge applies it with --force-device-scale-factor.
set "SCALE=1.5"

echo ============================================
echo   Drive My Home - Exhibition Kiosk Setup
echo ============================================
echo.

if not exist "%SRC%\server.js" (
  echo Cannot read the website folder from administrator mode.
  echo Copy this folder onto this PC or a USB stick, not a network drive, and run this file again.
  pause
  exit /b 1
)

if not exist "%ProgramFiles%\nodejs\node.exe" (
  where node >nul 2>&1
  if errorlevel 1 (
    echo Node.js is required. Install the LTS version from https://nodejs.org/ then run this file again.
    pause
    exit /b 1
  )
)

echo [1/8] Stopping the old server, if any...
schtasks /End /TN %TASK% >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'cmd.exe','node.exe' } | Where-Object { $_.CommandLine -like '*DriveMyHome\kiosk-server.bat*' -or $_.CommandLine -like '*DriveMyHome\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo [2/8] Copying the website to %DEST%...
if /i "%SRC%"=="%DEST%" goto copied
robocopy "%SRC%" "%DEST%" /MIR /XD .git _build __pycache__ skill /XF server.log *.pyc /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Copy failed.
  pause
  exit /b 1
)
:copied

echo [3/8] Starting the server with Windows...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c %DEST%\kiosk-server.bat' -WorkingDirectory '%DEST%'; $t = New-ScheduledTaskTrigger -AtStartup; $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero); $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; Register-ScheduledTask -TaskName '%TASK%' -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null"
if errorlevel 1 (
  echo Could not create the startup task.
  pause
  exit /b 1
)

echo [4/8] Allowing phones on the same Wi-Fi to open the site...
netsh advfirewall firewall delete rule name="Drive My Home %PORT%" >nul 2>&1
netsh advfirewall firewall add rule name="Drive My Home %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul

echo [5/8] Keeping the PC awake and blocking update restarts while signed in...
powercfg /change standby-timeout-ac 0
powercfg /change monitor-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /hibernate off
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f >nul

echo       Turning off Edge image search, sidebar and Copilot...
set "EDGE=HKLM\SOFTWARE\Policies\Microsoft\Edge"
reg add "%EDGE%" /v VisualSearchEnabled /t REG_DWORD /d 0 /f >nul
reg add "%EDGE%" /v DefaultSearchProviderContextMenuAccessAllowed /t REG_DWORD /d 0 /f >nul
reg add "%EDGE%" /v HubsSidebarEnabled /t REG_DWORD /d 0 /f >nul
reg add "%EDGE%" /v SearchInSidebarEnabled /t REG_DWORD /d 2 /f >nul
reg add "%EDGE%" /v QuickSearchShowMiniMenu /t REG_DWORD /d 0 /f >nul

echo       Turning off Edge pop-ups for visitors (notifications, translate, first-run)...
reg add "%EDGE%" /v DefaultNotificationsSetting /t REG_DWORD /d 2 /f >nul
reg add "%EDGE%" /v TranslateEnabled /t REG_DWORD /d 0 /f >nul
reg add "%EDGE%" /v HideFirstRunExperience /t REG_DWORD /d 1 /f >nul

echo       Turning off Edge Startup Boost and background mode (they make Edge ignore kiosk arguments)...
reg add "%EDGE%" /v StartupBoostEnabled /t REG_DWORD /d 0 /f >nul
reg add "%EDGE%" /v BackgroundModeEnabled /t REG_DWORD /d 0 /f >nul

echo       Turning off widgets and screen-edge swipes (Widgets board, Edge search bar widget)...
reg add "%EDGE%" /v WebWidgetAllowed /t REG_DWORD /d 0 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v AllowEdgeSwipe /t REG_DWORD /d 0 /f >nul

echo [6/8] Scheduling shutdown: Mon-Thu 17:45, Fri-Sun 20:15...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference = 'Stop'; $a = New-ScheduledTaskAction -Execute 'shutdown.exe' -Argument '/s /f /t 60 /c \"Drive My Home closing. Run shutdown /a to cancel.\"'; $t = @((New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday -At 17:45), (New-ScheduledTaskTrigger -Weekly -DaysOfWeek Friday,Saturday,Sunday -At 20:15)); $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; $p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest; Register-ScheduledTask -TaskName '%TASK% Shutdown' -Action $a -Trigger $t -Settings $s -Principal $p -Force | Out-Null"
if errorlevel 1 (
  echo Could not create the shutdown task.
  pause
  exit /b 1
)

echo [7/8] Starting the server...
schtasks /Run /TN %TASK% >nul
powershell -NoProfile -Command "for ($i = 0; $i -lt 20; $i++) { try { Invoke-WebRequest '%URL%' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep 1 } }; exit 1"
if errorlevel 1 (
  echo The server did not answer. Check %DEST%\server.log
  pause
  exit /b 1
)
echo       Server is running: %URL%

echo [8/8] Turning on Kiosk mode (Edge full screen at %SCALE%x)...
set "EDITION="
for /f "tokens=3" %%e in ('reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v EditionID 2^>nul') do set "EDITION=%%e"
echo %EDITION% | findstr /b /i "Core" >nul
if not errorlevel 1 (
  echo.
  echo ERROR: This PC runs Windows Home, which has no Kiosk mode.
  echo Upgrade to Windows Pro, then run this file again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\kiosk-edge.ps1" -Url "%URL%" -Scale %SCALE%
if errorlevel 1 (
  echo Could not turn on Kiosk mode.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   Done - restart the PC
echo ============================================
echo   After the restart, Windows signs in as "Drive My Home" by itself
echo   and opens %URL% full screen in Edge.
echo.
echo   If you set up the kiosk before with Settings ^> Kiosk, delete the old
echo   DriveMyHome account in Settings ^> Accounts ^> Other users.
echo   To change the scale, edit SCALE at the top of this file and run it again.
echo   To leave Kiosk mode later: Ctrl+Alt+Del, then Sign out.
echo   In the BIOS, also:
echo     - Turn on "Restore on AC power loss"
echo     - Turn on "Power On By RTC" / "Wake on Alarm": every day at 10:15
echo     - Turn off "ErP" / "Deep Sleep", or the wake alarm will not fire
echo.
pause
