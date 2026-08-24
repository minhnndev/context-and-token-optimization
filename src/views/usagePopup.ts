import * as vscode from 'vscode';
import { formatRange } from '../core/sizing';
import { LiveUsageService } from '../services/liveUsageService';
import { LocalStore } from '../services/localStore';

interface PopupItem extends vscode.QuickPickItem {
  command?: string;
}

export class UsagePopup implements vscode.Disposable {
  private popup: vscode.QuickPick<PopupItem> | undefined;
  private readonly liveSubscription: vscode.Disposable;

  constructor(
    private readonly store: LocalStore,
    private readonly live: LiveUsageService,
    private readonly creditUsd: () => number,
  ) {
    this.liveSubscription = live.onDidChange(() => this.refresh());
  }

  async show(): Promise<void> {
    if (this.popup) {
      this.popup.show();
      this.refresh();
      return;
    }

    const popup = vscode.window.createQuickPick<PopupItem>();
    this.popup = popup;
    popup.title = 'TokenLens';
    popup.placeholder = 'Live AI usage for this workspace';
    popup.matchOnDescription = true;
    popup.matchOnDetail = true;
    popup.ignoreFocusOut = false;
    popup.buttons = [
      { iconPath: new vscode.ThemeIcon('refresh'), tooltip: 'Refresh usage' },
      { iconPath: new vscode.ThemeIcon('settings-gear'), tooltip: 'Open settings' },
    ];

    popup.onDidTriggerButton(async (button) => {
      const tooltip = button.tooltip;
      if (tooltip === 'Refresh usage') {
        popup.busy = true;
        await vscode.commands.executeCommand('tokenLens.refreshUsage');
        popup.busy = false;
        this.refresh();
      } else if (tooltip === 'Open settings') {
        popup.hide();
        await vscode.commands.executeCommand('tokenLens.openSettings');
      }
    });
    popup.onDidAccept(async () => {
      const selected = popup.selectedItems[0];
      if (!selected?.command) return;
      popup.hide();
      await vscode.commands.executeCommand(selected.command);
    });
    popup.onDidHide(() => {
      popup.dispose();
      this.popup = undefined;
    });

    this.refresh();
    popup.show();
    await this.live.refresh();
  }

  dispose(): void {
    this.liveSubscription.dispose();
    this.popup?.dispose();
  }

  private refresh(): void {
    if (!this.popup) return;
    const usage = this.live.state.snapshot;
    const active = this.store.activeTask();
    const items: PopupItem[] = [
      { label: 'Live usage', kind: vscode.QuickPickItemKind.Separator },
    ];

    if (usage) {
      const requests = usage.perModel.reduce((sum, model) => sum + model.requests, 0);
      const reuse = usage.totals.input > 0 ? usage.totals.cached / usage.totals.input : null;
      const models = usage.perModel
        .map((model) => `${model.model}: ${model.requests}`)
        .join(' · ') || 'No model usage yet';
      items.push(
        metric('$(sparkle)', `${usage.credits.toFixed(1)} AI credits`, `$${(usage.credits * this.creditUsd()).toFixed(2)} estimated cost`),
        metric('$(arrow-up)', `${formatTokens(usage.totals.input)} input`, `${formatTokens(usage.totals.cached)} served from cache`),
        metric('$(database)', `${reuse == null ? '—' : `${Math.round(reuse * 100)}%`} cache reuse`, this.cacheDetail()),
        metric('$(arrow-down)', `${formatTokens(usage.totals.output)} output`, `${formatTokens(usage.totals.reasoning)} reasoning tokens`),
        metric('$(comment-discussion)', `${requests} model request${requests === 1 ? '' : 's'}`, models),
      );
    } else {
      items.push(metric(
        this.live.state.error ? '$(warning)' : '$(loading~spin)',
        this.live.state.error ? 'Usage unavailable' : 'Reading usage…',
        this.live.state.error ?? 'Waiting for the Copilot CLI session provider',
      ));
    }

    items.push({ label: 'Current task', kind: vscode.QuickPickItemKind.Separator });
    if (active) {
      items.push(metric(
        '$(target)',
        active.description,
        `${active.estimate.bucket} · ${formatRange(active.estimate.bucket)} credits · ${Math.round(active.estimate.confidence * 100)}% confidence`,
      ));
    } else {
      items.push(metric('$(circle-slash)', 'No active task', 'Start a task to measure a task-specific usage delta'));
    }

    items.push(
      { label: 'Actions', kind: vscode.QuickPickItemKind.Separator },
      action(active ? '$(pass-filled)' : '$(play)', active ? 'Complete current task' : 'Start a task', active ? 'tokenLens.completeTask' : 'tokenLens.startTask'),
      action('$(cloud-upload)', active?.github ? `Sync issue #${active.github.issueNumber}` : 'Sync task to GitHub', 'tokenLens.syncTask'),
      action('$(graph)', 'Open detailed metrics', 'tokenLens.showDashboard'),
    );
    this.popup.items = items;
  }

  private cacheDetail(): string {
    const cache = this.live.state.latestCache;
    if (!cache) return 'No cache transition observed yet';
    const delta = cache.cacheDelta == null
      ? ''
      : ` · ${cache.cacheDelta >= 0 ? '+' : ''}${formatTokens(cache.cacheDelta)} cached tokens`;
    return `${cache.model} · ${cache.transition}${delta}`;
  }
}

function metric(icon: string, label: string, detail: string): PopupItem {
  return {
    label: `${icon} ${label}`,
    detail,
    alwaysShow: true,
  };
}

function action(icon: string, label: string, command: string): PopupItem {
  return {
    label: `${icon} ${label}`,
    command,
    alwaysShow: true,
  };
}

function formatTokens(value: number): string {
  const absolute = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (absolute >= 1_000_000) return `${sign}${(absolute / 1_000_000).toFixed(1)}m`;
  if (absolute >= 1_000) return `${sign}${(absolute / 1_000).toFixed(1)}k`;
  return value.toLocaleString('en-US');
}
