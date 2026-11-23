import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideNextStepAction,
  ensureBottleneckDisclosures,
  evaluateKeywordOverlap,
  formatMistakeContextPrompt,
  stripHtmlToText,
  validateExternalUrl,
} from './pipeline-rules';
import type { BottleneckReport, MistakeLogEntry } from './types';

test('validateExternalUrl accepts valid public https/http URLs and rejects SSRF targets', () => {
  assert.equal(validateExternalUrl('https://arxiv.org/abs/2401.00001').valid, true);
  assert.equal(validateExternalUrl('http://example.com/docs').valid, true);

  assert.equal(validateExternalUrl('http://localhost:3000/api').valid, false);
  assert.equal(validateExternalUrl('http://127.0.0.1:8080').valid, false);
  assert.equal(validateExternalUrl('http://169.254.169.254/latest/meta-data/').valid, false);
  assert.equal(validateExternalUrl('http://10.0.0.5/internal').valid, false);
  assert.equal(validateExternalUrl('http://192.168.1.1').valid, false);
  assert.equal(validateExternalUrl('http://172.16.0.1').valid, false);
  assert.equal(validateExternalUrl('ftp://example.com/file').valid, false);
  assert.equal(validateExternalUrl('https://user:pass@example.com').valid, false);
});

test('evaluateKeywordOverlap measures grounded vs ungrounded terms deterministically', () => {
  const result = evaluateKeywordOverlap(
    'Transformer models reached 94.2% accuracy on ImageNet benchmark.',
    ['Recent benchmark evaluations confirm transformer models reached 94.2% accuracy on ImageNet validation sets.'],
  );
  assert.equal(result.matchedKeywords.includes('transformer'), true);
  assert.equal(result.matchedKeywords.includes('94.2%'), true);
  assert.equal(result.missingKeywords.length, 0);
  assert.equal(result.matchRatio, 1);

  const hallucinated = evaluateKeywordOverlap(
    'Quantum hyperdrive operates at 9000 gigawatts inside Mars.',
    ['Solar panels generate electricity using photovoltaic cells.'],
  );
  assert.equal(hallucinated.matchRatio, 0);
  assert.equal(hallucinated.missingKeywords.includes('quantum'), true);
});

test('decideNextStepAction enforces exact selective redo and 4th-attempt bottleneck cap', () => {
  // Clean pass
  assert.deepEqual(
    decideNextStepAction({
      attempt: 1,
      maxAttempts: 4,
      agent2Flagged: false,
      agent3Flagged: false,
      agent3FaultOwner: 'none',
    }),
    { action: 'accept', faultOwner: 'none' },
  );

  // Agent 2 flags Agent 1 -> redo all 3 agents
  assert.deepEqual(
    decideNextStepAction({
      attempt: 1,
      maxAttempts: 4,
      agent2Flagged: true,
      agent3Flagged: false,
      agent3FaultOwner: 'none',
    }),
    { action: 'redo_all', faultOwner: 'agent1' },
  );

  // Agent 3 flags only Agent 2 -> redo ONLY Agent 2 and Agent 3
  assert.deepEqual(
    decideNextStepAction({
      attempt: 2,
      maxAttempts: 4,
      agent2Flagged: false,
      agent3Flagged: true,
      agent3FaultOwner: 'agent2',
    }),
    { action: 'redo_agent2_and_3', faultOwner: 'agent2' },
  );

  // Agent 3 flags Agent 1 -> redo all
  assert.deepEqual(
    decideNextStepAction({
      attempt: 2,
      maxAttempts: 4,
      agent2Flagged: false,
      agent3Flagged: true,
      agent3FaultOwner: 'agent1',
    }),
    { action: 'redo_all', faultOwner: 'agent1' },
  );

  // 4th attempt failure -> cap with bottleneck disclosure
  assert.deepEqual(
    decideNextStepAction({
      attempt: 4,
      maxAttempts: 4,
      agent2Flagged: true,
      agent3Flagged: true,
      agent3FaultOwner: 'both',
    }),
    { action: 'cap_with_bottleneck', faultOwner: 'both' },
  );
});

test('formatMistakeContextPrompt prioritizes current step mistakes with unforgivable directive', () => {
  const mistakes: MistakeLogEntry[] = [
    {
      id: 'm1',
      stepId: 'part-1',
      stepLabel: 'Part 1: Baseline',
      attempt: 1,
      flaggedBy: 'agent2',
      faultOwner: 'agent1',
      reason: 'Cited unsupported 2027 revenue number.',
      resolutionNote: 'Retrying',
      timestamp: 1000,
    },
  ];
  const prompt = formatMistakeContextPrompt(mistakes, 'part-1');
  assert.match(prompt, /UNFORGIVABLE MISTAKE/);
  assert.match(prompt, /Cited unsupported 2027 revenue number/);
});

test('stripHtmlToText removes scripts, styles, and tags cleanly', () => {
  const text = stripHtmlToText(
    '<html><head><script>alert(1)</script><style>.x{color:red}</style></head><body><h1>Title</h1><p>Hello &amp; world</p></body></html>',
  );
  assert.equal(text, 'Title\nHello & world');
});

test('ensureBottleneckDisclosures appends missing basis/missing/why report for 4-attempt unresolved steps', () => {
  const reports: BottleneckReport[] = [
    {
      stepId: 'part-2',
      stepLabel: 'Part 2: Private 2026 Audit',
      basisUsed: '2025 SEC Form 10-K baseline revenue',
      missingInformation: 'Audited Q4 2026 private subsidiary breakdown',
      whyUnresolved: 'Not published in public filings or attached documents',
    },
  ];
  const output = ensureBottleneckDisclosures('Verified baseline answer.', reports);
  assert.match(output, /Basis used:/);
  assert.match(output, /Could not be verified\/found:/);
  assert.match(output, /Why unresolved:/);
  assert.match(output, /Part 2: Private 2026 Audit/);
});
