import type { BottleneckReport, FaultOwner, MistakeLogEntry } from './types.ts';

export interface UrlValidationResult {
  valid: boolean;
  normalizedUrl?: string;
  reason?: string;
}

const PRIVATE_IPV4_PATTERNS = [
  /^127\./,
  /^10\./,
  /^0\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

export function validateExternalUrl(rawUrl: string): UrlValidationResult {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { valid: false, reason: 'URL cannot be empty.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { valid: false, reason: 'Invalid URL format. Include https:// or http://.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only http:// and https:// URLs are permitted.' };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: 'URLs with embedded credentials are not permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return { valid: false, reason: 'URL is missing a hostname.' };
  }

  if (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '::1' ||
    hostname === '::' ||
    hostname.startsWith('fe80:') ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd')
  ) {
    return { valid: false, reason: 'Local, loopback, and private network hosts are blocked.' };
  }

  if (PRIVATE_IPV4_PATTERNS.some((pattern) => pattern.test(hostname))) {
    return { valid: false, reason: 'Private IPv4 addresses are blocked.' };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her',
  'was', 'one', 'our', 'out', 'has', 'have', 'been', 'were', 'they', 'this',
  'that', 'with', 'from', 'will', 'what', 'when', 'where', 'which', 'their',
  'there', 'about', 'would', 'could', 'should', 'into', 'than', 'then', 'them',
  'these', 'those', 'some', 'such', 'only', 'also', 'more', 'most', 'very',
  'being', 'over', 'each', 'other', 'does', 'doing', 'done', 'made', 'make',
]);

export function extractClaimKeywords(text: string, maxKeywords = 14): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9.\-%$ ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
      if (unique.length >= maxKeywords) break;
    }
  }
  return unique;
}

export function evaluateKeywordOverlap(
  claimText: string,
  sourceSnippets: string[],
): { matchedKeywords: string[]; missingKeywords: string[]; matchRatio: number } {
  const keywords = extractClaimKeywords(claimText);
  if (keywords.length === 0) {
    return { matchedKeywords: [], missingKeywords: [], matchRatio: 1 };
  }

  const corpus = sourceSnippets.join(' \n ').toLowerCase();
  const matchedKeywords: string[] = [];
  const missingKeywords: string[] = [];

  for (const kw of keywords) {
    if (corpus.includes(kw)) {
      matchedKeywords.push(kw);
    } else {
      missingKeywords.push(kw);
    }
  }

  const matchRatio = Number((matchedKeywords.length / keywords.length).toFixed(2));
  return { matchedKeywords, missingKeywords, matchRatio };
}

export interface RetryDecision {
  action: 'accept' | 'redo_all' | 'redo_agent2_and_3' | 'cap_with_bottleneck';
  faultOwner: FaultOwner;
}

export function decideNextStepAction(params: {
  attempt: number;
  maxAttempts: number;
  agent2Flagged: boolean;
  agent3Flagged: boolean;
  agent3FaultOwner: FaultOwner;
}): RetryDecision {
  const { attempt, maxAttempts, agent2Flagged, agent3Flagged, agent3FaultOwner } = params;

  if (!agent2Flagged && !agent3Flagged) {
    return { action: 'accept', faultOwner: 'none' };
  }

  let effectiveFault: FaultOwner = 'none';
  if (agent2Flagged && agent3Flagged) {
    effectiveFault = agent3FaultOwner === 'agent2' || agent3FaultOwner === 'both' ? 'both' : 'agent1';
  } else if (agent2Flagged) {
    effectiveFault = 'agent1';
  } else {
    effectiveFault = agent3FaultOwner === 'none' ? 'both' : agent3FaultOwner;
  }

  if (attempt >= maxAttempts) {
    return { action: 'cap_with_bottleneck', faultOwner: effectiveFault };
  }

  if (!agent2Flagged && agent3Flagged && effectiveFault === 'agent2') {
    return { action: 'redo_agent2_and_3', faultOwner: 'agent2' };
  }

  return { action: 'redo_all', faultOwner: effectiveFault };
}

export function formatMistakeContextPrompt(
  mistakes: MistakeLogEntry[],
  currentStepId?: string,
): string {
  if (mistakes.length === 0) {
    return 'No prior mistakes logged in this session.';
  }

  const relevant = currentStepId
    ? [
        ...mistakes.filter((m) => m.stepId === currentStepId),
        ...mistakes.filter((m) => m.stepId !== currentStepId),
      ]
    : mistakes;

  return relevant
    .map(
      (m, idx) =>
        `[${idx + 1}] Step "${m.stepLabel}" (Attempt ${m.attempt}, Flagged by ${m.flaggedBy.toUpperCase()}, Fault: ${m.faultOwner.toUpperCase()}): ${m.reason} -> UNFORGIVABLE MISTAKE: Do NOT repeat this error.`,
    )
    .join('\n');
}

export function ensureBottleneckDisclosures(
  finalAnswer: string,
  reports: BottleneckReport[],
): string {
  if (reports.length === 0) return finalAnswer;

  const lowerAnswer = finalAnswer.toLowerCase();
  const missingReports = reports.filter(
    (r) => !lowerAnswer.includes(r.stepLabel.toLowerCase()),
  );

  if (missingReports.length === 0) {
    return finalAnswer;
  }

  const sectionLines = missingReports.map(
    (r) =>
      `- **${r.stepLabel}** (Unresolved after 4 verification attempts)\n  - **Basis used:** ${r.basisUsed}\n  - **Could not be verified/found:** ${r.missingInformation}\n  - **Why unresolved:** ${r.whyUnresolved}`,
  );

  return `${finalAnswer.trim()}\n\n### Unresolved Verification Disclosures (4-Attempt Cap)\n${sectionLines.join('\n')}`;
}
