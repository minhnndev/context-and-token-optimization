#!/usr/bin/env pwsh
# Seed Lab 4: a recorded history to estimate from — 12 closed sized issues with
# actuals already recorded, plus one new unsized task for the estimator to size.
# Windows port of seed-history.sh — keep the two in sync.
#
#   pwsh scripts/seed-history.ps1           # seed for real
#   pwsh scripts/seed-history.ps1 -DryRun   # print what would be created
#   powershell -ExecutionPolicy Bypass -File scripts\seed-history.ps1   # Windows PowerShell 5.1
#
# Separate from seed-issues.ps1 on purpose: Lab 1 browses the Issues tab, and a
# dozen extra closed issues there would bury the three tasks it uses.
#
# The actuals below are illustrative examples, not measurements — every one is
# recorded with a "seeded example" note. Your own recordings are the real data;
# these exist so the estimator has something to reason from on day one.
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

Set-Location (Join-Path $PSScriptRoot '..')

if (-not $DryRun) {
  $repo = gh repo view --json nameWithOwner --jq .nameWithOwner
  if ($LASTEXITCODE -ne 0) { throw 'gh repo view failed — run this from your repo clone, signed in with gh auth login.' }
  Write-Host "Seeding recorded history in $repo"
} else {
  Write-Host 'DRY RUN — no issues will be created'
}
Write-Host ''

if (-not $DryRun) {
  Write-Host '── Labels'
  gh label create 'ai-sized' --color '8250df' --description 'Task sized in AI credits before work started' --force | Out-Null
  gh label create 'size:XS' --color 'c8e1ff' --description 'Estimated ≤10 AI credits' --force | Out-Null
  gh label create 'size:S'  --color '79b8ff' --description 'Estimated 11–30 AI credits' --force | Out-Null
  gh label create 'size:M'  --color '2188ff' --description 'Estimated 31–75 AI credits' --force | Out-Null
  gh label create 'size:L'  --color '0757ba' --description 'Estimated 76–150 AI credits' --force | Out-Null
  Write-Host ''
}

function New-Body { # description, size line, model, rationale
  param([string]$Description, [string]$SizeLine, [string]$Model, [string]$Why)
  return "### Task description`n`n$Description`n`n### AI credit size`n`n$SizeLine`n`n### Planned model`n`n$Model`n`n### Sizing rationale`n`n$Why"
}

function Add-SeededIssue {
  param(
    [string]$Title, [string]$Size, [string]$SizeLine, [string]$Model,
    [string]$Description, [string]$Why, [string]$Credits,
    [string]$Created, [string]$Edited, [string]$Note
  )
  if ($DryRun) {
    Write-Host ('  {0,-6} {1,-8} {2}' -f $Size, "${Credits}cr", $Title)
    Write-Host "    + gh issue create --label ai-sized --label $Size"
    Write-Host "    + record-usage --credits $Credits --created '$Created' --edited '$Edited'"
    Write-Host '    + gh issue close'
    return
  }
  $out = gh issue create --title $Title --label 'ai-sized' --label $Size --body (New-Body $Description $SizeLine $Model $Why)
  if ($LASTEXITCODE -ne 0) { throw "gh issue create failed for: $Title" }
  $n = (($out | Select-Object -Last 1) -split '/')[-1]

  $recordArgs = @('scripts/record-usage.mjs', '--issue', $n, '--credits', $Credits, '--model', $Model)
  if ($Created) { $recordArgs += @('--created', $Created) }
  if ($Edited) { $recordArgs += @('--edited', $Edited) }
  $recordArgs += @('--notes', $Note)
  node @recordArgs | Out-Null

  gh issue close $n 2>&1 | Out-Null
  Write-Host ('  #{0,-4} {1,-6} {2,-8} {3}' -f $n, $Size, "${Credits}cr", $Title)
}

$xsLine = 'XS — up to 10 credits'
$sLine = 'S — 11–30 credits'
$mLine = 'M — 31–75 credits'
$lLine = 'L — 76–150 credits'
$note = 'seeded example — illustrative, not a measurement'

Write-Host '── Closed tasks with recorded actuals'

Add-SeededIssue 'Right-align the gauge percentage column' 'size:XS' $xsLine 'auto' `
  'CPU and MEM percentages jump around as the digit count changes. Pad them to a fixed width in `renderGauge`.' `
  'One named render function, cosmetic, one verify cycle.' `
  '4.2' '' 'console/src/gauges.mjs' $note

Add-SeededIssue 'Dim the timestamp column in the log panel' 'size:XS' $xsLine 'auto' `
  'The `t+NNN` stamps compete with the message text. Paint them dim like the rest of the chrome.' `
  'One line in one named file.' `
  '3.1' '' 'console/src/logpanel.mjs' $note

Add-SeededIssue 'Truncate long service names in the services table' 'size:XS' $xsLine 'auto' `
  'A long service name pushes the LAT/RPS/ERR columns out of alignment. Clip the name to the column width.' `
  'Named file, obvious symptom, but the column maths needs one look.' `
  '8.7' '' 'console/src/svcpanel.mjs' $note

Add-SeededIssue 'Sparkline divide-by-zero on flat data' 'size:S' $sLine 'claude-sonnet-4.5' `
  'When every value in the window is equal the sparkline scale divides by zero and renders blanks. Fix the scaling and cover it with a test.' `
  'Small fix, but reproducing an edge case takes an extra cycle or two.' `
  '22.4' '' 'console/src/sparkline.mjs,console/test/sparkline.test.mjs' $note

