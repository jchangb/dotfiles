<#
.SYNOPSIS
    Point every Claude Code config directory on this machine at statusline.js.

.DESCRIPTION
    Claude Code reads whichever directory CLAUDE_CONFIG_DIR names, falling back to
    ~/.claude. A machine running separate work and personal profiles therefore has
    several config directories, and a status line installed into only one of them
    never appears in the others — silently, with no error anywhere. This script
    patches all of them.

    settings.json is merged, not replaced: every existing key is preserved and only
    statusLine is written. The previous file is kept alongside as settings.json.bak.

.PARAMETER Narrow
    Spend a third line so no row exceeds ~50 columns. Worth it in a vertical split;
    Claude Code truncates rather than wraps, so a wide row loses its right-hand end.

.PARAMETER RefreshInterval
    Seconds between forced re-runs. Without this the status line only re-renders on
    conversation events, so the reset countdowns sit frozen while the session idles.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1 -Narrow
#>
[CmdletBinding()]
param(
    [switch]$Narrow,
    [ValidateRange(1, 3600)]
    [int]$RefreshInterval = 30
)

$ErrorActionPreference = 'Stop'

$script = Join-Path $PSScriptRoot 'statusline.js'
if (-not (Test-Path $script)) {
    throw "statusline.js not found next to install.ps1 (looked in $PSScriptRoot)"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Warning 'node is not on PATH. The status line stays blank until it is.'
}

# Forward slashes survive JSON without escaping and Windows accepts them fine.
$command = 'node "{0}"' -f ($script -replace '\\', '/')
if ($Narrow) { $command = $command + ' --narrow' }

$statusLine = [pscustomobject]@{
    type            = 'command'
    command         = $command
    refreshInterval = $RefreshInterval
}

$dirs = Get-ChildItem -Path $HOME -Directory -Force |
        Where-Object { $_.Name -eq '.claude' -or $_.Name -like '.claude-*' }

if (-not $dirs) {
    throw "No Claude config directory found under $HOME"
}

Write-Host ''
Write-Host 'Installing status line:' -ForegroundColor Cyan
Write-Host "  $command"
Write-Host ''

foreach ($dir in $dirs) {
    $path = Join-Path $dir.FullName 'settings.json'

    if (Test-Path $path) {
        Copy-Item -Path $path -Destination "$path.bak" -Force
        $settings = Get-Content -Path $path -Raw | ConvertFrom-Json
    }
    else {
        $settings = [pscustomobject]@{}
    }

    $settings | Add-Member -NotePropertyName 'statusLine' -NotePropertyValue $statusLine -Force
    $json = $settings | ConvertTo-Json -Depth 20

    # Set-Content -Encoding utf8 writes a BOM on PowerShell 5.1, and a BOM makes
    # JSON.parse throw — which is exactly how a settings file gets silently ignored.
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))

    Write-Host ('  {0,-20} {1}' -f $dir.Name, $path) -ForegroundColor Green
}

Write-Host ''
Write-Host 'Start a new session to pick it up.' -ForegroundColor Cyan
Write-Host ''
