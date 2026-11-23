import { GoogleGenAI, ThinkingLevel, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai';

const globalForGenAI = globalThis as unknown as {
  __aegisGenAIClient?: GoogleGenAI;
  __aegisLiveGenAIClient?: GoogleGenAI;
};

export function getGenAIClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  if (!globalForGenAI.__aegisGenAIClient) {
    globalForGenAI.__aegisGenAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return globalForGenAI.__aegisGenAIClient;
}

export function getLiveGenAIClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured in server environment secrets.');
  }
  if (!globalForGenAI.__aegisLiveGenAIClient) {
    globalForGenAI.__aegisLiveGenAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      apiVersion: 'v1beta',
      httpOptions: {
        baseUrl: 'https://generativelanguage.googleapis.com',
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return globalForGenAI.__aegisLiveGenAIClient;
}

export interface FreeModelTier {
  model: string;
  thinkingLevel?: ThinkingLevel;
  label: string;
}

// Ordered strictly from best available free model/thinking capability down to fast fallback
export const FREE_REASONING_TIERS: FreeModelTier[] = [
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.XHIGH,
    label: 'gemini-4-hydrogen (XHIGH)',
  },
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.HIGH,
    label: 'gemini-4-hydrogen (HIGH)',
  },
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.MEDIUM,
    label: 'gemini-4-hydrogen (MEDIUM)',
  },
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.LOW,
    label: 'gemini-4-hydrogen (LOW)',
  },
  {
    model: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite (Fast Fallback)',
  },
];

export const FREE_STANDARD_TIERS: FreeModelTier[] = [
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.HIGH,
    label: 'gemini-4-hydrogen (HIGH)',
  },
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.MEDIUM,
    label: 'gemini-4-hydrogen (MEDIUM)',
  },
  {
    model: 'gemini-4-hydrogen',
    thinkingLevel: ThinkingLevel.LOW,
    label: 'gemini-4-hydrogen (LOW)',
  },
  {
    model: 'gemini-3.1-flash-lite',
    label: 'gemini-3.1-flash-lite (Fast Fallback)',
  },
];

function extractErrorDetails(err: unknown): {
  retriable: boolean;
  reason: string;
  isAuthError: boolean;
  isRateOrQuota: boolean;
  isServiceBusy: boolean;
  retryDelayMs: number | null;
} {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('permission_denied') ||
    lower.includes('403')
  ) {
    return {
      retriable: false,
      reason: message,
      isAuthError: true,
      isRateOrQuota: false,
      isServiceBusy: false,
      retryDelayMs: null,
    };
  }

  const isRateOrQuota =
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('rate limit');

  const isServiceBusy =
    lower.includes('503') ||
    lower.includes('unavailable') ||
    lower.includes('overloaded') ||
    lower.includes('500') ||
    lower.includes('deadline') ||
    lower.includes('timeout') ||
    lower.includes('timed out');

  const isUnsupportedConfig =
    lower.includes('thinking') ||
    lower.includes('not found') ||
    lower.includes('404') ||
    lower.includes('400');

  let retryDelayMs: number | null = null;
  const delayMatch = message.match(/retry(?:Delay| in)\s*[:=]?\s*"?(\d+(?:\.\d+)?)\s*s(?:\b|$)/i);
  if (delayMatch?.[1]) {
    const secs = parseFloat(delayMatch[1]);
    if (Number.isFinite(secs) && secs > 0 && secs <= 10) {
      retryDelayMs = Math.ceil(secs * 1000) + 250;
    }
  }

  return {
    retriable: isRateOrQuota || isServiceBusy || isUnsupportedConfig,
    reason: message,
    isAuthError: false,
    isRateOrQuota,
    isServiceBusy,
    retryDelayMs,
  };
}

function summarizeErrorReason(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error?.message) {
      const code = parsed.error.code ? `${parsed.error.code} ` : '';
      return `${code}${parsed.error.message}`;
    }
  } catch {
    // Non-JSON error string
  }
  return raw.length > 220 ? `${raw.slice(0, 220)}...` : raw;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FallbackCallOptions {
  contents: GenerateContentParameters['contents'];
  config?: GenerateContentParameters['config'];
  preferDeepReasoning?: boolean;
  onFallback?: (fromLabel: string, toLabel: string, reason: string) => void;
}

export async function generateWithFreeFallback(
  options: FallbackCallOptions,
): Promise<{ response: GenerateContentResponse; modelLabel: string; modelName: string }> {
  const ai = getGenAIClient();
  const tiers = options.preferDeepReasoning ? FREE_REASONING_TIERS : FREE_STANDARD_TIERS;
  const attemptedFailures: string[] = [];
  let lastError: unknown;

  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];

    const baseConfig = { ...(options.config ?? {}) };
    if (tier.thinkingLevel) {
      baseConfig.thinkingConfig = { thinkingLevel: tier.thinkingLevel };
    } else {
      delete baseConfig.thinkingConfig;
    }

    // Never pass maxOutputTokens with thinking models
    if (tier.model.startsWith('gemini-4')) {
      delete baseConfig.maxOutputTokens;
    }

    let transientRetries = 0;
    const maxTransientRetries = 1;

    while (true) {
      try {
        const response = await ai.models.generateContent({
          model: tier.model,
          contents: options.contents,
          config: baseConfig,
        });
        return { response, modelLabel: tier.label, modelName: tier.model };
      } catch (err) {
        lastError = err;
        const details = extractErrorDetails(err);

        if (details.isAuthError || !details.retriable) {
          throw new Error(
            `Gemini API authorization/request error on ${tier.label}: ${summarizeErrorReason(details.reason)}`,
          );
        }

        if (details.isRateOrQuota) {
          if (details.retryDelayMs && transientRetries < 1) {
            transientRetries++;
            await sleep(details.retryDelayMs);
            continue;
          }
          attemptedFailures.push(`${tier.label}: Quota/Rate limit (${summarizeErrorReason(details.reason)})`);
          break;
        }

        if (details.isServiceBusy && transientRetries < maxTransientRetries) {
          transientRetries++;
          await sleep(900 * transientRetries + Math.floor(Math.random() * 350));
          continue;
        }

        attemptedFailures.push(`${tier.label}: ${summarizeErrorReason(details.reason)}`);
        break;
      }
    }

    const nextTier = tiers[i + 1];
    if (nextTier && options.onFallback) {
      const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
      options.onFallback(tier.label, nextTier.label, summarizeErrorReason(errMsg));
    }
  }

  throw new Error(
    `Execution stopped: all free model tiers failed (${attemptedFailures.join(' | ')}). Please wait a moment for rate limits to reset or check your API key quota in Settings > Secrets.`,
  );
}
