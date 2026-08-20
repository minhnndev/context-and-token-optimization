#!/usr/bin/env bash
# Seed the lab: labels + 3 open sized issues on the Incident Console.
# Run once, from the repo root of YOUR template copy:  bash scripts/seed-issues.sh
set -euo pipefail

cd "$(dirname "$0")/.."
REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
echo "Seeding workshop issues in $REPO"
echo

echo "── Labels"
gh label create "ai-sized"             --color "8250df" --description "Task sized in AI credits before work started" --force
gh label create "size:XS"              --color "c8e1ff" --description "Estimated ≤10 AI credits" --force
gh label create "size:S"               --color "79b8ff" --description "Estimated 11–30 AI credits" --force
gh label create "size:M"               --color "2188ff" --description "Estimated 31–75 AI credits" --force
gh label create "size:L"               --color "0757ba" --description "Estimated 76–150 AI credits" --force
gh label create "size:XL"              --color "032f62" --description "Estimated >150 AI credits — consider splitting" --force
gh label create "calibration:on-target" --color "2da44e" --description "Actual AI spend landed inside the estimated bucket" --force
gh label create "calibration:over"      --color "d1242f" --description "Actual AI spend exceeded the estimated bucket" --force
gh label create "calibration:under"     --color "0969da" --description "Actual AI spend came in below the estimated bucket" --force

# Issue bodies mimic exactly what the ai-sized-task issue form renders, so
# the scripts parse seeded and form-created issues identically.
new_issue() { # title, size-label, body → echoes issue number
  local title="$1" size="$2" body="$3"
  gh issue create --title "$title" --label "ai-sized" --label "$size" --body "$body" \
    | grep -oE '[0-9]+$'
}

echo
echo "── Open sized issues (your lab tasks, all on the Incident Console)"

XS_BODY='### Task description

The CPU gauge shows 🔴 and the log spams ALERT even at ~30% load — critical should only fire above 80%. Verify (deterministic): `node console/src/dash.mjs --once` renders tick 30 at seed 42 with CPU 31% — the dot must be green after your fix (red before), and `node --test console/test/*.test.mjs` stays green.

### AI credit size

XS — up to 10 credits

### Planned model

auto (10% discount)

### Sizing rationale

Small app, obvious symptom, one-line class of fix, one verify cycle.'

S_BODY='### Task description

Add a latency panel to the dashboard: the metrics generator already emits `latMs`, but nothing displays it. Show a `LAT` sparkline line directly under `REQ/S` with the current value and the p99 of the recent window, give latency warn/crit thresholds with a status dot, and log latency alerts only on p99 status *transitions* — never per tick.

Acceptance tests are pre-written and they are the spec — do not edit them. Make `node --test console/test/pending/latency.test.mjs` pass, then move that file into `console/test/` so it runs with the suite and `node --test console/test/*.test.mjs` stays green. The tests pin the exact percentile math, line format, threshold values, and alert messages — run them early and often.

### AI credit size

S — 11–30 credits

### Planned model

auto (10% discount)

### Sizing rationale

Data already exists and the acceptance tests are pre-written for us; render + wiring + two small helpers.'

M_BODY='### Task description

Add an alert-rule engine: a rule fires ONE alert when a metric stays over its threshold for N consecutive ticks (no per-tick spam), and clears when it recovers. Make rules data-driven, wire them into the dashboard log panel, and cover the engine with `node:test`.

### AI credit size

M — 31–75 credits

### Planned model

claude-sonnet-4.5

### Sizing rationale

New module + integration + tests; genuine design decisions and iteration.'

N1=$(new_issue "CPU gauge stuck on red — crit threshold fires at normal load" "size:XS" "$XS_BODY")
echo "  #$N1 (XS)  CPU gauge stuck on red"
N2=$(new_issue "Add latency panel with p99 sparkline" "size:S" "$S_BODY")
echo "  #$N2 (S)   Add latency panel with p99 sparkline"
N3=$(new_issue "Add alert-rule engine (sustained-threshold alerts)" "size:M" "$M_BODY")
echo "  #$N3 (M)   Add alert-rule engine"

echo
echo "Done."
