<#
.SYNOPSIS
    Smoke-test a model preset against one note and print its speed.
.EXAMPLE
    .\test-model.ps1 -Model qwen3.6-35b-a3b
#>
param(
    [string]$Model = 'gemma-4-12b',
    [string]$Note = "Z:\Apps\Obsidian\obsdn-brain\05 - KNOWLEDGE\Rename PC bluetooth adapter's name.md"
)

for ($i = 0; $i -lt 30; $i++) { try { Invoke-RestMethod http://127.0.0.1:8080/health -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 } }

$text = Get-Content $Note -Raw -Encoding UTF8
$body = @{
    model       = $Model
    temperature = 0.2
    messages    = @(
        @{ role = 'system'; content = 'You maintain an Obsidian vault. Reply only with what is asked.' },
        @{ role = 'user'; content = "Give: (1) a one-sentence summary, (2) 3-5 lowercase tags, (3) any formatting problems in this note.`n`n$text" }
    )
} | ConvertTo-Json -Depth 5

$t = Measure-Command {
    $r = Invoke-RestMethod http://127.0.0.1:8080/v1/chat/completions -Method Post `
        -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 600
}
$r.choices[0].message.content
'---'
'wall: {0:N1}s (includes model load)' -f $t.TotalSeconds
'prompt {0:N0} tok/s | gen {1:N1} tok/s | {2} tokens' -f $r.timings.prompt_per_second, $r.timings.predicted_per_second, $r.timings.predicted_n
