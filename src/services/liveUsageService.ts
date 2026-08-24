import * as vscode from 'vscode';
import { getSetting } from '../config';
import { CacheTurn, CacheTurnObserver, formatCacheTurn } from '../core/cache';
import { UsageSnapshot } from '../core/types';
import { SessionProvider } from '../providers/sessionProvider';
import { LocalStore } from './localStore';

export interface LiveUsageState {
  snapshot?: UsageSnapshot;
  latestCache?: CacheTurn;
  error?: string;
  updatedAt?: string;
}

export class LiveUsageService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<LiveUsageState>();
  private timer: NodeJS.Timeout | undefined;
  private stateValue: LiveUsageState = {};
  private observer: CacheTurnObserver;
  private observedSessionId: string | undefined;
  private observedRowId = 0;
  private refreshing: Promise<void> | undefined;

  readonly onDidChange = this.changed.event;

  constructor(
    private readonly provider: SessionProvider,
    private readonly store: LocalStore,
  ) {
    this.observer = this.createObserver();
  }

  get state(): LiveUsageState {
    return this.stateValue;
  }

  start(): void {
    this.schedule();
    void this.refresh();
  }

  restart(): void {
    if (this.timer) clearInterval(this.timer);
    this.schedule();
  }

  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefresh().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  resetCacheObserver(): void {
    this.observer = this.createObserver();
    this.observedSessionId = undefined;
    this.observedRowId = 0;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.changed.dispose();
  }

  private schedule(): void {
    const seconds = getSetting('pollIntervalSeconds', 5);
    this.timer = setInterval(() => void this.refresh(), Math.max(2, seconds) * 1000);
  }

  private async doRefresh(): Promise<void> {
    try {
      const active = this.store.activeTask();
      const snapshot = active
        ? await this.provider.usageSince(active.usageBaseline)
        : await this.provider.liveSnapshot();
      if (!snapshot) {
        this.stateValue = { error: 'No Copilot CLI session found for this workspace.' };
        this.changed.fire(this.stateValue);
        return;
      }
      if (this.observedSessionId !== snapshot.sessionId) {
        this.observedSessionId = snapshot.sessionId;
        this.observedRowId = 0;
        this.observer = this.createObserver();
      }
      let latestCache = this.stateValue.latestCache;
      for (const event of snapshot.events.filter((item) => item.rowId > this.observedRowId)) {
        latestCache = this.observer.observe(event);
        this.observedRowId = event.rowId;
        await this.maybeNotify(latestCache);
      }
      this.stateValue = {
        snapshot,
        latestCache,
        updatedAt: new Date().toISOString(),
      };
      this.changed.fire(this.stateValue);
    } catch (error) {
      this.stateValue = { ...this.stateValue, error: (error as Error).message };
      this.changed.fire(this.stateValue);
    }
  }

  private createObserver(): CacheTurnObserver {
    const threshold = getSetting('significantCacheDeltaTokens', 4096);
    return new CacheTurnObserver(threshold);
  }

  private async maybeNotify(turn: CacheTurn): Promise<void> {
    const enabled = getSetting('cacheNotifications', true);
    if (!enabled || turn.transition === 'baseline') return;
    if (!turn.significant && turn.transition === 'same configuration') return;
    const severity = turn.cacheDelta != null && turn.cacheDelta < 0
      ? vscode.window.showWarningMessage
      : vscode.window.showInformationMessage;
    await severity(`TokenLens: ${formatCacheTurn(turn)}`);
  }
}
