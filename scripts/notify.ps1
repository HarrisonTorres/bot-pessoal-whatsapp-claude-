param([string]$Title = 'wa-claude', [string]$Message = '')

$logDir = Join-Path $PSScriptRoot '..\data\logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
Add-Content -Path (Join-Path $logDir 'ALERTA.txt') -Value "$(Get-Date -Format s) $Title - $Message"

try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
  $t = [System.Security.SecurityElement]::Escape($Title)
  $m = [System.Security.SecurityElement]::Escape($Message)
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>$t</text><text>$m</text></binding></visual></toast>")
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
} catch {
  # o registro em ALERTA.txt acima já garante que o aviso não se perde
}