Add-SeededIssue 'Add a --no-color flag for CI logs' 'size:S' $sLine 'auto' `
  'ANSI codes make piped output unreadable. Add `--no-color` and make `paint` a no-op when it is set.' `
  'Two files, one flag, but every call site goes through paint.' `
  '18.9' '' 'console/src/ansi.mjs,console/src/dash.mjs' $note

Add-SeededIssue 'Make the services table easier to scan' 'size:S' $sLine 'claude-sonnet-4.5' `
  'The services table is hard to read at a glance. Improve it.' `
  'Feels like a small presentation change.' `
  '41.5' '' 'console/src/svcpanel.mjs,console/src/services.mjs,console/src/dash.mjs' `
  "seeded example — vague spec: three redesign rounds before agreeing what 'easier to scan' meant"

Add-SeededIssue 'Add a p95 column to the services table' 'size:M' $mLine 'claude-sonnet-4.5' `
  'Track a rolling per-service latency window and show p95 next to the current LAT value.' `
  'New helper module, per-service state, table changes, tests.' `
  '38.2' 'console/src/svcstats.mjs,console/test/svcstats.test.mjs' 'console/src/svcpanel.mjs,console/src/services.mjs' $note

Add-SeededIssue 'Write the log panel to a rotating file' 'size:M' $mLine 'claude-sonnet-4.5' `
  'Persist log lines to disk with size-based rotation, keeping the on-screen panel unchanged.' `
  'New module plus wiring, and file rotation needs real tests.' `
  '64.0' 'console/src/logsink.mjs,console/test/logsink.test.mjs' 'console/src/logpanel.mjs,console/src/dash.mjs' $note

Add-SeededIssue 'Move threshold config into a JSON file' 'size:M' $mLine 'auto' `
  'Thresholds are hardcoded. Load them from a JSON file so they can change without a code edit.' `
  'Sounds cross-cutting: thresholds are read from several panels.' `
  '12.6' 'console/thresholds.json' 'console/src/thresholds.mjs' `
  'seeded example — sized M because it looked cross-cutting; it was one indirection behind an existing export'

Add-SeededIssue 'Replay mode: load a recorded metrics stream from disk' 'size:L' $lLine 'claude-sonnet-4.5' `
  'Add a `--replay FILE` mode that feeds the dashboard from a recorded stream instead of the generator, so an incident can be re-watched.' `
  'New input path parallel to the generator, plus flag handling and tests.' `
  '118.4' 'console/src/replay.mjs,console/test/replay.test.mjs' 'console/src/metrics.mjs,console/src/dash.mjs' $note

Add-SeededIssue 'Split the dashboard into a layout engine' 'size:L' $lLine 'claude-sonnet-4.5' `
  '`frame()` hardcodes panel order and widths. Extract a layout engine that composes panels so new panels do not mean editing frame().' `
  'Touches every panel; the refactor has to keep the seed-42 golden frame identical.' `
  '143.0' 'console/src/layout.mjs,console/test/layout.test.mjs' 'console/src/dash.mjs,console/src/svcpanel.mjs,console/src/logpanel.mjs,console/src/gauges.mjs' $note

Add-SeededIssue 'Add multi-host support' 'size:L' $lLine 'opus-class' `
  'Show more than one host: per-host metrics, a host switcher, and per-host alert state.' `
  'Big, but it is mostly repeating what already works for one host.' `
  '187.3' 'console/src/hosts.mjs,console/src/hostbar.mjs,console/test/hosts.test.mjs' 'console/src/dash.mjs,console/src/metrics.mjs,console/src/services.mjs,console/src/logpanel.mjs' `
  'seeded example — should have been split: XL work sized L, and the session ran out of budget twice'

Write-Host ''
Write-Host '── Open task, not sized yet'

$newDescription = @'
The gauges show the current CPU and MEM, but a spike scrolls away before you can read it. Add a `PEAK` line under the two gauges showing the highest CPU and MEM seen since the dashboard started, and cover the peak tracking with a test.

Verify: `node console/src/dash.mjs --once` shows a PEAK line under MEM, and `node --test console/test/*.test.mjs` stays green.
'@.TrimEnd()

$newBody = New-Body $newDescription '_Not sized yet — Lab 4 estimates this one._' 'auto' '_Not sized yet._'

if ($DryRun) {
  Write-Host '  (unsized) Show session peak CPU and MEM under the gauges'
  Write-Host '    + gh issue create --label ai-sized'
} else {
  $out = gh issue create --title 'Show session peak CPU and MEM under the gauges' --label 'ai-sized' --body $newBody
  if ($LASTEXITCODE -ne 0) { throw 'gh issue create failed for the unsized task.' }
  $new = (($out | Select-Object -Last 1) -split '/')[-1]
  Write-Host "  #$new  Show session peak CPU and MEM under the gauges"
}

Write-Host ''
Write-Host 'Done. See the history with:  node scripts/calibration-report.mjs'
