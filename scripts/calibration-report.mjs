#!/usr/bin/env node
// CALIBRATE stage of the loop: estimate-vs-actual across all sized issues.
//
//   node scripts/calibration-report.mjs           # human table + hit rates
//   node scripts/calibration-report.mjs --json    # machine-readable history
//
// Scans issues labeled `ai-sized` (open + closed), extracts the latest
// <!-- ai-usage {...} --> marker posted by record-usage.mjs, and prints a
// per-issue table plus a per-bucket hit-rate summary — the "velocity chart"
// for your AI-credit sizing.
//
// --json is the interface for agents: one command returns the sizing history
// (title + rationale + which files each task touched, next to estimate/actual)
// so an estimator never has to read issue threads itself. Per-model token
// counts stay out of it — an estimator never needs them, and this is a
// token-optimization workshop.
import { ghJson, representativeMarker, fmtRange, parseBucket, parseRationale, parseArgs } from './lib.mjs';

const args = parseArgs(process.argv.slice(2), { json: 'boolean' });

const issues = ghJson([
  'issue', 'list', '--label', 'ai-sized', '--state', 'all', '--limit', '200',
  '--json', 'number,title,state,body,comments',
]);

if (issues.length === 0) {
  if (args.json) {
    console.log('[]');
  } else {
    console.log('No issues labeled "ai-sized" found. Run scripts/seed-history.sh (or scripts/seed-history.ps1 on Windows), or create one with the AI-sized task form.');
  }
  process.exit(0);
}

const rows = [];
for (const issue of issues.sort((a, b) => a.number - b.number)) {
  rows.push({ issue, marker: representativeMarker(issue.comments) });
}

if (args.json) {
  console.log(JSON.stringify(rows.map(({ issue, marker }) => ({
    number: issue.number,
    state: issue.state.toLowerCase(),
    title: issue.title,
    bucket: marker?.bucket ?? parseBucket(issue.body),
    rationale: parseRationale(issue.body),
    actual: marker?.actual ?? null,
    verdict: marker?.verdict ?? null,
    model: marker?.model ?? null,
    ...(marker?.files && { files: marker.files }),
    ts: marker?.ts ?? null,
  })), null, 2));
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n);
const title = (t) => (t.length > 44 ? `${t.slice(0, 41)}...` : t);

console.log('AI-credit sizing calibration report');
console.log('===================================\n');
console.log([pad('Issue', 7), pad('State', 8), pad('Size', 6), pad('Range', 9), pad('Actual', 8), pad('Verdict', 14), 'Title'].join(''));
console.log('-'.repeat(95));

const byBucket = {};
let recorded = 0;
for (const { issue, marker } of rows) {
  const estimated = marker?.bucket ?? parseBucket(issue.body);
  const size = estimated ?? '—';
  const range = estimated ? fmtRange(estimated) : '—';
  const actual = marker ? marker.actual : '—';
  const verdict = marker ? marker.verdict ?? '—' : 'not recorded';
  console.log([
    pad(`#${issue.number}`, 7), pad(issue.state.toLowerCase(), 8), pad(size, 6),
    pad(range, 9), pad(actual, 8), pad(verdict, 14), title(issue.title),
  ].join(''));
  if (marker?.bucket && marker.verdict) {
    recorded++;
    byBucket[marker.bucket] ??= { hits: 0, total: 0 };
    byBucket[marker.bucket].total++;
    if (marker.verdict === 'on-target') byBucket[marker.bucket].hits++;
  }
}

console.log('');
if (recorded === 0) {
  console.log('No recorded actuals yet — finish a task and run scripts/record-usage.mjs.');
} else {
  const parts = Object.entries(byBucket)
    .sort(([a], [b]) => ['XS', 'S', 'M', 'L', 'XL'].indexOf(a) - ['XS', 'S', 'M', 'L', 'XL'].indexOf(b))
    .map(([bucket, { hits, total }]) => `${bucket} ${hits}/${total} (${Math.round((hits / total) * 100)}%)`);
  const totalHits = Object.values(byBucket).reduce((n, b) => n + b.hits, 0);
  console.log(`Sizing accuracy by bucket:  ${parts.join('   ')}`);
  console.log(`Overall on-target rate:     ${totalHits}/${recorded} (${Math.round((totalHits / recorded) * 100)}%)`);
}
