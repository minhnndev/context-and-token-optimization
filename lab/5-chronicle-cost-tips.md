# This is a take home lab. Try it in your own time.

# Lab 5 - Ask your sessions where the money went

**In this lab you will:** turn the four labs you just ran into feedback on how *you* work — where your tokens actually went, and what to do differently next time.

Labs 1–4 measured the cost of tasks. This one looks at your habits.

## 1 - Ask

First, which history are you asking about? A codespace only knows the labs. On your own machine it follows the machine, not the account — so your day-to-day work is in there too, and the tips will lean on it. More useful, if less tidy.

Still in Copilot CLI, from your repo:

```text
/chronicle cost-tips
```

On your own machine, add `for my sessions in this repository today` to keep it to the workshop.

This session is nearly empty, and you restarted the CLI several times today — neither matters. Copilot CLI keeps a history *across* sessions: your prompts, the tools that ran, the files that changed. Each lab you ran is in there as its own session. `cost-tips` reads all of them, reports where your tokens went, and suggests how to spend fewer.

It costs a few credits: analysing your history means reading it — the same trade as the recording skill in Lab 1.

## 2 - Read where your tokens actually went

You will get a breakdown and a handful of suggestions. Before you read them properly, answer for yourself: **where would you have guessed your tokens went?**

Then look.

Your report is yours alone — it is drawn from your sessions, so nobody else's will look like it, and there is nothing to compare it against.

## 3 - Keep one

Pick **one** suggestion you will actually keep. Not the most impressive one — the one that fits how you work.

Say why, to the agent:

```text
Of those, I'm keeping <the one>, because <reason>.
```

One habit you keep beats five you read and forget.

### Stuck?

- Sessions look missing? `/chronicle reindex` rebuilds the history, then run it again.
- Report thin or generic? Not much of *you* in the history yet — `/chronicle tips` asks it a broader question.
- `cost-tips` not recognised? Type `/chronicle` on its own and pick from the list. If `/chronicle` itself is unknown, your CLI predates it: `/update`, then restart.

### Finished early?

Same history, different question:

```text
/chronicle improve
```

This one only looks at *this* repository, finds where the agent misunderstood you or needed correcting, and proposes custom instructions to stop it happening again. Cheaper agents and better agents turn out to be the same problem: an agent that gets it right first time never re-reads your codebase to try again.

---

## Takeaways

- **Your session history is evidence.** The CLI already records how you work. You do not have to guess which habits are expensive — you can ask.
- **Cost is a habit, not just a task size.** Labs 1–4 priced tasks; this prices the way you work. Long sessions, re-runs and vague first prompts show up here and nowhere else.
- **Advice from your own data beats advice in general.** Tips that quote your own sessions back to you are the ones worth acting on.

That is the loop, end to end: estimate it, cap it, record it, estimate the next one from what you recorded — then ask your own history what to change.
