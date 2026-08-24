import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GitProvider } from '../providers/gitProvider';

test('Git provider inventories individual untracked files and modules', async () => {
  const root = mkdtempSync(join(tmpdir(), 'token-optimization-git-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  writeFileSync(join(root, 'README.md'), 'base\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'test'));
  writeFileSync(join(root, 'src', 'feature.ts'), 'one\ntwo\n');
  writeFileSync(join(root, 'test', 'feature.test.ts'), 'test\n');
  writeFileSync(join(root, 'README.md'), 'base\nchanged\n');

  const snapshot = await new GitProvider(root).snapshot();
  assert.equal(snapshot.changedFiles, 3);
  assert.equal(snapshot.addedFiles, 2);
  assert.deepEqual(snapshot.modules, ['(root)', 'src', 'test']);
  assert.ok(snapshot.insertions >= 4);
});
