import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRationale, parseBucket, parsePlannedModel, replaceSection, buildMarker, extractMarker,
  representativeMarker,
} from '../lib.mjs';

const body = (rationale) => `### Task description

Fix the gauge.

### AI credit size

XS — up to 10 credits

### Sizing rationale

${rationale}
`;

test('parseRationale reads the multi-line textarea section', () => {
  assert.equal(
    parseRationale(body('Single named file, clear repro,\none test cycle expected.')),
    'Single named file, clear repro,\none test cycle expected.'
  );
});

test('parseRationale returns null for empty or unanswered fields', () => {
  assert.equal(parseRationale(body('_No response_')), null);
  assert.equal(parseRationale(body('')), null);
  assert.equal(parseRationale('no such section'), null);
  assert.equal(parseRationale(null), null);
});

test('parseRationale stops at the next section heading', () => {
  assert.equal(parseRationale(body('why\n\n### Extra section\n\nnot rationale')), 'why');
});

const unsized = `### Task description

Add a PEAK line under the gauges.

Verify: \`node console/src/dash.mjs --once\`.

### AI credit size

_Not sized yet — Lab 4 estimates this one._

### Planned model

auto

### Sizing rationale

_Not sized yet._
`;

test('replaceSection fills an estimate in without disturbing other sections', () => {
  const filled = replaceSection(unsized, 'AI credit size', 'S — 11–30 credits');
  assert.equal(parseBucket(filled), 'S');
  assert.equal(parsePlannedModel(filled), 'auto');
  assert.match(filled, /Add a PEAK line under the gauges\./);
  assert.match(filled, /Verify: `node console\/src\/dash\.mjs --once`\./); // blank lines inside a section survive
  assert.doesNotMatch(filled, /Not sized yet — Lab 4/);
});

test('replaceSection round-trips a multi-line rationale', () => {
  let b = replaceSection(unsized, 'AI credit size', 'M — 31–75 credits');
  b = replaceSection(b, 'Sizing rationale', 'Closest analogues:\n- #7 (M, 38.2)\n- #9 (M, 12.6)');
  assert.equal(parseBucket(b), 'M');
  assert.equal(parseRationale(b), 'Closest analogues:\n- #7 (M, 38.2)\n- #9 (M, 12.6)');
});

test('replaceSection appends the section when the issue has none', () => {
  const b = replaceSection('Just a plain issue body.', 'AI credit size', 'XS — up to 10 credits');
  assert.equal(parseBucket(b), 'XS');
  assert.match(b, /^Just a plain issue body\./);
});

test('extractMarker keeps ai-usage and ai-estimate markers apart', () => {
  const usage = buildMarker({ actual: 4.2 });
  const estimate = buildMarker({ size: 'S' }, 'ai-estimate');
  assert.equal(extractMarker(usage).actual, 4.2);
  assert.equal(extractMarker(usage, 'ai-estimate'), null);
  assert.equal(extractMarker(estimate, 'ai-estimate').size, 'S');
  assert.equal(extractMarker(estimate), null);
});

test('a --comparison run never overwrites what the task actually cost', () => {
  const comments = [
    { body: `real run\n${buildMarker({ bucket: 'XS', actual: 4.46, verdict: 'on-target' })}` },
    { body: `opus re-run\n${buildMarker({ bucket: 'XS', actual: 22.3, verdict: 'over', comparison: true })}` },
  ];
  assert.equal(representativeMarker(comments).actual, 4.46);
});

test('representativeMarker keeps the latest genuine recording, and copes with none', () => {
  const genuine = (actual) => ({ body: buildMarker({ actual }) });
  assert.equal(representativeMarker([genuine(4), genuine(9)]).actual, 9); // a real re-record still wins
  assert.equal(representativeMarker([{ body: 'just a chat comment' }]), null);
  assert.equal(representativeMarker([]), null);
  assert.equal(representativeMarker(undefined), null);
  assert.equal(representativeMarker([{ body: buildMarker({ actual: 5, comparison: true }) }]), null);
});
