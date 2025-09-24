/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { latex } from 'codemirror-lang-latex';
import { oneDark } from '@codemirror/theme-one-dark';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { Save, Users, Wifi, WifiOff } from 'lucide-react';
import { User, Project, Collaborator } from '@frelated/types';

interface ProjectEditorProps {
  project: Project;
  fileName: string;
  user: User;
  onCollaboratorsChange: (users: Collaborator[]) => void;
}

const ProjectEditor: React.FC<ProjectEditorProps> = ({
  project,
  fileName,
  user,
  onCollaboratorsChange,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (!editorRef.current) return;

    if (viewRef.current) viewRef.current.destroy();
    if (providerRef.current) providerRef.current.destroy();

    const doc = new Y.Doc();
    docRef.current = doc;

    const roomName = `${project.id}-${fileName}`;
    const provider = new WebsocketProvider(
      'ws://localhost:8080',
      roomName,
      doc,
    );
    providerRef.current = provider;

    const yText = doc.getText('codemirror');

    if (yText.length === 0 && fileName === 'main.tex') {
      yText.insert(
        0,
        `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{amsmath}
\\usepackage{graphicx}

\\title{${project.name}}
\\author{${user.name}}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}
Welcome to collaborative LaTeX editing! Start typing your content here.

\\section{Methods}
Describe your methods here.

\\section{Results}
Present your results here.

\\section{Conclusion}
Summarize your findings here.

\\end{document}`,
      );
    }

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        basicSetup,
        latex(),
        ...(isDark ? [oneDark] : []),
        yCollab(yText, provider.awareness),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });
    viewRef.current = view;

    provider.on('status', (event: { status: string }) => {
      setIsConnected(event.status === 'connected');
      console.log(`Connection status: ${event.status}`);
    });

    provider.awareness.on('update', () => {
      const states = Array.from(provider.awareness.getStates().values());
      const activeUsers: Collaborator[] = states
        .filter((state: any) => state.user)
        .map((state: any) => state.user);
      setCollaborators(activeUsers);
      onCollaboratorsChange(activeUsers);
    });

    doc.on('update', () => {
      console.log('Document updated by:', user.name);
    });

    provider.awareness.setLocalStateField('user', {
      name: user.name,
      color: getRandomColor(),
      email: user.email,
    });

    return () => {
      view.destroy();
      provider.destroy();
    };
  }, [project.id, fileName, user, isDark]);

  const getRandomColor = (): string => {
    const colors = [
      '#FF6B6B',
      '#4ECDC4',
      '#45B7D1',
      '#96CEB4',
      '#FECA57',
      '#FF9FF3',
      '#54A0FF',
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const handleSave = () => {
    console.log('Saving document...', fileName);
    alert('Document saved successfully!');
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={handleSave}
            className="flex items-center space-x-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>Save</span>
          </button>

          <div className="flex items-center space-x-2">
            {isConnected ? (
              <>
                <Wifi className="w-4 h-4 text-green-600" />
                <span className="text-sm text-green-600">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-red-600" />
                <span className="text-sm text-red-600">Disconnected</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Dark mode toggle */}
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={isDark}
              onChange={(e) => setIsDark(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-600">Dark Mode</span>
          </label>

          {/* Collaborators */}
          {collaborators.length > 0 && (
            <div className="flex items-center space-x-2">
              <Users className="w-4 h-4 text-gray-500" />
              <div className="flex -space-x-2">
                {collaborators.slice(0, 3).map((collaborator, index) => (
                  <div
                    key={index}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium border-2 border-white"
                    style={{
                      backgroundColor: (collaborator as any).color || '#666',
                    }}
                    title={collaborator.name}
                  >
                    {collaborator.name!.charAt(0).toUpperCase()}
                  </div>
                ))}
                {collaborators.length > 3 && (
                  <div className="w-8 h-8 rounded-full bg-gray-500 flex items-center justify-center text-white text-xs font-medium border-2 border-white">
                    +{collaborators.length - 3}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CodeMirror editor */}
      <div className="flex-1 relative">
        <div
          ref={editorRef}
          className="h-full w-full"
          style={{
            fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
            fontSize: '14px',
            lineHeight: '1.5',
          }}
        />

        {!isConnected && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-red-100 border border-red-300 text-red-700 px-4 py-2 rounded-lg shadow-lg">
            <div className="flex items-center space-x-2">
              <WifiOff className="w-4 h-4" />
              <span className="text-sm">Reconnecting...</span>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="bg-gray-100 border-t border-gray-200 px-6 py-2 text-xs text-gray-600 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <span>File: {fileName}</span>
          <span>Project: {project.name}</span>
        </div>
        <div className="flex items-center space-x-4">
          <span>{collaborators.length} collaborator(s) online</span>
          <span>
            Room: {project.id}-{fileName}
          </span>
        </div>
      </div>
    </div>
  );
};

export default ProjectEditor;
