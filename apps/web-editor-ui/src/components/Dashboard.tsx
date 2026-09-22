import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight as ChevronRightSmall,
  ChevronRight,
  Download,
  FileImage,
  FilePlus2,
  FileText,
  FolderPlus,
  Folder,
  Image as ImageIcon,
  Import,
  Loader2,
  Menu,
  Play,
  Plus,
  Pencil,
  Share2,
  Terminal,
  Trash2,
  Users,
} from 'lucide-react';
import type {
  Collaborator,
  EditorIdentity,
  PdfSyncSourcePosition,
  PdfSyncTargetPosition,
} from '@frelated/types';
import { useNavigate } from 'react-router-dom';
import ProjectEditor from './ProjectEditor';
import CollaboratorsList from './CollaboratorsList';
import NotificationBell from './NotificationBell';
import Modal from './Modal';
import PdfViewer from './PdfViewer';
import CompilationLogs from './CompilationLogs';
import FileTreeActionsMenu from './FileTreeActionsMenu';
import ProjectActionsMenu from './projects/ProjectActionsMenu';
import ProjectShareModal from './projects/ProjectShareModal';
import { useToast } from './ui/ToastContext';
import { useProjects } from '../hooks/useProjects';
import { useCompilation } from '../hooks/useCompilation';
import {
  captureVisibleDraft,
  readRecoveryDraft,
  restoreRecoveryDraft,
} from '../services/editorDraft';
import { ProjectFile, ProjectWithFiles } from '../types';
import { downloadProjectSources } from '../services/projectService';
import { compilationApiService } from '../services/api/compilationApiService';

// ─── Types ────────────────────────────────────────────────────────────────────

type LayoutMode = 'code' | 'split' | 'pdf';

interface DashboardProps {
  user: EditorIdentity;
  initialProjectId?: string;
  owner?: string;
}

const findFileById = (
  files: ProjectFile[],
  id?: string,
): ProjectFile | undefined => {
  if (!id) return undefined;
  for (const file of files) {
    if (file.id === id) return file;
    if (file.children) {
      const found = findFileById(file.children, id);
      if (found) return found;
    }
  }
  return undefined;
};

const findFileByPath = (
  files: ProjectFile[],
  requestedPath: string,
  parent = '',
): ProjectFile | undefined => {
  for (const file of files) {
    const filePath = parent ? `${parent}/${file.name}` : file.name;
    if (filePath === requestedPath) return file;
    if (file.children) {
      const found = findFileByPath(file.children, requestedPath, filePath);
      if (found) return found;
    }
  }
  return undefined;
};

const findPathByFileId = (
  files: ProjectFile[],
  fileId: string,
  parent = '',
): string | undefined => {
  for (const file of files) {
    const filePath = parent ? `${parent}/${file.name}` : file.name;
    if (file.id === fileId) return filePath;
    if (file.children) {
      const found = findPathByFileId(file.children, fileId, filePath);
      if (found) return found;
    }
  }
  return undefined;
};

const getFirstSelectableFileId = (files: ProjectFile[]): string | undefined => {
  for (const file of files) {
    if (file.type !== 'folder') return file.id;
    if (file.children) {
      const childId = getFirstSelectableFileId(file.children);
      if (childId) return childId;
    }
  }
  return undefined;
};

const findNodeById = (
  files: ProjectFile[],
  id?: string,
): ProjectFile | undefined => {
  if (!id) return undefined;

  for (const file of files) {
    if (file.id === id) return file;

    if (file.children) {
      const child = findNodeById(file.children, id);
      if (child) return child;
    }
  }

  return undefined;
};

const sortProjectFiles = (files: ProjectFile[]): ProjectFile[] => {
  const order: Record<ProjectFile['type'], number> = {
    folder: 0,
    tex: 1,
    bib: 2,
    image: 3,
  };

  return [...files]
    .map((file) =>
      file.type === 'folder' && file.children
        ? { ...file, children: sortProjectFiles(file.children) }
        : file,
    )
    .sort((first, second) => {
      const orderDiff = order[first.type] - order[second.type];
      return orderDiff !== 0
        ? orderDiff
        : first.name.localeCompare(second.name);
    });
};

const insertIntoFolder = (
  files: ProjectFile[],
  parentFolderId: string | undefined,
  entry: ProjectFile,
): ProjectFile[] => {
  if (!parentFolderId) return sortProjectFiles([...files, entry]);

  return sortProjectFiles(
    files.map((file) => {
      if (file.id === parentFolderId && file.type === 'folder') {
        return {
          ...file,
          children: sortProjectFiles([...(file.children ?? []), entry]),
        };
      }

      if (!file.children) return file;

      return {
        ...file,
        children: insertIntoFolder(file.children, parentFolderId, entry),
      };
    }),
  );
};

const renameNodeInTree = (
  files: ProjectFile[],
  nodeId: string,
  name: string,
): ProjectFile[] =>
  sortProjectFiles(
    files.map((file) => {
      if (file.id === nodeId) {
        return { ...file, name };
      }

      if (!file.children) return file;

      return {
        ...file,
        children: renameNodeInTree(file.children, nodeId, name),
      };
    }),
  );

const removeNodeFromTree = (
  files: ProjectFile[],
  nodeId: string,
): ProjectFile[] =>
  sortProjectFiles(
    files
      .filter((file) => file.id !== nodeId)
      .map((file) =>
        file.children
          ? {
              ...file,
              children: removeNodeFromTree(file.children, nodeId),
            }
          : file,
      ),
  );

type TreeEntryType = 'tex' | 'bib' | 'folder';

interface TreeCreationState {
  entryType: TreeEntryType;
  parentFolderId?: string;
  parentLabel: string;
}

