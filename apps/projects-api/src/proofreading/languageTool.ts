import { env } from '../config/env';
import type {
  ProofreadingIssue,
  ProofreadingProvider,
  ProofreadingResult,
} from './types';

interface LanguageToolResponse {
  language?: { code?: string };
  matches?: Array<{
    offset?: number;
    length?: number;
    message?: string;
    shortMessage?: string;
    replacements?: Array<{ value?: string }>;
    rule?: {
      id?: string;
      issueType?: string;
      category?: { id?: string; name?: string };
    };
  }>;
}

const issueType = (issue?: string): ProofreadingIssue['type'] => {
  if (issue === 'misspelling') return 'spelling';
  if (issue === 'typographical') return 'typography';
  if (issue === 'grammar') return 'grammar';
  if (issue === 'style' || issue === 'duplication') return 'style';
  return 'other';
};

export class LanguageToolProofreadingProvider implements ProofreadingProvider {
  async check(
    text: string,
    language: string,
    signal?: AbortSignal,
  ): Promise<ProofreadingResult> {
    const body = new URLSearchParams({
      text,
      language: language === 'auto' ? 'auto' : language,
      enabledOnly: 'false',
    });
    if (env.languageToolApiKey) {
      body.set('apiKey', env.languageToolApiKey);
    }
    const timeout = AbortSignal.timeout(12_000);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeout])
      : timeout;
    const response = await fetch(env.languageToolUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: combinedSignal,
    });
    if (!response.ok) {
      throw new Error(`PROOFREADING_PROVIDER_${response.status}`);
    }
    const payload = (await response.json()) as LanguageToolResponse;
    return {
      language: payload.language?.code || language,
      issues: (payload.matches ?? [])
        .filter(
          (match) =>
            Number.isInteger(match.offset) &&
            Number.isInteger(match.length) &&
            (match.length ?? 0) > 0,
        )
        .map((match) => ({
          offset: match.offset!,
          length: match.length!,
          message: match.message || 'Problème linguistique détecté.',
          shortMessage: match.shortMessage || undefined,
          ruleId: match.rule?.id,
          category: match.rule?.category?.name || match.rule?.category?.id,
          type: issueType(match.rule?.issueType),
          suggestions: (match.replacements ?? [])
            .flatMap((replacement) =>
              replacement.value ? [{ value: replacement.value }] : [],
            )
            .slice(0, 8),
        })),
    };
  }
}
