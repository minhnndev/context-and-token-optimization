import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { TaskCommands } from './commands/taskCommands';
import { getSetting } from './config';
import type { CacheTransition, CacheTurn } from './core/cache';
import type { UsageSnapshot } from './core/types';
import { GitProvider } from './providers/gitProvider';
import { GitHubProvider } from './providers/githubProvider';
import { SessionProvider } from './providers/sessionProvider';
import { LiveUsageService } from './services/liveUsageService';
import { LocalStore } from './services/localStore';
import { Dashboard } from './views/dashboard';
import { HistoryTreeProvider, SessionTreeProvider, TaskTreeProvider } from './views/treeProviders';

const execFileAsync = promisify(execFile);

interface ExtensionRuntime {
  commands: TaskCommands;
  dashboard: Dashboard;
  live: LiveUsageService;
  repositoryRoot: string;
  session: SessionProvider;
}

interface ActivationState {
  folder?: vscode.WorkspaceFolder;
  issue?: string;
  runtime?: ExtensionRuntime;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const state: ActivationState = {};
  const output = vscode.window.createOutputChannel('TokenLens');
  const appStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 91);
  appStatus.name = 'TokenLens';
  appStatus.command = 'tokenLens.checkSetup';
  appStatus.show();

  context.subscriptions.push(
    output,
    appStatus,
    ...registerUserCommands(state, output),
  );

  const folder = vscode.workspace.workspaceFolders?.[0];
  state.folder = folder;
  if (!folder) {
    state.issue = 'Open a filesystem workspace folder before starting a task.';
    updateSetupStatus(appStatus, state.issue);
    return;
  }

  try {
    const storageRoot = context.storageUri?.fsPath ?? join(context.globalStorageUri.fsPath, workspaceKey(folder.uri));
    const storePath = join(storageRoot, 'tokenlens.json');
    const store = new LocalStore(storePath);
    await store.initialize();

    const repositoryRoot = await GitProvider.discoverRoot(folder.uri.fsPath);
    const git = new GitProvider(repositoryRoot);
    const session = new SessionProvider(repositoryRoot);
    const github = new GitHubProvider();
    const live = new LiveUsageService(session, store);
    const creditUsd = () => getSetting('creditUsd', 0.01);
    const dashboard = new Dashboard(store, live, creditUsd);

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
    state.runtime = { commands, dashboard, live, repositoryRoot, session };

    context.subscriptions.push(
      live,
      dashboard,
      vscode.window.registerTreeDataProvider('tokenLens.session', sessionTree),
      vscode.window.registerTreeDataProvider('tokenLens.task', taskTree),
      vscode.window.registerTreeDataProvider('tokenLens.history', historyTree),
      live.onDidChange(() => refreshViews()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('tokenLens.pollIntervalSeconds')) live.restart();
        if (event.affectsConfiguration('tokenLens.significantCacheDeltaTokens')) live.resetCacheObserver();
        if (event.affectsConfiguration('tokenLens')) refreshViews();
      }),
    );

    updateStatus(appStatus, live, store.activeTask() != null, creditUsd());
    live.start();
    output.appendLine(`TokenLens activated for ${repositoryRoot}`);
  } catch (error) {
    state.runtime = undefined;
    state.issue = `Initialization failed: ${errorMessage(error)}`;
    output.appendLine(state.issue);
    output.appendLine(errorStack(error));
    updateSetupStatus(appStatus, state.issue);
    const selection = await vscode.window.showErrorMessage(
      `TokenLens could not initialize. ${errorMessage(error)}`,
      'Check Setup',
      'Show Logs',
    );
    if (selection === 'Check Setup') await vscode.commands.executeCommand('tokenLens.checkSetup');
    if (selection === 'Show Logs') output.show(true);
  }
}

export function deactivate(): void {}

