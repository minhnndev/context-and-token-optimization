# Lab 3 - Build a live cache clock

**In 10 minutes you will:** give Copilot one constrained build prompt, turn the Lab 2 notifier into a live model-cache countdown, and watch two CLI-reported expiry clocks tick while the session is idle.

The completed solution is not on this branch. The supplied tests are the contract.

## 1 - Keep the starter installed - 30 sec

Lab 3 continues directly from Lab 2. Keep its marketplace and plugin installed, and exit Copilot CLI if it is open.

## 2 - Build and test it - 4 min

Start a budgeted builder session:

```bash
copilot --model gpt-5.4-mini --effort low --max-ai-credits 30 --allow-all-tools
```

Send exactly:

```text
Read lab/3-starter/build-prompt.txt and implement it exactly.
```

The prompt limits Copilot to two files and gives it deterministic fake-time tests. A strengthened Mini Low replay finished in 45 seconds and used 5.36 AI credits; workshop runs have taken up to 3.5 minutes, so this step reserves four.

When Copilot finishes, run the contract yourself without another model call:

```text
! node --test lab/3-starter/cache-clock.tests.mjs plugins/cache-continuity/test/cache-continuity.test.mjs
```

You are ready when all **19 tests pass**. The suite also loads the extension against a mock SDK, so green clock logic alone is not enough.

If `plugins/cache-continuity/lib/cache-clock.mjs` is missing or the tests are still red after four minutes, exit Copilot and use the tested [catch-up path](3-starter/fallback.txt):

```bash
git fetch https://github.com/karolmckgh/github-copilot-token-optimization.git solutions
git restore --source FETCH_HEAD --worktree -- plugins/cache-continuity/lib/cache-clock.mjs plugins/cache-continuity/extensions/cache-continuity-notifier/extension.mjs
node --test lab/3-starter/cache-clock.tests.mjs plugins/cache-continuity/test/cache-continuity.test.mjs
```

Then continue below.

## 3 - Refresh the installed plugin - 1 min

Exit the builder, update the plugin from your working tree, then start a fresh experimental CLI:

```text
/exit
```

```bash
copilot plugin update cache-continuity@token-optimization-workshop
copilot --experimental --model gpt-5.4-mini --effort low --max-ai-credits 30
```

`already at latest` is expected: the version is unchanged, but the local source is recopied. Do not reload extensions.

You are ready when the timeline shows:

```text
Cache continuity notifier active.
```

## 4 - Start the live clock - 90 sec

Send this small turn twice:

```text
Reply with exactly CACHE-CHECK. Do not use tools.
```

The first turn establishes a baseline. The repeated turn normally produces a cache checkpoint. One second after the session becomes idle, watch for:

```text
Cache TTL: gpt-5.4-mini 29:57
Cache TTL: gpt-5.4-mini 29:56
Cache TTL: gpt-5.4-mini 29:55
```

The value is computed from the CLI's `cacheExpiresAt`; the code does not assume a 30-minute TTL. The tests also prove that a new main-agent turn cancels the clock until the session becomes idle again.

## 5 - Show two model clocks - 1 min

Switch model:

```text
/model claude-sonnet-4.6
```

Send the same `CACHE-CHECK` prompt once more. After the response, the live line should contain both models:

```text
Cache TTL: claude-sonnet-4.6 4:55 | gpt-5.4-mini 29:43
```

The tests cap each idle preview at ten lines; the final line says `live preview paused`, so a long cache window cannot flood the timeline.

## 6 - Interpret and clean up - 2 min

This is a real countdown, with a narrow boundary:

- `session.usage_checkpoint` reports each model's `cacheExpiresAt` and `cacheTtlSeconds`.
- Those fields are runtime-visible but absent from the generated SDK typings.
- Treat the value as **CLI-reported state**, not a provider guarantee across versions.
- A later checkpoint can refresh one model while another model continues counting down.

Exit and remove the workshop plugin:

```text
/exit
```

```bash
copilot plugin uninstall cache-continuity
copilot plugin marketplace remove token-optimization-workshop
```

Both commands remove the runtime plugin and marketplace registration. The two generated file changes remain in your working tree.

### Stuck?

- No clock after the repeated turn? Check `/usage`; if cached input is still zero, send the identical prompt once more.
- Notifier starts but the clock does not? Confirm the 19 tests passed before `plugin update`, then exit and start a fresh `--experimental` process.
- Plugin was removed after Lab 2? Run `copilot plugin marketplace add .`, then `copilot plugin install cache-continuity@token-optimization-workshop`.
- Never use extension reload in this lab; repeated reloads hang the runtime.

**Continue:** [Lab 4 - Estimate from your own data](4-estimate-from-history.md).
