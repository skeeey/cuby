param(
  [string]$LockPath = "",
  [string]$AppExe = "",
  [string]$LanguagePath = ""
)

$ErrorActionPreference = 'Continue'

function Join-CubyChars([int[]]$Codes) {
  return -join ($Codes | ForEach-Object { [char]$_ })
}

function ConvertTo-PowerShellLiteral([string]$Value) {
  return "'" + $Value.Replace("'", "''") + "'"
}

function Get-CubyUpdatePromptMutexName {
  $mutexKey = if ($PromptMarkerPath) { $PromptMarkerPath } elseif ($LockPath) { $LockPath } else { 'default' }
  $bytes = [Text.Encoding]::UTF8.GetBytes($mutexKey.ToLowerInvariant())
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try {
    $digest = $hash.ComputeHash($bytes)
  } finally {
    $hash.Dispose()
  }
  return 'Local\CubyUpdatePrompt-' + ([Convert]::ToBase64String($digest).Replace('+', '-').Replace('/', '_').TrimEnd('='))
}

$PromptMutex = $null

function Enter-CubyUpdatePromptSingleton {
  try {
    $script:PromptMutex = [System.Threading.Mutex]::new($false, (Get-CubyUpdatePromptMutexName))
    return $script:PromptMutex.WaitOne(0)
  } catch {
    return $true
  }
}

function Exit-CubyUpdatePromptSingleton {
  if ($null -eq $script:PromptMutex) {
    return
  }

  try {
    $script:PromptMutex.ReleaseMutex() | Out-Null
  } catch {
  }

  $script:PromptMutex.Dispose()
  $script:PromptMutex = $null
}

function Resolve-CubyPromptLanguage {
  if ($LanguagePath -and (Test-Path -LiteralPath $LanguagePath)) {
    $savedLanguage = (Get-Content -LiteralPath $LanguagePath -Raw -ErrorAction SilentlyContinue).Trim()
    if ($savedLanguage -eq 'zh-CN' -or $savedLanguage -eq 'en-US') {
      return $savedLanguage
    }
  }

  if ((Get-Culture).Name -like 'zh*') {
    return 'zh-CN'
  }
  return 'en-US'
}

$PromptMarkerPath = if ($LockPath -and $LockPath.EndsWith('.lock')) {
  $LockPath.Substring(0, $LockPath.Length - 5) + '.prompt'
} else {
  ''
}

function Get-CubyAppProcessIds {
  if (-not $AppExe) {
    return @()
  }

  try {
    $targetPath = [System.IO.Path]::GetFullPath($AppExe)
  } catch {
    return @()
  }

  return @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
    try {
      $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -ieq $targetPath)
    } catch {
      $false
    }
  } | ForEach-Object { $_.Id })
}

$InitialAppProcessIds = @(Get-CubyAppProcessIds)

function Test-CubyAppOpenedAfterPrompt {
  $currentAppProcessIds = @(Get-CubyAppProcessIds)
  foreach ($id in $currentAppProcessIds) {
    if ($InitialAppProcessIds -notcontains $id) {
      return $true
    }
  }
  return $false
}

function Test-CubyUpdatePromptDone {
  $hasPromptMarker = $PromptMarkerPath -and (Test-Path -LiteralPath $PromptMarkerPath)
  if (-not $hasPromptMarker) {
    return $true
  }

  if (Test-CubyAppOpenedAfterPrompt) {
    return $true
  }

  $hasLock = $LockPath -and (Test-Path -LiteralPath $LockPath)
  $hasExe = (-not $AppExe) -or (Test-Path -LiteralPath $AppExe)
  return (-not $hasLock) -and $hasExe
}

$language = Resolve-CubyPromptLanguage
$promptTitle = if ($language -eq 'zh-CN') {
  'Cuby ' + (Join-CubyChars @(0x6B63,0x5728,0x66F4,0x65B0))
} else {
  'Cuby is updating'
}
$promptBody = if ($language -eq 'zh-CN') {
  'Cuby ' + (Join-CubyChars @(0x6B63,0x5728,0x66F4,0x65B0,0xFF0C,0x8BF7,0x7A0D,0x540E,0x518D,0x6253,0x5F00,0x3002))
} else {
  'Cuby is updating. Please open Cuby again in a moment.'
}

if (Test-CubyUpdatePromptDone) {
  exit 0
}

if (-not (Enter-CubyUpdatePromptSingleton)) {
  exit 0
}

$messageBoxCommand = @"
Add-Type -AssemblyName PresentationFramework
[System.Windows.MessageBox]::Show($(ConvertTo-PowerShellLiteral $promptBody), $(ConvertTo-PowerShellLiteral $promptTitle), [System.Windows.MessageBoxButton]::OK, [System.Windows.MessageBoxImage]::Information) | Out-Null
"@
$encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($messageBoxCommand))
$childPowerShell = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $childPowerShell)) {
  $childPowerShell = 'powershell.exe'
}

try {
  $promptProcess = Start-Process -FilePath $childPowerShell -ArgumentList @(
    '-STA',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    $encodedCommand
  ) -WindowStyle Hidden -PassThru

  while (-not $promptProcess.HasExited) {
    if (Test-CubyUpdatePromptDone) {
      Stop-Process -Id $promptProcess.Id -Force -ErrorAction SilentlyContinue
      break
    }
    Start-Sleep -Milliseconds 500
    $promptProcess.Refresh()
  }
} catch {
  exit 1
} finally {
  Exit-CubyUpdatePromptSingleton
}
