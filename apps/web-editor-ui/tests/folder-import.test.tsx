import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import FolderImportModal from '../src/components/FolderImportModal';
import { ToastContext } from '../src/components/ui/ToastContext';
import { useProjects } from '../src/hooks/useProjects';
import type { ProjectWithFiles } from '../src/types';

const services = vi.hoisted(() => ({ list: vi.fn(), replace: vi.fn() }));
vi.mock('../src/services', () => ({
  appServices: {
    projects: {
      listProjects: services.list,
      replaceProjectFiles: services.replace,
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fileAt(path: string, content = 'source') {
  const file = new File([content], path.split('/').at(-1)!, {
    type: 'text/plain',
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

function show(existingNames: string[] = []) {
  const onImport = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const toast = vi.fn();
  render(
    <ToastContext.Provider value={{ toast }}>
      <FolderImportModal
        isOpen
        parentLabel="la racine du projet"
        existingNames={existingNames}
        progress={null}
        onClose={onClose}
        onImport={onImport}
      />
    </ToastContext.Provider>,
  );
  return { onImport, onClose, toast };
}

it('accumulates multiple folder selections and imports their hierarchy in a single batch', () => {
  const { onImport } = show();
  const input = screen.getByLabelText('Ajouter des dossiers à importer');
  fireEvent.change(input, {
    target: { files: [fileAt('chapitres/main.tex')] },
  });
  fireEvent.change(input, {
    target: {
      files: [
        fileAt('images/figures/plot.png'),
        fileAt('bibliographie/references.bib'),
      ],
    },
  });
  expect(onImport).not.toHaveBeenCalled();
  expect(screen.getByText('3 dossiers · 3 fichiers')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Importer 3 dossiers' }));
  expect(onImport).toHaveBeenCalledTimes(1);
  expect(
    onImport.mock.calls[0][0].map((file: { path: string }) => file.path),
  ).toEqual([
    'chapitres/main.tex',
    'images/figures/plot.png',
    'bibliographie/references.bib',
  ]);
});

it('removes a selected folder and keeps identically named folders separate', () => {
  const { onImport } = show(['images']);
  const input = screen.getByLabelText('Ajouter des dossiers à importer');
  fireEvent.change(input, { target: { files: [fileAt('images/first.png')] } });
  fireEvent.change(input, { target: { files: [fileAt('images/second.png')] } });
  expect(screen.getByText('images (2)')).toBeTruthy();
  expect(screen.getByText('images (3)')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retirer le dossier images (2)' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Importer le dossier' }));
  expect(
    onImport.mock.calls[0][0].map((file: { path: string }) => file.path),
  ).toEqual(['images (3)/second.png']);
});

it('adds consecutive native folder picker results without starting an import', async () => {
  const folder = (name: string) => ({
    name,
    kind: 'directory',
    values: async function* () {
      yield {
        name: 'main.tex',
        kind: 'file',
        getFile: async () => fileAt(`${name}/main.tex`),
      };
    },
  });
  const picker = vi
    .fn()
    .mockResolvedValueOnce(folder('premier'))
    .mockResolvedValueOnce(folder('second'));
  vi.stubGlobal('showDirectoryPicker', picker);
  const { onImport } = show();
  fireEvent.click(screen.getByRole('button', { name: 'Choisir un dossier' }));
  await screen.findByText('premier');
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un dossier' }));
  await screen.findByText('second');
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Importer 2 dossiers' }));
  expect(onImport.mock.calls[0][0]).toHaveLength(2);
});

it('reads multiple dropped folders including all batches and nested files', async () => {
  const fileEntry = (name: string) => ({
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve: (file: File) => void) => resolve(fileAt(name)),
  });
  const directory = (name: string, batches: unknown[][]) => ({
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let index = 0;
      return {
        readEntries: (resolve: (entries: unknown[]) => void) =>
          resolve(batches[index++] ?? []),
      };
    },
  });
  const entries = [
    directory('chapitres', [[fileEntry('a.tex')], [fileEntry('b.tex')]]),
    directory('images', [[directory('figures', [[fileEntry('plot.png')]])]]),
  ];
  const { onImport } = show();
  const dropzone = screen.getByText(
    'Glissez un ou plusieurs dossiers ici',
  ).parentElement!;
  fireEvent.drop(dropzone, {
    dataTransfer: {
      items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    },
  });
  await screen.findByText('2 dossiers · 3 fichiers');
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Importer 2 dossiers' }));
  expect(
    onImport.mock.calls[0][0].map((file: { path: string }) => file.path),
  ).toEqual(['chapitres/a.tex', 'chapitres/b.tex', 'images/figures/plot.png']);
});

it('preserves the existing selection after a folder read fails and allows cancellation', async () => {
  vi.stubGlobal(
    'showDirectoryPicker',
    vi.fn().mockRejectedValue(new Error('Read failed')),
  );
  const { onImport, onClose, toast } = show();
  fireEvent.change(screen.getByLabelText('Ajouter des dossiers à importer'), {
    target: { files: [fileAt('chapitres/main.tex')] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un dossier' }));
  await waitFor(() =>
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining('Impossible de lire'),
      'error',
    ),
  );
  expect(screen.getByText('chapitres')).toBeTruthy();
  expect(onImport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps the saved tree unchanged after an upload failure so the same import can be retried', async () => {
  const user = {
    id: 'owner',
    email: 'owner@test.dev',
    name: 'Owner',
    joinedAt: '',
  };
  const project: ProjectWithFiles = {
    id: 'project',
    name: 'Document',
    owner: user.email,
    createdAt: '',
    collaborators: [],
    files: [
      {
        id: 'main',
        name: 'main.tex',
        type: 'tex',
        content: 'original',
        createdAt: '',
      },
    ],
  };
  const files = [
    ...project.files,
    {
      id: 'folder',
      name: 'chapitres',
      type: 'folder' as const,
      children: [],
      createdAt: '',
    },
  ];
  services.list.mockResolvedValue([project]);
  services.replace
    .mockRejectedValueOnce(new Error('Upload failed'))
    .mockResolvedValueOnce({ ...project, files });
  const { result } = renderHook(() => useProjects(user));
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  await act(async () => {
    await expect(
      result.current.updateProjectFiles(project.id, files, {
        optimistic: false,
      }),
    ).rejects.toThrow('Upload failed');
  });
  expect(result.current.projects[0].files).toEqual(project.files);
  await act(async () => {
    await result.current.updateProjectFiles(project.id, files, {
      optimistic: false,
    });
  });
  expect(result.current.projects[0].files).toEqual(files);
});
