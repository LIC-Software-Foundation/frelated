import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompilationState } from '../src/types';
import { useCompilation } from '../src/hooks/useCompilation';
const mock = vi.hoisted(() => ({
  getState: vi.fn(),
  compileProject: vi.fn(),
  fetchPdf: vi.fn(),
  saveSettings: vi.fn(),
  subscribe: vi.fn(),
  listener: undefined as undefined | ((state: CompilationState) => void),
}));
vi.mock('../src/services/api/compilationApiService', () => ({
  compilationApiService: mock,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.getState.mockResolvedValue({ status: 'idle', revision: 0, logs: [] });
  mock.fetchPdf.mockResolvedValue('blob:pdf');
  mock.subscribe.mockImplementation(
    (_id: string, callback: (state: CompilationState) => void) => {
      mock.listener = callback;
      return vi.fn();
    },
  );
  vi.stubGlobal('URL', { revokeObjectURL: vi.fn() });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('ignores older results, retains the PDF on error and loads collaborator results', async () => {
  const { result } = renderHook(() => useCompilation('project'));
  await waitFor(() => expect(mock.subscribe).toHaveBeenCalled());
  act(() =>
    mock.listener?.({
      status: 'success',
      revision: 2,
      pdfJobId: 'second',
      logs: [],
    }),
  );
  await waitFor(() => expect(result.current.pdfUrl).toBe('blob:pdf'));
  expect(result.current.displayedPdfJobId).toBe('second');
  act(() =>
    mock.listener?.({
      status: 'success',
      revision: 1,
      pdfJobId: 'first',
      logs: [],
    }),
  );
  expect(result.current.revision).toBe(2);
  act(() =>
    mock.listener?.({
      status: 'compiling',
      revision: 3,
      pdfJobId: 'second',
      logs: [],
    }),
  );
  expect(result.current.pdfUrl).toBe('blob:pdf');
  expect(result.current.displayedPdfJobId).toBe('second');
  act(() =>
    mock.listener?.({
      status: 'error',
      revision: 3,
      pdfJobId: 'second',
      logs: [{ level: 'error', message: 'LaTeX error' }],
    }),
  );
  expect(result.current.pdfUrl).toBe('blob:pdf');
  expect(result.current.status).toBe('error');
});
it('never displays a delayed PDF after changing project', async () => {
  let resolvePdf!: (url: string) => void;
  mock.fetchPdf.mockReturnValue(
    new Promise<string>((resolve) => {
      resolvePdf = resolve;
    }),
  );
  const { result, rerender } = renderHook(({ id }) => useCompilation(id), {
    initialProps: { id: 'first' },
  });
  await waitFor(() => expect(mock.subscribe).toHaveBeenCalled());
  act(() =>
    mock.listener?.({
      status: 'success',
      revision: 1,
      pdfJobId: 'first',
      logs: [],
    }),
  );
  rerender({ id: 'second' });
  await act(async () => resolvePdf('blob:old'));
  expect(result.current.pdfUrl).toBeUndefined();
  expect(result.current.displayedPdfJobId).toBeUndefined();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:old');
});
