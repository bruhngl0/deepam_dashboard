<#
  Sends new punches from the Matrix COSEC attendance database to the Deepam CRM (HR Intelligence -> Attendance).

  Runs on the office PC that can reach the COSEC SQL Server (ADMIN-PC\MATRIXDB), every few minutes from Task Scheduler.
  Reads Mx_ATDEventTrn (UserID, Edatetime, IOTYPE 0 = IN / 1 = OUT, Idatetime = when the machine's punches were
  downloaded) for rows downloaded since the last run, and posts them to each CRM in config.json. Sending a punch twice
  is harmless: the CRM ignores repeats. Remembers how far it got per CRM in state.json; writes sync.log.

  Setup and settings: README.md next to this file. Needs only Windows PowerShell 5.1 (built in).
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here 'config.json'
$statePath = Join-Path $here 'state.json'
$logPath = Join-Path $here 'sync.log'
$batchSize = 2000

function Log($message) {
  $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -Path $logPath -Value $line
  Write-Output $line
  # Keep the log small: the last 2,000 lines.
  if ((Get-Item $logPath).Length -gt 512KB) { (Get-Content $logPath -Tail 2000) | Set-Content $logPath }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  if (-not (Test-Path $configPath)) { throw "config.json not found next to the script (copy config.example.json and fill it in)" }
  $config = Get-Content $configPath -Raw | ConvertFrom-Json
  $state = @{}
  if (Test-Path $statePath) { (Get-Content $statePath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $state[$_.Name] = $_.Value } }

  $connection = New-Object System.Data.SqlClient.SqlConnection $config.sqlConnectionString
  $connection.Open()
  try {
    foreach ($target in $config.targets) {
      $since = if ($state[$target.name]) { $state[$target.name] } else { $config.startFrom }
      $command = $connection.CreateCommand()
      # Rows downloaded at or after the last mark: the same punch may come again, which the CRM ignores.
      $command.CommandText = @"
SELECT LTRIM(RTRIM(CAST(UserID AS nvarchar(40)))) AS UserID,
       CONVERT(varchar(19), Edatetime, 120) AS EventTime,
       CAST(IOTYPE AS int) AS IoType,
       CONVERT(varchar(19), ISNULL(Idatetime, Edatetime), 120) AS DownloadTime
FROM Mx_ATDEventTrn
WHERE ISNULL(Idatetime, Edatetime) >= @since AND Edatetime IS NOT NULL AND UserID IS NOT NULL AND IOTYPE IN (0, 1)
ORDER BY ISNULL(Idatetime, Edatetime), Edatetime
"@
      $command.CommandTimeout = 120
      [void]$command.Parameters.Add('@since', [System.Data.SqlDbType]::DateTime)
      $command.Parameters['@since'].Value = [datetime]::ParseExact($since, 'yyyy-MM-dd HH:mm:ss', $null)
      $reader = $command.ExecuteReader()
      $rows = New-Object System.Collections.Generic.List[object]
      while ($reader.Read()) {
        $rows.Add([ordered]@{ userId = [string]$reader['UserID']; at = [string]$reader['EventTime']; io = [int]$reader['IoType']; downloadedAt = [string]$reader['DownloadTime'] })
      }
      $reader.Close()

      if ($rows.Count -eq 0) { Log "$($target.name): nothing new since $since"; continue }
      $inserted = 0; $unmatched = @{}
      for ($i = 0; $i -lt $rows.Count; $i += $batchSize) {
        $chunk = $rows.GetRange($i, [Math]::Min($batchSize, $rows.Count - $i))
        $body = @{ device = $config.deviceName; punches = $chunk.ToArray() } | ConvertTo-Json -Depth 4 -Compress
        $result = Invoke-RestMethod -Method Post -Uri $target.url -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' `
          -Headers @{ Authorization = "Bearer $($target.token)" } -TimeoutSec 120
        $inserted += [int]$result.inserted
        foreach ($id in $result.unmatchedIds) { $unmatched[$id] = $true }
        # Move the mark only after the CRM has stored the batch, so a failure resends it next time.
        $state[$target.name] = $chunk[$chunk.Count - 1].downloadedAt
        $state | ConvertTo-Json | Set-Content $statePath
      }
      $note = if ($unmatched.Count) { "; machine IDs with no employee: " + (($unmatched.Keys | Sort-Object) -join ', ') } else { '' }
      Log "$($target.name): sent $($rows.Count) punches, $inserted new$note"
    }
  } finally { $connection.Close() }
} catch {
  Log "ERROR: $($_.Exception.Message)"
  exit 1
}
