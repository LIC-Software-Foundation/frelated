import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '../src/components/Dashboard';
import { ToastProvider } from '../src/components/ui/Toast';
import type { CompilationState } from '../src/types';
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  compile: vi.fn(),
  reportError: vi.fn(),
  open: vi.fn(),
  state: {
    status: 'success',
    logs: [],
    pdfUrl: 'blob:last-pdf',
    settings: { mainFile: 'main.tex', engine: 'pdflatex' },
  } as CompilationState,
}));
vi.mock('../src/components/PdfDocument', () => ({
  default: ({ url }: { url: string }) => (
    <div title="Aperçu PDF" data-url={url} />
  ),
}));
vi.mock('../src/components/ProjectEditor', () => ({
  default: ({
    onContentChange,
  }: {
    onContentChange: (content: string) => void;
  }) => (
    <textarea
      aria-label="Source"
      onChange={(event) => onContentChange(event.target.value)}
    />
  ),
}));
vi.mock('../src/hooks/useCompilation', () => ({
  useCompilation: () => ({
    ...mocks.state,
    compile: mocks.compile,
    reportError: mocks.reportError,
    saveSettings: vi.fn(),
  }),
}));
vi.mock('../src/hooks/useProjects', () => {
  const project = {
    id: 'project',
    name: 'Document',
    owner: 'owner@test.dev',
    createdAt: '',
    collaborators: [],
    files: [
      {
        id: 'main',
        name: 'main.tex',
        type: 'tex',
        content: 'hello',
        createdAt: '',
      },
    ],
  };
  return {
    useProjects: () => ({
      projects: [project],
      isLoading: false,
      openProject: mocks.open,
      saveFileContent: mocks.save,
    }),
  };
});
const show = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <Dashboard
          user={{
            id: 'owner',
            email: 'owner@test.dev',
            name: 'Owner',
            joinedAt: '',
          }}
          initialProjectId="project"
        />
      </ToastProvider>
    </MemoryRouter>,
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(undefined);
  mocks.compile.mockResolvedValue(undefined);
  mocks.state.status = 'success';
});
afterEach(cleanup);
describe('Editor compilation commands', () => {
  it('shows Split without compiling and PDF checks freshness', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Split', exact: true }));
    expect(
      (await screen.findByTitle('Aperçu PDF')).getAttribute('data-url'),
    ).toContain('blob:last-pdf');
    expect(mocks.compile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'PDF', exact: true }));
    await waitFor(() => expect(mocks.compile).toHaveBeenCalledWith(true));
    expect(screen.queryByLabelText('Source')).toBeNull();
  });
  it('saves before compiling with Ctrl+S and suppresses browser save', async () => {
    show();
    fireEvent.change(await screen.findByLabelText('Source'), {
      target: { value: 'Updated source' },
    });
    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    await waitFor(() => expect(mocks.compile).toHaveBeenCalledWith(false));
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.save).toHaveBeenCalledWith(
      'project',
      'main',
      'Updated source',
    );
    expect(mocks.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.compile.mock.invocationCallOrder[0],
    );
  });
  it('opens Split on explicit compilation', async () => {
    show();
    fireEvent.click(
      screen.getByRole('button', { name: 'Compiler', exact: true }),
    );
    await waitFor(() => expect(mocks.compile).toHaveBeenCalledWith(false));
    expect(screen.getByLabelText('Source')).toBeTruthy();
    expect(screen.getByTitle('Aperçu PDF')).toBeTruthy();
  });
  it('retries failed saves before submitting', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Save failed'));
    show();
    fireEvent.change(await screen.findByLabelText('Source'), {
      target: { value: 'Unsaved source' },
    });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(mocks.reportError).toHaveBeenCalled());
    expect(mocks.compile).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(mocks.compile).toHaveBeenCalledWith(false));
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it.each(['compiling', 'error'] as const)(
    'keeps last PDF on %s',
    async (status) => {
      mocks.state.status = status;
      show();
      fireEvent.click(
        screen.getByRole('button', { name: 'Split', exact: true }),
      );
      expect(
        (await screen.findByTitle('Aperçu PDF')).getAttribute('data-url'),
      ).toContain('blob:last-pdf');
    },
  );
});
