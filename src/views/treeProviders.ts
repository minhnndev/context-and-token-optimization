import * as vscode from 'vscode';
import { calibrationSummary } from '../core/calibration';
import { formatRange } from '../core/sizing';
import { TaskRecord } from '../core/types';
import { LiveUsageService } from '../services/liveUsageService';
import { LocalStore } from '../services/localStore';

export class SessionTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly live: LiveUsageService, private readonly creditUsd: () => number) {}

  refresh(): void { this.changed.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  getChildren(): vscode.TreeItem[] {
    const { snapshot, latestCache, error } = this.live.state;
    if (!snapshot) return error ? [item('Provider', error, 'warning')] : [];
    const reuse = snapshot.totals.input > 0 ? snapshot.totals.cached / snapshot.totals.input : null;
    const models = snapshot.perModel.map((model) => model.model).join(', ') || 'No usage yet';
    return [
      item('AI Credits', snapshot.credits.toFixed(1), 'sparkle'),
      item('Estimated Cost', `$${(snapshot.credits * this.creditUsd()).toFixed(2)}`, 'credit-card'),
      item('Input', formatTokens(snapshot.totals.input), 'arrow-up'),
      item('Cached', `${formatTokens(snapshot.totals.cached)}${reuse == null ? '' : ` · ${Math.round(reuse * 100)}%`}`, 'database'),
      item('Output', formatTokens(snapshot.totals.output), 'arrow-down'),
      item('Requests', String(snapshot.perModel.reduce((sum, model) => sum + model.requests, 0)), 'comment-discussion'),
      item('Model', models, 'hubot'),
      ...(latestCache ? [item('Cache change', latestCache.transition, latestCache.significant ? 'warning' : 'pulse')] : []),
    ];
  }
}

export class TaskTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: LocalStore, private readonly live: LiveUsageService) {}

  refresh(): void { this.changed.fire(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  getChildren(): vscode.TreeItem[] {
    const task = this.store.activeTask();
    if (!task) return [];
    return [
      item('Task', task.description, 'target'),
      item('Size', `${task.estimate.bucket} · ${formatRange(task.estimate.bucket)} cr`, 'symbol-ruler'),
      item('Confidence', `${Math.round(task.estimate.confidence * 100)}%`, 'graph'),
      item('Actual so far', `${(this.live.state.snapshot?.credits ?? 0).toFixed(1)} cr`, 'pulse'),
      commandItem('Complete Task', 'tokenLens.completeTask', 'pass-filled'),
      commandItem(task.github ? `Issue #${task.github.issueNumber}` : 'Sync to GitHub', 'tokenLens.syncTask', 'cloud-upload'),
    ];
  }
}

export class HistoryTreeProvider implements vscode.TreeDataProvider<HistoryItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: LocalStore) {}

  refresh(): void { this.changed.fire(); }
  getTreeItem(item: HistoryItem): vscode.TreeItem { return item; }

  getChildren(element?: HistoryItem): HistoryItem[] {
    if (element?.task) {
      const task = element.task;
      return [
        new HistoryItem(`Estimate: ${task.estimate.bucket} (${formatRange(task.estimate.bucket)} cr)`),
        new HistoryItem(`Actual: ${task.usage?.credits.toFixed(1) ?? '—'} cr`),
        new HistoryItem(`Verdict: ${task.verdict ?? '—'}`),
        new HistoryItem(`Files: ${task.usage?.files.length ?? task.endGit?.changedFiles ?? 0}`),
      ];
    }
    const tasks = this.store.allTasks().filter((task) => task.status === 'completed');
    if (tasks.length === 0) return [];
    const summary = calibrationSummary(tasks);
    const summaryItem = new HistoryItem(
      'Calibration',
      summary.rate == null ? 'No actuals' : `${summary.hits}/${summary.recorded} · ${Math.round(summary.rate * 100)}%`,
      undefined,
      vscode.TreeItemCollapsibleState.None,
      'graph',
    );
    return [summaryItem, ...tasks.slice(0, 20).map((task) => new HistoryItem(
      task.description,
      `${task.estimate.bucket} → ${task.usage?.credits.toFixed(1) ?? '—'} cr · ${task.verdict}`,
      task,
      vscode.TreeItemCollapsibleState.Collapsed,
      verdictIcon(task),
    ))];
  }
}

export class HistoryItem extends vscode.TreeItem {
  constructor(
    label: string,
    description?: string,
    readonly task?: TaskRecord,
    collapsibleState = vscode.TreeItemCollapsibleState.None,
    icon = 'history',
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = description ? `${label}: ${description}` : label;
  }
}

function item(label: string, description: string, icon: string): vscode.TreeItem {
  const treeItem = new vscode.TreeItem(label);
  treeItem.description = description;
  treeItem.tooltip = `${label}: ${description}`;
  treeItem.iconPath = new vscode.ThemeIcon(icon);
  return treeItem;
}

function commandItem(label: string, command: string, icon: string): vscode.TreeItem {
  const treeItem = item(label, '', icon);
  treeItem.command = { command, title: label };
  return treeItem;
}

function verdictIcon(task: TaskRecord): string {
  if (task.verdict === 'on-target') return 'pass-filled';
  if (task.verdict === 'over') return 'arrow-up';
  if (task.verdict === 'under') return 'arrow-down';
  return 'question';
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}
