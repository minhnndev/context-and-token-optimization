#!/usr/bin/env node
// RECORD stage of the loop: post actual AI-credit spend on a sized issue.
//
//   node scripts/record-usage.mjs --issue 12 --credits 24 [--notes "..."]
//   node scripts/record-usage.mjs --issue 12 --input-tokens 180000 --output-tokens 9500 \
//        --model claude-sonnet-4.5 [--auto] [--notes "..."]
//
// Reads the estimate bucket from the issue body (created via the AI-sized
// task form), posts an estimate-vs-actual comment with a machine-readable
// <!-- ai-usage {...} --> marker, and applies a calibration:* label.
// Auth: your existing `gh auth login` — nothing else.
import {
  gh, ghJson, parseBucket, tokensToCredits, verdictFor,
  buildMarker, ensureLabel, fmtRange, parseArgs, BUCKETS,
} from './lib.mjs';
import { collectSessionUsage, writeCursor, gitRoot } from './session-usage.mjs';

const HELP = `Usage:
  node scripts/record-usage.mjs --issue N --from-session [--notes "..."]
  node scripts/record-usage.mjs --issue N --credits X [--model NAME] [--notes "..."]
  node scripts/record-usage.mjs --issue N --input-tokens A --output-tokens B --model NAME \\
       [--cached-tokens C] [--cache-write-tokens W] [--auto] [--notes "..."]

--comparison marks a run that re-prices a finished task on another model. It is
posted on the issue but kept out of the calibration history, so a deliberately
expensive re-run never becomes the recorded cost of the task.

--from-session reads the exact numbers /usage shows straight from Copilot
CLI's own session store — credits plus per-model tokens — counting only usage
since your last recording (so one long session can record several tasks). It
also records which files the agent created or edited for this task, so the
history says what each task changed, not only what it cost.

Manual fallback: read /usage yourself. If it gives credits, use --credits; if
per-model tokens, use the token flags and this script converts via
scripts/rates.json (--auto applies the 10% auto-model-selection discount).
--created/--edited take comma-separated paths when there is no session to read.

Token flags: --input-tokens is UNCACHED input only. Cache reads bill at ~10%
of the input rate — if /usage breaks them out, pass them as --cached-tokens
(and cache writes as --cache-write-tokens) or the estimate will be way high.`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    issue: 'number', fromSession: 'boolean', credits: 'number', inputTokens: 'number', outputTokens: 'number',
    cachedTokens: 'number', cacheWriteTokens: 'number', created: 'string', edited: 'string',
    model: 'string', auto: 'boolean', notes: 'string', comparison: 'boolean', help: 'boolean',
  });
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(1);
}

if (args.help || !args.issue) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}

let credits = args.credits;
let source = 'manual (/usage reading)';
let session = null;
if (args.fromSession) {
  try {
    session = await collectSessionUsage();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  credits = session.credits;
  source = `Copilot CLI session store (session ${session.sessionId.slice(0, 8)}, usage since your last recording)`;
} else if (credits === undefined) {
  if (args.inputTokens === undefined || args.outputTokens === undefined || !args.model) {
    console.error(`Provide either --credits, or all of --input-tokens/--output-tokens/--model.\n\n${HELP}`);
    process.exit(1);
  }
  credits = tokensToCredits({
    inputTokens: args.inputTokens, outputTokens: args.outputTokens,
    cachedTokens: args.cachedTokens ?? 0, cacheWriteTokens: args.cacheWriteTokens ?? 0,
    model: args.model, auto: Boolean(args.auto),
  });
  const breakdown = [
    `${args.inputTokens} in`, `${args.outputTokens} out`,
    ...(args.cachedTokens ? [`${args.cachedTokens} cache-read`] : []),
    ...(args.cacheWriteTokens ? [`${args.cacheWriteTokens} cache-write`] : []),
  ].join(' / ');
  source = `converted from tokens via rates.json (${breakdown})`;
}
credits = Math.round(credits * 10) / 10;

const issue = ghJson(['issue', 'view', String(args.issue), '--json', 'number,title,body,labels']);
const bucket = parseBucket(issue.body);
if (!bucket) {
  console.error(
    `Issue #${issue.number} has no "AI credit size" section — was it created with the AI-sized task form?\n` +
    'Recording anyway with verdict "unknown" so the data is not lost.'
  );
}

const verdict = bucket ? verdictFor(bucket, credits) : 'unknown';
const ts = new Date().toISOString();

// What the task changed, not just what it cost. --from-session reads the files
// the agent created/edited out of the CLI's own store; --created/--edited are
// the manual equivalent (used when seeding a history corpus).
const splitPaths = (s) => (s ? s.split(',').map((p) => p.trim()).filter(Boolean) : []);
const files = session
  ? session.files
  : [
      ...splitPaths(args.created).map((path) => ({ path, tool: 'create' })),
      ...splitPaths(args.edited).map((path) => ({ path, tool: 'edit' })),
    ];

const marker = buildMarker({
  bucket: bucket ?? null,
  min: bucket ? BUCKETS[bucket].min : null,
  max: bucket && BUCKETS[bucket].max !== Infinity ? BUCKETS[bucket].max : null,
  actual: credits,
  model: session ? session.perModel.map((m) => m.model).join(' + ') : args.model ?? null,
  verdict,
  ts,
  // Additive fields only — existing marker consumers keep working untouched.
  ...(args.comparison && { comparison: true }),
  ...(files.length && { files }),
  ...(session && { sessionId: session.sessionId, perModel: session.perModel }),
});

// Mirror /usage's display shape: ↑ input (cached reads) · ↓ output (reasoning).
const fmtTok = (n) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n ?? 0));
const usageLine = (u) =>
  `↑ ${fmtTok(u.input)}${u.cached ? ` (${fmtTok(u.cached)} cached)` : ''} · ` +
  `↓ ${fmtTok(u.output)}${u.reasoning ? ` (${fmtTok(u.reasoning)} reasoning)` : ''}`;

