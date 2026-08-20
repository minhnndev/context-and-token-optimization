---
name: update-aic-cost
description: Record the current Copilot CLI session's AI credits on a GitHub issue. Use for requests to record, update, or post AI usage or cost, e.g. "/update-aic-cost #1".
---

# Record AI cost

1. Extract the issue number. If absent, ask; never guess.
2. Without a preamble, run exactly once from the repository root:

   ```sh
   node scripts/record-usage.mjs --issue <NUMBER> --from-session
   ```

3. Reply only with the recorded credits, estimate bucket, and verdict.

Use only the script's values; never calculate or estimate. Never rerun it:
usage is measured since the last recording, so a rerun posts duplicate overhead.
On failure, return the error verbatim and stop. Never close the issue or alter
`<!-- ai-usage {...} -->` markers.
