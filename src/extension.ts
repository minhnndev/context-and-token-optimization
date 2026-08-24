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
import { UsagePopup } from './views/usagePopup';

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
  const usagePopup = new UsagePopup(store, live, creditUsd);
  const appStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 91);
  appStatus.command = 'tokenLens.showUsagePopup';
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
    usagePopup,
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
    vscode.commands.registerCommand('tokenLens.showUsagePopup', () => usagePopup.show()),
    vscode.commands.registerCommand('tokenLens.showDashboard', () => dashboard.show()),
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
    status.text = `$(sparkle) AI - ${usage.credits.toFixed(1)} cr`;
    const cache = usage.totals.input > 0 ? Math.round(usage.totals.cached / usage.totals.input * 100) : null;
    const requests = usage.perModel.reduce((sum, model) => sum + model.requests, 0);
    const models = usage.perModel.map((model) => `${model.model} (${model.requests})`).join(', ') || 'No model usage yet';
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**TokenLens live usage**\n\n');
    tooltip.appendMarkdown(`${activeTask ? 'Current task' : 'Current Copilot CLI session'}\n\n`);
    tooltip.appendMarkdown('| Metric | Value |\n|---|---:|\n');
    tooltip.appendMarkdown(`| AI credits | **${usage.credits.toFixed(1)} cr** |\n`);
    tooltip.appendMarkdown(`| Estimated cost | **$${(usage.credits * creditUsd).toFixed(2)}** |\n`);
    tooltip.appendMarkdown(`| Input | ${formatTokens(usage.totals.input)} |\n`);
    tooltip.appendMarkdown(`| Cached | ${formatTokens(usage.totals.cached)} (${cache == null ? 'n/a' : `${cache}%`}) |\n`);
    tooltip.appendMarkdown(`| Output | ${formatTokens(usage.totals.output)} |\n`);
    tooltip.appendMarkdown(`| Model requests | ${requests} |\n\n`);
    tooltip.appendMarkdown(`**Models:** ${escapeMarkdown(models)}\n\n`);
    tooltip.appendMarkdown('_Click the status item to open the interactive popup._');
    status.tooltip = tooltip;
    status.backgroundColor = undefined;
  } else if (live.state.error) {
    status.text = '$(sparkle) AI - —';
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**TokenLens usage unavailable**\n\n');
    tooltip.appendText(live.state.error);
    tooltip.appendMarkdown('\n\n_Click to open the TokenLens popup._');
    status.tooltip = tooltip;
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    status.text = '$(sparkle) AI - …';
    status.tooltip = new vscode.MarkdownString('**TokenLens**\n\nReading Copilot CLI usage…\n\n_Click to open the popup._');
  }
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
}

function workspaceKey(uri: vscode.Uri): string {
  return Buffer.from(uri.toString()).toString('base64url').slice(0, 32);
}

function registerLegacyCommandAliases(): vscode.Disposable[] {
  const aliases = [
    'startTask', 'estimateTask', 'completeTask', 'syncTask',
    'refreshUsage', 'showUsagePopup', 'showDashboard', 'openSettings',
  ];
  return aliases.map((name) => vscode.commands.registerCommand(
    `tokenOptimization.${name}`,
    (...args: unknown[]) => vscode.commands.executeCommand(`tokenLens.${name}`, ...args),
  ));
}