function registerUserCommands(
  state: ActivationState,
  output: vscode.OutputChannel,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('tokenLens.startTask', () => runWithRuntime(
      state,
      output,
      'Start Task',
      (runtime) => runtime.commands.estimate(true),
    )),
    vscode.commands.registerCommand('tokenLens.estimateTask', () => runWithRuntime(
      state,
      output,
      'Estimate Task',
      (runtime) => runtime.commands.estimate(false),
    )),
    vscode.commands.registerCommand('tokenLens.completeTask', () => runWithRuntime(
      state,
      output,
      'Complete Task',
      (runtime) => runtime.commands.complete(),
    )),
    vscode.commands.registerCommand('tokenLens.syncTask', () => runWithRuntime(
      state,
      output,
      'Sync Task',
      (runtime) => runtime.commands.sync(),
    )),
    vscode.commands.registerCommand('tokenLens.refreshUsage', () => runWithRuntime(
      state,
      output,
      'Refresh Usage',
      async (runtime) => {
        await runtime.live.refresh();
        if (runtime.live.state.error) {
          await vscode.window.showWarningMessage(
            `TokenLens live metrics: ${runtime.live.state.error}`,
            'Check Setup',
          ).then((selection) => selection === 'Check Setup'
            ? vscode.commands.executeCommand('tokenLens.checkSetup')
            : undefined);
        }
      },
    )),
    vscode.commands.registerCommand('tokenLens.openMetrics', () => runWithRuntime(
      state,
      output,
      'Open Metrics',
      (runtime) => runtime.dashboard.show(),
    )),
    vscode.commands.registerCommand('tokenLens.showOptimizationTips', () => runWithRuntime(
      state,
      output,
      'Optimization Tips',
      async (runtime) => {
        const tips = optimizationTips(runtime.live);
        const selected = await vscode.window.showQuickPick(tips, {
          title: 'TokenLens Optimization Tips',
          placeHolder: 'Evidence-based suggestions from the current session',
          ignoreFocusOut: true,
        });
        if (selected?.detail) await vscode.window.showInformationMessage(selected.detail);
      },
    )),
    vscode.commands.registerCommand('tokenLens.openHistory', () => runWithRuntime(
      state,
      output,
      'Open History',
      async () => {
        await vscode.commands.executeCommand('workbench.view.extension.tokenLens');
        await vscode.commands.executeCommand('tokenLens.history.focus');
      },
    )),
    vscode.commands.registerCommand('tokenLens.checkSetup', () => showSetupDiagnostics(state, output)),
    vscode.commands.registerCommand('tokenLens.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:minhnndev.tokenlens-for-copilot')),
  ];
}

async function runWithRuntime(
  state: ActivationState,
  output: vscode.OutputChannel,
  label: string,
  action: (runtime: ExtensionRuntime) => void | Promise<unknown>,
): Promise<void> {
  if (!state.runtime) {
    const reason = state.issue ?? 'TokenLens is still initializing.';
    const selection = await vscode.window.showWarningMessage(
      `TokenLens: ${reason}`,
      'Check Setup',
      'Show Logs',
    );
    if (selection === 'Check Setup') await vscode.commands.executeCommand('tokenLens.checkSetup');
    if (selection === 'Show Logs') output.show(true);
    return;
  }
  try {
    await action(state.runtime);
  } catch (error) {
    output.appendLine(`${label} failed: ${errorMessage(error)}`);
    output.appendLine(errorStack(error));
    const selection = await vscode.window.showErrorMessage(
      `TokenLens: ${label} failed. ${errorMessage(error)}`,
      'Check Setup',
      'Show Logs',
    );
    if (selection === 'Check Setup') await vscode.commands.executeCommand('tokenLens.checkSetup');
    if (selection === 'Show Logs') output.show(true);
  }
}

