---
name: estimate-aic-cost
description: Estimate an issue's AI-credit cost from this repo's recorded actuals. Use for requests to estimate, size, or budget a task in AI credits, e.g. "/estimate-aic-cost #14".
---

# Estimate AI cost from recorded history

1. Extract the issue number. If absent, ask; never guess.
2. Read the task: `gh issue view <NUMBER>`.
3. Read the history once: `node scripts/calibration-report.mjs --json`.
4. Pick the 2–3 closest recorded tasks. Compare **task shape**, not wording:
   how many files each touched and whether any were new (`files`), how wide the
   scope is, and how specific the ask is. A vague ask costs more than its size
   suggests — the history shows this.
5. Choose the bucket those analogues land in, then write it:

   ```sh
   node scripts/set-estimate.mjs --issue <NUMBER> --size <XS|S|M|L|XL> \
     --rationale "<why, naming the drivers>" --analogues "#<n> (<actual>cr), #<n> (<actual>cr)"
   ```

6. Reply with the bucket **and its credit range**, written as
   `<SIZE> — <range> credits`. Take both from what `set-estimate.mjs` printed;
   never state a bucket letter on its own. Then give the analogues you used and
   how many recorded tasks the history holds — so the reader can judge how thin
   the evidence is.

Use only actuals from the JSON; never calculate or invent a credit number. If
the history has no recorded actuals, say so and stop rather than guessing. If
the closest analogues straddle two buckets, pick the higher one and say why.
Never record actuals, close the issue, or alter `<!-- ai-usage {...} -->` markers.
