# Changelog

## 0.3.2

- Added a native Markdown status hover centered on live cache reuse, configuration continuity, usage, and optimization signals.
- Added Analyze and Optimize % cards to Metrics with cache, configuration, model-consistency, and cost-per-request signals.
- Made Optimize % explainable: 75% cache reuse plus 25% dominant-model request share; cost remains outside the score until historical baselines exist.
- Added visible progress and a completion confirmation when analyzing and starting a task.
- Reduced the Current Task description size for better dashboard hierarchy.
- Added evidence-based Optimization Tips for low cache reuse, configuration changes, context growth, and expensive requests.
- Registered user commands before workspace initialization so setup failures are reported instead of failing silently.
- Added **TokenLens: Check Setup** with separate readiness checks for task tracking and live Copilot CLI metrics.
- Standardized the project on the `TokenLens`, `tokenLens.*`, and `minhnndev.tokenlens-for-copilot` names as one clean namespace.
