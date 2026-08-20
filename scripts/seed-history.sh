#!/usr/bin/env bash
# Seed Lab 4: a recorded history to estimate from — 12 closed sized issues with
# actuals already recorded, plus one new unsized task for the estimator to size.
#
#   bash scripts/seed-history.sh          # seed for real
#   DRY_RUN=1 bash scripts/seed-history.sh  # print what would be created
#
# Separate from seed-issues.sh on purpose: Lab 1 browses the Issues tab, and a
# dozen extra closed issues there would bury the three tasks it uses.
#
# The actuals below are illustrative examples, not measurements — every one is
# recorded with a "seeded example" note. Your own recordings are the real data;
# these exist so the estimator has something to reason from on day one.
set -euo pipefail

cd "$(dirname "$0")/.."
DRY_RUN="${DRY_RUN:-}"

if [ -z "$DRY_RUN" ]; then
  REPO=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
  echo "Seeding recorded history in $REPO"
else
  echo "DRY RUN — no issues will be created"
fi
echo

run() { # echo in dry-run, execute otherwise
  if [ -n "$DRY_RUN" ]; then echo "    + $*"; else "$@" >/dev/null; fi
}

if [ -z "$DRY_RUN" ]; then
  echo "── Labels"
  gh label create "ai-sized" --color "8250df" --description "Task sized in AI credits before work started" --force >/dev/null
  gh label create "size:XS" --color "c8e1ff" --description "Estimated ≤10 AI credits" --force >/dev/null
  gh label create "size:S"  --color "79b8ff" --description "Estimated 11–30 AI credits" --force >/dev/null
  gh label create "size:M"  --color "2188ff" --description "Estimated 31–75 AI credits" --force >/dev/null
  gh label create "size:L"  --color "0757ba" --description "Estimated 76–150 AI credits" --force >/dev/null
  echo
fi

body() { # description, size line, model, rationale
  printf '### Task description\n\n%s\n\n### AI credit size\n\n%s\n\n### Planned model\n\n%s\n\n### Sizing rationale\n\n%s' "$1" "$2" "$3" "$4"
}

# title | size-label | size-line | model | description | rationale | credits | created | edited | note
seed() {
  local title="$1" size="$2" sizeline="$3" model="$4" desc="$5" why="$6" credits="$7" created="$8" edited="$9" note="${10}"
  if [ -n "$DRY_RUN" ]; then
    printf '  %-6s %-8s %s\n' "$size" "${credits}cr" "$title"
    echo "    + gh issue create --label ai-sized --label $size"
    echo "    + record-usage --credits $credits --created '$created' --edited '$edited'"
    echo "    + gh issue close"
    return
  fi
  local n
  n=$(gh issue create --title "$title" --label "ai-sized" --label "$size" \
        --body "$(body "$desc" "$sizeline" "$model" "$why")" | grep -oE '[0-9]+$')
  node scripts/record-usage.mjs --issue "$n" --credits "$credits" --model "$model" \
    ${created:+--created "$created"} ${edited:+--edited "$edited"} --notes "$note" >/dev/null
  gh issue close "$n" >/dev/null 2>&1
  printf '  #%-4s %-6s %-8s %s\n' "$n" "$size" "${credits}cr" "$title"
}

XS_LINE='XS — up to 10 credits'
S_LINE='S — 11–30 credits'
M_LINE='M — 31–75 credits'
L_LINE='L — 76–150 credits'
NOTE='seeded example — illustrative, not a measurement'

echo "── Closed tasks with recorded actuals"

seed "Right-align the gauge percentage column" "size:XS" "$XS_LINE" "auto" \
  "CPU and MEM percentages jump around as the digit count changes. Pad them to a fixed width in \`renderGauge\`." \
  "One named render function, cosmetic, one verify cycle." \
  4.2 "" "console/src/gauges.mjs" "$NOTE"

seed "Dim the timestamp column in the log panel" "size:XS" "$XS_LINE" "auto" \
  "The \`t+NNN\` stamps compete with the message text. Paint them dim like the rest of the chrome." \
  "One line in one named file." \
  3.1 "" "console/src/logpanel.mjs" "$NOTE"

seed "Truncate long service names in the services table" "size:XS" "$XS_LINE" "auto" \
  "A long service name pushes the LAT/RPS/ERR columns out of alignment. Clip the name to the column width." \
  "Named file, obvious symptom, but the column maths needs one look." \
  8.7 "" "console/src/svcpanel.mjs" "$NOTE"

seed "Sparkline divide-by-zero on flat data" "size:S" "$S_LINE" "claude-sonnet-4.5" \
  "When every value in the window is equal the sparkline scale divides by zero and renders blanks. Fix the scaling and cover it with a test." \
  "Small fix, but reproducing an edge case takes an extra cycle or two." \
  22.4 "" "console/src/sparkline.mjs,console/test/sparkline.test.mjs" "$NOTE"

