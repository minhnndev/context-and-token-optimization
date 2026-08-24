import * as vscode from 'vscode';
import { calibrationSummary } from '../core/calibration';
import { formatRange } from '../core/sizing';
import { TaskRecord } from '../core/types';
import { LiveUsageService } from '../services/liveUsageService';
import { LocalStore } from '../services/localStore';

export class Dashboard implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly store: LocalStore,
    private readonly live: LiveUsageService,
    private readonly creditUsd: () => number,
  ) {
    this.subscription = live.onDidChange(() => this.render());
  }

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'tokenOptimization.dashboard',
      'Token Optimization',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage(async (message: { command?: string }) => {
      if (message.command) await vscode.commands.executeCommand(message.command);
    });
    this.render();
  }

  refresh(): void {
    this.render();
  }

  dispose(): void {
    this.subscription.dispose();
    this.panel?.dispose();
  }

  private render(): void {
    if (!this.panel) return;
    const nonce = getNonce();
    const active = this.store.activeTask();
    const tasks = this.store.allTasks();
    const completed = tasks.filter((task) => task.status === 'completed');
    const summary = calibrationSummary(completed);
    const usage = this.live.state.snapshot;
    const cacheReuse = usage && usage.totals.input > 0 ? usage.totals.cached / usage.totals.input : null;
    const credits = usage?.credits ?? 0;
    const perModel = usage?.perModel ?? [];
    const maxModelCredits = Math.max(1, ...perModel.map((model) => model.credits));
    const csp = this.panel.webview.cspSource;
    this.panel.webview.html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>Token Optimization</title>
  <style>${styles}</style>
</head>
<body>
  <header>
    <div>
      <div class="eyebrow">LOCAL-FIRST AI ECONOMICS</div>
      <h1>Token Optimization</h1>
      <p>Task sizing, live usage, cache continuity, and calibration for this workspace.</p>
    </div>
    <div class="actions">
      <button data-command="tokenOptimization.refreshUsage">Refresh</button>
      <button class="primary" data-command="${active ? 'tokenOptimization.completeTask' : 'tokenOptimization.startTask'}">${active ? 'Complete task' : 'Start task'}</button>
    </div>
  </header>

  ${this.live.state.error ? `<div class="notice"><strong>Usage provider unavailable.</strong> ${escapeHtml(this.live.state.error)}</div>` : ''}

  <main>
    <section class="grid metrics">
      ${metric('AI Credits', credits.toFixed(1), active ? 'Active task' : 'Current CLI session')}
      ${metric('Estimated Cost', `$${(credits * this.creditUsd()).toFixed(2)}`, `${formatMoney(this.creditUsd())} / credit`)}
      ${metric('Requests', String(perModel.reduce((sum, model) => sum + model.requests, 0)), `${perModel.length} model${perModel.length === 1 ? '' : 's'}`)}
      ${metric('Cache Reuse', cacheReuse == null ? '—' : `${Math.round(cacheReuse * 100)}%`, usage ? `${formatTokens(usage.totals.cached)} cached` : 'No data')}
    </section>

    <section class="grid two-column">
      <article class="card current">
        <div class="section-title"><span>Current task</span><span class="status ${active ? 'live' : ''}">${active ? 'ACTIVE' : 'IDLE'}</span></div>
        ${active ? currentTask(active, credits) : `
          <div class="empty">
            <div class="empty-icon">◎</div>
            <h2>No active task</h2>
            <p>Start with a description; Git scope and local calibration history shape the estimate.</p>
            <button class="primary" data-command="tokenOptimization.startTask">Start Task</button>
          </div>`}
      </article>

      <article class="card">
        <div class="section-title"><span>Token flow</span><span>${usage ? escapeHtml(shortSession(usage.sessionId)) : '—'}</span></div>
        ${tokenRow('Input', usage?.totals.input ?? 0, 'input')}
        ${tokenRow('Cached', usage?.totals.cached ?? 0, 'cached', usage?.totals.input)}
        ${tokenRow('Output', usage?.totals.output ?? 0, 'output')}
        ${tokenRow('Reasoning', usage?.totals.reasoning ?? 0, 'reasoning')}
        ${this.live.state.latestCache ? `<div class="cache-note">${escapeHtml(this.live.state.latestCache.transition)}${this.live.state.latestCache.significant ? ' · significant delta' : ''}</div>` : ''}
      </article>
    </section>

    <section class="grid two-column">
      <article class="card">
        <div class="section-title"><span>By model</span><span>CREDITS</span></div>
        ${perModel.length ? perModel.map((model) => `
          <div class="model-row">
            <div class="model-head"><span>${escapeHtml(model.model)}</span><strong>${model.credits.toFixed(1)} cr</strong></div>
            <div class="track"><div class="fill model" style="width:${Math.max(2, model.credits / maxModelCredits * 100)}%"></div></div>
            <div class="model-meta">${model.requests} requests · ${formatTokens(model.input)} in · ${formatTokens(model.cached)} cached</div>
          </div>`).join('') : '<p class="muted">No model usage recorded yet.</p>'}
      </article>

      <article class="card">
        <div class="section-title"><span>Calibration</span><span>${summary.rate == null ? 'NO DATA' : `${Math.round(summary.rate * 100)}% ON TARGET`}</span></div>
        ${summary.byBucket.length ? summary.byBucket.map((entry) => `
          <div class="calibration-row">
            <span class="bucket">${entry.bucket}</span>
            <div class="track"><div class="fill calibration" style="width:${entry.hits / entry.total * 100}%"></div></div>
            <span>${entry.hits}/${entry.total}</span>
          </div>`).join('') : '<p class="muted">Complete a task to begin local calibration.</p>'}
        <div class="calibration-total"><strong>${summary.hits}/${summary.recorded}</strong><span>overall on-target tasks</span></div>
      </article>
    </section>

    <section class="card history">
      <div class="section-title"><span>Recent tasks</span><span>${completed.length} COMPLETED</span></div>
      ${completed.length ? `<div class="history-list">${completed.slice(0, 8).map(historyRow).join('')}</div>` : '<p class="muted">History is stored locally in VS Code workspace storage. GitHub sync is opt-in.</p>'}
    </section>
  </main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-command]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command }));
    });
  </script>
