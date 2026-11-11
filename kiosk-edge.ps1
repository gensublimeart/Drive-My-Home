# Sets up (or removes) the Edge kiosk with Windows Assigned Access.
# The Settings kiosk wizard cannot pass extra Edge arguments, so the same single-app kiosk
# is written as an Assigned Access XML, adding --force-device-scale-factor to scale the site.
# Run from an elevated prompt; the MDM bridge only accepts SYSTEM, so this script re-runs
# itself as SYSTEM through a temporary scheduled task.
param(
  [string]$Url = "http://localhost:8080",
  [string]$Scale = "1.5",
  [switch]$Remove,
  [switch]$AsSystem
)

$ErrorActionPreference = "Stop"
$log = Join-Path $PSScriptRoot "kiosk-edge.log"

if (-not $AsSystem) {
  $task = "DriveMyHome Kiosk Setup"
  $argList = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -AsSystem -Url `"$Url`" -Scale $Scale"
  if ($Remove) { $argList += " -Remove" }
  Remove-Item $log -ErrorAction SilentlyContinue
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argList
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $task -Action $action -Principal $principal -Force | Out-Null
  try {
    Start-ScheduledTask -TaskName $task
    for ($i = 0; $i -lt 60 -and -not ((Test-Path $log) -and (Get-Item $log).Length -gt 0); $i++) { Start-Sleep 1 }
  } finally {
    Unregister-ScheduledTask -TaskName $task -Confirm:$false
  }
  if (-not ((Test-Path $log) -and (Get-Item $log).Length -gt 0)) {
    Write-Host "No answer from the SYSTEM task after 60 seconds."
    exit 1
  }
  $result = Get-Content $log -Raw
  Write-Host $result.Trim()
  if ($result -like "OK*") { exit 0 } else { exit 1 }
}

try {
  if (-not $Remove) {
    if ([Environment]::OSVersion.Version.Build -lt 22000) { throw "Windows 11 is required for an Edge kiosk with custom arguments." }
    $edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"
    if (-not (Test-Path $edge)) { throw "Microsoft Edge was not found at $edge" }
  }

  $obj = Get-CimInstance -Namespace "root\cimv2\mdm\dmmap" -ClassName "MDM_AssignedAccess"
  if ($Remove) {
    $obj.Configuration = $null
  } else {
    $edgeArgs = "--kiosk $Url --edge-kiosk-type=fullscreen --no-first-run --force-device-scale-factor=$Scale"
    $xml = @"
<?xml version="1.0" encoding="utf-8"?>
<AssignedAccessConfiguration xmlns="http://schemas.microsoft.com/AssignedAccess/2017/config" xmlns:rs5="http://schemas.microsoft.com/AssignedAccess/201810/config" xmlns:v4="http://schemas.microsoft.com/AssignedAccess/2021/config">
  <Profiles>
    <Profile Id="{6F1D7C1E-3B8A-4C55-9E7D-2A4B8C0D9E11}">
      <KioskModeApp v4:ClassicAppPath="%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" v4:ClassicAppArguments="$edgeArgs" />
    </Profile>
  </Profiles>
  <Configs>
    <Config>
      <AutoLogonAccount rs5:DisplayName="Drive My Home" />
      <DefaultProfile Id="{6F1D7C1E-3B8A-4C55-9E7D-2A4B8C0D9E11}" />
    </Config>
  </Configs>
</AssignedAccessConfiguration>
"@
    $obj.Configuration = [System.Net.WebUtility]::HtmlEncode($xml)
  }
  Set-CimInstance -CimInstance $obj
  if ($Remove) { Set-Content $log "OK: kiosk removed." } else { Set-Content $log "OK: Edge kiosk set to $Url at ${Scale}x." }
} catch {
  Set-Content $log "ERROR: $($_.Exception.Message)"
}
