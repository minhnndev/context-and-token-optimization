#!/usr/bin/env node
// BUDGET + RECORD, automated: run a Copilot CLI prompt under a credit budget
// and record actuals on the issue in one step. This is the automation path;
// the primary lab path is manual (/usage → record-usage.mjs).
//
//   node scripts/run-budgeted.mjs --issue 12 --budget 30 [--model NAME] -- "fix the date parsing bug in sample-app"
//
// Wraps: copilot -p "<prompt>" --max-ai-credits=<budget> -s --output-format json --no-ask-user
//
// DEFENSIVE BY DESIGN: --output-format json and --max-ai-credits are public
// preview (July 2026) and their output shape may drift. If usage data cannot
// be parsed from the JSONL stream, this script prints the raw candidate lines
// and tells you how to record manually — it never dead-ends a demo.
// TODO(session-b): verify the JSONL usage schema against the pinned CLI
// version and tighten the parser.
import { spawnSync } from 'node:child_process';
import { parseArgs } from './lib.mjs';

const HELP = `Usage:
  node scripts/run-budgeted.mjs --issue N --budget CREDITS [--model NAME] -- "PROMPT"`;

let args;
try {
  args = parseArgs(process.argv.slice(2), {
    issue: 'number', budget: 'number', model: 'string', help: 'boolean',
  });
} catch (e) {
  console.error(`${e.message}\n\n${HELP}`);
  process.exit(1);
}
const prompt = args._.join(' ').trim();
if (args.help || !args.issue || !args.budget || !prompt) {
  console.log(HELP);
  process.exit(args.help ? 0 : 1);
}

const copilotArgs = [
  '-p', prompt,
  `--max-ai-credits=${args.budget}`,
  '-s',
  '--output-format', 'json',
  '--no-ask-user',
  ...(args.model ? ['--model', args.model] : []),
];
console.log(`Running: copilot ${copilotArgs.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}\n`);

const res = spawnSync('copilot', copilotArgs, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
if (res.error) {
  console.error(`Could not run the Copilot CLI: ${res.error.message}`);
  console.error('Install it with: npm install -g @github/copilot   (Node 22+ required)');
  process.exit(1);
}
process.stdout.write(res.stdout ?? '');

// Parse the JSONL stream for anything that looks like a usage record.
const events = (res.stdout ?? '')
  .split(/\r?\n/)
  .filter((l) => l.trim().startsWith('{'))
  .flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });

const looksLikeUsage = (obj) => {
  const keys = JSON.stringify(Object.keys(flatten(obj))).toLowerCase();
  return /credit|token|usage/.test(keys);
};
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const usageEvents = events.filter(looksLikeUsage);
let credits = null;
let inputTokens = null;
let outputTokens = null;
let cachedTokens = null;
for (const ev of usageEvents) {
  const flat = flatten(ev);
  for (const [k, v] of Object.entries(flat)) {
    if (typeof v !== 'number') continue;
    const key = k.toLowerCase();
    if (/credit/.test(key) && !/max|limit|remaining/.test(key)) credits = v;
    if (/cach/.test(key) && /token/.test(key)) {
      cachedTokens = (cachedTokens ?? 0) + v;
    } else if (/input.*token|prompt.*token/.test(key)) {
      inputTokens = (inputTokens ?? 0) + v;
    } else if (/output.*token|completion.*token/.test(key)) {
      outputTokens = (outputTokens ?? 0) + v;
    }
  }
}

const record = (recordArgs) => {
  const r = spawnSync('node', ['scripts/record-usage.mjs', '--issue', String(args.issue), ...recordArgs], {
    encoding: 'utf8', stdio: 'inherit',
  });
  process.exit(r.status ?? 0);
};

if (credits !== null) {
  console.log(`\nParsed ${credits} credits from the session output — recording on issue #${args.issue}.`);
  record(['--credits', String(credits), '--notes', `automated via run-budgeted.mjs, budget ${args.budget}`]);
} else if (inputTokens !== null && outputTokens !== null && args.model) {
  const cachedNote = cachedTokens !== null ? ` / ${cachedTokens} cache-read` : '';
  console.log(`\nParsed token counts (${inputTokens} in / ${outputTokens} out${cachedNote}) — converting via rates.json and recording.`);
  record(['--input-tokens', String(inputTokens), '--output-tokens', String(outputTokens),
    ...(cachedTokens !== null ? ['--cached-tokens', String(cachedTokens)] : []),
    '--model', args.model,
    '--notes', `automated via run-budgeted.mjs, budget ${args.budget}`]);
} else {
  console.log('\n⚠️  Could not identify a usage record in the JSON output (preview format may have changed).');
  if (usageEvents.length > 0) {
    console.log('Candidate events that mentioned usage/tokens/credits:');
    for (const ev of usageEvents.slice(-5)) console.log(`  ${JSON.stringify(ev)}`);
  }
  console.log('\nFallback: read your numbers from /usage (or the lines above) and record manually:');
  console.log(`  node scripts/record-usage.mjs --issue ${args.issue} --credits <X>`);
}
