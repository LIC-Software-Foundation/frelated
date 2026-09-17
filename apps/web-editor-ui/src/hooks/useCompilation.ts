import { useCallback, useEffect, useRef, useState } from 'react';
import { compilationApiService as service } from '../services/api/compilationApiService';
import type { CompilationSettings, CompilationState } from '../types';

const initial: CompilationState = {
  status: 'idle',
  logs: [],
  settings: { mainFile: 'main.tex', engine: 'pdflatex' },
};
export const useCompilation = (projectId: string) => {
  const [state, setState] = useState<CompilationState>(initial);
  const generation = useRef(0);
  const pdf = useRef<{ id?: string; url?: string }>({});
  const latest = useRef<CompilationState>(initial);
  const submitting = useRef(false);
  const project = useRef(projectId);
  project.current = projectId;
  const reportError = useCallback((error: unknown) => {
    setState((previous) => ({
      ...previous,
      status: 'error',
      logs: [
        {
          level: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'Compilation indisponible.',
        },
      ],
    }));
  }, []);
  const apply = useCallback(
    async (next: CompilationState, epoch: number, id: string) => {
      if (epoch !== generation.current || project.current !== id) return;
      if ((next.revision ?? 0) < (latest.current.revision ?? 0)) return;
      if (
        next.revision === latest.current.revision &&
        next.status === 'compiling' &&
        ['success', 'error'].includes(latest.current.status)
      )
        return;
      latest.current = next;
      setState({ ...next, pdfUrl: pdf.current.url });
      if (next.pdfJobId && next.pdfJobId !== pdf.current.id) {
        try {
          const url = await service.fetchPdf(id);
          if (
            epoch !== generation.current ||
            project.current !== id ||
            latest.current.pdfJobId !== next.pdfJobId
          ) {
            URL.revokeObjectURL(url);
            return;
          }
          if (pdf.current.url) URL.revokeObjectURL(pdf.current.url);
          pdf.current = { id: next.pdfJobId, url };
          setState((previous) => ({ ...previous, pdfUrl: url }));
        } catch (error) {
          if (epoch === generation.current) reportError(error);
        }
      }
    },
    [reportError],
  );
  useEffect(() => {
    const epoch = ++generation.current;
    latest.current = initial;
    if (pdf.current.url) URL.revokeObjectURL(pdf.current.url);
    pdf.current = {};
    setState(initial);
    if (!projectId || import.meta.env.VITE_SERVICE_MODE === 'mock') return;
    const update = (next: CompilationState) => {
      // The POST response establishes the new job id. Ignore heartbeat/pubsub
      // snapshots from the preceding job while that request is in flight.
      if (submitting.current) return;
      void apply(next, epoch, projectId);
    };
    void service
      .getState(projectId)
      .then(update)
      .catch((error) => {
        if (epoch === generation.current) reportError(error);
      });
    const unsubscribe = service.subscribe(projectId, update);
    return () => {
      generation.current = epoch + 1;
      unsubscribe();
      if (pdf.current.url) URL.revokeObjectURL(pdf.current.url);
      pdf.current = {};
    };
  }, [projectId, apply, reportError]);
  const compile = useCallback(
    async (onlyIfChanged = false) => {
      const epoch = generation.current;
      try {
        if (import.meta.env.VITE_SERVICE_MODE === 'mock')
          throw new Error(
            'La compilation nécessite le mode API et un worker LaTeX.',
          );
        submitting.current = true;
        const freshState: CompilationState = {
          status: 'compiling',
          logs: [],
          settings: latest.current.settings ?? initial.settings,
          pdfUrl: pdf.current.url,
        };
        latest.current = freshState;
        setState(freshState);
        const response = await service.compileProject(projectId, onlyIfChanged);
        submitting.current = false;
        await apply(response, epoch, projectId);
      } catch (error) {
        submitting.current = false;
        if (epoch === generation.current && project.current === projectId)
          reportError(error);
      }
    },
    [projectId, apply, reportError],
  );
  const saveSettings = useCallback(
    async (settings: CompilationSettings) => {
      const epoch = generation.current;
      try {
        await apply(
          await service.saveSettings(projectId, settings),
          epoch,
          projectId,
        );
      } catch (error) {
        if (epoch === generation.current) reportError(error);
      }
    },
    [projectId, apply, reportError],
  );
  return { ...state, compile, saveSettings, reportError };
};