seed "Add a --no-color flag for CI logs" "size:S" "$S_LINE" "auto" \
  "ANSI codes make piped output unreadable. Add \`--no-color\` and make \`paint\` a no-op when it is set." \
  "Two files, one flag, but every call site goes through paint." \
  18.9 "" "console/src/ansi.mjs,console/src/dash.mjs" "$NOTE"

seed "Make the services table easier to scan" "size:S" "$S_LINE" "claude-sonnet-4.5" \
  "The services table is hard to read at a glance. Improve it." \
  "Feels like a small presentation change." \
  41.5 "" "console/src/svcpanel.mjs,console/src/services.mjs,console/src/dash.mjs" \
  "seeded example — vague spec: three redesign rounds before agreeing what 'easier to scan' meant"

seed "Add a p95 column to the services table" "size:M" "$M_LINE" "claude-sonnet-4.5" \
  "Track a rolling per-service latency window and show p95 next to the current LAT value." \
  "New helper module, per-service state, table changes, tests." \
  38.2 "console/src/svcstats.mjs,console/test/svcstats.test.mjs" "console/src/svcpanel.mjs,console/src/services.mjs" "$NOTE"

seed "Write the log panel to a rotating file" "size:M" "$M_LINE" "claude-sonnet-4.5" \
  "Persist log lines to disk with size-based rotation, keeping the on-screen panel unchanged." \
  "New module plus wiring, and file rotation needs real tests." \
  64.0 "console/src/logsink.mjs,console/test/logsink.test.mjs" "console/src/logpanel.mjs,console/src/dash.mjs" "$NOTE"

seed "Move threshold config into a JSON file" "size:M" "$M_LINE" "auto" \
  "Thresholds are hardcoded. Load them from a JSON file so they can change without a code edit." \
  "Sounds cross-cutting: thresholds are read from several panels." \
  12.6 "console/thresholds.json" "console/src/thresholds.mjs" \
  "seeded example — sized M because it looked cross-cutting; it was one indirection behind an existing export"

seed "Replay mode: load a recorded metrics stream from disk" "size:L" "$L_LINE" "claude-sonnet-4.5" \
  "Add a \`--replay FILE\` mode that feeds the dashboard from a recorded stream instead of the generator, so an incident can be re-watched." \
  "New input path parallel to the generator, plus flag handling and tests." \
  118.4 "console/src/replay.mjs,console/test/replay.test.mjs" "console/src/metrics.mjs,console/src/dash.mjs" "$NOTE"

seed "Split the dashboard into a layout engine" "size:L" "$L_LINE" "claude-sonnet-4.5" \
  "\`frame()\` hardcodes panel order and widths. Extract a layout engine that composes panels so new panels do not mean editing frame()." \
  "Touches every panel; the refactor has to keep the seed-42 golden frame identical." \
  143.0 "console/src/layout.mjs,console/test/layout.test.mjs" "console/src/dash.mjs,console/src/svcpanel.mjs,console/src/logpanel.mjs,console/src/gauges.mjs" "$NOTE"

seed "Add multi-host support" "size:L" "$L_LINE" "opus-class" \
  "Show more than one host: per-host metrics, a host switcher, and per-host alert state." \
  "Big, but it is mostly repeating what already works for one host." \
  187.3 "console/src/hosts.mjs,console/src/hostbar.mjs,console/test/hosts.test.mjs" "console/src/dash.mjs,console/src/metrics.mjs,console/src/services.mjs,console/src/logpanel.mjs" \
  "seeded example — should have been split: XL work sized L, and the session ran out of budget twice"

echo
echo "── Open task, not sized yet"

NEW_BODY=$(body \
  "The gauges show the current CPU and MEM, but a spike scrolls away before you can read it. Add a \`PEAK\` line under the two gauges showing the highest CPU and MEM seen since the dashboard started, and cover the peak tracking with a test.

Verify: \`node console/src/dash.mjs --once\` shows a PEAK line under MEM, and \`node --test console/test/*.test.mjs\` stays green." \
  "_Not sized yet — Lab 4 estimates this one._" \
  "auto" \
  "_Not sized yet._")

if [ -n "$DRY_RUN" ]; then
  echo "  (unsized) Show session peak CPU and MEM under the gauges"
  echo "    + gh issue create --label ai-sized"
else
  NEW=$(gh issue create --title "Show session peak CPU and MEM under the gauges" \
    --label "ai-sized" --body "$NEW_BODY" | grep -oE '[0-9]+$')
  echo "  #$NEW  Show session peak CPU and MEM under the gauges"
fi

echo
echo "Done. See the history with:  node scripts/calibration-report.mjs"
