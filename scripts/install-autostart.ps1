param([switch]$Remove)

$taskName = 'wa-claude-bridge'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Tarefa '$taskName' removida."
  return
}

$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$cmd = "Set-Location '$root'; & '$node' --disable-warning=ExperimentalWarning bridge/src/index.js"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -Command `"$cmd`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Ponte WhatsApp para o Claude Code (wa-claude)' -Force | Out-Null
Write-Host "Tarefa '$taskName' registrada. Inicie agora com: Start-ScheduledTask -TaskName $taskName"