</body>
</html>`;
  }
}

function metric(label: string, value: string, detail: string): string {
  return `<article class="card metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function currentTask(task: TaskRecord, actual: number): string {
  const max = task.estimate.max ?? Math.max(151, task.estimate.expectedCredits);
  const progress = Math.min(100, max > 0 ? actual / max * 100 : 0);
  return `<div class="task-body">
    <h2>${escapeHtml(task.description)}</h2>
    <div class="estimate-line"><span class="size">${task.estimate.bucket}</span><span>${formatRange(task.estimate.bucket)} credits</span><span>${Math.round(task.estimate.confidence * 100)}% confidence</span></div>
    <div class="task-progress"><div><span>Actual so far</span><strong>${actual.toFixed(1)} cr</strong></div><div class="track large"><div class="fill task" style="width:${progress}%"></div></div></div>
    <div class="drivers">${task.estimate.drivers.slice(0, 4).map((driver) => `<span>${escapeHtml(driver)}</span>`).join('')}</div>
    <div class="task-actions"><button data-command="tokenOptimization.syncTask">${task.github ? `Issue #${task.github.issueNumber}` : 'Create GitHub issue'}</button><button class="primary" data-command="tokenOptimization.completeTask">Complete</button></div>
  </div>`;
}

function tokenRow(label: string, value: number, kind: string, total?: number): string {
  const ratio = total && total > 0 ? Math.min(100, value / total * 100) : value > 0 ? 100 : 0;
  return `<div class="token-row"><div><span>${label}</span><strong>${formatTokens(value)}</strong></div><div class="track"><div class="fill ${kind}" style="width:${ratio}%"></div></div></div>`;
}

function historyRow(task: TaskRecord): string {
  const icon = task.verdict === 'on-target' ? '✓' : task.verdict === 'over' ? '↑' : task.verdict === 'under' ? '↓' : '?';
  return `<div class="history-row">
    <span class="verdict ${task.verdict}">${icon}</span>
    <div><strong>${escapeHtml(task.description)}</strong><small>${new Date(task.completedAt!).toLocaleDateString()} · ${task.usage?.files.length ?? 0} files${task.github ? ` · #${task.github.issueNumber}` : ''}</small></div>
    <span class="history-cost"><strong>${task.usage?.credits.toFixed(1) ?? '—'} cr</strong><small>${task.estimate.bucket} estimate</small></span>
  </div>`;
}

const styles = `
:root { color-scheme: light dark; --card: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-editor-foreground) 12%); --line: color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent); --accent: #8b5cf6; --teal: #2dd4bf; --amber: #f59e0b; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0 32px 48px; font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: radial-gradient(circle at 85% -20%, rgba(139,92,246,.18), transparent 35%), var(--vscode-editor-background); }
header { max-width: 1180px; margin: 0 auto; padding: 42px 0 28px; display: flex; align-items: end; justify-content: space-between; gap: 24px; }
h1 { font-size: 34px; margin: 6px 0 4px; letter-spacing: -.03em; } h2 { margin: 0 0 16px; font-size: 20px; } p { line-height: 1.5; } header p { margin: 0; opacity: .66; }
.eyebrow { color: var(--teal); font-size: 11px; font-weight: 800; letter-spacing: .18em; }
.actions, .task-actions { display: flex; gap: 9px; }
button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: 0; border-radius: 7px; padding: 9px 14px; cursor: pointer; font: inherit; font-weight: 600; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); } button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); } button.primary:hover { background: var(--vscode-button-hoverBackground); }
main, .notice { max-width: 1180px; margin: 0 auto; } .notice { border: 1px solid rgba(245,158,11,.5); background: rgba(245,158,11,.09); padding: 12px 15px; border-radius: 9px; margin-bottom: 16px; }
.grid { display: grid; gap: 14px; margin-bottom: 14px; } .metrics { grid-template-columns: repeat(4, minmax(0,1fr)); } .two-column { grid-template-columns: 1.15fr .85fr; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; box-shadow: 0 12px 34px rgba(0,0,0,.08); }
.metric { min-height: 132px; display: flex; flex-direction: column; justify-content: space-between; } .metric > span { opacity: .65; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; } .metric > strong { font-size: 28px; letter-spacing: -.03em; } .metric small, .model-meta, .history-row small { opacity: .58; }
.section-title { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 22px; font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; opacity: .68; }
.status { font-size: 10px; } .status.live { color: var(--teal); } .status.live:before { content: ''; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 10px var(--teal); }
.empty { text-align: center; padding: 24px; } .empty-icon { margin: auto auto 12px; font-size: 38px; color: var(--accent); } .empty p { max-width: 420px; margin: 0 auto 18px; opacity: .65; }
.estimate-line { display: flex; align-items: center; gap: 12px; opacity: .72; } .estimate-line .size { opacity: 1; color: white; background: var(--accent); border-radius: 6px; padding: 4px 8px; font-weight: 800; }
.task-progress { margin: 28px 0 22px; } .task-progress > div:first-child { display: flex; justify-content: space-between; margin-bottom: 9px; } .track { overflow: hidden; height: 6px; border-radius: 20px; background: color-mix(in srgb, var(--vscode-editor-foreground) 11%, transparent); } .track.large { height: 9px; } .fill { height: 100%; border-radius: inherit; background: var(--accent); } .fill.cached { background: var(--teal); } .fill.output { background: var(--amber); } .fill.reasoning { background: #ec4899; } .fill.task { background: linear-gradient(90deg, var(--teal), var(--accent)); } .fill.model { background: linear-gradient(90deg, var(--accent), #c084fc); } .fill.calibration { background: var(--teal); }
.drivers { display: flex; flex-wrap: wrap; gap: 7px; margin-bottom: 22px; } .drivers span { border: 1px solid var(--line); border-radius: 999px; padding: 5px 9px; font-size: 11px; opacity: .76; } .task-actions { justify-content: flex-end; }
.token-row { margin: 18px 0; } .token-row > div:first-child, .model-head { display: flex; justify-content: space-between; margin-bottom: 7px; } .cache-note { margin-top: 18px; padding: 9px; border-radius: 7px; background: rgba(45,212,191,.08); color: var(--teal); font-size: 12px; }
.model-row { margin: 18px 0 22px; } .model-meta { font-size: 11px; margin-top: 6px; }
.calibration-row { display: grid; grid-template-columns: 35px 1fr 36px; align-items: center; gap: 10px; margin: 16px 0; } .bucket { font-weight: 800; } .calibration-total { display: flex; gap: 10px; align-items: baseline; margin-top: 28px; border-top: 1px solid var(--line); padding-top: 16px; } .calibration-total strong { font-size: 23px; } .calibration-total span { opacity: .6; }
.history { margin-top: 14px; } .history-row { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 12px; padding: 12px 2px; border-top: 1px solid var(--line); } .history-row:first-child { border-top: 0; } .history-row > div { display: flex; flex-direction: column; gap: 4px; } .verdict { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: rgba(139,92,246,.16); } .verdict.on-target { color: var(--teal); background: rgba(45,212,191,.12); } .verdict.over { color: #f87171; } .verdict.under { color: #60a5fa; } .history-cost { text-align: right; display: flex; flex-direction: column; gap: 4px; }
.muted { opacity: .58; } @media (max-width: 800px) { body { padding: 0 16px 32px; } header { align-items: start; flex-direction: column; } .metrics { grid-template-columns: repeat(2,1fr); } .two-column { grid-template-columns: 1fr; } } @media (max-width: 470px) { .metrics { grid-template-columns: 1fr; } }
`;

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}

function formatMoney(value: number): string { return `$${value.toFixed(3)}`; }
function shortSession(value: string): string { return value.length > 12 ? `${value.slice(0, 8)}…` : value; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function getNonce(): string { return Array.from({ length: 24 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]).join(''); }
