import { env } from '../config/env';
import { LanguageToolProofreadingProvider } from './languageTool';
import type { ProofreadingProvider } from './types';

class DisabledProofreadingProvider implements ProofreadingProvider {
  async check(_text: string, language: string) {
    return { language, issues: [] };
  }
}

export const proofreadingProvider: ProofreadingProvider =
  env.proofreadingProvider === 'disabled'
    ? new DisabledProofreadingProvider()
    : new LanguageToolProofreadingProvider();
