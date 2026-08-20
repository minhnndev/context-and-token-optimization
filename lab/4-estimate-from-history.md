# Lab 4 - Estimate the next task from your own data

**In this lab you will:** turn the recordings from Lab 1 into something useful — ask the agent to size a brand-new task twice, once on general knowledge and once on your repo's recorded actuals, and compare what each answer was based on.

This is what the recording step was for. Sizing gets better because you measured, not because you got wiser.

## 1 - Seed a history

Three recorded tasks is not a history. Exit Copilot CLI and add a corpus of finished ones to your repo:

```bash
bash scripts/seed-history.sh
copilot
```

On Windows PowerShell, use the `.ps1` port instead:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\seed-history.ps1
copilot
```

That creates twelve closed tasks with actuals already recorded, plus one open task nobody has sized. It takes a couple of minutes; you are ready when it prints:

```text
Done. See the history with:  node scripts/calibration-report.mjs
```

The twelve are **illustrative examples, not measurements** — every one says so in its recording. The real data in the corpus is yours: the issues you recorded in Lab 1 are in there too.

## 2 - Look at what you have

From the Copilot prompt:

```text
! node scripts/calibration-report.mjs
```

Read the two summary lines under the table: buckets that hold, buckets that drift, and an overall on-target rate. That is a velocity chart for AI spend.

Now find the unsized task at the bottom of the table — *Show session peak CPU and MEM under the gauges*. Note its number; the steps below call it **#N**.

## 3 - Estimate it cold

```text
Estimate the AI-credit cost of issue #N. Answer from general knowledge only — do
not read this repo's recorded history. Give a bucket (XS/S/M/L/XL) and one sentence.
```

Write the answer down, and note what it was based on. It will sound confident.

## 4 - Estimate it from your data

```text
/estimate-aic-cost #N
```

The **estimate-aic-cost skill** has the agent read the whole recorded history in one command, pick the closest finished tasks, and size this one against them. The reply names its evidence:

```text
S — 11–30 credits
Estimated from recorded history: #29 (22.4cr), #30 (18.9cr)
15 recorded tasks in the history.
```

## 5 - Compare

Both answers gave you a bucket. Only one can tell you where it came from.

Look at what the grounded estimate cited. The analogues are rarely the tasks with similar *titles* — they are the tasks with a similar **shape**: how many files they touched, how many were new, how specific the ask was. Recording captures that shape automatically, straight from the CLI's own session store, which is why the estimator has something to match on.

```text
! gh issue view N
```

The estimate is now on the issue — bucket in the body, size label applied — so when someone finishes this task and records it, the verdict compares against this estimate.

### Stuck?

- Skill not found? It ships in `.github/skills/estimate-aic-cost/`; start a fresh CLI in the repo root.
- `No issues labeled "ai-sized"`? Run `bash scripts/seed-history.sh` (Windows: `scripts\seed-history.ps1`) first.
- Both estimates landed on the same bucket? That happens — compare the *evidence*, not the buckets. One cited your tasks and their actuals; the other cited nothing.
- Estimate looks wrong to you? Say so and re-run — you have context the history does not. The estimate is an opening bid, not a verdict.

### Finished early?

Close the loop for real. Cap the session at the top of the bucket the estimate gave you, build it, then record what it actually cost:

```text
/limits unset max-ai-credits
/limits set max-ai-credits <top of that bucket>
Fix issue #N: show the peak CPU and MEM seen so far under the two gauges.
```

```text
! node --test console/test/*.test.mjs
! node console/src/dash.mjs --once
! node scripts/record-usage.mjs --issue N --from-session
```

The verdict on that comment is the estimator being graded — by you, on your own repo.

---

## Takeaways

- **Recorded actuals are the asset.** The estimate got better because there was data, not because the model got smarter. Three recordings is a hunch; a few dozen is a prior.
- **Cost follows the shape of the change.** Files touched, files created, how specific the ask was. Recording captures that shape for free, so the history is comparable rather than anecdotal.
- **The vague task is the expensive one.** It shows up in the history as the overrun, and it is the one thing you can fix before starting.
- **Judge the evidence, not the confidence.** A cold estimate sounds exactly as certain as a grounded one. Ask what it was based on — with a dozen tasks this is reasoning by analogy, not statistics — then decide for yourself.
- **The loop closes on itself.** Estimate from history, cap at the estimate, record the actual, and the recording becomes evidence for the next estimate.

**Continue:** [Lab 5 - Ask your sessions where the money went](5-chronicle-cost-tips.md).
