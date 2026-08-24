import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LocalStore } from '../services/localStore';

test('TokenLens copies the legacy local store without deleting it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'tokenlens-store-'));
  const legacy = join(root, 'token-optimization.json');
  const current = join(root, 'tokenlens.json');
  const data = `${JSON.stringify({ version: 1, tasks: [] })}\n`;
  writeFileSync(legacy, data);

  await LocalStore.migrate([legacy], current);

  assert.equal(readFileSync(current, 'utf8'), data);
  assert.equal(readFileSync(legacy, 'utf8'), data);
});