async function showSetupDiagnostics(
  state: ActivationState,
  output: vscode.OutputChannel,
): Promise<void> {
  const folder = state.folder ?? vscode.workspace.workspaceFolders?.[0];
  const dbPath = join(homedir(), '.copilot', 'session-store.db');
  const remoteName = vscode.env.remoteName;
  const gitVersion = await executableVersion('git', ['--version']);
  const copilotVersion = await executableVersion('copilot', ['--version']);
  let sqliteAvailable = true;
  try {
    await import('node:sqlite');
  } catch {
    sqliteAvailable = false;
  }

  let repositoryRoot = state.runtime?.repositoryRoot;
  if (!repositoryRoot && folder) repositoryRoot = await GitProvider.discoverRoot(folder.uri.fsPath);
  let matchingSession = false;
  let sessionError: string | undefined;
  if (repositoryRoot && existsSync(dbPath) && sqliteAvailable) {
    try {
      const provider = state.runtime?.session ?? new SessionProvider(repositoryRoot);
      matchingSession = await provider.currentCursor() != null;
    } catch (error) {
      sessionError = errorMessage(error);
    }
  }

  const taskReady = state.runtime != null;
  const liveReady = taskReady && existsSync(dbPath) && sqliteAvailable && matchingSession && !sessionError;
  const lines = [
    '',
    `TokenLens setup check — ${new Date().toLocaleString()}`,
    '────────────────────────────────────────',
    diagnosticLine(folder != null, 'Workspace folder', folder?.uri.toString() ?? 'not open'),
    diagnosticLine(vscode.workspace.isTrusted, 'Workspace trust', vscode.workspace.isTrusted ? 'trusted' : 'Restricted Mode'),
    diagnosticLine(folder != null && (folder.uri.scheme === 'file' || remoteName != null), 'Filesystem workspace', folder?.uri.scheme ?? 'none'),
    diagnosticLine(state.runtime != null, 'Extension runtime', state.runtime ? 'initialized' : state.issue ?? 'not initialized'),
    diagnosticLine(gitVersion != null, 'Git', gitVersion ?? 'not found in the extension host PATH'),
    diagnosticLine(sqliteAvailable, 'SQLite support', sqliteAvailable ? `available · Node ${process.versions.node}` : `node:sqlite unavailable · Node ${process.versions.node}`),
    diagnosticLine(copilotVersion != null, 'Copilot CLI', copilotVersion ?? 'command not found in the extension host PATH'),
    diagnosticLine(existsSync(dbPath), 'Copilot session store', existsSync(dbPath) ? dbPath : `not found at ${dbPath}`),
    diagnosticLine(matchingSession, 'Matching Copilot session', matchingSession ? repositoryRoot ?? 'found' : sessionError ?? `none for ${repositoryRoot ?? 'this workspace'}`),
    '',
    `VS Code: ${vscode.version}`,
    `Extension host: ${remoteName ? `remote (${remoteName})` : 'local'}`,
    `Repository root: ${repositoryRoot ?? 'unavailable'}`,
    `Task workflow: ${taskReady ? 'READY' : 'BLOCKED'}`,
    `Live metrics: ${liveReady ? 'READY' : 'WAITING'}`,
  ];
  if (remoteName) {
    lines.push('', `Note: Copilot CLI and ${dbPath} must exist on the ${remoteName} host, not only on the local device.`);
  }
  if (!existsSync(dbPath) || !matchingSession) {
    lines.push('', 'To enable live metrics, start Copilot CLI inside this repository and complete at least one request. Installing the CLI alone does not create a matching session.');
  }
  output.appendLine(lines.join('\n'));

  const summary = taskReady
    ? liveReady
      ? 'TokenLens task workflow and live metrics are ready.'
      : 'TokenLens task workflow is ready. Live metrics still need a matching Copilot CLI session.'
    : `TokenLens task workflow is blocked. ${state.issue ?? 'See setup details.'}`;
  const show = taskReady && liveReady
    ? vscode.window.showInformationMessage(summary, 'Show Details')
    : vscode.window.showWarningMessage(summary, 'Show Details');
  if (await show === 'Show Details') output.show(true);
}

async function executableVersion(command: string, args: string[]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      encoding: 'utf8',
      timeout: 5_000,
    });
    return String(stdout || stderr).trim() || 'available';
  } catch {
    return undefined;
  }
}

