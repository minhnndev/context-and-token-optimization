#!/usr/bin/env pwsh
# Seed the lab: labels + 3 open sized issues on the Incident Console.
# Windows port of seed-issues.sh — keep the two in sync.
# Run once, from the repo root of YOUR template copy:  pwsh scripts/seed-issues.ps1
$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')
$repo = gh repo view --json nameWithOwner --jq .nameWithOwner
if ($LASTEXITCODE -ne 0) { throw 'gh repo view failed — run this from your repo clone, signed in with gh auth login.' }
Write-Host "Seeding workshop issues in $repo"
Write-Host ''

Write-Host '── Labels'
gh label create 'ai-sized'              --color '8250df' --description 'Task sized in AI credits before work started' --force
gh label create 'size:XS'               --color 'c8e1ff' --description 'Estimated ≤10 AI credits' --force
gh label create 'size:S'                --color '79b8ff' --description 'Estimated 11–30 AI credits' --force
gh label create 'size:M'                --color '2188ff' --description 'Estimated 31–75 AI credits' --force
gh label create 'size:L'                --color '0757ba' --description 'Estimated 76–150 AI credits' --force
gh label create 'size:XL'               --color '032f62' --description 'Estimated >150 AI credits — consider splitting' --force
gh label create 'calibration:on-target' --color '2da44e' --description 'Actual AI spend landed inside the estimated bucket' --force
gh label create 'calibration:over'      --color 'd1242f' --description 'Actual AI spend exceeded the estimated bucket' --force
gh label create 'calibration:under'     --color '0969da' --description 'Actual AI spend came in below the estimated bucket' --force

# Issue bodies mimic exactly what the ai-sized-task issue form renders, so
# the scripts parse seeded and form-created issues identically.
function New-SeedIssue { # title, size-label, body -> returns issue number
  param([string]$Title, [string]$Size, [string]$Body)
  $out = gh issue create --title $Title --label 'ai-sized' --label $Size --body $Body
  if ($LASTEXITCODE -ne 0) { throw "gh issue create failed for: $Title" }
  return (($out | Select-Object -Last 1) -split '/')[-1]
}

Write-Host ''
Write-Host '── Open sized issues (your lab tasks, all on the Incident Console)'

$xsBody = @'
### Task description

The CPU gauge shows 🔴 and the log spams ALERT even at ~30% load — critical should only fire above 80%. Verify (deterministic): `node console/src/dash.mjs --once` renders tick 30 at seed 42 with CPU 31% — the dot must be green after your fix (red before), and `node --test console/test/*.test.mjs` stays green.

### AI credit size

XS — up to 10 credits

### Planned model

auto (10% discount)

### Sizing rationale

Small app, obvious symptom, one-line class of fix, one verify cycle.
'@

$sBody = @'
### Task description

Add a latency panel to the dashboard: the metrics generator already emits `latMs`, but nothing displays it. Show a `LAT` sparkline line directly under `REQ/S` with the current value and the p99 of the recent window, give latency warn/crit thresholds with a status dot, and log latency alerts only on p99 status *transitions* — never per tick.

Acceptance tests are pre-written and they are the spec — do not edit them. Make `node --test console/test/pending/latency.test.mjs` pass, then move that file into `console/test/` so it runs with the suite and `node --test console/test/*.test.mjs` stays green. The tests pin the exact percentile math, line format, threshold values, and alert messages — run them early and often.

### AI credit size

S — 11–30 credits

### Planned model

auto (10% discount)

### Sizing rationale

Data already exists and the acceptance tests are pre-written for us; render + wiring + two small helpers.
'@

$mBody = @'
### Task description

Add an alert-rule engine: a rule fires ONE alert when a metric stays over its threshold for N consecutive ticks (no per-tick spam), and clears when it recovers. Make rules data-driven, wire them into the dashboard log panel, and cover the engine with `node:test`.

### AI credit size

M — 31–75 credits

### Planned model

claude-sonnet-4.5

### Sizing rationale

New module + integration + tests; genuine design decisions and iteration.
'@

$n1 = New-SeedIssue 'CPU gauge stuck on red — crit threshold fires at normal load' 'size:XS' $xsBody
Write-Host "  #$n1 (XS)  CPU gauge stuck on red"
$n2 = New-SeedIssue 'Add latency panel with p99 sparkline' 'size:S' $sBody
Write-Host "  #$n2 (S)   Add latency panel with p99 sparkline"
$n3 = New-SeedIssue 'Add alert-rule engine (sustained-threshold alerts)' 'size:M' $mBody
Write-Host "  #$n3 (M)   Add alert-rule engine"

Write-Host ''
Write-Host 'Done.'