interface TreeImportState {
  importType: 'tex' | 'image' | 'folder';
  parentFolderId?: string;
  parentLabel: string;
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

// ─── Reusable sub-components ──────────────────────────────────────────────────

const FileIcon: React.FC<{ type: ProjectFile['type'] }> = ({ type }) => {
  switch (type) {
    case 'tex':
      return <FileText className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />;
    case 'bib':
      return <FileText className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />;
    case 'folder':
      return <Folder className="w-3.5 h-3.5 text-amber-300 flex-shrink-0" />;
    case 'image':
      return <ImageIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />;
  }
};

const ModalFooter: React.FC<{
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  disabled?: boolean;
}> = ({ onCancel, onConfirm, confirmLabel = 'Confirmer', disabled }) => (
  <div className="flex justify-end gap-2">
    <button
      onClick={onCancel}
      className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
    >
      Annuler
    </button>
    <button
      onClick={onConfirm}
      disabled={disabled}
      className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 transition-colors"
    >
      {confirmLabel}
    </button>
  </div>
);

// ─── Dashboard ────────────────────────────────────────────────────────────────

const Dashboard: React.FC<DashboardProps> = ({
  user,
  initialProjectId,
  owner,
}) => {
  const navigate = useNavigate();
  const isGuest = 'kind' in user && user.kind === 'guest';
  const projectOwnerScope = owner;
  const isSharedProjectView = Boolean(owner && owner !== user.email);
  const {
    projects,
    isLoading: projectsLoading,
    loadSharedProject,
    createProject,
    deleteProject,
    openProject,
    renameProject,
    saveFileContent,
    updateProjectFiles,
    updateProjectCollaborators,
    approveCollaborator,
    removeCollaborator,
  } = useProjects(user, projectOwnerScope);
  const { toast } = useToast();
  const hasCreatedInitialProjectRef = useRef(false);

  const [selectedProjectId, setSelectedProjectId] = useState<
    string | undefined
  >(initialProjectId);
  const [selectedFileId, setSelectedFileId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // ── Layout / UI mode ──
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('code');
  const [logsOpen, setLogsOpen] = useState(false);

  // ── Modal / form state ──
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const [newProjectName, setNewProjectName] = useState('');
  const [newEntryName, setNewEntryName] = useState('');
  const [creationState, setCreationState] = useState<TreeCreationState | null>(
    null,
  );
  const [importState, setImportState] = useState<TreeImportState | null>(null);
  const [folderImportOpen, setFolderImportOpen] = useState(false);
  const [folderImportProgress, setFolderImportProgress] = useState<
    number | null
  >(null);
  const [projectToShare, setProjectToShare] = useState<ProjectWithFiles | null>(
    null,
  );
  const [projectToDelete, setProjectToDelete] =
    useState<ProjectWithFiles | null>(null);
  const [projectToRename, setProjectToRename] =
    useState<ProjectWithFiles | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [nodeToRename, setNodeToRename] = useState<ProjectFile | null>(null);
  const [nodeRenameValue, setNodeRenameValue] = useState('');
  const [nodeToDelete, setNodeToDelete] = useState<ProjectFile | null>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<string[]>([]);
  const [isPendingApproval, setIsPendingApproval] = useState(false);
  const [confirmRemoveCollaboratorId, setConfirmRemoveCollaboratorId] =
    useState<string | null>(null);
  const [liveCollaborators, setLiveCollaborators] = useState<Collaborator[]>(
    [],
  );
  const texImportInputRef = useRef<HTMLInputElement | null>(null);
  const imageImportInputRef = useRef<HTMLInputElement | null>(null);
  const folderImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingContentSaveRef = useRef<number | null>(null);
  const pendingContentDraftsRef = useRef(
    new Map<string, { projectId: string; fileId: string; content: string }>(),
  );
  const saveChainRef = useRef(Promise.resolve());
  const sourceSyncRequestRef = useRef(false);
  const sourceSyncCompilationRef = useRef(false);
  const sourceRevisionRef = useRef(0);
  const pdfSyncRequestRef = useRef(false);
  const [pdfSyncTarget, setPdfSyncTarget] = useState<PdfSyncTargetPosition>();
  const [pendingSourceSync, setPendingSourceSync] =
    useState<PdfSyncSourcePosition>();
  const [pdfLocallyStale, setPdfLocallyStale] = useState(false);
  const [revealPosition, setRevealPosition] = useState<{
    file: string;
    line: number;
    column?: number;
    requestId: number;
  }>();

  // ── Derived state ──
  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? projects[0],
    [projects, selectedProjectId],
  );

  const selectedFile = useMemo(
    () =>
      selectedProject
        ? findFileById(selectedProject.files, selectedFileId)
        : undefined,
    [selectedProject, selectedFileId],
  );

  const displayedCollaborators = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    const merged = new Map<string, Collaborator>();

    for (const collaborator of selectedProject.collaborators) {
      const key = collaborator.email || collaborator.name;
      if (key) {
        merged.set(key, collaborator);
      }
    }

    for (const collaborator of liveCollaborators) {
      const key = collaborator.email || collaborator.name;
      const existing = key ? merged.get(key) : undefined;

      if (key) {
        merged.set(key, {
          ...existing,
          ...collaborator,
          role: existing?.role || collaborator.role || 'editor',
          isOnline: collaborator.isOnline ?? true,
        });
      }
    }

    return Array.from(merged.values());
  }, [liveCollaborators, selectedProject]);

  const sharedProjectUnavailable =
    isSharedProjectView &&
    Boolean(initialProjectId) &&
    !projectsLoading &&
    !projects.some((project) => project.id === initialProjectId);
  const selectedFilePath =
    selectedProject && selectedFile
      ? findPathByFileId(selectedProject.files, selectedFile.id)
      : undefined;

  // ── Compilation ──
  const compilation = useCompilation(selectedProject?.id ?? '');
  const errorCount = compilation.logs.filter((l) => l.level === 'error').length;
  const warnCount = compilation.logs.filter(
    (l) => l.level === 'warning',
  ).length;

  useEffect(() => {
    if (compilation.status === 'compiling' || compilation.logs.length > 0)
      setLogsOpen(true);
  }, [compilation.status, compilation.logs.length]);

  useEffect(() => {
    if (
      compilation.pdfJobId &&
      compilation.pdfJobId === compilation.displayedPdfJobId
    ) {
      setPdfLocallyStale(false);
    }
  }, [compilation.displayedPdfJobId, compilation.pdfJobId]);

  // ── Effects ──
  useEffect(() => {
    if (!isSharedProjectView || !owner || !initialProjectId) {
      return;
    }

    void loadSharedProject(owner, initialProjectId).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'PENDING_APPROVAL') {
        setIsPendingApproval(true);
      } else {
        console.error(error);
      }
    });
  }, [initialProjectId, isSharedProjectView, loadSharedProject, owner]);

  useEffect(() => {
    if (initialProjectId) {
      const routeProject = projects.find(
        (project) => project.id === initialProjectId,
      );
      if (!routeProject) return;

      if (selectedProjectId !== initialProjectId) {
        setSelectedProjectId(initialProjectId);
        setSelectedFileId(getFirstSelectableFileId(routeProject.files));
      }
      return;
    }

    if (!selectedProjectId && projects[0]) {
      setSelectedProjectId(projects[0].id);
      setSelectedFileId(getFirstSelectableFileId(projects[0].files));
    }
  }, [initialProjectId, projects, selectedProjectId]);

  useEffect(() => {
    if (
      projectsLoading ||
      projects.length > 0 ||
      isSharedProjectView ||
      hasCreatedInitialProjectRef.current
    ) {
      return;
    }

    hasCreatedInitialProjectRef.current = true;
    void createProject('Premier projet').then((project) => {
      setSelectedProjectId(project.id);
      setSelectedFileId(getFirstSelectableFileId(project.files));
      navigate(`/editor/${project.id}`, { replace: true });
    });
  }, [
    createProject,
    isSharedProjectView,
    navigate,
    projects.length,
    projectsLoading,
  ]);

  useEffect(() => {
    if (!selectedProject) return;
    const currentFile = findFileById(selectedProject.files, selectedFileId);
    if (!currentFile) {
      setSelectedFileId(getFirstSelectableFileId(selectedProject.files));
    }
  }, [selectedFileId, selectedProject]);

  useEffect(() => {
    if (!selectedProject) {
      setCollapsedFolderIds([]);
      setLiveCollaborators([]);
      return;
    }

    const existingFolderIds = new Set<string>();
    const collectFolders = (files: ProjectFile[]) => {
      for (const file of files) {
        if (file.type === 'folder') {
          existingFolderIds.add(file.id);
          collectFolders(file.children ?? []);
        }
      }
    };

    collectFolders(selectedProject.files);
    setCollapsedFolderIds((current) =>
      current.filter((folderId) => existingFolderIds.has(folderId)),
    );
  }, [selectedProject]);

  useEffect(() => {
    if (!selectedProject?.id) return;
    void openProject(selectedProject.id);
  }, [openProject, selectedProject?.id]);

  useEffect(
    () => () => {
      if (pendingContentSaveRef.current !== null) {
        window.clearTimeout(pendingContentSaveRef.current);
      }
    },
    [],
  );

  // ── Memoized callbacks ──
  const flushPendingContentSave = useCallback(() => {
    const drafts = [...pendingContentDraftsRef.current.values()];
    if (!drafts.length) return saveChainRef.current;
    if (pendingContentSaveRef.current !== null) {
      window.clearTimeout(pendingContentSaveRef.current);
      pendingContentSaveRef.current = null;
    }
    pendingContentDraftsRef.current.clear();
    saveChainRef.current = saveChainRef.current
      .catch(() => undefined)
      .then(async () => {
        let failure: unknown;
        for (const draft of drafts) {
          try {
            await saveFileContent(draft.projectId, draft.fileId, draft.content);
          } catch (error) {
            const key = `${draft.projectId}/${draft.fileId}`;
            if (!pendingContentDraftsRef.current.has(key))
              pendingContentDraftsRef.current.set(key, draft);
            failure = error;
          }
        }
        if (failure) throw failure;
      });
    return saveChainRef.current;
  }, [saveFileContent]);

  useEffect(
    () => () => {
      void flushPendingContentSave().catch(console.error);
    },
    [flushPendingContentSave, selectedProject?.id, selectedFile?.id],
  );

  const { compile, reportError } = compilation;
  const compileRequestsRef = useRef(Promise.resolve());
  const runCompilation = useCallback(
    (onlyIfChanged = false, showSplit = false) => {
      const visibleContent = captureVisibleDraft();
      if (visibleContent !== undefined && selectedProject && selectedFile) {
        pendingContentDraftsRef.current.set(
          `${selectedProject.id}/${selectedFile.id}`,
          {
            projectId: selectedProject.id,
            fileId: selectedFile.id,
            content: visibleContent,
          },
        );
      }
      if (showSplit) setLayoutMode('split');
      compileRequestsRef.current = compileRequestsRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await flushPendingContentSave();
            await compile(onlyIfChanged);
          } catch (error) {
            reportError(error);
          }
        });
      return compileRequestsRef.current;
    },
    [
      flushPendingContentSave,
      compile,
      reportError,
      selectedProject,
      selectedFile,
    ],
  );

  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        event.stopPropagation();
        void runCompilation();
      }
    };
    window.addEventListener('keydown', save, true);
    return () => window.removeEventListener('keydown', save, true);
  }, [runCompilation]);

  const mainFileOptions = useMemo(() => {
    const paths: string[] = [];
    const visit = (files: ProjectFile[], parent = '') => {
      for (const file of files) {
        const path = parent + file.name;
        if (file.type === 'folder') visit(file.children ?? [], path + '/');
        else if (file.name.endsWith('.tex')) paths.push(path);
      }
    };
    visit(selectedProject?.files ?? []);
    return paths;
  }, [selectedProject?.files]);

  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      if (!selectedProject) return;
      // A SyncTeX marker belongs to the exact source revision that produced
      // it. Keeping it after an edit makes the PDF viewer scroll back to an
      // obsolete location whenever React refreshes the editor state.
      sourceRevisionRef.current += 1;
      setPendingSourceSync(undefined);
      setPdfSyncTarget(undefined);
      setPdfLocallyStale(Boolean(compilation.pdfJobId));
      pendingContentDraftsRef.current.set(`${selectedProject.id}/${fileId}`, {
        projectId: selectedProject.id,
        fileId,
        content,
      });

      if (pendingContentSaveRef.current !== null) {
        window.clearTimeout(pendingContentSaveRef.current);
      }

      pendingContentSaveRef.current = window.setTimeout(() => {
        void flushPendingContentSave().catch(console.error);
      }, 500);
    },
    [compilation.pdfJobId, flushPendingContentSave, selectedProject],
  );

  const onContentChange = useCallback(
    (content: string) => {
      if (selectedFile) handleContentChange(selectedFile.id, content);
    },
    [selectedFile?.id, handleContentChange], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onCollaboratorsChange = useCallback((collabs: Collaborator[]) => {
    setLiveCollaborators(collabs);
  }, []);

  const isOwnerOfSelected = Boolean(
    selectedProject && selectedProject.owner === user.email,
  );

  const handleUpdateCollaboratorRole = useCallback(
    async (collaboratorId: string, role: 'viewer' | 'editor') => {
      if (!selectedProject) return;
      const updated = selectedProject.collaborators.map((c) =>
        (c as { id?: string }).id === collaboratorId ? { ...c, role } : c,
      );
      await updateProjectCollaborators(selectedProject.id, updated);
    },
    [selectedProject, updateProjectCollaborators],
  );

  const handleApproveCollaborator = useCallback(
    async (collaboratorId: string) => {
      if (!selectedProject) return;
      await approveCollaborator(selectedProject.id, collaboratorId);
    },
    [approveCollaborator, selectedProject],
  );

  const handleRemoveCollaborator = useCallback((collaboratorId: string) => {
    setConfirmRemoveCollaboratorId(collaboratorId);
  }, []);

  const handleConfirmRemoveCollaborator = useCallback(async () => {
    if (!selectedProject || !confirmRemoveCollaboratorId) return;
    await removeCollaborator(selectedProject.id, confirmRemoveCollaboratorId);
    setConfirmRemoveCollaboratorId(null);
  }, [confirmRemoveCollaboratorId, removeCollaborator, selectedProject]);

  // ── Action handlers ──
  const handleSelectProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    setSelectedProjectId(projectId);
    setSelectedFileId(getFirstSelectableFileId(project?.files ?? []));
    // reset auto-switch for new project
    navigate(`/editor/${projectId}`);
  };

  const handleSelectFile = (fileId: string) => {
    setSelectedFileId(fileId);
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const newProject = await createProject(newProjectName.trim());
    setSelectedProjectId(newProject.id);
    setSelectedFileId(getFirstSelectableFileId(newProject.files));
    setNewProjectName('');
    setIsCreateModalOpen(false);
  };

  const updateSelectedProjectFiles = async (
    nextFiles: ProjectFile[],
  ): Promise<void> => {
    if (!selectedProject) return;

    await updateProjectFiles(selectedProject.id, sortProjectFiles(nextFiles));
  };

  const handleOpenCreationModal = (
    entryType: TreeEntryType,
    parentFolderId?: string,
    parentLabel = 'la racine du projet',
  ) => {
    setCreationState({ entryType, parentFolderId, parentLabel });
    setNewEntryName('');
  };

  const handleToggleFolder = (folderId: string) => {
    setCollapsedFolderIds((current) =>
      current.includes(folderId)
        ? current.filter((id) => id !== folderId)
        : [...current, folderId],
    );
  };

  const handleConfirmEntryCreation = async () => {
    if (!selectedProject || !creationState || !newEntryName.trim()) return;

    const baseName = newEntryName.trim();
    const extension =
      creationState.entryType === 'tex'
        ? '.tex'
        : creationState.entryType === 'bib'
          ? '.bib'
          : '';
    const normalizedName =
      extension && !baseName.toLowerCase().endsWith(extension)
        ? `${baseName}${extension}`
        : baseName;
    const createdAt = new Date().toISOString();
    const nextEntry: ProjectFile =
      creationState.entryType === 'folder'
        ? {
            id: crypto.randomUUID(),
            name: normalizedName,
            type: 'folder',
            children: [],
            createdAt,
          }
        : {
            id: crypto.randomUUID(),
            name: normalizedName,
            type: creationState.entryType,
            content:
              creationState.entryType === 'tex'
                ? `\\section{${normalizedName.replace(/\.tex$/i, '')}}\nVotre contenu ici.`
                : '',
            createdAt,
          };

    const nextFiles = insertIntoFolder(
      selectedProject.files,
      creationState.parentFolderId,
      nextEntry,
    );
    await updateSelectedProjectFiles(nextFiles);

    if (nextEntry.type === 'folder') {
      setCollapsedFolderIds((current) =>
        current.filter((id) => id !== nextEntry.id),
      );
    } else {
      setSelectedFileId(nextEntry.id);
    }

    toast(
      `${
        creationState.entryType === 'folder' ? 'Dossier' : 'Fichier'
      } "${nextEntry.name}" cree.`,
      'success',
    );
    setCreationState(null);
    setNewEntryName('');
  };

  const handleRequestImport = (
    importType: 'tex' | 'image' | 'folder',
    parentFolderId?: string,
    parentLabel = 'la racine du projet',
  ) => {
    setImportState({ importType, parentFolderId, parentLabel });

    if (importType === 'tex') {
      texImportInputRef.current?.click();
      return;
    }

    if (importType === 'image') {
      imageImportInputRef.current?.click();
      return;
    }

    setFolderImportOpen(true);
  };

  const readTextFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });

  const readImageFile = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const handleImportedFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
    importType: 'tex' | 'image',
  ) => {
    const importedFile = event.target.files?.[0];
    event.target.value = '';

    if (!selectedProject || !importState || !importedFile) return;

    try {
      const content =
        importType === 'tex'
          ? await readTextFile(importedFile)
          : await readImageFile(importedFile);

      const nextEntry: ProjectFile = {
        id: crypto.randomUUID(),
        name: importedFile.name,
        type: importType === 'tex' ? 'tex' : 'image',
        content,
        createdAt: new Date().toISOString(),
      };
      const nextFiles = insertIntoFolder(
        selectedProject.files,
        importState.parentFolderId,
        nextEntry,
      );

      await updateSelectedProjectFiles(nextFiles);

      if (nextEntry.type !== 'image') {
        setSelectedFileId(nextEntry.id);
      }

      toast(
        `"${nextEntry.name}" importe dans ${importState.parentLabel}.`,
        'success',
      );
    } catch (error) {
      console.error(error);
      toast("Impossible d'importer ce fichier.", 'error');
    } finally {
      setImportState(null);
    }
  };

  const importFolderFiles = async (
    importedFiles: Array<{ file: File; path: string }>,
  ) => {
    if (!selectedProject || !importState || !importedFiles.length) return;

    try {
      setFolderImportProgress(0);
      const createdAt = new Date().toISOString();
      const roots: ProjectFile[] = [];
      const folders = new Map<string, ProjectFile[]>();

      for (const [index, imported] of importedFiles.entries()) {
        const importedFile = imported.file;
        const relativePath = imported.path;
        const parts = relativePath.split('/').filter(Boolean);
        const fileName = parts.pop();
        if (!fileName) continue;

        let children = roots;
        let folderPath = '';
        for (const folderName of parts) {
          folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
          let folderChildren = folders.get(folderPath);
          if (!folderChildren) {
            folderChildren = [];
            children.push({
              id: crypto.randomUUID(),
              name: folderName,
              type: 'folder',
              children: folderChildren,
              createdAt,
            });
            folders.set(folderPath, folderChildren);
          }
          children = folderChildren;
        }

        const extension = fileName.split('.').pop()?.toLowerCase();
        const isBinary =
          importedFile.type.startsWith('image/') || extension === 'pdf';
        children.push({
          id: crypto.randomUUID(),
          name: fileName,
          type: extension === 'bib' ? 'bib' : isBinary ? 'image' : 'tex',
          content: isBinary
            ? await readImageFile(importedFile)
            : await readTextFile(importedFile),
          createdAt,
        });
        setFolderImportProgress(
          Math.round(((index + 1) / importedFiles.length) * 75),
        );
      }

      let nextFiles = selectedProject.files;
      for (const root of roots) {
        nextFiles = insertIntoFolder(
          nextFiles,
          importState.parentFolderId,
          root,
        );
      }
      setFolderImportProgress(85);
      await updateSelectedProjectFiles(nextFiles);
      setFolderImportProgress(100);
      toast(
        `${importedFiles.length} fichier(s) importé(s) dans ${importState.parentLabel}.`,
        'success',
      );
    } catch (error) {
      console.error(error);
      toast("Impossible d'importer ce dossier.", 'error');
    } finally {
      setFolderImportOpen(false);
      setFolderImportProgress(null);
      setImportState(null);
    }
  };

  const handleImportedFolder = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const importedFiles = Array.from(event.target.files ?? []).map((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
    }));
    event.target.value = '';
    await importFolderFiles(importedFiles);
  };

  const collectDirectoryHandle = async (
    directory: DirectoryFolderHandle,
    parent: string,
  ): Promise<Array<{ file: File; path: string }>> => {
    const files: Array<{ file: File; path: string }> = [];
    for await (const entry of directory.values()) {
      const path = `${parent}/${entry.name}`;
      if (entry.kind === 'file') {
        files.push({ file: await entry.getFile(), path });
      } else {
        files.push(...(await collectDirectoryHandle(entry, path)));
      }
    }
    return files;
  };

  const handleChooseFolder = async () => {
    const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
    if (!picker) {
      folderImportInputRef.current?.click();
      return;
    }

    try {
      const directory = await picker();
      setFolderImportProgress(0);
      const files = await collectDirectoryHandle(directory, directory.name);
      await importFolderFiles(files);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
      setFolderImportProgress(null);
      toast("Impossible d'importer ce dossier.", 'error');
    }
  };

  const collectDroppedEntry = async (
    entry: FileSystemEntry,
    parent = '',
  ): Promise<Array<{ file: File; path: string }>> => {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      return [{ file, path }];
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children: FileSystemEntry[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      children.push(...batch);
    }
    return (
      await Promise.all(
        children.map((child) => collectDroppedEntry(child, path)),
      )
    ).flat();
  };

  const handleFolderDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const entries = Array.from(event.dataTransfer.items)
      .map((item) => item.webkitGetAsEntry?.())
      .filter((entry): entry is FileSystemEntry => Boolean(entry));
    if (!entries.length) return;
    setFolderImportProgress(0);
    const files = (
      await Promise.all(entries.map((entry) => collectDroppedEntry(entry)))
    ).flat();
    await importFolderFiles(files);
  };

  const handleStartRenameNode = (nodeId: string) => {
    if (!selectedProject) return;

    const node = findNodeById(selectedProject.files, nodeId);
    if (!node) return;

    setNodeToRename(node);
    setNodeRenameValue(node.name);
  };

  const handleConfirmRenameNode = async () => {
    if (!selectedProject || !nodeToRename || !nodeRenameValue.trim()) return;

    const nextFiles = renameNodeInTree(
      selectedProject.files,
      nodeToRename.id,
      nodeRenameValue.trim(),
    );
    await updateSelectedProjectFiles(nextFiles);
    toast(`"${nodeRenameValue.trim()}" renomme avec succes.`, 'success');
    setNodeToRename(null);
    setNodeRenameValue('');
  };

  const handleDeleteNode = async () => {
    if (!selectedProject || !nodeToDelete) return;

    const nextFiles = removeNodeFromTree(
      selectedProject.files,
      nodeToDelete.id,
    );
    await updateSelectedProjectFiles(nextFiles);

    if (selectedFileId && findNodeById([nodeToDelete], selectedFileId)) {
      setSelectedFileId(getFirstSelectableFileId(nextFiles));
    }

    setCollapsedFolderIds((current) =>
      current.filter((id) => id !== nodeToDelete.id),
    );
    toast(`"${nodeToDelete.name}" supprime.`, 'info');
    setNodeToDelete(null);
  };

  const handleShareProject = (project: ProjectWithFiles) => {
    setProjectToShare(project);
  };

  const handleCloseShareModal = () => {
    setProjectToShare(null);
  };

  const requestSourceToPdf = useCallback(
    async (position: PdfSyncSourcePosition, displayedPdfJobId: string) => {
      if (!selectedProject || sourceSyncRequestRef.current) return false;
      sourceSyncRequestRef.current = true;
      const requestedRevision = sourceRevisionRef.current;
      try {
        const target = await compilationApiService.sourceToPdf(
          selectedProject.id,
          position,
          displayedPdfJobId,
        );
        if (
          target.pdfJobId !== displayedPdfJobId ||
          requestedRevision !== sourceRevisionRef.current
        ) {
          return false;
        }
        setPdfSyncTarget(target);
        setLayoutMode('split');
        if (target.stale) {
          toast('Le PDF correspond à une compilation antérieure.', 'info');
        } else if (target.approximate) {
          toast(
            'Cette ligne n’est pas imprimée directement : la position PDF la plus proche est affichée.',
            'info',
          );
        }
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Synchronisation PDF impossible.';
        toast(
          message,
          message.includes('zone de texte synchronisable')
            ? 'warning'
            : 'error',
        );
        return false;
      } finally {
        sourceSyncRequestRef.current = false;
      }
    },
    [selectedProject, toast],
  );

  const handleSourceToPdf = useCallback(
    async (position: PdfSyncSourcePosition) => {
      const displayedPdfJobId = compilation.displayedPdfJobId;
      const needsFreshCompilation =
        !displayedPdfJobId ||
        displayedPdfJobId !== compilation.synctexJobId ||
        pdfLocallyStale ||
        compilation.isPdfStale;

      if (needsFreshCompilation) {
        setPendingSourceSync(position);
        setPdfSyncTarget(undefined);
        toast(
          'Mise à jour du PDF avant la synchronisation de la position…',
          'info',
        );
        if (
          compilation.status !== 'compiling' &&
          !sourceSyncCompilationRef.current
        ) {
          sourceSyncCompilationRef.current = true;
          try {
            await runCompilation(false, true);
          } finally {
            sourceSyncCompilationRef.current = false;
          }
        }
        return;
      }
      await requestSourceToPdf(position, displayedPdfJobId);
    },
    [
      compilation.displayedPdfJobId,
      compilation.isPdfStale,
      compilation.status,
      compilation.synctexJobId,
      pdfLocallyStale,
      requestSourceToPdf,
      runCompilation,
      toast,
    ],
  );

  useEffect(() => {
    if (!pendingSourceSync) return;
    if (compilation.status === 'error') {
      setPendingSourceSync(undefined);
      toast(
        'La compilation a échoué : la synchronisation n’a pas été lancée.',
        'error',
      );
      return;
    }
    const displayedPdfJobId = compilation.displayedPdfJobId;
    if (
      compilation.status !== 'success' ||
      !displayedPdfJobId ||
      displayedPdfJobId !== compilation.pdfJobId ||
      displayedPdfJobId !== compilation.synctexJobId
    ) {
      return;
    }
    const position = pendingSourceSync;
    setPendingSourceSync(undefined);
    void requestSourceToPdf(position, displayedPdfJobId);
  }, [
    compilation.displayedPdfJobId,
    compilation.pdfJobId,
    compilation.status,
    compilation.synctexJobId,
    pendingSourceSync,
    requestSourceToPdf,
    toast,
  ]);

  const handlePdfToSource = useCallback(
    async (position: { page: number; x: number; y: number }) => {
      if (!selectedProject) return;
      const displayedPdfJobId = compilation.displayedPdfJobId;
      if (!displayedPdfJobId) {
        toast('Compilez le projet avant de synchroniser le PDF.', 'info');
        return;
      }
      if (pdfSyncRequestRef.current) return;
      pdfSyncRequestRef.current = true;
      try {
        const source = await compilationApiService.pdfToSource(
          selectedProject.id,
          position,
          displayedPdfJobId,
        );
        if (source.pdfJobId !== displayedPdfJobId) return;
        const file = findFileByPath(selectedProject.files, source.file);
        if (!file)
          throw new Error(`Fichier source introuvable : ${source.file}`);
        setSelectedFileId(file.id);
        setRevealPosition({
          file: source.file,
          line: source.line,
          column: source.column,
          requestId: Date.now(),
        });
        setLayoutMode('split');
        if (source.stale) {
          toast(
            'La position provient de la dernière compilation réussie.',
            'info',
          );
        } else if (source.approximate) {
          toast(
            'Le point choisi ne contient pas de texte : la ligne source la plus proche est affichée.',
            'info',
          );
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Synchronisation source impossible.';
        toast(
          message,
          message.includes('zone de texte synchronisable')
            ? 'warning'
            : 'error',
        );
      } finally {
        pdfSyncRequestRef.current = false;
      }
    },
    [compilation.displayedPdfJobId, selectedProject, toast],
  );

  const handleExportSources = (project: ProjectWithFiles) => {
    downloadProjectSources(project);
    toast(`Le projet "${project.name}" a ete exporte en ZIP.`, 'success');
  };

  const handleStartRenameProject = (project: ProjectWithFiles) => {
    setProjectToRename(project);
    setRenameValue(project.name);
  };

  const handleConfirmRenameProject = async () => {
    if (!projectToRename || !renameValue.trim()) return;

    await renameProject(projectToRename.id, renameValue.trim());
    toast(`Projet renomme en "${renameValue.trim()}".`, 'success');
    setProjectToRename(null);
    setRenameValue('');
  };

  const handleDeleteExistingProject = async (project: ProjectWithFiles) => {
    const remainingProjects = projects.filter(
      (currentProject) => currentProject.id !== project.id,
    );

    await deleteProject(project.id);
    toast(`Projet "${project.name}" supprime.`, 'info');
    setProjectToDelete(null);

    if (selectedProject?.id !== project.id) return;

    const nextProject = remainingProjects[0];
    if (!nextProject) {
      setSelectedProjectId(undefined);
      setSelectedFileId(undefined);
      navigate('/projects');
      return;
    }

    setSelectedProjectId(nextProject.id);
    setSelectedFileId(getFirstSelectableFileId(nextProject.files));
    navigate(`/editor/${nextProject.id}`);
  };

  // ── Helpers ──
  const isCompiling = compilation.status === 'compiling';

  const layoutBtnCls = (mode: LayoutMode) =>
    `px-2.5 py-1 text-xs transition-colors ${
      layoutMode === mode
        ? 'bg-white/15 text-white'
        : 'text-slate-400 hover:bg-white/5 hover:text-white'
    }`;
  const visibleProjects = projects.slice(0, 3);
  const creationTitle = creationState
    ? {
        tex: 'Creer un fichier .tex',
        bib: 'Creer un fichier .bib',
        folder: 'Creer un dossier',
      }[creationState.entryType]
    : '';
  const creationPlaceholder = creationState
    ? {
        tex: 'ex : introduction',
        bib: 'ex : references',
        folder: 'ex : chapitres',
      }[creationState.entryType]
    : '';

  const buildNodeActions = (node: ProjectFile) => {
    if (node.type === 'folder') {
      return [
        {
          id: 'create-tex',
          label: 'Creer un fichier .tex',
          icon: FilePlus2,
          onClick: () =>
            handleOpenCreationModal('tex', node.id, `le dossier ${node.name}`),
        },
        {
          id: 'create-bib',
          label: 'Creer un fichier .bib',
          icon: FileText,
          onClick: () =>
            handleOpenCreationModal('bib', node.id, `le dossier ${node.name}`),
        },
        {
          id: 'create-folder',
          label: 'Creer un dossier',
          icon: FolderPlus,
          onClick: () =>
            handleOpenCreationModal(
              'folder',
              node.id,
              `le dossier ${node.name}`,
            ),
        },
        {
          id: 'import-tex',
          label: 'Importer un fichier .tex',
          icon: Import,
          onClick: () =>
            handleRequestImport('tex', node.id, `le dossier ${node.name}`),
        },
        {
          id: 'import-image',
          label: 'Importer une image',
          icon: FileImage,
          onClick: () =>
            handleRequestImport('image', node.id, `le dossier ${node.name}`),
        },
        {
          id: 'import-folder',
          label: 'Importer un dossier',
          icon: FolderPlus,
          onClick: () =>
            handleRequestImport('folder', node.id, `le dossier ${node.name}`),
        },
        {
          id: 'rename-folder',
          label: 'Renommer',
          icon: Pencil,
          onClick: () => handleStartRenameNode(node.id),
        },
        {
          id: 'delete-folder',
          label: 'Supprimer',
          icon: Trash2,
          onClick: () => setNodeToDelete(node),
          tone: 'danger' as const,
        },
      ];
    }

    return [
      {
        id: 'rename-file',
        label: 'Renommer',
        icon: Pencil,
        onClick: () => handleStartRenameNode(node.id),
      },
      {
        id: 'delete-file',
        label: 'Supprimer',
        icon: Trash2,
        onClick: () => setNodeToDelete(node),
        tone: 'danger' as const,
      },
    ];
  };

  const renderFileTree = (files: ProjectFile[], depth = 0): React.ReactNode =>
    sortProjectFiles(files).map((file) => {
      const isFolder = file.type === 'folder';
      const isCollapsed = isFolder && collapsedFolderIds.includes(file.id);
      const paddingLeft = 8 + depth * 16;

      if (isFolder) {
        return (
          <div key={file.id} className="group space-y-0.5">
            <div
              className="flex items-center justify-between rounded-md pr-1"
              style={{ paddingLeft }}
            >
              <button
                type="button"
                onClick={() => handleToggleFolder(file.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
              >
                {isCollapsed ? (
                  <ChevronRightSmall className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" />
                )}
                <FileIcon type="folder" />
                <span className="truncate text-xs font-medium">
                  {file.name}/
                </span>
              </button>

              <FileTreeActionsMenu
                label={file.name}
                actions={buildNodeActions(file)}
                buttonClassName="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              />
            </div>

            {!isCollapsed && (
              <div className="space-y-0.5">
                {(file.children ?? []).length > 0 ? (
                  renderFileTree(file.children ?? [], depth + 1)
                ) : (
                  <p
                    className="px-2 py-1 text-[11px] text-slate-600"
                    style={{ paddingLeft: paddingLeft + 30 }}
                  >
                    Dossier vide
                  </p>
                )}
              </div>
            )}
          </div>
        );
      }

      return (
        <div
          key={file.id}
          className="group flex items-center justify-between rounded-md pr-1"
          style={{ paddingLeft }}
        >
          <button
            type="button"
            onClick={() => handleSelectFile(file.id)}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
              selectedFileId === file.id
                ? 'bg-white/10 text-white'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            <span className="w-3.5 flex-shrink-0" />
            <FileIcon type={file.type} />
            <span className="truncate text-xs">{file.name}</span>
          </button>

          <FileTreeActionsMenu
            label={file.name}
            actions={buildNodeActions(file)}
            buttonClassName="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          />
        </div>
      );
    });

  // ── Render ──
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* ════════════════════════════════════════
          TOPBAR
      ════════════════════════════════════════ */}
      <header className="flex items-center h-11 bg-[#1b2635] border-b border-[#253347] px-3 flex-shrink-0 gap-2">
        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-1.5 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
          aria-label={
            sidebarOpen
              ? 'Masquer la barre latérale'
              : 'Afficher la barre latérale'
          }
        >
          <Menu className="w-4 h-4" />
        </button>

        {/* Logo — clickable to go back to projects list */}
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 mr-2 cursor-pointer"
          title="Retour à l'accueil"
        >
          <span
            className="w-6 h-6 rounded bg-emerald-600 flex items-center justify-center text-white text-xs font-bold select-none hover:bg-emerald-500 transition-colors"
            title="Frelated"
          >
            F
          </span>
          <span className="hidden sm:block text-white text-sm font-semibold tracking-tight">
            Frelated
          </span>
        </button>
        {/* Breadcrumb */}
        {selectedProject && (
          <div className="flex items-center gap-1 text-sm text-slate-500 min-w-0 overflow-hidden">
            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-slate-300 truncate max-w-[160px]">
              {selectedProject.name}
            </span>
            <ProjectActionsMenu
              projectName={selectedProject.name}
              onOpen={() => navigate(`/editor/${selectedProject.id}`)}
              onShare={() => void handleShareProject(selectedProject)}
              onExport={() => handleExportSources(selectedProject)}
              onRename={() => handleStartRenameProject(selectedProject)}
              onDelete={() => setProjectToDelete(selectedProject)}
              buttonClassName="text-slate-500 hover:text-white hover:bg-white/10"
              menuClassName="mt-1"
            />
            {selectedFile && (
              <>
                <ChevronRight className="w-3.5 h-3.5 flex-shrink-0" />
                <span className="text-white font-medium truncate max-w-[120px]">
                  {selectedFile.name}
                </span>
              </>
            )}
          </div>
        )}

        {/* Right controls */}
        <div className="ml-auto flex items-center gap-2">
          <select
            aria-label="Fichier principal"
            title="Fichier principal du projet"
            className="max-w-32 bg-slate-800 text-slate-200 border border-slate-700 rounded text-xs p-1"
            value={compilation.settings?.mainFile ?? 'main.tex'}
            onChange={(event) =>
              void compilation.saveSettings({
                mainFile: event.target.value,
                engine: compilation.settings?.engine ?? 'pdflatex',
              })
            }
          >
            {!mainFileOptions.includes(
              compilation.settings?.mainFile ?? 'main.tex',
            ) && (
              <option value={compilation.settings?.mainFile ?? 'main.tex'}>
                Choisir le fichier principal
              </option>
            )}
            {mainFileOptions.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
          <select
            aria-label="Moteur LaTeX"
            className="bg-slate-800 text-slate-200 border border-slate-700 rounded text-xs p-1"
            value={compilation.settings?.engine ?? 'pdflatex'}
            onChange={(event) =>
              void compilation.saveSettings({
                mainFile: compilation.settings?.mainFile ?? 'main.tex',
                engine: event.target.value as
                  | 'pdflatex'
                  | 'xelatex'
                  | 'lualatex',
              })
            }
          >
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
            <option value="lualatex">LuaLaTeX</option>
          </select>
          {selectedFile?.type === 'tex' &&
            !selectedFile.content &&
            readRecoveryDraft() && (
              <button
                className="text-xs text-amber-200 border border-amber-500 rounded px-2 py-1"
                onClick={() => {
                  setLayoutMode('split');
                  window.setTimeout(() => {
                    if (restoreRecoveryDraft()) void runCompilation();
                  }, 100);
                }}
              >
                Restaurer le texte de cet onglet
              </button>
            )}
          {/* Layout switcher */}
          <div className="hidden sm:flex items-center rounded border border-slate-700 overflow-hidden">
            <button
              onClick={() => setLayoutMode('code')}
              className={layoutBtnCls('code')}
              title="Éditeur seul"
            >
              Code
            </button>
            <button
              onClick={() => setLayoutMode('split')}
              className={`${layoutBtnCls('split')} border-x border-slate-700`}
              title="Éditeur + Aperçu"
            >
              Split
            </button>
            <button
              onClick={() => {
                setLayoutMode('pdf');
                void runCompilation(true);
              }}
              className={layoutBtnCls('pdf')}
              title="Aperçu seul"
            >
              PDF
            </button>
          </div>

          {/* Logs toggle */}
          <button
            onClick={() => setLogsOpen(!logsOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border transition-colors ${
              logsOpen
                ? 'border-slate-500 bg-white/10 text-white'
                : errorCount > 0
                  ? 'border-red-800/60 bg-red-900/20 text-red-400 hover:bg-red-900/30'
                  : 'border-slate-700 text-slate-400 hover:bg-white/5 hover:text-white'
            }`}
            title="Logs de compilation"
          >
            <Terminal className="w-3.5 h-3.5" />
            {errorCount > 0 && (
              <span className="font-semibold">{errorCount}</span>
            )}
            {errorCount === 0 && warnCount > 0 && (
              <span className="text-amber-400 font-semibold">{warnCount}</span>
            )}
          </button>

          {!isGuest && (
            <NotificationBell
              theme="light"
              onApprove={approveCollaborator}
              onReject={removeCollaborator}
            />
          )}

          <div className="w-px h-5 bg-slate-700" />

          <button
            onClick={() =>
              selectedProject && handleExportSources(selectedProject)
            }
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-white/10 hover:text-white hover:border-slate-500 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exporter les sources</span>
          </button>

          {!isGuest && isOwnerOfSelected && (
            <button
              onClick={() =>
                selectedProject && handleShareProject(selectedProject)
              }
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded border border-slate-600 text-slate-300 hover:bg-white/10 hover:text-white hover:border-slate-500 transition-colors"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Partager</span>
            </button>
          )}

          {/* Compile button */}
          <button
            onClick={() => void runCompilation(false, true)}
            disabled={isCompiling}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:text-emerald-300 text-white font-semibold transition-colors"
          >
            {isCompiling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            <span>{isCompiling ? 'Compilation…' : 'Compiler'}</span>
          </button>
        </div>
      </header>

      {/* ════════════════════════════════════════
          MAIN LAYOUT
      ════════════════════════════════════════ */}
      <div className="flex flex-1 overflow-hidden">
        {/* ══════════════════════════
            SIDEBAR
        ══════════════════════════ */}
        <aside
          className={`${
            sidebarOpen ? 'w-64' : 'w-0'
          } bg-[#1b2635] flex flex-col overflow-hidden transition-[width] duration-200 border-r border-[#253347] flex-shrink-0`}
        >
          {/* ── Section: Projects ── */}
          <div className="flex-shrink-0 border-b border-[#253347]">
            <div className="flex items-center justify-between px-3 pt-3 pb-2">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-slate-400">
                Projets
              </span>
              <div className="flex items-center gap-1">
                {!isGuest && (
                  <>
                    <button
                      onClick={() => navigate('/projects')}
                      className="rounded px-2 py-1 text-[10px] font-medium text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                    >
                      Voir tout
                    </button>
                    <button
                      onClick={() => setIsCreateModalOpen(true)}
                      className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                      title="Nouveau projet"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="px-2 pb-2 space-y-0.5 overflow-y-auto max-h-44 sidebar-scroll">
              {visibleProjects.map((project) => (
                <div
                  key={project.id}
                  onClick={() => handleSelectProject(project.id)}
                  className={`flex items-center justify-between px-2 py-2 rounded-md cursor-pointer transition-colors group ${
                    selectedProject?.id === project.id
                      ? 'bg-white/10 text-white'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Folder
                      className={`w-3.5 h-3.5 flex-shrink-0 ${
                        selectedProject?.id === project.id
                          ? 'text-emerald-400'
                          : 'text-slate-500 group-hover:text-slate-400'
                      }`}
                    />
                    <span className="text-xs font-medium truncate">
                      {project.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className="text-[10px] text-slate-600 group-hover:text-slate-500">
                      <Users className="w-3 h-3 inline mr-0.5" />
                      {project.collaborators.length}
                    </span>
                    {!isGuest && (
                      <ProjectActionsMenu
                        projectName={project.name}
                        onOpen={() => handleSelectProject(project.id)}
                        onShare={() => handleShareProject(project)}
                        onExport={() => handleExportSources(project)}
                        onRename={() => handleStartRenameProject(project)}
                        onDelete={() => setProjectToDelete(project)}
                        buttonClassName="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-white hover:bg-white/15"
                        menuClassName="mt-1"
                      />
                    )}
                  </div>
                </div>
              ))}

              {!projectsLoading && visibleProjects.length === 0 && (
                <p className="px-2 py-2 text-[11px] text-slate-600">
                  Aucun projet disponible.
                </p>
              )}
            </div>
          </div>

          {/* ── Section: Files ── */}
          {selectedProject && (
            <div className="flex flex-col flex-1 overflow-hidden min-h-0 border-b border-[#253347]">
              <div className="flex items-center justify-between px-3 pt-3 pb-2 flex-shrink-0">
                <span className="text-[10px] font-semibold tracking-widest uppercase text-slate-400">
                  Fichiers
                </span>
                <FileTreeActionsMenu
                  label="la racine du projet"
                  actions={[
                    {
                      id: 'root-create-tex',
                      label: 'Creer un fichier .tex',
                      icon: FilePlus2,
                      onClick: () => handleOpenCreationModal('tex'),
                    },
                    {
                      id: 'root-create-bib',
                      label: 'Creer un fichier .bib',
                      icon: FileText,
                      onClick: () => handleOpenCreationModal('bib'),
                    },
                    {
                      id: 'root-create-folder',
                      label: 'Creer un dossier',
                      icon: FolderPlus,
                      onClick: () => handleOpenCreationModal('folder'),
                    },
                    {
                      id: 'root-import-tex',
                      label: 'Importer un fichier .tex',
                      icon: Import,
                      onClick: () => handleRequestImport('tex'),
                    },
                    {
                      id: 'root-import-image',
                      label: 'Importer une image',
                      icon: FileImage,
                      onClick: () => handleRequestImport('image'),
                    },
                    {
                      id: 'root-import-folder',
                      label: 'Importer un dossier',
                      icon: FolderPlus,
                      onClick: () => handleRequestImport('folder'),
                    },
                  ]}
                />
              </div>

              <div className="flex-1 overflow-y-auto sidebar-scroll px-2 pb-2 space-y-0.5">
                {selectedProject.files.length > 0 ? (
                  renderFileTree(selectedProject.files)
                ) : (
                  <p className="px-2 py-2 text-[11px] text-slate-600">
                    Aucun fichier dans ce projet.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Section: Collaborators ── */}
          {selectedProject && (
            <div className="flex-shrink-0">
              <CollaboratorsList
                collaborators={displayedCollaborators}
                currentUser={user}
                owner={owner ?? selectedProject.owner}
                isOwner={isOwnerOfSelected}
                onUpdateRole={
                  isOwnerOfSelected
                    ? (id, role) => void handleUpdateCollaboratorRole(id, role)
                    : undefined
                }
                onApprove={
                  isOwnerOfSelected
                    ? (id) => void handleApproveCollaborator(id)
                    : undefined
                }
                onRemove={
                  isOwnerOfSelected
                    ? (id) => void handleRemoveCollaborator(id)
                    : undefined
                }
              />
            </div>
          )}
        </aside>

        {/* ══════════════════════════
            CONTENT AREA
        ══════════════════════════ */}
        <main className="flex-1 flex flex-col overflow-hidden min-h-0">
          {/* ── Editor + PDF split ── */}
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Editor panel (hidden in pdf-only mode) */}
            {layoutMode !== 'pdf' && (
              <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                {isPendingApproval ? (
                  <div className="h-full flex items-center justify-center bg-slate-900">
                    <div className="max-w-md px-6 text-center">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-500/20 flex items-center justify-center">
                        <Users className="w-7 h-7 text-amber-400" />
                      </div>
                      <p className="text-base font-semibold text-slate-200">
                        En attente d&apos;approbation
                      </p>
                      <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                        Le propriétaire du projet doit approuver votre accès
                        avant que vous puissiez collaborer. Revenez vérifier une
                        fois approuvé.
                      </p>
                      <button
                        onClick={() => {
                          setIsPendingApproval(false);
                          if (owner && initialProjectId) {
                            void loadSharedProject(
                              owner,
                              initialProjectId,
                            ).catch((error: unknown) => {
                              if (
                                error instanceof Error &&
                                error.message === 'PENDING_APPROVAL'
                              ) {
                                setIsPendingApproval(true);
                              }
                            });
                          }
                        }}
                        className="mt-4 px-4 py-2 text-sm rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors"
                      >
                        Vérifier à nouveau
                      </button>
                    </div>
                  </div>
                ) : sharedProjectUnavailable ? (
                  <div className="h-full flex items-center justify-center bg-slate-50">
                    <div className="max-w-md px-6 text-center">
                      <Folder className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                      <p className="text-sm font-semibold text-slate-700">
                        Projet partage introuvable
                      </p>
                      <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                        Dans le mode mock actuel, un lien partage ne peut ouvrir
                        que les projets presents dans ce navigateur. Avec le
                        backend reel, ce lien chargera directement le projet du
                        proprietaire.
                      </p>
                    </div>
                  </div>
                ) : selectedProject && selectedFile ? (
                  selectedFile.type === 'image' ? (
                    <div className="h-full flex flex-col items-center justify-center bg-slate-900 p-6 gap-3">
                      <p className="text-xs text-slate-500 flex-shrink-0">
                        {selectedFile.name}
                      </p>
                      {selectedFile.content ? (
                        <img
                          src={selectedFile.content}
                          alt={selectedFile.name}
                          className="max-h-full max-w-full object-contain rounded shadow-lg"
                        />
                      ) : (
                        <div className="text-center">
                          <ImageIcon className="w-10 h-10 mx-auto mb-2 text-slate-600" />
                          <p className="text-sm text-slate-500">
                            Aperçu non disponible
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <ProjectEditor
                      key={`${selectedProject.id}:${selectedFile.id}`}
                      project={selectedProject}
                      file={selectedFile}
                      filePath={selectedFilePath ?? selectedFile.name}
                      user={user}
                      onContentChange={onContentChange}
                      onCollaboratorsChange={onCollaboratorsChange}
                      onSyncToPdf={handleSourceToPdf}
                      revealPosition={
                        revealPosition?.file === selectedFilePath
                          ? revealPosition
                          : undefined
                      }
                    />
                  )
                ) : (
                  <div className="h-full flex items-center justify-center bg-slate-50">
                    <div className="text-center">
                      <FileText className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                      <p className="text-sm font-medium text-slate-500">
                        Aucun fichier sélectionné
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Choisissez un fichier dans la barre latérale pour
                        commencer
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* PDF preview panel (visible in split and pdf modes) */}
            {layoutMode !== 'code' && (
              <div
                className={`${
                  layoutMode === 'split'
                    ? 'w-[48%] flex-shrink-0 border-l border-slate-200'
                    : 'flex-1'
                } flex flex-col overflow-hidden`}
              >
                <PdfViewer
                  status={compilation.status}
                  pdfUrl={compilation.pdfUrl}
                  projectName={selectedProject?.name ?? ''}
                  compiledAt={compilation.compiledAt}
                  durationMs={compilation.durationMs}
                  onRecompile={() => void runCompilation(false, true)}
                  onClose={() => setLayoutMode('code')}
                  isStale={pdfLocallyStale || compilation.isPdfStale}
                  syncTarget={
                    pdfSyncTarget?.pdfJobId === compilation.displayedPdfJobId
                      ? pdfSyncTarget
                      : undefined
                  }
                  onSyncToSource={handlePdfToSource}
                />
              </div>
            )}
          </div>

          {/* ── Compilation logs panel ── */}
          <CompilationLogs
            isOpen={logsOpen}
            status={compilation.status}
            logs={compilation.logs}
            durationMs={compilation.durationMs}
            onClose={() => setLogsOpen(false)}
          />
        </main>
      </div>

      {/* ════════════════════════════════════════
          MODALS
      ════════════════════════════════════════ */}

      <ProjectShareModal
        isOpen={Boolean(projectToShare)}
        projectId={projectToShare?.id}
        projectName={projectToShare?.name}
        onClose={handleCloseShareModal}
      />

      {/* Create project */}
      <Modal
        isOpen={isCreateModalOpen}
        title="Nouveau projet"
        onClose={() => {
          setIsCreateModalOpen(false);
          setNewProjectName('');
        }}
        footer={
          <ModalFooter
            onCancel={() => {
              setIsCreateModalOpen(false);
              setNewProjectName('');
            }}
            onConfirm={handleCreateProject}
            confirmLabel="Créer le projet"
            disabled={!newProjectName.trim()}
          />
        }
      >
        <div className="space-y-2">
          <label
            htmlFor="projectName"
            className="block text-sm font-medium text-slate-700"
          >
            Nom du projet
          </label>
          <input
            id="projectName"
            type="text"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            placeholder="ex : Article de conférence"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
            autoFocus
          />
          <p className="text-xs text-slate-400">
            Les fichiers{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">
              main.tex
            </code>
            ,{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">
              reference.bib
            </code>{' '}
            et le dossier{' '}
            <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-600">
              pic/
            </code>{' '}
            seront créés automatiquement.
          </p>
        </div>
      </Modal>

      <input
        ref={texImportInputRef}
        type="file"
        accept=".tex,text/plain"
        className="hidden"
        onChange={(event) => void handleImportedFile(event, 'tex')}
      />
      <input
        ref={imageImportInputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(event) => void handleImportedFile(event, 'image')}
      />
      <input
        ref={(element) => {
          folderImportInputRef.current = element;
          element?.setAttribute('webkitdirectory', '');
          element?.setAttribute('directory', '');
        }}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => void handleImportedFolder(event)}
      />

      <Modal
        isOpen={folderImportOpen}
        title="Importer un dossier"
        onClose={() => {
          if (folderImportProgress === null) {
            setFolderImportOpen(false);
            setImportState(null);
          }
        }}
      >
        <div
          className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center transition-colors hover:border-emerald-500 hover:bg-emerald-50/40"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => void handleFolderDrop(event)}
        >
          <FolderPlus className="mx-auto mb-3 h-9 w-9 text-emerald-600" />
          {folderImportProgress === null ? (
            <>
              <p className="text-sm font-semibold text-slate-700">
                Glissez votre dossier ici
              </p>
              <p className="mt-1 text-xs text-slate-500">
                L&apos;arborescence, les images et les fichiers seront
                conservés.
              </p>
              <button
                type="button"
                className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                onClick={() => void handleChooseFolder()}
              >
                Choisir un dossier
              </button>
            </>
          ) : (
            <div className="space-y-3">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-emerald-600" />
              <p className="text-sm font-medium text-slate-700">
                {folderImportProgress < 80
                  ? 'Lecture des fichiers…'
                  : 'Envoi du dossier…'}
              </p>
              <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-200"
                  style={{ width: `${folderImportProgress}%` }}
                />
              </div>
              <p className="text-xs tabular-nums text-slate-500">
                {folderImportProgress}%
              </p>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(creationState)}
        title={creationTitle}
        onClose={() => {
          setCreationState(null);
          setNewEntryName('');
        }}
        footer={
          <ModalFooter
            onCancel={() => {
              setCreationState(null);
              setNewEntryName('');
            }}
            onConfirm={() => void handleConfirmEntryCreation()}
            confirmLabel="Creer"
            disabled={!newEntryName.trim()}
          />
        }
      >
        <div className="space-y-2">
          <label
            htmlFor="newEntryName"
            className="block text-sm font-medium text-slate-700"
          >
            Nom dans {creationState?.parentLabel ?? 'le projet'}
          </label>
          <input
            id="newEntryName"
            type="text"
            value={newEntryName}
            onChange={(event) => setNewEntryName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleConfirmEntryCreation();
              }
            }}
            placeholder={creationPlaceholder}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
            autoFocus
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(nodeToRename)}
        title="Renommer cet element"
        onClose={() => {
          setNodeToRename(null);
          setNodeRenameValue('');
        }}
        footer={
          <ModalFooter
            onCancel={() => {
              setNodeToRename(null);
              setNodeRenameValue('');
            }}
            onConfirm={() => void handleConfirmRenameNode()}
            confirmLabel="Enregistrer"
            disabled={!nodeRenameValue.trim()}
          />
        }
      >
        <div className="space-y-2">
          <label
            htmlFor="renameNodeName"
            className="block text-sm font-medium text-slate-700"
          >
            Nouveau nom
          </label>
          <input
            id="renameNodeName"
            type="text"
            value={nodeRenameValue}
            onChange={(event) => setNodeRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleConfirmRenameNode();
              }
            }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
            autoFocus
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(nodeToDelete)}
        title="Supprimer cet element ?"
        onClose={() => setNodeToDelete(null)}
        footer={
          <ModalFooter
            onCancel={() => setNodeToDelete(null)}
            onConfirm={() => void handleDeleteNode()}
            confirmLabel="Supprimer"
          />
        }
      >
        <p className="text-sm text-slate-600">
          Cette action supprimera{' '}
          <span className="font-medium text-slate-800">
            {nodeToDelete?.name ?? 'cet element'}
          </span>
          {nodeToDelete?.type === 'folder'
            ? ' ainsi que tout son contenu.'
            : '.'}
        </p>
      </Modal>

      <Modal
        isOpen={Boolean(projectToRename)}
        title="Renommer le projet"
        onClose={() => {
          setProjectToRename(null);
          setRenameValue('');
        }}
        footer={
          <ModalFooter
            onCancel={() => {
              setProjectToRename(null);
              setRenameValue('');
            }}
            onConfirm={() => void handleConfirmRenameProject()}
            confirmLabel="Enregistrer"
            disabled={!renameValue.trim()}
          />
        }
      >
        <div className="space-y-2">
          <label
            htmlFor="renameProjectName"
            className="block text-sm font-medium text-slate-700"
          >
            Nom du projet
          </label>
          <input
            id="renameProjectName"
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void handleConfirmRenameProject();
              }
            }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
            autoFocus
          />
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(projectToDelete)}
        title="Supprimer ce projet ?"
        onClose={() => setProjectToDelete(null)}
        footer={
          <ModalFooter
            onCancel={() => setProjectToDelete(null)}
            onConfirm={() =>
              projectToDelete &&
              void handleDeleteExistingProject(projectToDelete)
            }
            confirmLabel="Supprimer"
          />
        }
      >
        <p className="text-sm text-slate-600">
          Cette action est irreversible. Les fichiers du projet{' '}
          <span className="font-medium text-slate-800">
            {projectToDelete?.name ?? 'ce projet'}
          </span>{' '}
          seront supprimes.
        </p>
      </Modal>

      {/* Confirm remove collaborator */}
      <Modal
        isOpen={Boolean(confirmRemoveCollaboratorId)}
        title="Retirer ce collaborateur ?"
        onClose={() => setConfirmRemoveCollaboratorId(null)}
        footer={
          <ModalFooter
            onCancel={() => setConfirmRemoveCollaboratorId(null)}
            onConfirm={() => void handleConfirmRemoveCollaborator()}
            confirmLabel="Retirer"
          />
        }
      >
        <p className="text-sm text-slate-600">
          Ce collaborateur perdra immédiatement l&apos;accès au projet et
          celui-ci n&apos;apparaîtra plus dans son espace de travail.
        </p>
      </Modal>
    </div>
  );
};

export default Dashboard;
