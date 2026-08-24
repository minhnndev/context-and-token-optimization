import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import { GitSnapshot } from '../core/types';

const execFileAsync = promisify(execFile);

export class GitProvider {
  constructor(readonly root: string) {}

  static async discoverRoot(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
        cwd,
        encoding: 'utf8',
      });
      return stdout.trim() || cwd;
    } catch {
      return cwd;
    }
  }

  async snapshot(): Promise<GitSnapshot> {
    const [branch, status, numstat] = await Promise.all([
      this.git(['branch', '--show-current']).catch(() => ''),
      this.git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => ''),
      this.git(['diff', '--numstat', 'HEAD']).catch(() => ''),
    ]);
    const stats = parseNumstat(numstat);
    const files = await parseStatus(status, this.root, stats);
    return {
      branch: branch.trim() || null,
      changedFiles: files.length,
      addedFiles: files.filter((file) => file.status === 'added' || file.status === 'untracked').length,
      deletedFiles: files.filter((file) => file.status === 'deleted').length,
      insertions: files.reduce((sum, file) => sum + file.insertions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
      modules: [...new Set(files.map((file) => moduleFor(file.path)))].sort(),
      files,
    };
  }

  async githubRemote(): Promise<{ owner: string; repo: string } | null> {
    const remote = (await this.git(['remote', 'get-url', 'origin'])).trim();
    const match = remote.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    return match ? { owner: match[1], repo: match[2] } : null;
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, {
      cwd: this.root,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }
}

function parseNumstat(raw: string): Map<string, { insertions: number; deletions: number }> {
  const result = new Map<string, { insertions: number; deletions: number }>();
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const [added, deleted, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    if (!path) continue;
    result.set(normalizeRenamePath(path), {
      insertions: added === '-' ? 0 : Number(added) || 0,
      deletions: deleted === '-' ? 0 : Number(deleted) || 0,
    });
  }
  return result;
}

async function parseStatus(
  raw: string,
  root: string,
  stats: Map<string, { insertions: number; deletions: number }>,
): Promise<GitSnapshot['files']> {
  const entries = raw.split('\0').filter(Boolean);
  const files: GitSnapshot['files'] = [];
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const code = entry.slice(0, 2);
    let path = entry.slice(3);
    if (code.includes('R') || code.includes('C')) {
      index++; // porcelain -z puts the original path in the following entry
    }
    const status = classifyStatus(code);
    let fileStats = stats.get(path) ?? { insertions: 0, deletions: 0 };
    if (status === 'untracked') {
      fileStats = { insertions: await countLines(join(root, path)), deletions: 0 };
    }
    files.push({ path, status, ...fileStats });
  }
  return files;
}

function classifyStatus(code: string): GitSnapshot['files'][number]['status'] {
  if (code === '??') return 'untracked';
  if (code.includes('R')) return 'renamed';
  if (code.includes('D')) return 'deleted';
  if (code.includes('A')) return 'added';
  return 'modified';
}

async function countLines(path: string): Promise<number> {
  try {
    const data = await readFile(path);
    if (data.length > 2_000_000 || data.includes(0)) return 0;
    return data.toString('utf8').split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function normalizeRenamePath(path: string): string {
  const brace = path.match(/^(.*?)\{(.+?) => (.+?)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`;
  const arrow = path.match(/^(.+) => (.+)$/);
  return arrow ? arrow[2] : path;
}

function moduleFor(path: string): string {
  const normalized = path.split(sep).join('/');
  const first = normalized.split('/')[0];
  return dirname(normalized) === '.' ? '(root)' : first;
}
