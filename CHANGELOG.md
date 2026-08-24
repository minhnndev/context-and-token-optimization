# Changelog

## 0.3.1

- Kept the status experience as a native Markdown hover instead of using a Quick Pick for metric display.
- Kept Metrics as an explicit action in the hover instead of navigating there implicitly.
- Added Analyze and Optimize % cards to Metrics with cache, configuration, model-consistency, and cost-per-request signals.
- Made Optimize % explainable: 75% cache reuse plus 25% dominant-model request share; cost remains outside the score until historical baselines exist.
- Added evidence-based Optimization Tips for low cache reuse, configuration changes, context growth, and expensive requests.
- Switched the native hover to Markdown tables and a rendered SVG progress bar so alignment does not depend on unsupported hover CSS.

## 0.3.0

- Replaced the Quick Pick usage popup with a native Rich Status Bar Hover.
- Added trusted Codicon command links for Metrics, History, and Refresh.
- Made the status item open the Metrics Webview directly.
- Removed the obsolete popup runtime while preserving its old command IDs as compatibility aliases.

## 0.2.0

- Renamed the extension to TokenLens for GitHub Copilot.
- Added canonical `tokenLens.*` commands and settings with compatibility aliases for existing command IDs and configuration.
- Added a live-credit status item with rich hover analytics and an interactive usage popup.
- Kept detailed dashboard access as a metrics action inside the popup.

## 0.1.0

- Added a local-first VS Code extension MVP.
- Added task sizing, live Copilot CLI usage, cache continuity, a cost dashboard, local history, and opt-in GitHub calibration sync.
- Preserved the existing `ai-usage` marker contract used by the workshop scripts.
