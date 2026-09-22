export interface ProofreadingSuggestion {
  value: string;
}

export interface ProofreadingIssue {
  offset: number;
  length: number;
  message: string;
  shortMessage?: string;
  ruleId?: string;
  category?: string;
  type: 'spelling' | 'grammar' | 'typography' | 'style' | 'other';
  suggestions: ProofreadingSuggestion[];
}

export interface ProofreadingResult {
  language: string;
  issues: ProofreadingIssue[];
}

export interface ProofreadingProvider {
  check(
    text: string,
    language: string,
    signal?: AbortSignal,
  ): Promise<ProofreadingResult>;
}
