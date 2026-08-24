import * as vscode from 'vscode';
import { buildMarker } from '../core/calibration';
import { formatRange } from '../core/sizing';
import { GitHubLink, TaskRecord } from '../core/types';

interface GitHubIssueResponse {
  number: number;
  html_url: string;
}

export class GitHubProvider {
  async createTaskIssue(
    repository: { owner: string; repo: string },
    task: TaskRecord,
  ): Promise<GitHubLink> {
    await this.ensureLabels(repository, task.estimate.bucket);
    const issue = await this.request<GitHubIssueResponse>(
      'POST',
      `/repos/${repository.owner}/${repository.repo}/issues`,
      {
        title: task.description.split(/\r?\n/)[0].slice(0, 256),
        body: buildIssueBody(task),
      },
    );
    if (!issue) throw new Error('GitHub did not return the created issue.');
    await this.request(
      'POST',
      `/repos/${repository.owner}/${repository.repo}/issues/${issue.number}/labels`,
      { labels: ['ai-sized', `size:${task.estimate.bucket}`] },
    );
    return {
      ...repository,
      issueNumber: issue.number,
      issueUrl: issue.html_url,
    };
  }

  async recordCompletedTask(link: GitHubLink, task: TaskRecord): Promise<void> {
    if (!task.usage || !task.verdict) throw new Error('The task has no completed usage to sync.');
    if (task.verdict !== 'unknown') {
      await this.ensureCalibrationLabel(link, task.verdict);
      await this.request(
        'POST',
        `/repos/${link.owner}/${link.repo}/issues/${link.issueNumber}/labels`,
        { labels: [`calibration:${task.verdict}`] },
      );
      for (const stale of ['under', 'on-target', 'over'].filter((value) => value !== task.verdict)) {
        await this.request(
          'DELETE',
          `/repos/${link.owner}/${link.repo}/issues/${link.issueNumber}/labels/${encodeURIComponent(`calibration:${stale}`)}`,
          undefined,
          true,
        );
      }
    }
    await this.request(
      'POST',
      `/repos/${link.owner}/${link.repo}/issues/${link.issueNumber}/comments`,
      { body: buildUsageComment(task) },
    );
  }

  async linkExisting(
    repository: { owner: string; repo: string },
    issueNumber: number,
    bucket: string,
  ): Promise<GitHubLink> {
    const issue = await this.request<GitHubIssueResponse>(
      'GET',
      `/repos/${repository.owner}/${repository.repo}/issues/${issueNumber}`,
    );
    if (!issue) throw new Error(`GitHub issue #${issueNumber} was not found.`);
    await this.ensureLabels(repository, bucket);
    await this.request(
      'POST',
      `/repos/${repository.owner}/${repository.repo}/issues/${issue.number}/labels`,
      { labels: ['ai-sized', `size:${bucket}`] },
    );
    return { ...repository, issueNumber: issue.number, issueUrl: issue.html_url };
  }

  private async ensureLabels(repository: { owner: string; repo: string }, bucket: string): Promise<void> {
    await this.ensureLabel(repository, 'ai-sized', '8250df', 'Task estimated in AI credits');
    await this.ensureLabel(repository, `size:${bucket}`, '8250df', `Estimated ${bucket} AI-credit task`);
  }

  private async ensureCalibrationLabel(
    repository: { owner: string; repo: string },
    verdict: 'under' | 'on-target' | 'over' | 'unknown',
  ): Promise<void> {
    const metadata = {
      'on-target': ['2da44e', 'Actual AI spend landed inside the estimated bucket'],
      over: ['d1242f', 'Actual AI spend exceeded the estimated bucket'],
      under: ['0969da', 'Actual AI spend came in below the estimated bucket'],
      unknown: ['6e7781', 'No estimate was available'],
    } as const;
    const [color, description] = metadata[verdict];
    await this.ensureLabel(repository, `calibration:${verdict}`, color, description);
  }

  private async ensureLabel(
    repository: { owner: string; repo: string },
    name: string,
    color: string,
    description: string,
  ): Promise<void> {
    const path = `/repos/${repository.owner}/${repository.repo}/labels/${encodeURIComponent(name)}`;
    const existing = await this.request('GET', path, undefined, true);
    if (existing) return;
    await this.request('POST', `/repos/${repository.owner}/${repository.repo}/labels`, {
      name,
      color,
      description,
    });
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    allowNotFound = false,
  ): Promise<T | null> {
    const session = await vscode.authentication.getSession('github', ['repo'], { createIfNone: true });
    const apiRoot = vscode.workspace.getConfiguration('tokenOptimization')
      .get<string>('githubApiBaseUrl', 'https://api.github.com').replace(/\/$/, '');
    const response = await fetch(`${apiRoot}${path}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${session.accessToken}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return null;
    return await response.json() as T;
  }
}

function buildIssueBody(task: TaskRecord): string {
  const analogues = task.estimate.analogues.length
    ? task.estimate.analogues.map((item) => item.issueNumber ? `#${item.issueNumber}` : item.description).join(', ')
    : '_No recorded analogues_';
  return [
    '### Task description',
    '',
    task.description,
    '',
    '### AI credit size',
    '',
    `${task.estimate.bucket} — ${formatRange(task.estimate.bucket)} credits`,
    '',
    '### Planned model',
    '',
    'auto',
    '',
    '### Sizing rationale',
    '',
    ...task.estimate.drivers.map((driver) => `- ${driver}`),
    `- Confidence: ${Math.round(task.estimate.confidence * 100)}%`,
    `- Similar history: ${analogues}`,
  ].join('\n');
}

function buildUsageComment(task: TaskRecord): string {
  const usage = task.usage!;
  const credits = Math.round(usage.credits * 10) / 10;
  const files = usage.files;
  const marker = buildMarker({
    bucket: task.estimate.bucket,
    min: task.estimate.min,
    max: task.estimate.max,
    actual: credits,
    model: usage.perModel.map((model) => model.model).join(' + ') || null,
    verdict: task.verdict,
    ts: task.completedAt,
    ...(files.length ? { files } : {}),
    sessionId: usage.sessionId,
    perModel: usage.perModel,
  });
  const emoji = { 'on-target': '✅', over: '🔺', under: '🔻', unknown: '❓' }[task.verdict!];
  const model = usage.perModel.map((entry) => entry.model).join(' + ') || 'unknown';
  return [
    '## 🎯 AI usage recorded',
    '',
    '| | |',
    '|---|---|',
    `| Estimate | **${task.estimate.bucket}** (${formatRange(task.estimate.bucket)} credits) |`,
    `| Actual | **${credits} credits** |`,
    `| Verdict | ${emoji} ${task.verdict} |`,
    `| Files | ${files.length} |`,
    `| Model | ${model} |`,
    '',
    `**Tokens** ↑ ${usage.totals.input.toLocaleString('en-US')} (${usage.totals.cached.toLocaleString('en-US')} cached) · ↓ ${usage.totals.output.toLocaleString('en-US')}`,
    '',
    `_Recorded ${task.completedAt} by Token Optimization for GitHub Copilot._`,
    '',
    marker,
  ].join('\n');
}
