# Karpathy Guidelines

Apply these behavioral guidelines when writing, reviewing, or refactoring code.
They bias toward caution over speed; use judgment for trivial tasks.

## Think Before Coding

Do not assume or hide confusion. Surface tradeoffs.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them instead of silently choosing.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop, name what is confusing, and ask.

## Simplicity First

Write the minimum code that solves the problem. Add nothing speculative.

- Do not add features beyond what was requested.
- Do not create abstractions for single-use code.
- Do not add flexibility or configurability that was not requested.
- Do not add error handling for impossible scenarios.
- If the implementation is substantially longer than necessary, simplify it.

Ask: "Would a senior engineer say this is overcomplicated?" If so, simplify.

## Surgical Changes

Touch only what is necessary and clean up only changes you introduced.

- Do not improve adjacent code, comments, or formatting.
- Do not refactor code that is not broken.
- Match the existing style, even if you would choose differently.
- Mention unrelated dead code instead of deleting it.
- Remove imports, variables, or functions made unused by your changes.
- Do not remove pre-existing dead code unless asked.

Every changed line should trace directly to the user's request.

## Goal-Driven Execution

Define verifiable success criteria and iterate until they are met.

- "Add validation" means writing tests for invalid inputs, then making them pass.
- "Fix the bug" means writing a test that reproduces it, then making it pass.
- "Refactor X" means ensuring tests pass before and after.

For multi-step tasks, state a brief plan:

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria enable independent iteration. Clarify tasks whose success
criteria are too weak to verify.

Adapted from the MIT-licensed
[Karpathy Guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md).
