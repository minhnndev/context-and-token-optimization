// Shared helpers for the sizing prototype. Zero dependencies; all GitHub
// access goes through the `gh` CLI so attendees need no PAT.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// Bucket boundaries mirror docs/sizing-rubric.md and the issue form.
export const BUCKETS = {
  XS: { min: 0, max: 10 },
  S: { min: 11, max: 30 },
  M: { min: 31, max: 75 },
  L: { min: 76, max: 150 },
  XL: { min: 151, max: Infinity },
};

export function loadRates() {
  return JSON.parse(readFileSync(join(HERE, 'rates.json'), 'utf8'));
}

export function gh(args, { input, allowFail = false } = {}) {
  const res = spawnSync('gh', args, { input, encoding: 'utf8' });
  if (res.error) {
    throw new Error(`Failed to run gh: ${res.error.message}. Is the GitHub CLI installed and on PATH?`);
  }
  if (res.status !== 0 && !allowFail) {
    throw new Error(`gh ${args.join(' ')} failed:\n${res.stderr || res.stdout}`);
  }
  return res;
}

export function ghJson(args) {
  return JSON.parse(gh(args).stdout);
}

// Issue forms render a dropdown as:  ### AI credit size\n\nS — 11–30 credits
// Take the first non-empty line after the heading and read the bucket prefix.
export function parseBucket(issueBody) {
  const lines = (issueBody || '').split(/\r?\n/);
  const idx = lines.findIndex((l) => /^#{2,4}\s+AI credit size\s*$/i.test(l.trim()));
  if (idx === -1) return null;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#')) break; // ran into the next section
    const m = line.match(/^(XS|S|M|L|XL)\b/);
    return m ? m[1] : null;
  }
  return null;
}

export function parsePlannedModel(issueBody) {
  const lines = (issueBody || '').split(/\r?\n/);
  const idx = lines.findIndex((l) => /^#{2,4}\s+Planned model\s*$/i.test(l.trim()));
  if (idx === -1) return null;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#')) break;
    return line;
  }
  return null;
}

// Unlike the dropdowns above, the rationale is a multi-line textarea; GitHub
// renders an empty optional field as "_No response_".
export function parseRationale(issueBody) {
  const lines = (issueBody || '').split(/\r?\n/);
  const idx = lines.findIndex((l) => /^#{2,4}\s+Sizing rationale\s*$/i.test(l.trim()));
  if (idx === -1) return null;
  const out = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^#{2,4}\s+\S/.test(lines[i].trim())) break;
    out.push(lines[i]);
  }
  const text = out.join('\n').trim();
  return !text || text === '_No response_' ? null : text;
}

export function tokensToCredits({ inputTokens, outputTokens, cachedTokens = 0, cacheWriteTokens = 0, model, auto = false }) {
  const rates = loadRates();
  const r = rates.models[model];
  if (!r) {
    throw new Error(`Unknown model "${model}". Known models: ${Object.keys(rates.models).join(', ')} (see scripts/rates.json)`);
  }
  if (cachedTokens && r.cachedInPer1M === undefined) {
    throw new Error(`No cache-read rate for "${model}" in scripts/rates.json — add cachedInPer1M, or fold the tokens into --input-tokens (overestimates).`);
  }
  if (cacheWriteTokens && r.cacheWritePer1M === undefined) {
    throw new Error(`No cache-write rate for "${model}" in scripts/rates.json — add cacheWritePer1M, or fold the tokens into --input-tokens.`);
  }
  let usd =
    (inputTokens / 1e6) * r.inPer1M +
    (outputTokens / 1e6) * r.outPer1M +
    (cachedTokens / 1e6) * (r.cachedInPer1M ?? 0) +
    (cacheWriteTokens / 1e6) * (r.cacheWritePer1M ?? 0);
  if (auto) usd *= rates.autoDiscount;
  return usd / rates.creditUsd;
}

export function verdictFor(bucket, actualCredits) {
  const b = BUCKETS[bucket];
  if (!b) return 'unknown';
  if (actualCredits > b.max) return 'over';
  if (actualCredits < b.min) return 'under';
  return 'on-target';
}

// Rewrite one issue-form section in place, leaving every other section byte
// for byte. Used to fill in an estimate that was left unsized.
export function replaceSection(issueBody, heading, content) {
  const lines = (issueBody || '').split(/\r?\n/);
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^#{2,4}\\s+${escaped}\\s*$`, 'i');
  const idx = lines.findIndex((l) => re.test(l.trim()));
  if (idx === -1) {
    return `${(issueBody || '').trimEnd()}\n\n### ${heading}\n\n${content}\n`;
  }
  let end = idx + 1;
  while (end < lines.length && !/^#{2,4}\s+\S/.test(lines[end].trim())) end++;
  return [...lines.slice(0, idx + 1), '', content, '', ...lines.slice(end)].join('\n').trimEnd() + '\n';
}

// Machine-readable markers embedded in issue comments by record-usage.mjs.
const MARKER_RE = /<!--\s*ai-usage\s+(\{.*?\})\s*-->/s;

export function buildMarker(data, kind = 'ai-usage') {
  return `<!-- ${kind} ${JSON.stringify(data)} -->`;
}

export function extractMarker(commentBody, kind = 'ai-usage') {
  const re = kind === 'ai-usage' ? MARKER_RE : new RegExp(`<!--\\s*${kind}\\s+(\\{.*?\\})\\s*-->`, 's');
  const m = (commentBody || '').match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// The recording that represents what a task cost: the latest one that is not a
// --comparison run. Re-pricing a finished task on another model says nothing
// about the original estimate, so it must not overwrite the real actual.
export function representativeMarker(comments) {
  let marker = null;
  for (const c of comments ?? []) {
    const m = extractMarker(c.body);
    if (m && !m.comparison) marker = m;
  }
  return marker;
}

export function ensureLabel(name, color, description) {
  // --force makes this idempotent (updates the label if it already exists).
  gh(['label', 'create', name, '--color', color, '--description', description, '--force'], { allowFail: true });
}

export function fmtRange(bucket) {
  const b = BUCKETS[bucket];
  if (!b) return '?';
  return b.max === Infinity ? `>${b.min - 1}` : `${b.min}–${b.max}`;
}

export function parseArgs(argv, spec) {
  // Tiny flag parser: spec = { credits: 'number', notes: 'string', auto: 'boolean' }
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const type = spec[key];
    if (!type) throw new Error(`Unknown flag ${a}`);
    if (type === 'boolean') {
      out[key] = true;
    } else {
      const raw = argv[++i];
      if (raw === undefined) throw new Error(`Flag ${a} needs a value`);
      out[key] = type === 'number' ? Number(raw) : raw;
      if (type === 'number' && Number.isNaN(out[key])) throw new Error(`Flag ${a} must be a number, got "${raw}"`);
    }
  }
  return out;
}
