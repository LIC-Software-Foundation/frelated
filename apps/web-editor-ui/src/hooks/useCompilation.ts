import { useCallback, useState } from 'react';
import { appServices } from '../services';
import { CompilationState } from '../types';

export interface UseCompilationReturn extends CompilationState {
  compile: () => void;
}

export const useCompilation = (projectId: string): UseCompilationReturn => {
  const [state, setState] = useState<CompilationState>({
    status: 'idle',
    logs: [],
  });

  const compile = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'compiling', logs: [] }));

    void appServices.compilation.compileProject(projectId).then((result) => {
      setState(result);
    });
  }, [projectId]);

  return { ...state, compile };
};
