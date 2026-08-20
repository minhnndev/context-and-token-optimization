#!/usr/bin/env node
// ESTIMATE stage of the loop: write a credit estimate onto an unsized issue.
//
//   node scripts/set-estimate.mjs --issue 14 --size S --rationale "..."
//
// Fills the issue form's "AI credit size" and "Sizing rationale" sections,
// applies the size:X label, and posts the rationale with a machine-readable
// <!-- ai-estimate {...} --> marker. The estimate has to land in the body
// because that is where record-usage.mjs reads it from when the task is done —
// which is what turns an estimate into a verdict later.
//
// The judgement is the agent's (see .github/skills/estimate-aic-cost); this
// script is the deterministic write path, so nothing is invented here.
import { gh, ghJson, BUCKETS, fmtRange, replaceSection, buildMarker, ensureLabel, parseArgs } from './lib.mjs';

const HELP = `Usage:
  node scripts/set-estimate.mjs --issue N --size XS|S|M|L|XL --rationale "why this bucket"
       [--analogues "#3, #7"]   issues the estimate was reasoned from`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    issue: 'number', size: 'string', rationale: 'string', analogues: 'string', help: 'boolean',
  });
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(1);
}

if (args.help || !args.issue || !args.size || !args.rationale) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}

const size = args.size.toUpperCase();
if (!BUCKETS[size]) {
  console.error(`Unknown size "${args.size}". Use one of: ${Object.keys(BUCKETS).join(', ')}`);
  process.exit(1);
}

const issue = ghJson(['issue', 'view', String(args.issue), '--json', 'number,title,body,labels']);

// Mirror the issue form's dropdown wording exactly, so an estimated issue
// reads identically to a hand-filled one and parseBucket reads it back.
const SIZE_LINES = {
  XS: 'XS — up to 10 credits',
  S: 'S — 11–30 credits',
  M: 'M — 31–75 credits',
  L: 'L — 76–150 credits',
  XL: 'XL — over 150 credits (consider splitting the task)',
};
const sizeLine = SIZE_LINES[size];
const rationale = args.analogues
  ? `${args.rationale}\n\nEstimated from recorded history: ${args.analogues}.`
  : args.rationale;

let body = replaceSection(issue.body, 'AI credit size', sizeLine);
body = replaceSection(body, 'Sizing rationale', rationale);
gh(['issue', 'edit', String(args.issue), '--body-file', '-'], { input: body });

const label = `size:${size}`;
const stale = (issue.labels ?? [])
  .map((l) => l.name)
  .filter((n) => n !== label && /^size:(XS|S|M|L|XL)$/.test(n))
  .flatMap((n) => ['--remove-label', n]);
const edit = ['issue', 'edit', String(args.issue), '--add-label', label, ...stale];
if (gh(edit, { allowFail: true }).status !== 0) {
  ensureLabel(label, '8250df', `Estimated ${fmtRange(size)} AI credits`);
  gh(edit);
}

const marker = buildMarker(
  { size, min: BUCKETS[size].min, max: BUCKETS[size].max === Infinity ? null : BUCKETS[size].max,
    analogues: args.analogues ?? null, ts: new Date().toISOString() },
  'ai-estimate'
);
gh(['issue', 'comment', String(args.issue), '--body-file', '-'], {
  input: [
    '## 📐 AI credit estimate',
    '',
    `**${size}** — ${fmtRange(size)} credits`,
    '',
    rationale,
    '',
    '_Estimated from recorded actuals on this repo by scripts/set-estimate.mjs._',
    '',
    marker,
  ].join('\n'),
});

console.log(`Issue #${issue.number} ("${issue.title}") estimated ${size} (${fmtRange(size)} credits)`);
console.log(`Next: cap the session at the top of the bucket, then record the actual when it is done.`);
