# Lab 2 - See cache continuity

**In 10 minutes you will:** run the same tiny turn across model and reasoning changes, watch Copilot CLI report cached-input reuse after every response, and compare the result when you return to a configuration you used before.

This is an observation lab, not a cache contest. Zero reuse is valid evidence.

## 1 - Install the notifier - 2 min

Exit Copilot CLI if it is still open. From your repository root:

```bash
copilot plugin marketplace add .
copilot plugin install cache-continuity@token-optimization-workshop
copilot --experimental --model gpt-5.4-mini --effort low --max-ai-credits 30
```

You are ready when the timeline shows:

```text
Cache continuity notifier active.
```

Use a fresh CLI process after plugin changes. Do not reload extensions.

## 2 - Establish a baseline - 1 min

Send:

```text
Reply with exactly CACHE-CHECK. Do not use tools.
```

After the response, the notifier adds a line shaped like:

```text
Cache: gpt-5.4-mini / low | 18,944 of 20,561 reused (92%) | baseline
```

Your token counts and percentage will differ. `baseline` means this is the notifier's first observed turn, not necessarily a cold provider cache.

## 3 - Keep the configuration unchanged - 1 min

Send the identical prompt again:

```text
Reply with exactly CACHE-CHECK. Do not use tools.
```

Look for:

```text
... | same configuration
```

Compare the reused-token count with the baseline. It may rise, stay flat, or remain zero.

## 4 - Change reasoning - 1 min

Run `/model`, keep **GPT-5.4 mini**, and select **High** reasoning. Send the same prompt:

```text
Reply with exactly CACHE-CHECK. Do not use tools.
```

Look for:

```text
... | reasoning changed
```

The notifier may also append a large positive or negative `cache change`. That describes the measured token delta; it does not prove the setting change caused it.

## 5 - Change model and reasoning - 1 min

Run `/model`, select **GPT-5.6 Terra** with **Low** reasoning, then send:

```text
Reply with exactly CACHE-CHECK. Do not use tools.
```

Look for:

```text
... | model + reasoning changed
```

Terra unavailable? Pick any different model with Low reasoning. The experiment is about the transition, not that specific model.

## 6 - Return to the first configuration - 1 min

Run `/model`, select **GPT-5.4 mini** with **Low** reasoning, then send the prompt once more:

```text
Reply with exactly CACHE-CHECK. Do not use tools.
```

Look for:

```text
... | returned to seen configuration
```

In the verified replay, the returned configuration immediately reused 20,480 cached tokens. Your result can differ.

## 7 - Read the evidence - 3 min

Run:

```text
/usage
```

Compare its per-model cached-input totals with the notifier lines. The five turns answer three practical questions:

| Observation | What you can conclude |
|---|---|
| Same configuration reused more input | Continuity was available for that turn |
| A model or reasoning change reused less | Reported reuse differed; its source and cause remain unknown |
| Returning reused input again | That turn reported reuse again; its source and cause remain unknown |

The verified five-turn replay used **10.1228 AI credits**. Treat that as a reference, not a guarantee.

### Stuck?

- No notifier line? Confirm the startup line appeared and that you launched with `--experimental`.
- Plugin changed but output did not? Exit and start a fresh CLI process; do not reload extensions.
- Cache says `0 reused`? Continue. The transition labels still make the experiment useful.
- Model picker differs? Preserve the sequence: Mini Low -> Mini High -> a different model Low -> Mini Low.

---

## Takeaways

- **Input is the bill.** Five one-line prompts cost around 10 credits because every turn re-sends the accumulated context, not just what you typed. Output length is rarely what makes a session expensive.
- **Cached input is cheaper input.** The CLI reports reuse per model, and `/usage` splits cached tokens out from the rest. It is the one part of a growing context that does not cost full price.
- **Continuity is per configuration.** Reuse is reported against a model and reasoning effort. Switching either one is a boundary, and the notifier labelled every one of those transitions for you.
- **A switch mid-task is not free.** That is a reason to choose a configuration for a task and stay on it, rather than changing model or effort in the middle of one.
- **Reported reuse is an observation, not an explanation.** The numbers say what the CLI reported; they do not prove why. Zero reuse is a valid result, and a cache percentage is not a score to optimise.
- **The CLI already emits this data.** Everything you watched came from events the runtime publishes; the plugin only made them visible. Lab 3 builds on exactly that.

Keep the plugin installed. [Lab 3](3-build-cache-clock.md) starts from this notifier and removes it at the end.
