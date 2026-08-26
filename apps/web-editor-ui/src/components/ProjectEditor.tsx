import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { latex } from 'codemirror-lang-latex';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WifiOff } from 'lucide-react';
import { User, Collaborator } from '@frelated/types';
import { ProjectFile, ProjectWithFiles, CollaboratorWithColor } from '../types';
import { readApiSession } from '../services/api/sessionStorage';
import EditorToolbar from './EditorToolbar';

// Shape of each entry in the Yjs awareness map
interface AwarenessState {
  user?: CollaboratorWithColor;
}

interface ProjectEditorProps {
  project: ProjectWithFiles;
  file: ProjectFile;
  user: User;
  onContentChange: (content: string) => void;
  onCollaboratorsChange: (users: Collaborator[]) => void;
}

const CURSOR_COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FECA57',
  '#FF9FF3',
  '#54A0FF',
];

const getPresenceColor = (email: string): string => {
  const normalizedEmail = email.trim().toLowerCase();
  const seed = Array.from(normalizedEmail).reduce(
    (sum, character) => sum + character.charCodeAt(0),
    0,
  );

  return CURSOR_COLORS[seed % CURSOR_COLORS.length];
};

// EditorView.theme() has higher specificity than baseTheme(), ensuring our
// cursor styles override the defaults injected by y-codemirror.next.
const cursorPresenceTheme = EditorView.theme({
  '.cm-ySelectionCaret': {
    position: 'relative',
    borderLeftWidth: '2px',
    borderRightWidth: '2px',
  },
  '.cm-ySelectionInfo': {
    opacity: '1 !important',
    transform: 'translateY(-2px)',
    borderRadius: '999px',
    padding: '2px 8px',
    fontFamily:
      '"JetBrains Mono", "Fira Code", Monaco, Menlo, "Ubuntu Mono", monospace',
    fontSize: '10px',
    fontWeight: '600',
    boxShadow: '0 8px 20px rgba(15, 23, 42, 0.18)',
    whiteSpace: 'nowrap',
  },
  '.cm-ySelectionCaretDot': {
    width: '0.55em',
    height: '0.55em',
  },
});

const COLLAB_SERVER_URL =
  import.meta.env.VITE_COLLAB_SERVER_URL?.trim() || 'ws://localhost:8080';
const COLLAB_HTTP_URL = COLLAB_SERVER_URL?.replace(/^ws/u, 'http');

