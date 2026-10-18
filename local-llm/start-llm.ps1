<#
.SYNOPSIS
    Start llama-server in router mode on http://127.0.0.1:8080, in the background.

.DESCRIPTION
    One model in VRAM at a time, unloaded after 5 minutes idle so the GPU is free
    for gaming. Binaries and models live outside the repo, under -Root.
    Uses the CUDA build: the winget Vulkan build generates ~15x slower on the 4070 Ti.

    Launched with Start-Process so the server outlives this script. Run inline, it
    died with whichever short-lived process had spawned the script (the MCP server).
    Stop it with: Stop-Process -Name llama-server
#>
param(
    [string]$Root = $(if ($env:LLM_ROOT) { $env:LLM_ROOT } else { 'Z:\Apps\LLM' })
)

if (Get-Process llama-server -ErrorAction SilentlyContinue) {
    Write-Host 'llama-server is already running.'
    return
}

$server = Join-Path $Root 'llama-cuda\llama-server.exe'
if (-not (Test-Path $server)) { throw "llama-server not found at $server - see README.md" }

Start-Process -FilePath $server -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $Root 'server.out.log') `
    -RedirectStandardError (Join-Path $Root 'server.log') `
    -ArgumentList @(
        '--models-preset', "`"$PSScriptRoot\models.ini`"",
        '--models-max', '1',
        '--sleep-idle-seconds', '300',
        '--host', '127.0.0.1',
        '--port', '8080'
    )

Write-Host 'llama-server started on http://127.0.0.1:8080 (log: server.log)'
