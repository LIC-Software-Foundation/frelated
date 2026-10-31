import { useEffect, useRef, useState } from 'react';
import { Folder, FolderPlus, Loader2, X } from 'lucide-react';
import Modal from './Modal';
import { useToast } from './ui/ToastContext';

export interface ImportedFolderFile {
  file: File;
  path: string;
}

interface SelectedFolder {
  id: string;
  name: string;
  files: ImportedFolderFile[];
}

interface DirectoryFileHandle {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
}

interface DirectoryFolderHandle {
  kind: 'directory';
  name: string;
  values: () => AsyncIterableIterator<
    DirectoryFileHandle | DirectoryFolderHandle
  >;
}

interface DirectoryPickerWindow extends Window {
  showDirectoryPicker?: () => Promise<DirectoryFolderHandle>;
}

async function collectDirectoryHandle(
  directory: DirectoryFolderHandle,
  parent: string,
): Promise<ImportedFolderFile[]> {
  const files: ImportedFolderFile[] = [];
  for await (const entry of directory.values()) {
    const path = `${parent}/${entry.name}`;
    if (entry.kind === 'file')
      files.push({ file: await entry.getFile(), path });
    else files.push(...(await collectDirectoryHandle(entry, path)));
  }
  return files;
}

async function collectDroppedEntry(
  entry: FileSystemEntry,
  parent = '',
): Promise<ImportedFolderFile[]> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    return [{ file, path }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const files: ImportedFolderFile[] = [];
  // Directory readers can return several batches, especially above 100 files.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) return files;
    files.push(
      ...(
        await Promise.all(
          batch.map((child) => collectDroppedEntry(child, path)),
        )
      ).flat(),
    );
  }
}

interface FolderImportModalProps {
  isOpen: boolean;
  parentLabel: string;
  existingNames: string[];
  progress: number | null;
  onClose: () => void;
  onImport: (files: ImportedFolderFile[]) => Promise<void>;
}

