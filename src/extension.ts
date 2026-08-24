import { join } from 'node:path';
import * as vscode from 'vscode';
import { TaskCommands } from './commands/taskCommands';
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
  const store = new LocalStore(join(storageRoot, 'token-optimization.json'));
  await store.initialize();

  const repositoryRoot = await GitProvider.discoverRoot(folder.uri.fsPath);
  const git = new GitProvider(repositoryRoot);
  const session = new SessionProvider(repositoryRoot);
  const github = new GitHubProvider();
  const live = new LiveUsageService(session, store);
  const creditUsd = () => vscode.workspace.getConfiguration('tokenOptimization').get<number>('creditUsd', 0.01);
  const dashboard = new Dashboard(store, live, creditUsd);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  status.command = 'tokenOptimization.showDashboard';
  status.name = 'Token Optimization';
  status.show();

  const sessionTree = new SessionTreeProvider(live, creditUsd);
  const taskTree = new TaskTreeProvider(store, live);
  const historyTree = new HistoryTreeProvider(store);
  const refreshViews = () => {
    sessionTree.refresh();
    taskTree.refresh();
    historyTree.refresh();
    dashboard.refresh();
    updateStatus(status, live, store.activeTask() != null);
  };
  const commands = new TaskCommands(store, git, session, live, github, refreshViews);

  context.subscriptions.push(
    live,
    dashboard,
    status,
    vscode.window.registerTreeDataProvider('tokenOptimization.session', sessionTree),
    vscode.window.registerTreeDataProvider('tokenOptimization.task', taskTree),
    vscode.window.registerTreeDataProvider('tokenOptimization.history', historyTree),
    vscode.commands.registerCommand('tokenOptimization.startTask', () => commands.estimate(true)),
    vscode.commands.registerCommand('tokenOptimization.estimateTask', () => commands.estimate(false)),
    vscode.commands.registerCommand('tokenOptimization.completeTask', () => commands.complete()),
    vscode.commands.registerCommand('tokenOptimization.syncTask', () => commands.sync()),
    vscode.commands.registerCommand('tokenOptimization.refreshUsage', async () => {
      await live.refresh();
      refreshViews();
      if (live.state.error) {
        await vscode.window.showWarningMessage(`Token Optimization: ${live.state.error}`);
      }
    }),
    vscode.commands.registerCommand('tokenOptimization.showDashboard', () => dashboard.show()),
    vscode.commands.registerCommand('tokenOptimization.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:token-optimization.token-optimization')),
    live.onDidChange(() => refreshViews()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('tokenOptimization.pollIntervalSeconds')) live.restart();
      if (event.affectsConfiguration('tokenOptimization.significantCacheDeltaTokens')) live.resetCacheObserver();
      if (event.affectsConfiguration('tokenOptimization')) refreshViews();
    }),
  );

  updateStatus(status, live, store.activeTask() != null);
  live.start();
}

export function deactivate(): void {}

function updateStatus(
  status: vscode.StatusBarItem,
  live: LiveUsageService,
  activeTask: boolean,
): void {
  const usage = live.state.snapshot;
  if (usage) {
    status.text = `$(sparkle) AI ${usage.credits.toFixed(1)} cr`;
    const cache = usage.totals.input > 0 ? Math.round(usage.totals.cached / usage.totals.input * 100) : null;
    status.tooltip = `${activeTask ? 'Current task' : 'Current Copilot CLI session'}\n` +
      `${usage.totals.input.toLocaleString('en-US')} input · ${usage.totals.output.toLocaleString('en-US')} output\n` +
      `Cache reuse: ${cache == null ? 'n/a' : `${cache}%`}`;
    status.backgroundColor = undefined;
  } else if (live.state.error) {
    status.text = '$(sparkle) AI —';
    status.tooltip = live.state.error;
    status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    status.text = '$(sparkle) AI …';
    status.tooltip = 'Reading Copilot CLI usage…';
  }
}

function workspaceKey(uri: vscode.Uri): string {
  return Buffer.from(uri.toString()).toString('base64url').slice(0, 32);
}
