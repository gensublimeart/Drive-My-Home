@echo off
setlocal
net session >nul 2>&1
if errorlevel 1 (
  echo Asking for administrator permission...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "TASK=DriveMyHome"
set "PORT=8080"
set "DEST=C:\DriveMyHome"

if exist "%DEST%\kiosk-edge.ps1" (
  echo Turning off Kiosk mode...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\kiosk-edge.ps1" -Remove
)

schtasks /End /TN %TASK% >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'cmd.exe','node.exe' } | Where-Object { $_.CommandLine -like '*DriveMyHome\kiosk-server.bat*' -or $_.CommandLine -like '*DriveMyHome\server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
schtasks /Delete /TN %TASK% /F >nul 2>&1
netsh advfirewall firewall delete rule name="Drive My Home %PORT%" >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /f >nul 2>&1
set "EDGE=HKLM\SOFTWARE\Policies\Microsoft\Edge"
for %%v in (VisualSearchEnabled DefaultSearchProviderContextMenuAccessAllowed HubsSidebarEnabled SearchInSidebarEnabled QuickSearchShowMiniMenu DefaultNotificationsSetting TranslateEnabled HideFirstRunExperience StartupBoostEnabled BackgroundModeEnabled WebWidgetAllowed) do reg delete "%EDGE%" /v %%v /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Dsh" /v AllowNewsAndInterests /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v AllowEdgeSwipe /f >nul 2>&1

echo The server no longer starts with Windows.
echo The website files are still in %DEST%.
echo Restart the PC to finish leaving Kiosk mode.
echo If a kiosk is still listed in Settings ^> Accounts ^> Other users, remove it there.
pause