function diagnosticLine(ok: boolean, label: string, detail: string): string {
  return `${ok ? '✓' : '⚠'} ${label}: ${detail}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string {
  return error instanceof Error && error.stack ? error.stack : String(error);
}

function updateSetupStatus(status: vscode.StatusBarItem, issue: string): void {
  status.text = '$(warning) AI · Setup';
  status.command = 'tokenLens.checkSetup';
  status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  const tooltip = new vscode.MarkdownString();
  configureTooltip(tooltip);
  tooltip.appendMarkdown('**TokenLens setup required**\n\n');
  tooltip.appendText(issue);
  tooltip.appendMarkdown('\n\n[$(tools) Check Setup](command:tokenLens.checkSetup)');
  status.tooltip = tooltip;
}

function updateStatus(
  status: vscode.StatusBarItem,
  live: LiveUsageService,
  activeTask: boolean,
  creditUsd: number,
): void {
  status.command = 'tokenLens.openMetrics';
  const context = liveTooltipContext(live, activeTask, creditUsd);
  if (context) {
    const warning = isOptimizationWarning(context.latestCache?.transition, context.currentReuse);
    status.text = `${warning ? '$(warning)' : '$(pulse)'} AI · ${context.usage.credits.toFixed(1)} cr`;
    const tooltip = new vscode.MarkdownString();
    configureTooltip(tooltip);
    tooltip.appendMarkdown(renderLiveTooltip(context));
    tooltip.appendMarkdown(
      '[$(graph-line) Metrics](command:tokenLens.openMetrics)&nbsp;&nbsp;&nbsp;&nbsp;' +
      '[$(lightbulb) Optimization Tips](command:tokenLens.showOptimizationTips)',
    );
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
      '[$(tools) Check Setup](command:tokenLens.checkSetup)  ' +
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

function formatPercentage(value: number | null): string {
  return value == null ? 'n/a' : `${Math.round(value * 100)}%`;
}

interface LiveTooltipContext {
  activeTask: boolean;
  creditUsd: number;
  currentCached: number | null;
  currentInput: number | null;
  currentReuse: number | null;
  latestCache?: CacheTurn;
  requests: number;
  sessionReuse: number | null;
  usage: UsageSnapshot;
}

function liveTooltipContext(
  live: LiveUsageService,
  activeTask: boolean,
  creditUsd: number,
): LiveTooltipContext | undefined {
  const usage = live.state.snapshot;
  if (!usage) return undefined;
  const latestCache = live.state.latestCache;
  const sessionReuse = usage.totals.input > 0 ? usage.totals.cached / usage.totals.input : null;
  return {
    activeTask,
    creditUsd,
    currentCached: latestCache?.cacheReadTokens ?? usage.totals.cached,
    currentInput: latestCache?.inputTokens ?? usage.totals.input,
    currentReuse: latestCache?.reuseRate ?? sessionReuse,
    latestCache,
    requests: usage.perModel.reduce((sum, model) => sum + model.requests, 0),
    sessionReuse,
    usage,
  };
}

function renderLiveTooltip(context: LiveTooltipContext): string {
  const {
    activeTask,
    creditUsd,
    currentCached,
    currentInput,
    currentReuse,
    latestCache,
    requests,
    sessionReuse,
    usage,
  } = context;
  const cacheTrend = latestCache && requests > 1 && currentReuse != null && sessionReuse != null
    ? currentReuse - sessionReuse
    : null;
  const averageCredits = requests > 0 ? usage.credits / requests : null;
  const costTrend = latestCache && requests > 1 && averageCredits && averageCredits > 0
    ? latestCache.credits / averageCredits - 1
    : null;
  const costPerRequest = latestCache
    ? latestCache.credits * creditUsd
    : requests > 0 ? usage.credits * creditUsd / requests : null;
  const comparisonLabel = activeTask ? 'task average' : 'session average';
  const configuration = configurationPresentation(latestCache);
  const insight = optimizationInsight(
    latestCache?.transition,
    currentReuse,
    cacheTrend,
    costTrend,
    comparisonLabel,
  );
  const cacheSignal = cacheTrend == null
    ? formatPercentage(currentReuse)
    : `${formatTrend(cacheTrend, 'points')} vs ${comparisonLabel}`;
  const costSignal = costTrend == null
    ? costPerRequest == null ? 'n/a' : `$${costPerRequest.toFixed(2)}`
    : `${formatTrend(costTrend, 'percent')} vs ${comparisonLabel}`;

  return [
    '**TokenLens** &nbsp; `● Live`',
    '',
    `_${activeTask ? 'Current task' : 'Current session'} optimization snapshot_`,
    '',
    '---',
    '',
    `**Cache reuse** &nbsp; **${formatPercentage(currentReuse)}**`,
    '',
    cacheProgressMarkdown(currentReuse),
    '',
    `${formatTokens(currentCached ?? 0)} / ${formatTokens(currentInput ?? 0)} tokens reused`,
    cacheTrend == null ? '' : `${formatTrend(cacheTrend, 'points')} vs ${comparisonLabel}`,
    '',
    '---',
    '',
    `**${configuration.icon} ${escapeMarkdown(configuration.label)}**`,
    '',
    escapeMarkdown(configuration.detail),
    '',
    '---',
    '',
    `**${activeTask ? 'Current task' : 'Session'}**`,
    '',
    '| Metric | Value |',
    '|:---|---:|',
    `| Input | ${formatTokens(usage.totals.input)} |`,
    `| Cached | ${formatTokens(usage.totals.cached)} |`,
    `| Output | ${formatTokens(usage.totals.output)} |`,
    `| Requests | ${requests.toLocaleString('en-US')} |`,
    `| **Cost** | **$${(usage.credits * creditUsd).toFixed(2)}** |`,
    `| **AI credits** | **${usage.credits.toFixed(1)}** |`,
    '',
    '---',
    '',
    '**Optimization**',
    '',
    '| Signal | Current |',
    '|:---|---:|',
    `| Cache reuse | ${escapeMarkdown(cacheSignal)} |`,
    `| Cost / request | ${escapeMarkdown(costSignal)} |`,
    '',
    `> ${insight.icon} ${escapeMarkdown(insight.message)}`,
    '',
    '---',
    '',
  ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

function cacheProgressMarkdown(value: number | null): string {
  const percentage = value == null
    ? 0
    : Math.max(0, Math.min(100, Math.round(value * 100)));
  const fillWidth = Math.round(320 * percentage / 100);
  const label = formatPercentage(value);
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="10" viewBox="0 0 320 10">',
    '<rect width="320" height="10" rx="5" fill="#7f7f7f" fill-opacity="0.28"/>',
    `<rect width="${fillWidth}" height="10" rx="5" fill="#3794ff"/>`,
    '</svg>',
  ].join('');
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  return `![Cache reuse ${label}](${dataUri})`;
}

function formatTrend(delta: number, unit: 'points' | 'percent'): string {
  const rounded = Math.round(Math.abs(delta) * 100);
  if (rounded === 0) return '→ About average';
  const arrow = delta > 0 ? '↑' : '↓';
  return `${arrow} ${rounded}${unit === 'points' ? ' pts' : '%'}`;
}

function configurationPresentation(turn: CacheTurn | undefined): {
  icon: string;
  label: string;
  detail: string;
} {
  if (!turn) {
    return {
      icon: '○',
      label: 'Configuration unavailable',
      detail: 'Waiting for the next request',
    };
  }
  const current = `${turn.model} · ${formatReasoning(turn.reasoningEffort)}`;
  if (turn.transition === 'baseline' || turn.transition === 'same configuration') {
    return {
      icon: '✓',
      label: turn.transition === 'baseline' ? 'Configuration observed' : 'Stable configuration',
      detail: current,
    };
  }
  if (turn.transition === 'model changed') {
    return {
      icon: '⚠',
      label: 'Model changed',
      detail: `${turn.previousModel ?? 'Previous model'} → ${turn.model} · ${formatReasoning(turn.reasoningEffort)}`,
    };
  }
  if (turn.transition === 'reasoning changed') {
    return {
      icon: '⚠',
      label: 'Reasoning changed',
      detail: `${turn.model} · ${formatReasoning(turn.previousReasoningEffort)} → ${formatReasoning(turn.reasoningEffort)}`,
    };
  }
  if (turn.transition === 'model + reasoning changed') {
    return {
      icon: '⚠',
      label: 'Configuration changed',
      detail: `${turn.previousModel ?? 'Previous'} / ${formatReasoning(turn.previousReasoningEffort)} → ${turn.model} / ${formatReasoning(turn.reasoningEffort)}`,
    };
  }
  return {
    icon: '⚠',
    label: 'Configuration switched',
    detail: current,
  };
}

function formatReasoning(value?: string): string {
  if (!value || value === 'unavailable') return 'Reasoning unavailable';
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

interface OptimizationInsight {
  icon: string;
  message: string;
}

function optimizationInsight(
  transition: CacheTransition | undefined,
  reuse: number | null,
  cacheTrend: number | null,
  costTrend: number | null,
  comparisonLabel: string,
): OptimizationInsight {
  if (transition && !['baseline', 'same configuration'].includes(transition)) {
    return warningInsight('Configuration changed; cache continuity may need to rebuild.');
  }
  if (cacheTrend != null && cacheTrend <= -0.1) {
    return warningInsight(`Cache reuse is ${Math.round(Math.abs(cacheTrend) * 100)} points below the ${comparisonLabel}.`);
  }
  if (reuse != null && reuse < 0.5) {
    return warningInsight(`Latest request reused only ${formatPercentage(reuse)} of its input context.`);
  }
  if (costTrend != null && costTrend >= 0.25) {
    return warningInsight(`Latest request cost is ${Math.round(costTrend * 100)}% above the ${comparisonLabel}.`);
  }
  if (reuse != null && reuse >= 0.8) {
    return successInsight('Strong cache reuse on the latest request.');
  }
  if (reuse != null && reuse >= 0.6) {
    return successInsight('Cache continuity looks healthy.');
  }
  return {
    icon: '○',
    message: 'More requests are needed for an optimization comparison.',
  };
}

function warningInsight(message: string): OptimizationInsight {
  return {
    icon: '⚠',
    message,
  };
}

function successInsight(message: string): OptimizationInsight {
  return {
    icon: '✓',
    message,
  };
}

function isOptimizationWarning(
  transition: CacheTransition | undefined,
  reuse: number | null,
): boolean {
  return (transition != null && !['baseline', 'same configuration'].includes(transition))
    || (reuse != null && reuse < 0.5);
}

function optimizationTips(live: LiveUsageService): vscode.QuickPickItem[] {
  const usage = live.state.snapshot;
  const latest = live.state.latestCache;
  if (!usage) {
    return [{
      label: '$(info) No live usage data yet',
      detail: 'Run a Copilot CLI request in this workspace, then refresh TokenLens.',
    }];
  }
  const requests = usage.perModel.reduce((sum, model) => sum + model.requests, 0);
  const averageInput = requests > 0 ? usage.totals.input / requests : null;
  const averageCredits = requests > 0 ? usage.credits / requests : null;
  const tips: vscode.QuickPickItem[] = [];

  if (latest && !['baseline', 'same configuration'].includes(latest.transition)) {
    tips.push({
      label: '$(warning) Keep related work on a stable configuration',
      description: latest.transition,
      detail: 'The latest request changed model or reasoning configuration. Stable configuration usually gives cache continuity more opportunity to build.',
    });
  }
  if (latest?.reuseRate != null && latest.reuseRate < 0.6) {
    tips.push({
      label: '$(database) Review low cache reuse',
      description: formatPercentage(latest.reuseRate),
      detail: `The latest request reused ${formatTokens(latest.cacheReadTokens ?? 0)} of ${formatTokens(latest.inputTokens ?? 0)} input tokens. Keep related context together and avoid unnecessary configuration changes.`,
    });
  }
  if (latest?.inputTokens != null && averageInput != null && latest.inputTokens > averageInput * 1.25) {
    tips.push({
      label: '$(arrow-up) Watch context growth',
      description: `${formatTokens(latest.inputTokens)} vs ${formatTokens(averageInput)} average`,
      detail: 'The latest request used at least 25% more input than the session average. Consider starting a fresh task when the context is no longer related.',
    });
  }
  if (latest && averageCredits != null && averageCredits > 0 && latest.credits > averageCredits * 1.25) {
    tips.push({
      label: '$(credit-card) Review an expensive request',
      description: `${latest.credits.toFixed(1)} cr vs ${averageCredits.toFixed(1)} cr average`,
      detail: 'The latest request cost at least 25% more than the session average. Check whether high reasoning or a larger model was necessary for this step.',
    });
  }
  if (tips.length === 0) {
    tips.push({
      label: '$(pass-filled) No immediate optimization issue detected',
      description: latest?.reuseRate == null ? undefined : `${formatPercentage(latest.reuseRate)} cache reuse`,
      detail: latest?.reuseRate == null
        ? 'TokenLens needs more request-level cache data before it can make a specific recommendation.'
        : `The latest request reused ${formatPercentage(latest.reuseRate)} of its input context and did not trigger a configuration or cost warning.`,
    });
  }
  return tips;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
}

function configureTooltip(tooltip: vscode.MarkdownString): void {
  tooltip.supportThemeIcons = true;
  tooltip.supportHtml = true;
  tooltip.isTrusted = {
    enabledCommands: [
      'tokenLens.openMetrics',
      'tokenLens.openHistory',
      'tokenLens.refreshUsage',
      'tokenLens.showOptimizationTips',
      'tokenLens.checkSetup',
    ],
  };
}

function workspaceKey(uri: vscode.Uri): string {
  return Buffer.from(uri.toString()).toString('base64url').slice(0, 32);
}
