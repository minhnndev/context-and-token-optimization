# TokenLens for GitHub Copilot

TokenLens is a local-first VS Code extension for estimating AI task size, monitoring Copilot CLI usage, surfacing cache continuity, and calibrating estimates against completed work.

The VS Code extension is the primary product surface. The repository also contains TokenLens workshop tools that share the same sizing buckets and `<!-- ai-usage {...} -->` marker contract.

## MVP

- A native rich status hover organized around cache reuse, configuration continuity, current usage, and evidence-based optimization signals.
- Clickable hover actions for Metrics and Optimization Tips.
- Analyze and Optimize % cards in Metrics with an explicit cache/model-consistency formula.
- Task estimates from the description, current Git scope, and locally recorded analogues.
- Cache continuity notifications for model/configuration transitions and significant cache-read deltas.
- Local task history and per-bucket calibration accuracy.
- Explicit GitHub sync through VS Code GitHub Authentication—no mandatory `gh` CLI or PAT.
- Structured issue comments that `scripts/calibration-report.mjs` can read.

## Workflow

1. Open a Git workspace in VS Code.
2. Run **TokenLens: Start Task**.
3. Describe the work and review the size, confidence, scope drivers, and similar completed tasks.
4. Use Copilot normally. The extension polls the matching Copilot CLI session store read-only.
5. Run **TokenLens: Complete Task** to record actual usage and the final Git scope locally.
6. Choose **Sync to GitHub** when you want to create/link an issue and publish calibration data.

If a command does not respond, run **TokenLens: Check Setup**. Task sizing and local task tracking do not require live Copilot data. Live metrics require a matching Copilot CLI session in the same repository and on the same extension host. For Remote SSH, WSL, or Dev Containers, the CLI session store must therefore exist on that remote host.

The status bar keeps the live total visible as **$(pulse) AI · 23.4 cr** and changes to a warning icon when the latest request has low cache reuse or a configuration transition. Hover it for a native Markdown optimization snapshot with a rendered progress graphic, right-aligned metrics, current configuration, request-vs-average comparisons, and explicit **$(graph-line) Metrics** and **$(lightbulb) Optimization Tips** actions.

## Live usage provider

GitHub Copilot does not expose a public VS Code API that gives third-party extensions token or credit telemetry. The initial provider therefore reads the same local Copilot CLI store used by the workshop scripts:

```text
~/.copilot/session-store.db
```

Requirements:

- Copilot CLI has run from the current repository and completed at least one request. Installing the CLI alone is not enough.
- The VS Code extension host includes `node:sqlite` (Node 22.5 or newer).
- The Copilot CLI schema remains compatible with the fields verified by this repository.

The current session-store schema exposes model and cache counters, but not reasoning-effort configuration. The cache observer therefore detects model transitions and factual cache deltas; reasoning transitions will become available when a provider can supply that field. Manual credit entry remains available from **Complete Task** if live usage cannot be read.

If the provider is unavailable, task estimates, Git analysis, local history, calibration, the dashboard, and GitHub issue creation remain usable. The UI reports the provider error instead of inventing usage.

The provider boundary is isolated in `src/providers/sessionProvider.ts`, so a future supported Copilot API can replace the CLI-store implementation without changing the core or UI.

## Architecture

```text
src/
├── extension.ts
├── commands/
│   └── taskCommands.ts
├── core/
│   ├── cache.ts
│   ├── calibration.ts
│   ├── pricing.ts
│   ├── sizing.ts
│   └── types.ts
├── providers/
│   ├── gitProvider.ts
│   ├── githubProvider.ts
│   └── sessionProvider.ts
├── services/
│   ├── liveUsageService.ts
│   └── localStore.ts
├── views/
│   ├── dashboard.ts
│   └── treeProviders.ts
└── test/
```

Core modules do not import VS Code. Local task data is written atomically into VS Code workspace storage, not into the repository. GitHub access happens only after the user runs a sync command.

## Development

```bash
npm install
npm run compile
npm test
npm run package
```

Install the resulting development build with:

```bash
code --install-extension tokenlens-for-copilot-0.3.2.vsix
```

Press `F5` in VS Code to launch an Extension Development Host. Useful commands:

```text
TokenLens: Start Task
TokenLens: Estimate Task
TokenLens: Complete Task
TokenLens: Refresh Usage
TokenLens: Open Metrics
TokenLens: Optimization Tips
TokenLens: View History
TokenLens: Sync Task to GitHub
TokenLens: Check Setup
```

## Pricing

The bundled `scripts/rates.json` remains the pricing source of truth for token-to-credit conversion. Live Copilot CLI monitoring uses the exact `total_nano_aiu` credits already recorded by Copilot, while the configurable `tokenLens.creditUsd` setting controls the dashboard's USD display.

Pricing is deliberately not hard-coded into the dashboard.

## GitHub calibration format

Completed tasks are posted with the existing marker shape:

```html
<!-- ai-usage {"bucket":"M","actual":42.7,"verdict":"on-target"} -->
```

Additional fields include models, per-model usage, files, session ID, and timestamp. Comparison markers remain excluded by the workshop calibration reporter.

## Workshop tools

The original workshop material remains in:

- `lab/`
- `scripts/`
- `plugins/cache-continuity/`
- `console/`

The workshop tests run as part of `npm test`, ensuring the extension and companion tools keep the same sizing and calibration contracts.