export default function FolderImportModal({
  isOpen,
  parentLabel,
  existingNames,
  progress,
  onClose,
  onImport,
}: FolderImportModalProps) {
  const { toast } = useToast();
  const [selectedFolders, setSelectedFolders] = useState<SelectedFolder[]>([]);
  const [collecting, setCollecting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectionBusyRef = useRef(false);
  const busy = collecting || progress !== null;
  const fileCount = selectedFolders.reduce(
    (sum, folder) => sum + folder.files.length,
    0,
  );

  useEffect(() => {
    if (!isOpen) setSelectedFolders([]);
  }, [isOpen]);

  const close = () => {
    if (!selectionBusyRef.current && progress === null) onClose();
  };

  const addFolders = (
    folders: Array<{ name: string; files: ImportedFolderFile[] }>,
  ) => {
    const nonEmpty = folders.filter((folder) => folder.files.length);
    if (nonEmpty.length !== folders.length)
      toast(
        'Les dossiers vides ne contiennent aucun fichier à importer.',
        'info',
      );
    setSelectedFolders((current) => {
      const names = new Set([
        ...existingNames,
        ...current.map((folder) => folder.name),
      ]);
      return [
        ...current,
        ...nonEmpty.map((folder) => {
          let name = folder.name;
          let suffix = 2;
          while (names.has(name)) name = `${folder.name} (${suffix++})`;
          names.add(name);
          return {
            id: crypto.randomUUID(),
            name,
            files: folder.files.map((file) => ({
              ...file,
              path: `${name}/${file.path.split('/').slice(1).join('/')}`,
            })),
          };
        }),
      ];
    });
  };

  const chooseFolder = async () => {
    if (selectionBusyRef.current || progress !== null) return;
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      inputRef.current?.click();
      return;
    }
    selectionBusyRef.current = true;
    setCollecting(true);
    try {
      const directory = await picker.call(window);
      const files = await collectDirectoryHandle(directory, directory.name);
      addFolders([{ name: directory.name, files }]);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        toast(
          'Impossible de lire ce dossier. Réessayez ou glissez-le dans la zone.',
          'error',
        );
    } finally {
      selectionBusyRef.current = false;
      setCollecting(false);
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (selectionBusyRef.current || progress !== null) return;
    const folders = new Map<string, ImportedFolderFile[]>();
    for (const file of files) {
      const path = file.webkitRelativePath;
      if (!path.includes('/')) continue;
      const name = path.split('/')[0];
      const entries = folders.get(name) ?? [];
      entries.push({ file, path });
      folders.set(name, entries);
    }
    addFolders(
      Array.from(folders, ([name, entries]) => ({ name, files: entries })),
    );
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (selectionBusyRef.current || progress !== null) return;
    // Capture entries synchronously: browser access to DataTransfer expires after drop.
    const entries = Array.from(event.dataTransfer.items ?? [])
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => Boolean(entry?.isDirectory));
    if (!entries.length) {
      toast('Déposez un ou plusieurs dossiers dans cette zone.', 'info');
      return;
    }
    selectionBusyRef.current = true;
    setCollecting(true);
    try {
      const folders = await Promise.all(
        entries.map(async (entry) => ({
          name: entry.name,
          files: await collectDroppedEntry(entry),
        })),
      );
      addFolders(folders);
    } catch {
      toast(
        'Impossible de lire les dossiers déposés. Votre sélection est conservée.',
        'error',
      );
    } finally {
      selectionBusyRef.current = false;
      setCollecting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Importer des dossiers"
      onClose={close}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy || !selectedFolders.length}
            onClick={() =>
              void onImport(selectedFolders.flatMap((folder) => folder.files))
            }
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400"
          >
            {selectedFolders.length > 1
              ? `Importer ${selectedFolders.length} dossiers`
              : 'Importer le dossier'}
          </button>
        </div>
      }
    >
      <input
        ref={(element) => {
          inputRef.current = element;
          element?.setAttribute('webkitdirectory', '');
          element?.setAttribute('directory', '');
        }}
        type="file"
        multiple
        aria-label="Ajouter des dossiers à importer"
        className="hidden"
        onChange={handleInput}
      />
      <p className="mb-3 text-xs text-slate-500">Destination : {parentLabel}</p>
      <div
        className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-center transition-colors hover:border-emerald-500 hover:bg-emerald-50/40"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => void handleDrop(event)}
        aria-busy={busy}
      >
        {progress !== null ? (
          <div className="space-y-3" role="status">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-600" />
            <p className="text-sm font-medium text-slate-700">
              {progress < 80 ? 'Lecture des fichiers…' : 'Envoi des dossiers…'}
            </p>
            <div
              role="progressbar"
              aria-label="Import des dossiers"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-2 overflow-hidden rounded-full bg-slate-200"
            >
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs tabular-nums text-slate-500">{progress}%</p>
          </div>
        ) : collecting ? (
          <div className="space-y-3" role="status">
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-600" />
            <p className="text-sm text-slate-600">
              Préparation de la sélection…
            </p>
          </div>
        ) : (
          <>
            <FolderPlus className="mx-auto mb-3 h-9 w-9 text-emerald-600" />
            <p className="text-sm font-semibold text-slate-700">
              Glissez un ou plusieurs dossiers ici
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Vous pouvez aussi ajouter plusieurs dossiers à la sélection avant
              de les importer ensemble.
            </p>
            <button
              type="button"
              onClick={() => void chooseFolder()}
              className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              {selectedFolders.length
                ? 'Ajouter un dossier'
                : 'Choisir un dossier'}
            </button>
          </>
        )}
      </div>
      {selectedFolders.length > 0 && (
        <div className="mt-4">
          <p
            className="mb-2 text-sm font-medium text-slate-700"
            aria-live="polite"
          >
            {selectedFolders.length} dossier
            {selectedFolders.length > 1 ? 's' : ''} · {fileCount} fichier
            {fileCount > 1 ? 's' : ''}
          </p>
          <ul
            aria-label="Dossiers sélectionnés"
            className="max-h-48 space-y-2 overflow-y-auto"
          >
            {selectedFolders.map((folder) => (
              <li
                key={folder.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2"
              >
                <Folder className="h-5 w-5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    title={folder.name}
                  >
                    {folder.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {folder.files.length} fichier
                    {folder.files.length > 1 ? 's' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Retirer le dossier ${folder.name}`}
                  disabled={busy}
                  onClick={() =>
                    setSelectedFolders((current) =>
                      current.filter((entry) => entry.id !== folder.id),
                    )
                  }
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">
            L&apos;arborescence et les fichiers sont conservés. Les dossiers de
            même nom sont renommés automatiquement.
          </p>
        </div>
      )}
    </Modal>
  );
}
