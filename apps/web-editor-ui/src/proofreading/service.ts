import type { ProofreadingCheckResponse } from '@frelated/types';
import { apiFetch } from '../services/api/http';

export const checkProofreading = (
  text: string,
  language: 'fr' | 'en' | 'auto',
  signal?: AbortSignal,
) =>
  apiFetch<ProofreadingCheckResponse>('/proofreading/check', {
    method: 'POST',
    body: JSON.stringify({ text, language }),
    signal,
  });
