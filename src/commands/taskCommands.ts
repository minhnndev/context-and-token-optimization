import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { verdictFor } from '../core/calibration';
import { estimateTask, formatRange } from '../core/sizing';
import { TaskEstimate, TaskRecord } from '../core/types';
import { GitProvider } from '../providers/gitProvider';
import { GitHubProvider } from '../providers/githubProvider';
import { SessionProvider } from '../providers/sessionProvider';
import { LiveUsageService } from '../services/liveUsageService';
import { LocalStore } from '../services/localStore';

export class TaskCommands {
  constructor(
    private readonly store: LocalStore,
    private readonly git: GitProvider,
    private readonly session: SessionProvider,
    private readonly live: LiveUsageService,
    private readonly github: GitHubProvider,
    private readonly changed: () => void,
  ) {}

  async estimate(startImmediately = false): Promise<void> {
    if (startImmediately && this.store.activeTask()) {
      await vscode.window.showWarningMessage(
        `Complete the active task "${this.store.activeTask()!.description}" before starting another one.`,
      );
      return;
    }
    const description = await vscode.window.showInputBox({
      title: startImmediately ? 'Start AI-cost task' : 'Estimate AI cost',
      prompt: 'What are you working on?',
      placeHolder: 'Add offline synchronization to the editor',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim().length < 5 ? 'Describe the task in at least 5 characters.' : undefined,
    });
    if (!description) return;
    const git = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'TokenLens: Analyzing task scope…',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Reading Git changes and workspace structure' });
        return this.git.snapshot();
      },
    );
    const estimate = estimateTask(description.trim(), git, this.store.allTasks());
    const startLabel = 'Start Task';
    const selection = await vscode.window.showInformationMessage(
      `${estimate.bucket} — ${formatRange(estimate.bucket)} credits`,
      {
        modal: true,
        detail: formatEstimateDetail(estimate),
      },
      startLabel,
    );
    if (selection === startLabel) {
      await this.start(description.trim(), estimate, git);
    }
  }

  async complete(): Promise<void> {
    const active = this.store.activeTask();
    if (!active) {
      await vscode.window.showInformationMessage('TokenLens: there is no active task.');
      return;
    }
    await this.live.refresh();
    let usage = this.live.state.snapshot;
    if (!usage || this.live.state.error) {
      const manual = 'Enter Credits Manually';
      const choice = await vscode.window.showWarningMessage(
        `Live usage is unavailable: ${this.live.state.error ?? 'no usage snapshot available'}`,
        manual,
      );
      if (choice !== manual) return;
      const value = await vscode.window.showInputBox({
        title: 'Record AI credits manually',
        prompt: 'Enter the credits shown by Copilot /usage.',
        validateInput: (input) => Number.isFinite(Number(input)) && Number(input) >= 0
          ? undefined
          : 'Enter a non-negative number.',
      });
      if (value == null) return;
      usage = {
        sessionId: 'manual',
        lastRowId: 0,
        lastFileId: 0,
        credits: Number(value),
        apiDurationMs: 0,
        totals: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 },
        perModel: [],
        files: [],
        events: [],
      };
    }
    const endGit = await this.git.snapshot();
    if (usage.sessionId === 'manual') {
      usage = {
        ...usage,
        files: endGit.files.map((file) => ({
          path: file.path,
          tool: file.status === 'added' || file.status === 'untracked' ? 'create' : 'edit',
        })),
      };
    }
    const completed: TaskRecord = {
      ...active,
      status: 'completed',
      completedAt: new Date().toISOString(),
      endGit,
      usage,
      verdict: verdictFor(active.estimate.bucket, usage.credits),
    };
    await this.store.updateTask(completed);
    this.live.resetCacheObserver();
    await this.live.refresh();
    this.changed();

    const sync = 'Sync to GitHub';
    const result = await vscode.window.showInformationMessage(
      `Task completed: ${usage.credits.toFixed(1)} credits — ${completed.verdict}`,
      {
        modal: true,
        detail: `${active.estimate.bucket} estimate (${formatRange(active.estimate.bucket)})\n` +
          `${usage.files.length} Copilot-touched files · ${endGit.changedFiles} files currently changed in Git`,
      },
      sync,
    );
    if (result === sync) await this.sync(completed);
  }

  async sync(task?: TaskRecord): Promise<void> {
    let currentTask = task ?? this.store.activeTask() ?? this.store.mostRecentTask();
    if (!currentTask) {
      await vscode.window.showInformationMessage('TokenLens: there is no task to sync.');
      return;
    }
    if (currentTask.syncedAt && currentTask.status === 'completed') {
      await vscode.window.showInformationMessage(`Task already synced to ${currentTask.github?.issueUrl ?? 'GitHub'}.`);
      return;
    }
    const repository = await this.git.githubRemote();
    if (!repository) {
      await vscode.window.showErrorMessage('The origin remote is not a github.com repository.');
      return;
    }
    let link = currentTask.github;
    if (!link) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Create GitHub Issue', description: `${repository.owner}/${repository.repo}` },
          { label: 'Link Existing Issue', description: 'Use an issue number from this repository' },
        ],
        { title: 'Sync task calibration', ignoreFocusOut: true },
      );
      if (!choice) return;
      if (choice.label === 'Create GitHub Issue') {
        const taskToCreate = currentTask;
        link = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Creating GitHub issue…' },
          () => this.github.createTaskIssue(repository, taskToCreate),
        );
      } else {
        const issueText = await vscode.window.showInputBox({
          title: 'Link existing GitHub issue',
          prompt: `Issue number in ${repository.owner}/${repository.repo}`,
          validateInput: (value) => /^#?\d+$/.test(value.trim()) ? undefined : 'Enter a numeric issue number.',
        });
        if (!issueText) return;
        link = await this.github.linkExisting(
          repository,
          Number(issueText.replace('#', '')),
          currentTask.estimate.bucket,
        );
      }
      currentTask = { ...currentTask, github: link };
      await this.store.updateTask(currentTask);
    }
    if (currentTask.status === 'completed') {
      const taskToRecord = currentTask;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Recording usage on issue #${link.issueNumber}…` },
        () => this.github.recordCompletedTask(link, taskToRecord),
      );
      currentTask = { ...currentTask, syncedAt: new Date().toISOString() };
      await this.store.updateTask(currentTask);
    }
    this.changed();
    await vscode.window.showInformationMessage(
      currentTask.status === 'completed'
        ? `Calibration synced to issue #${link.issueNumber}.`
        : `Task linked to issue #${link.issueNumber}.`,
      'Open Issue',
    ).then((selection) => {
      if (selection === 'Open Issue') void vscode.env.openExternal(vscode.Uri.parse(link.issueUrl));
    });
  }

  private async start(
    description: string,
    estimate: TaskEstimate,
    startGit: Awaited<ReturnType<GitProvider['snapshot']>>,
  ): Promise<void> {
    if (this.store.activeTask()) {
      await vscode.window.showWarningMessage('Complete the active task before starting another one.');
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'TokenLens: Starting task…',
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: 'Capturing the usage baseline', increment: 20 });
        let usageBaseline;
        try {
          usageBaseline = await this.session.currentCursor();
        } catch {
          // Starting remains local-first. Live usage will become available when a compatible session appears.
        }
        const task: TaskRecord = {
          id: randomUUID(),
          description,
          status: 'active',
          estimate,
          startedAt: new Date().toISOString(),
          startGit,
          usageBaseline,
        };
        progress.report({ message: 'Saving the active task', increment: 40 });
        await this.store.startTask(task);
        this.live.resetCacheObserver();
        this.changed();
        progress.report({ message: 'Refreshing live usage', increment: 30 });
        await this.live.refresh();
        this.changed();
        progress.report({ message: 'Ready', increment: 10 });
      },
    );
    const openMetrics = 'Open Metrics';
    const selection = await vscode.window.showInformationMessage(
      `TokenLens: Task started · ${estimate.bucket} · expected ${formatRange(estimate.bucket)} credits.`,
      openMetrics,
    );
    if (selection === openMetrics) await vscode.commands.executeCommand('tokenLens.openMetrics');
  }
}

function formatEstimateDetail(estimate: TaskEstimate): string {
  const lines = [
    `Expected: ${estimate.expectedCredits.toFixed(1)} credits`,
    `Confidence: ${Math.round(estimate.confidence * 100)}%`,
    '',
    'Drivers:',
    ...estimate.drivers.map((driver) => `• ${driver}`),
  ];
  if (estimate.analogues.length) {
    lines.push('', 'Similar tasks:');
    lines.push(...estimate.analogues.map((item) =>
      `• ${item.issueNumber ? `#${item.issueNumber} ` : ''}${item.description} — ${item.actualCredits.toFixed(1)} cr`,
    ));
  }
  return lines.join('\n');
}
