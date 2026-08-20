# Lab 1 · Size it, cap it, record it

**In this lab you will:** take one real bug, estimate its AI-credit cost like a story point, cap your Copilot CLI session at that estimate, fix the bug with the agent, record what it actually cost — then price the identical fix on a frontier model and feel the difference.

*(No environment yet? Do [Lab 0](../README.md) first.)*

---

## 0 · Ready the lab

Still inside Copilot CLI from Lab 0? `/exit` first. Then check the app runs — a live dashboard should appear (`q` to quit). Note the red CPU dot and the ALERT spam: that's the bug you're about to fix.

```bash
node console/src/dash.mjs
```

Seed the lab tasks into your repo's Issues, then start Copilot CLI:

```bash
bash scripts/seed-issues.sh
copilot
```

On Windows PowerShell, use the `.ps1` port instead:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\seed-issues.ps1
copilot
```

Seeding creates issues **#1–#3**; the steps below use those numbers. If yours differ, use what you see.

On first start Copilot CLI asks whether you trust this folder — confirm to proceed. Then go to the **Issues** tab in the bar at the top: select it there, or press **Tab** until you land on it.

## 1 · Size the task

You'll read the task without leaving Copilot CLI. On the **Issues** tab, highlight **#1 · CPU gauge stuck on red**, press **Enter** to read it, **Esc** to go back.

The CPU gauge glows red at ~30% load. The issue is already sized **XS — up to 10 credits**, and the rationale field says why: *small app, obvious symptom, one verify cycle*. That's the whole sizing skill — before starting, ask: how much code must the agent **read**? how many **iterations** are plausible? how **ambiguous** is the ask? Cheap tasks are specific tasks.

*(1 AI credit = $0.01. Your Copilot allowance is a monthly pool of these — an unwatched agent session can burn a day's worth on one vague prompt.)*

## 2 · Cap the session at the estimate

Back on the **Session** tab (press **Tab** until you're there):

```
/limits set max-ai-credits 30
```

Why 30 when the issue says XS ≤10? The CLI's minimum session limit is 30 — so for small tasks the cap is a runaway-guardrail, and you hold yourself to the estimate at the recording step (for M and larger, cap at your bucket top). It's a soft limit; hitting it just means you underestimated — useful data, not failure.

## 3 · Pick the model

```
/model
```

Select **GPT-5.4 mini**: a small, cheap model that is plenty for a task this size. Model choice is a cost lever — step 6 will show you how big.

## 4 · Fix the bug

Give the agent a *specific* prompt — you sized this XS because it's specific, so prompt like it:

```
Fix issue #1: the CPU gauge shows red and the log spams ALERT even at ~30% load.
Critical should fire above 80%.
```

*(Slick alternative: Tab back to **Issues**, highlight #1, press **c** — the issue reference is inserted into your prompt input for you; type the rest of the prompt around it.)*

When it's done, verify — deterministically, same on every machine, straight from the Copilot prompt (`!` runs a shell command, no agent, no tokens):

```
! node console/src/dash.mjs --once        # tick 30, CPU 31% → the dot must now be 🟢
! node --test console/test/*.test.mjs     # fail 0 — all green (the agent may have added a test of its own)
```

## 5 · Record what it really cost

Still in Copilot CLI, look at the meter:

```
/usage
```

Now post the actual on the issue — same `!` trick, so **recording costs zero tokens**:

```
! node scripts/record-usage.mjs --issue 1 --from-session
```

It reads the exact numbers behind `/usage` from the CLI's own session store and comments estimate-vs-actual on the issue, per-model breakdown included (uses your existing `gh` login).

Over the estimate? **Record it anyway.** Overruns are the most valuable calibration data you'll ever collect.

## 6 · Same bug, bigger model

You just fixed this bug for a few credits on GPT-5.4 mini. Now price the exact same work on a frontier model. First undo the fix — double-tap `Esc` (or run `/rewind`) to roll the session back without spending any AI credits.

You're reset when `! node console/src/dash.mjs --once` shows the **red** dot again. *(Agent left something behind? `! git checkout -- console && git clean -fd console` resets for free.)*

Then switch models:

```
/model
```

Select **Claude Opus 4.8** and re-run the identical prompt:

```
Fix issue #1: the CPU gauge shows red and the log spams ALERT even at ~30% load.
Critical should fire above 80%.
```

Hit the 30-credit cap from step 2 mid-fix? That **is** the price gap making itself felt — `/limits unset max-ai-credits` then `/limits set max-ai-credits 60`, and finish.

When it's done (`! node console/src/dash.mjs --once` — green dot again), check the meter:

```
/usage
```

Read the **Opus line** in the per-model breakdown — that's this fix; compare it with what Auto charged you in step 5. Then record the second data point on the same issue (this also keeps the next recording clean):

```
! node scripts/record-usage.mjs --issue 1 --from-session --comparison
```

`--comparison` prices a *model*, not the task — it lands on the issue but stays out of your calibration history, so this deliberately expensive run never becomes the recorded cost of an XS task.

Same bug, same prompt, same fix — a different invoice. That gap is the model lever: pick the model for the task, not by habit.

---

### Let's try another bigger issue

**Issue #2** (*Add latency panel with p99 sparkline*) is sized **S — 11–30 credits**. It's a real feature, not a bug — notice how the wider scope changes what the agent reads, and what that does to the meter.

**1.** Switch back to **Auto** — step 6 left you on Opus:

```
/model
```

**2.** Clear the old cap and set a fresh one for the bigger task:

```
/limits unset max-ai-credits
/limits set max-ai-credits 75
```

**3.** Fix it:

```
Fix issue #2: add a latency panel with a p99 sparkline to the dashboard.
```

**4.** Verify — same `!` trick, no tokens:

```
! node console/src/dash.mjs --once        # a LAT line with p99 now sits under REQ/S
! node --test console/test/*.test.mjs     # fail 0 — latency.test.mjs moved in and green
```

**5.** Record using the **update-aic-cost skill** instead of the bare `!` command:

```
/update-aic-cost #2
```

The skill has the agent run the recorder for you. It costs a few tokens — everything an agent does costs tokens — which is why step 5 used the free `!` command. A skill earns its price when an agent works through a stack of issues on autopilot. Recording is per-task either way: the recorder only counts usage since your last recording.

## Takeaways

- **Pick the model for the task, not by habit.** Auto routes to a capable-but-cheap model and takes 10% off the bill. A frontier model overthinks a small problem: in step 6 the identical one-line fix came back around **5× more expensive** on Opus 4.8. Save the big model for problems that are genuinely hard.
- **Scope and specificity are the cheapest levers you have.** The bill is how much the agent must read and how often it has to guess. A narrow, precise ask is what makes a task XS — vague prompts are expensive prompts.
- **Cap the session at your estimate.** The limit is a guardrail, not a target: let it stop a session that has drifted, and lift it only once you can see the work heading the right way. Tripping the cap is information, not failure.
- **Record the actual on the work item.** A handful of recorded issues beats any generic pricing table — your codebase, your prompts, your numbers. Record the overruns especially; they build the estimation muscle faster than the tasks that went to plan.
- **Commands starting with `!` are free.** Tests, verification, the recorder — anything you can run yourself costs zero tokens. Never pay an agent to run a shell command you could have typed.
- **Skills are for autopilot.** When the agent has to do the running itself — a stack of issues, unattended — a skill like `update-aic-cost` buys that autonomy for a few tokens. That is the trade: tokens for hands-off.

**Not tracking work in GitHub?** The plumbing here is GitHub-flavoured — issues, labels, `gh` — and works the same on GitHub Enterprise. The loop itself is not GitHub-specific: on Azure DevOps it is the same four moves with a credit-size custom field on the work item and `az boards` where this repo calls `gh`. Everything on the CLI side — `/limits`, `/usage`, `!`, skills, model choice — is identical wherever the backlog lives.

**Continue:** [Lab 2 - See cache continuity](2-keep-cache-warm.md).



## Going faster than the presenter?

### Now make the cap bite — issue #3

**Issue #3** (*Add alert-rule engine*) is sized **M — 31–75 credits**. Cap it at **30** anyway — deliberately under the estimate — so you can see what a session running out of budget mid-task actually looks like.

**1.** Reset the cap, on purpose too low:

```
/limits unset max-ai-credits
/limits set max-ai-credits 85
```

**2.** Give it the task:

```
Fix issue #3: add an alert-rule engine that fires one alert when a metric stays
over its threshold for several consecutive ticks, and clears when it recovers.
```

**3.** Watch the meter with `/usage` as it works. Odds are the agent stops mid-task when it hits 85 — that's the guardrail doing its job, not a failure. Lift it and let it finish:

```
/limits unset max-ai-credits
/limits set max-ai-credits 110
```

**4.** Verify:

```
! node --test console/test/*.test.mjs     # fail 0 — including the engine tests the agent wrote
! node console/src/dash.mjs --once        # header reads ALERTS 3 active; queue, api-gw, search announced once each
```

**5.** Record it — including the fact that you tripped the cap:

```
/update-aic-cost #3
```

Three issues, three sizes, three very different meters. That spread — plus the point where 30 credits stopped being enough — is calibration data: estimates grounded in numbers rather than in a feeling.

### Stuck?

- Agent went sideways? `/usage` to check spend, then re-prompt more specifically — or `/clear` and restart the task fresh (a new, smaller context is often *cheaper* than arguing with a big one).
- Fix didn't verify? The issue's verify line is exact: seed 42, tick 30, CPU 31%, green dot.
- Hit the 30-credit limit mid-fix? On an XS task that's loud underestimation data. `/limits unset max-ai-credits` then `/limits set max-ai-credits 45`, note it, and record the real total at the end.

---

**Continue:** [Lab 2 - See cache continuity](2-keep-cache-warm.md).
