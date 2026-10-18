<#
.SYNOPSIS
    Register the local-llm MCP server and link the local-llm skill into every
    Claude Code config directory on this machine.

.DESCRIPTION
    Same reasoning as claude/install.ps1: a machine running work and personal
    profiles has several config directories, and anything installed into only one
    silently never appears in the others.

    Plain ~/.claude keeps its MCP config in ~/.claude.json, outside the directory,
    so for that one CLAUDE_CONFIG_DIR must stay unset rather than point at it.

    The skill is linked with a junction, which needs no admin rights, so edits in
    the repo show up immediately.

    Does not download llama.cpp or models - see README.md.

.PARAMETER Vault
    Folder that vault-relative paths in local_llm_files resolve against.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1
#>
[CmdletBinding()]
param(
    [string]$Vault = 'Z:\Apps\Obsidian\obsdn-brain'
)

$ErrorActionPreference = 'Stop'

$server = (Join-Path $PSScriptRoot 'mcp\local-llm.mjs') -replace '\\', '/'
$skill = Join-Path (Split-Path $PSScriptRoot -Parent) 'skills\local-llm'

foreach ($tool in 'node', 'claude') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH" }
}

$dirs = Get-ChildItem -Path $HOME -Directory -Force |
        Where-Object { $_.Name -eq '.claude' -or $_.Name -like '.claude-*' }
if (-not $dirs) { throw "No Claude config directory found under $HOME" }

$previous = $env:CLAUDE_CONFIG_DIR
Write-Host ''
Write-Host 'Installing local-llm:' -ForegroundColor Cyan

try {
    foreach ($dir in $dirs) {
        if ($dir.Name -eq '.claude') { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
        else { $env:CLAUDE_CONFIG_DIR = $dir.FullName }

        # Through cmd: PowerShell 5.1 turns the "not found" stderr into a terminating error under Stop.
        cmd /c 'claude mcp remove local-llm --scope user >nul 2>&1'
        claude mcp add local-llm --scope user -e "VAULT_DIR=$Vault" -- node $server | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "claude mcp add failed for $($dir.Name)" }

        $skills = Join-Path $dir.FullName 'skills'
        $link = Join-Path $skills 'local-llm'
        New-Item -ItemType Directory -Force $skills | Out-Null
        if (Test-Path $link) { (Get-Item $link -Force).Delete() }
        New-Item -ItemType Junction -Path $link -Target $skill | Out-Null

        Write-Host ('  {0,-20} mcp + skill' -f $dir.Name) -ForegroundColor Green
    }
}
finally {
    if ($previous) { $env:CLAUDE_CONFIG_DIR = $previous } else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host 'Start a new session to pick it up.' -ForegroundColor Cyan
Write-Host ''