const verdictEmoji = { 'on-target': '✅', over: '🔺', under: '🔻', unknown: '❓' }[verdict];
const usd = (credits * 0.01).toFixed(2);
const nCreated = files.filter((f) => f.tool === 'create').length;
const filesLine = files.length
  ? `${files.length} (${nCreated} created, ${files.length - nCreated} edited): ` +
    files.map((f) => `\`${f.path}\``).join(', ')
  : null;
const lines = [
  args.comparison ? '## 🔬 Model comparison' : '## 🎯 AI usage recorded',
  '',
  ...(args.comparison
    ? ['_Re-running a finished task on a different model. Kept out of the calibration history: it prices a model, not the task._', '']
    : []),
  '| | |',
  '|---|---|',
  `| Estimate | ${bucket ? `**${bucket}** (${fmtRange(bucket)} credits)` : '_none found on issue_'} |`,
  `| Actual | **${credits} credits** (~$${usd}) |`,
  `| Verdict | ${verdictEmoji} ${verdict} |`,
  ...(filesLine ? [`| Files | ${filesLine} |`] : []),
  ...(args.model ? [`| Model | ${args.model}${args.auto ? ' (auto discount applied)' : ''} |`] : []),
  ...(args.notes ? [`| Notes | ${args.notes} |`] : []),
  ...(session
    ? [
        '',
        `**AI Credits ${session.credits.toFixed(2)}** (${Math.round(session.apiDurationMs / 1000)}s API) · Tokens ${usageLine(session.totals)}`,
        ...session.perModel.map(
          (m) => `- ${m.model} — ${m.credits.toFixed(2)} credits · ${usageLine(m)} · ${m.requests} request${m.requests === 1 ? '' : 's'}`
        ),
      ]
    : []),
  '',
  `_Source: ${source}. Recorded ${ts} by scripts/record-usage.mjs._`,
  '',
  marker,
];

gh(['issue', 'comment', String(args.issue), '--body-file', '-'], { input: lines.join('\n') });

// Only after the comment landed: mark this point as recorded, so the next
// --from-session run counts fresh usage only (/clear keeps the same session).
if (session) writeCursor(gitRoot(), { sessionId: session.sessionId, lastRowId: session.maxRowId, lastFileId: session.maxFileId });

// A comparison run re-prices a finished task on another model, so its verdict
// says nothing about the original estimate — leave the calibration label alone.
if (verdict !== 'unknown' && !args.comparison) {
  const label = `calibration:${verdict}`;
  const meta = {
    'calibration:on-target': ['2da44e', 'Actual AI spend landed inside the estimated bucket'],
    'calibration:over': ['d1242f', 'Actual AI spend exceeded the estimated bucket'],
    'calibration:under': ['0969da', 'Actual AI spend came in below the estimated bucket'],
  };
  // Only touch labels the issue actually has, and create the label only when
  // applying it fails: seeding a corpus of issues would otherwise blow through
  // GitHub's 80-content-request-per-minute secondary limit.
  const stale = (issue.labels ?? [])
    .map((l) => l.name)
    .filter((n) => n !== label && n in meta)
    .flatMap((n) => ['--remove-label', n]);
  const edit = ['issue', 'edit', String(args.issue), '--add-label', label, ...stale];
  if (gh(edit, { allowFail: true }).status !== 0) {
    ensureLabel(label, ...meta[label]);
    gh(edit);
  }
}

console.log(`Recorded ${credits} credits on issue #${issue.number} ("${issue.title}")`);
console.log(`Estimate: ${bucket ?? 'none'}  →  Verdict: ${verdict}`);
if (!args.comparison) {
  // Open or closed makes no difference: calibration-report reads both.
  console.log(`\nThis task is now part of your sizing history.`);
}
