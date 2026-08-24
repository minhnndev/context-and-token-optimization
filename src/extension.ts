import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { TaskCommands } from './commands/taskCommands';
import { getSetting } from './config';
import { GitProvider } from './providers/gitProvider';
import { GitHubProvider } from './providers/githubProvider';
import { SessionProvider } from './providers/sessionProvider';
import { LiveUsageService } from './services/liveUsageService';
import { LocalStore } from './services/localStore';
import { Dashboard } from './views/dashboard';
import { HistoryTreeProvider, SessionTreeProvider, TaskTreeProvider } from './views/treeProviders';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const storageRoot = context.storageUri?.fsPath ?? join(context.globalStorageUri.fsPath, workspaceKey(folder.uri));
  const storePath = join(storageRoot, 'tokenlens.json');
  const legacyExtensionStorage = context.storageUri
    ? join(dirname(storageRoot), 'token-optimization.token-optimization')
    : join(dirname(context.globalStorageUri.fsPath), 'token-optimization.token-optimization', workspaceKey(folder.uri));
  await LocalStore.migrate([
    join(storageRoot, 'token-optimization.json'),
    join(legacyExtensionStorage, 'token-optimization.json'),
  ], storePath);
  const store = new LocalStore(storePath);
  await store.initialize();

  const repositoryRoot = await GitProvider.discoverRoot(folder.uri.fsPath);
  const git = new GitProvider(repositoryRoot);
  const session = new SessionProvider(repositoryRoot);
  const github = new GitHubProvider();
  const live = new LiveUsageService(session, store);
  const creditUsd = () => getSetting('creditUsd', 0.01);
  const dashboard = new Dashboard(store, live, creditUsd);
  const appStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 91);
  appStatus.command = 'tokenLens.openMetrics';
  appStatus.name = 'TokenLens';
  appStatus.show();

  const sessionTree = new SessionTreeProvider(live, creditUsd);
  const taskTree = new TaskTreeProvider(store, live);
  const historyTree = new HistoryTreeProvider(store);
  const refreshViews = () => {
    sessionTree.refresh();
    taskTree.refresh();
    historyTree.refresh();
    dashboard.refresh();
    updateStatus(appStatus, live, store.activeTask() != null, creditUsd());
  };
  const commands = new TaskCommands(store, git, session, live, github, refreshViews);

  context.subscriptions.push(
    live,
    dashboard,
    appStatus,
    vscode.window.registerTreeDataProvider('tokenLens.session', sessionTree),
    vscode.window.registerTreeDataProvider('tokenLens.task', taskTree),
    vscode.window.registerTreeDataProvider('tokenLens.history', historyTree),
    vscode.commands.registerCommand('tokenLens.startTask', () => commands.estimate(true)),
    vscode.commands.registerCommand('tokenLens.estimateTask', () => commands.estimate(false)),
    vscode.commands.registerCommand('tokenLens.completeTask', () => commands.complete()),
    vscode.commands.registerCommand('tokenLens.syncTask', () => commands.sync()),
    vscode.commands.registerCommand('tokenLens.refreshUsage', async () => {
      await live.refresh();
      refreshViews();
      if (live.state.error) {
        await vscode.window.showWarningMessage(`TokenLens: ${live.state.error}`);
      }
    }),
    vscode.commands.registerCommand('tokenLens.openMetrics', () => dashboard.show()),
    vscode.commands.registerCommand('tokenLens.openHistory', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.tokenLens');
      await vscode.commands.executeCommand('tokenLens.history.focus');
    }),
    vscode.commands.registerCommand('tokenLens.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:minhnndev.tokenlens-for-copilot')),
    ...registerLegacyCommandAliases(),
    live.onDidChange(() => refreshViews()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('tokenLens.pollIntervalSeconds') || event.affectsConfiguration('tokenOptimization.pollIntervalSeconds')) live.restart();
      if (event.affectsConfiguration('tokenLens.significantCacheDeltaTokens') || event.affectsConfiguration('tokenOptimization.significantCacheDeltaTokens')) live.resetCacheObserver();
      if (event.affectsConfiguration('tokenLens') || event.affectsConfiguration('tokenOptimization')) refreshViews();
    }),
  );

  updateStatus(appStatus, live, store.activeTask() != null, creditUsd());
  live.start();
}

export function deactivate(): void {}