const ensureCollaborationRoom = async (roomName: string, token: string) => {
  if (!COLLAB_HTTP_URL) {
    return;
  }

  const response = await fetch(
    `${COLLAB_HTTP_URL}/rooms/${encodeURIComponent(roomName)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error('Preparation de la room collaborative impossible.');
  }
};

const normalizePresenceUsers = (states: AwarenessState[]) =>
  states
    .filter(
      (state): state is Required<AwarenessState> => state.user !== undefined,
    )
    .map((state) => ({
      ...state.user,
      isOnline: true,
    }));

const ProjectEditor: React.FC<ProjectEditorProps> = ({
  project,
  file,
  user,
  onContentChange,
  onCollaboratorsChange,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const initialFileContentRef = useRef(file.content);
  // One Compartment instance per component lifetime — safe to reuse across
  // editor recreations because Compartment is just an identity token.
  const themeCompartmentRef = useRef(new Compartment());

  const onContentChangeRef = useRef(onContentChange);
  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  const onCollaboratorsChangeRef = useRef(onCollaboratorsChange);
  useEffect(() => {
    onCollaboratorsChangeRef.current = onCollaboratorsChange;
  }, [onCollaboratorsChange]);

  useEffect(() => {
    initialFileContentRef.current = file.content;
  }, [file.id, file.content]);

  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorWithColor[]>(
    [],
  );
  const [isDark, setIsDark] = useState(false);
  const [fontSize, setFontSize] = useState(15);

  // Apply theme changes without tearing down the WebSocket provider.
  // Previously isDark was in the main effect deps, which destroyed and
  // recreated the provider (and broke the active collaboration session)
  // every time the user toggled the theme.
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: themeCompartmentRef.current.reconfigure(isDark ? [oneDark] : []),
    });
  }, [isDark]);

  // Reinitialize editor only when the document identity changes.
  // Recreating the Yjs doc on every content update breaks collaborative sync.
  // isDark is intentionally absent from deps — theme updates are handled by
  // the Compartment effect above.
  useEffect(() => {
    if (!editorRef.current) return;

    viewRef.current?.destroy();
    providerRef.current?.destroy();
    setIsConnected(false);
    setCollaborators([]);

    const doc = new Y.Doc();
    const yText = doc.getText('codemirror');
    const themeCompartment = themeCompartmentRef.current;

    const localUser: CollaboratorWithColor = {
      name: user.name,
      email: user.email,
      color: getPresenceColor(user.email),
      colorLight: `${getPresenceColor(user.email)}33`,
      isOnline: true,
    };

    // Flag set to true while the Yjs provider is applying its initial sync.
    // REST saves triggered during that window would overwrite newer disk
    // content with a potentially stale Yjs state — we skip them.
    let yjsSyncing = false;

    const extensions = [
      basicSetup,
      latex(),
      cursorPresenceTheme,
      // Theme is managed via Compartment so it can be swapped without
      // rebuilding the editor or the WebSocket provider.
      themeCompartment.of(isDark ? [oneDark] : []),
      EditorView.updateListener.of((update) => {
        // Skip the initial Yjs seed transaction to avoid overwriting newer
        // content with a stale REST snapshot.
        if (update.docChanged && !yjsSyncing) {
          onContentChangeRef.current(update.state.doc.toString());
        }
      }),
    ];

    let provider: WebsocketProvider | null = null;
    let view: EditorView | null = null;
    let isCancelled = false;
    let detachAwarenessListener: (() => void) | null = null;

    const initializeEditor = async () => {
      const session = readApiSession();
      const roomName = `${project.id}___${file.id}`;

      if (COLLAB_SERVER_URL && session?.token) {
        provider = new WebsocketProvider(COLLAB_SERVER_URL, roomName, doc, {
          params: { token: session.token },
        });
        const activeProvider = provider;
        providerRef.current = activeProvider;

        // Seed the collaborative doc from the persisted file content only when
        // the room is effectively empty. During an active collaboration session,
        // Yjs is the freshest source of truth; replacing it with the REST file
        // content would wipe live remote edits when another user joins.
        activeProvider.once('sync', (isSynced: boolean) => {
          if (!isSynced || initialFileContentRef.current == null) return;

          const fileContent = initialFileContentRef.current;
          const yjsContent = yText.toString();

          if (yjsContent.length === 0 && fileContent.length > 0) {
            yjsSyncing = true;
            doc.transact(() => {
              yText.insert(0, fileContent);
            });
            yjsSyncing = false;
          }
        });

        extensions.push(yCollab(yText, activeProvider.awareness));

        activeProvider.on('status', (event: { status: string }) => {
          setIsConnected(event.status === 'connected');
        });

        const syncPresence = () => {
          const states = Array.from(
            activeProvider.awareness.getStates().values(),
          ) as AwarenessState[];
          const activeUsers = normalizePresenceUsers(states);
          setCollaborators(activeUsers.length > 0 ? activeUsers : [localUser]);
          onCollaboratorsChangeRef.current(
            activeUsers.length > 0 ? activeUsers : [localUser],
          );
        };

        activeProvider.awareness.on('change', syncPresence);
        detachAwarenessListener = () => {
          activeProvider.awareness.off('change', syncPresence);
        };
        activeProvider.awareness.setLocalStateField('user', localUser);
        syncPresence();

        void ensureCollaborationRoom(roomName, session.token).catch((error) => {
          console.warn('Preparation de la room collaborative echouee', error);
        });
      } else {
        // No collab server: populate directly from Prisma (no merge risk)
        if (yText.length === 0 && initialFileContentRef.current) {
          yText.insert(0, initialFileContentRef.current);
        }
        setIsConnected(true);
        setCollaborators([localUser]);
        onCollaboratorsChangeRef.current([localUser]);
      }

      if (isCancelled) {
        return;
      }

      const state = EditorState.create({
        doc: yText.toString(),
        extensions,
      });

      view = new EditorView({ state, parent: editorRef.current! });
      viewRef.current = view;
    };

    void initializeEditor();

    return () => {
      isCancelled = true;
      detachAwarenessListener?.();
      view?.destroy();
      provider?.destroy();
      doc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, project.id, user.email, user.name]);

  return (
    <div
      className={`h-full flex flex-col ${isDark ? 'bg-[#1e1e2e] text-slate-100' : 'bg-white text-slate-900'}`}
    >
      {/* ── Toolbar ── */}
      <EditorToolbar
        viewRef={viewRef}
        isDark={isDark}
        fontSize={fontSize}
        isConnected={isConnected}
        collaborators={collaborators}
        onToggleTheme={() => setIsDark((d) => !d)}
        onFontSizeChange={setFontSize}
      />

      {/* ── Editor area ── */}
      <div className="flex-1 relative overflow-hidden">
        {/* CodeMirror mount */}
        <div
          ref={editorRef}
          className="h-full w-full"
          style={{
            fontFamily:
              '"JetBrains Mono", "Fira Code", Monaco, Menlo, "Ubuntu Mono", monospace',
            fontSize: `${fontSize}px`,
            lineHeight: '1.6',
          }}
        />

        {/* Offline banner */}
        {!isConnected && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-red-50 border border-red-200 text-red-700 px-3 py-1.5 rounded-lg shadow-md flex items-center gap-2">
            <WifiOff className="w-3.5 h-3.5" />
            <span className="text-xs font-medium">Reconnexion en cours…</span>
          </div>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="flex items-center justify-between bg-[#1b2635] border-t border-[#253347] px-4 py-1 text-[11px] text-slate-400 flex-shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-slate-300 font-medium">{file.name}</span>
          <span>{project.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>{collaborators.length} en ligne</span>
          <span className="text-slate-600">LaTeX</span>
        </div>
      </div>
    </div>
  );
};

export default ProjectEditor;
