import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { TaskRecord } from '../core/types';

interface StoreState {
  version: 1;
  activeTaskId?: string;
  tasks: TaskRecord[];
}

const EMPTY_STATE: StoreState = { version: 1, tasks: [] };

export class LocalStore {
  private state: StoreState = { ...EMPTY_STATE, tasks: [] };

  constructor(private readonly filePath: string) {}

  static async migrate(legacyPaths: string[], currentPath: string): Promise<void> {
    try {
      await access(currentPath);
      return;
    } catch {
      // No TokenLens store yet; try the legacy filename next.
    }
    for (const legacyPath of legacyPaths) {
      try {
        await mkdir(dirname(currentPath), { recursive: true });
        await copyFile(legacyPath, currentPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as StoreState;
      this.state = parsed.version === 1 && Array.isArray(parsed.tasks)
        ? parsed
        : { ...EMPTY_STATE, tasks: [] };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
  }

  allTasks(): TaskRecord[] {
    return [...this.state.tasks].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  activeTask(): TaskRecord | undefined {
    return this.state.tasks.find((task) => task.id === this.state.activeTaskId && task.status === 'active');
  }

  mostRecentTask(): TaskRecord | undefined {
    return this.allTasks()[0];
  }

  async startTask(task: TaskRecord): Promise<void> {
    const previous = this.activeTask();
    if (previous) throw new Error(`Task "${previous.description}" is already active.`);
    this.state.tasks.push(task);
    this.state.activeTaskId = task.id;
    await this.flush();
  }

  async updateTask(task: TaskRecord): Promise<void> {
    const index = this.state.tasks.findIndex((candidate) => candidate.id === task.id);
    if (index === -1) throw new Error(`Task ${task.id} does not exist.`);
    this.state.tasks[index] = task;
    if (task.status === 'completed' && this.state.activeTaskId === task.id) {
      delete this.state.activeTaskId;
    }
    await this.flush();
  }

  private async flush(): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.filePath);
  }
}