function updateStatus(
  status: vscode.StatusBarItem,
  live: LiveUsageService,
  activeTask: boolean,
  creditUsd: number,
): void {
  const usage = live.state.snapshot;
  if (usage) {
    status.text = `$(zap) AI · ${usage.credits.toFixed(1)} cr`;
    const latestCache = live.state.latestCache;
    const sessionReuse = usage.totals.input > 0 ? usage.totals.cached / usage.totals.input : null;
    const currentReuse = latestCache?.reuseRate ?? sessionReuse;
    const currentInput = latestCache?.inputTokens ?? usage.totals.input;
    const currentCached = latestCache?.cacheReadTokens ?? usage.totals.cached;
    const requests = usage.perModel.reduce((sum, model) => sum + model.requests, 0);
    const models = usage.perModel.map((model) => `${model.model} (${model.requests})`).join(', ') || 'No model usage yet';
    const tooltip = new vscode.MarkdownString();
    configureTooltip(tooltip);
    tooltip.appendMarkdown('**TokenLens live usage**\n\n');
    tooltip.appendMarkdown('**Current cache reuse**\n\n');
    tooltip.appendMarkdown(`\`${cacheBar(currentReuse)} ${formatPercentage(currentReuse)}\`\n\n`);
    tooltip.appendMarkdown(`${formatTokens(currentCached ?? 0)} / ${formatTokens(currentInput ?? 0)} tokens reused\n\n`);
    if (latestCache) {
      tooltip.appendMarkdown('**Current configuration**\n\n');
      tooltip.appendMarkdown(`${escapeMarkdown(latestCache.model)} · ${escapeMarkdown(formatReasoning(latestCache.reasoningEffort))}\n\n`);
      tooltip.appendMarkdown(`${escapeMarkdown(formatTransition(latestCache.transition))}\n\n`);
      if (latestCache.cacheDelta != null) {
        tooltip.appendMarkdown(`**Last cache change:** ${formatSignedTokens(latestCache.cacheDelta)}\n\n`);
      }
    }
    tooltip.appendMarkdown(`**${activeTask ? 'Current task' : 'Session'} totals**\n\n`);
    tooltip.appendMarkdown('| Metric | Value |\n|---|---:|\n');
    tooltip.appendMarkdown(`| AI credits | **${usage.credits.toFixed(1)} cr** |\n`);
    tooltip.appendMarkdown(`| Estimated cost | **$${(usage.credits * creditUsd).toFixed(2)}** |\n`);
    tooltip.appendMarkdown(`| Turns / requests | ${requests} |\n`);
    tooltip.appendMarkdown(`| Total input | ${formatTokens(usage.totals.input)} |\n`);
    tooltip.appendMarkdown(`| Total cached | ${formatTokens(usage.totals.cached)} |\n`);
    tooltip.appendMarkdown(`| Average reuse | ${formatPercentage(sessionReuse)} |\n`);
    tooltip.appendMarkdown(`| Total output | ${formatTokens(usage.totals.output)} |\n\n`);
    tooltip.appendMarkdown(`**Models:** ${escapeMarkdown(models)}\n\n`);
    tooltip.appendMarkdown(
      '[$(graph-line) Open Metrics](command:tokenLens.openMetrics)  ' +
      '[$(history) View History](command:tokenLens.openHistory)  ' +
      '[$(refresh) Refresh](command:tokenLens.refreshUsage)\n\n',
    );
    tooltip.appendMarkdown('_Click the status item to open Metrics._');
    status.tooltip = tooltip;
    status.backgroundColor = undefined;
  } else if (live.state.error) {
    status.text = '$(zap) AI · —';
    const tooltip = new vscode.MarkdownString();
    configureTooltip(tooltip);
    tooltip.appendMarkdown('**TokenLens usage unavailable**\n\n');
    tooltip.appendText(live.state.error);
    tooltip.appendMarkdown(
      '\n\n[$(refresh) Refresh](command:tokenLens.refreshUsage)  ' +
      '[$(graph-line) Open Metrics](command:tokenLens.openMetrics)',
    );
    status.tooltip = tooltip;
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    status.text = '$(zap) AI · …';
    const tooltip = new vscode.MarkdownString('**TokenLens**\n\nReading Copilot CLI usage…\n\n');
    configureTooltip(tooltip);
    tooltip.appendMarkdown(
      '[$(refresh) Refresh](command:tokenLens.refreshUsage)  ' +
      '[$(graph-line) Open Metrics](command:tokenLens.openMetrics)',
    );
    status.tooltip = tooltip;
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}

function formatSignedTokens(value: number): string {
  return `${value >= 0 ? '+' : '-'}${formatTokens(Math.abs(value))} cached tokens`;
}

function formatPercentage(value: number | null): string {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function cacheBar(value: number | null, width = 20): string {
  if (value == null) return '░'.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round(value * width)));
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

function formatReasoning(value: string): string {
  if (!value || value === 'unavailable') return 'Reasoning unavailable';
  return `${value[0].toUpperCase()}${value.slice(1)} reasoning`;
}

function formatTransition(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
}

function configureTooltip(tooltip: vscode.MarkdownString): void {
  tooltip.supportThemeIcons = true;
  tooltip.isTrusted = {
    enabledCommands: ['tokenLens.openMetrics', 'tokenLens.openHistory', 'tokenLens.refreshUsage'],
  };
}

function workspaceKey(uri: vscode.Uri): string {
  return Buffer.from(uri.toString()).toString('base64url').slice(0, 32);
}

function registerLegacyCommandAliases(): vscode.Disposable[] {
  const aliases: Array<[string, string]> = [
    ['tokenOptimization.startTask', 'tokenLens.startTask'],
    ['tokenOptimization.estimateTask', 'tokenLens.estimateTask'],
    ['tokenOptimization.completeTask', 'tokenLens.completeTask'],
    ['tokenOptimization.syncTask', 'tokenLens.syncTask'],
    ['tokenOptimization.refreshUsage', 'tokenLens.refreshUsage'],
    ['tokenOptimization.openSettings', 'tokenLens.openSettings'],
    ['tokenOptimization.showUsagePopup', 'tokenLens.openMetrics'],
    ['tokenOptimization.showDashboard', 'tokenLens.openMetrics'],
    ['tokenLens.showUsagePopup', 'tokenLens.openMetrics'],
    ['tokenLens.showDashboard', 'tokenLens.openMetrics'],
  ];
  return aliases.map(([legacy, current]) => vscode.commands.registerCommand(
    legacy,
    (...args: unknown[]) => vscode.commands.executeCommand(current, ...args),
  ));
}
