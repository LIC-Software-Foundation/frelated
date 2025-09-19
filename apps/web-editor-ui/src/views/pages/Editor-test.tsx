import React, { useState, useRef } from 'react';
import {
  FileText,
  Save,
  Download,
  Upload,
  Play,
  RefreshCw,
  Settings,
  Plus,
  Eye,
  Code,
  Split,
  File,
} from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { StreamLanguage } from '@codemirror/language';
import { EditorView, keymap } from '@codemirror/view';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import Latex from 'react-latex-next';
import latexCompletions from '../../data/latex-completions.json';
import { Link } from 'react-router-dom';

// Custom LaTeX syntax highlighting
const latexLanguage = StreamLanguage.define({
  token: (stream, state: { indentLevel?: number }) => {
    if (stream.match(/^%.*$/)) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\\[$]{1,2}/)) {
      return 'keyword';
    }
    if (stream.match(/^\\[a-zA-Z@]+/)) {
      return 'keyword';
    }
    if (stream.match(/^\{[^}]*\}/)) {
      return 'string';
    }
    if (stream.match(/^\$[^$]+\$/)) {
      return 'variable';
    }
    if (stream.match(/^\\begin\{[a-zA-Z@]*\}/)) {
      state.indentLevel = (state.indentLevel || 0) + 1;
      return 'tag';
    }
    if (stream.match(/^\\end\{[a-zA-Z@]*\}/)) {
      state.indentLevel = Math.max((state.indentLevel || 0) - 1, 0);
      return 'tag';
    }
    stream.next();
    return null;
  },
  languageData: {
    indentOnInput: /^\s*\\end\{/,
    indentUnit: '  ', // Two spaces for indentation
  },
});

// Custom style for syntax highlighting
const latexHighlightStyle = EditorView.theme({
  '.cm-comment': { color: '#5C6370', fontStyle: 'italic' },
  '.cm-keyword': { color: '#61AFEF' }, // LaTeX commands
  '.cm-string': { color: '#98C379' }, // Braces content
  '.cm-variable': { color: '#E06C75' }, // Math mode
  '.cm-tag': { color: '#C678DD' }, // Environments
});

// Custom autocompletion function
const latexAutocomplete = autocompletion({
  override: [
    (context) => {
      const word = context.matchBefore(/\\[\w@]*/);
      if (!word) return null;
      if (word.from === word.to && !context.explicit) return null;
      return {
        from: word.from,
        options: latexCompletions.map((c) => ({
          ...c,
          apply: (view, _completion, from, to) => {
            const insertText = c.template || c.label;
            view.dispatch({
              changes: { from, to, insert: insertText },
              selection: {
                anchor:
                  from + insertText.indexOf('}') || from + insertText.length,
              },
            });
          },
        })),
      };
    },
  ],
});

const Editor = () => {
  // State to manage multiple files
  const [files, setFiles] = useState<{ name: string; content: string }[]>([
    {
      name: 'main.tex',
      content: `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\begin{document}
\\title{My LaTeX Document}
\\author{Author Name}
\\maketitle
\\section{Introduction}
This is a sample LaTeX document. You can edit the code on the left and compile to see the preview.
\\begin{equation}
E = mc^2
\\end{equation}
\\end{document}`,
    },
    {
      name: 'references.bib',
      content: `@article{example,
  author = {Author, A.},
  title = {Sample Article},
  journal = {Journal Name},
  year = {2025}
}`,
    },
  ]);
  const [currentFile, setCurrentFile] = useState<string>('main.tex');
  const [preview, setPreview] = useState<string>('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    fileName: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Get the content of the current file
  const currentFileContent =
    files.find((file) => file.name === currentFile)?.content || '';

  // Handle file creation
  const handleCreateFile = () => {
    let newFileName = prompt(
      'Entrez le nom du nouveau fichier (.tex sera ajouté automatiquement) :',
      `new-file-${files.length + 1}`,
    );
    if (newFileName) {
      newFileName = newFileName.endsWith('.tex')
        ? newFileName
        : `${newFileName}.tex`;
      if (files.some((file) => file.name === newFileName)) {
        alert('Un fichier avec ce nom existe déjà !');
        return;
      }
      const newFileContent = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\begin{document}
\\title{${newFileName.replace('.tex', '')}}
\\author{Author Name}
\\maketitle
\\section{Introduction}
This is a new LaTeX document.
\\end{document}`;
      setFiles([...files, { name: newFileName, content: newFileContent }]);
      setCurrentFile(newFileName);
    }
  };

  // Handle file rename
  const handleRenameFile = (fileName: string) => {
    const newName = prompt(
      `Entrez le nouveau nom pour ${fileName} (.tex sera ajouté pour les fichiers LaTeX) :`,
      fileName,
    );
    if (newName && newName !== fileName) {
      const isTexFile = fileName.endsWith('.tex');
      const finalName = isTexFile
        ? newName.endsWith('.tex')
          ? newName
          : `${newName}.tex`
        : newName;
      if (files.some((file) => file.name === finalName)) {
        alert('Un fichier avec ce nom existe déjà !');
        return;
      }
      setFiles(
        files.map((file) =>
          file.name === fileName ? { ...file, name: finalName } : file,
        ),
      );
      if (currentFile === fileName) {
        setCurrentFile(finalName);
      }
    }
    setContextMenu(null);
  };

  // Handle file selection
  const handleFileSelect = (fileName: string) => {
    setCurrentFile(fileName);
    setContextMenu(null);
  };

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.name.endsWith('.tex')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        if (files.some((f) => f.name === file.name)) {
          alert('Un fichier avec ce nom existe déjà !');
          return;
        }
        setFiles([...files, { name: file.name, content }]);
        setCurrentFile(file.name);
      };
      reader.readAsText(file);
    } else {
      alert('Veuillez sélectionner un fichier .tex');
    }
    event.target.value = '';
  };

  // Handle context menu
  const handleContextMenu = (e: React.MouseEvent, fileName: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, fileName });
  };

  // Close context menu on click outside
  const handleClickOutside = () => {
    setContextMenu(null);
  };

  // Handle compile
  const handleCompile = () => {
    setIsCompiling(true);
    setTimeout(() => {
      const bodyMatch = currentFileContent.match(
        /\\begin\{document\}([\s\S]*?)\\end\{document\}/,
      );
      const body = bodyMatch ? bodyMatch[1].trim() : currentFileContent;
      setPreview(
        `\\documentclass{article}\\usepackage{amsmath}\\usepackage{graphicx}\\begin{document}${body}\\end{document}`,
      );
      setIsCompiling(false);
    }, 1500);
  };

  // Handle editor content change
  const handleEditorChange = (value: string) => {
    setFiles(
      files.map((file) =>
        file.name === currentFile ? { ...file, content: value } : file,
      ),
    );
  };

  return (
    <div className="flex h-screen bg-gray-50" onClick={handleClickOutside}>
      {/* Sidebar */}
      <div className="w-64 bg-gray-800 text-white flex flex-col shadow-xl">
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center space-x-2 mb-4">
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">Lᴀ</span>
              </div>
              <h1 className="text-xl font-bold">FreLatEd</h1>
            </Link>
          </div>
          <button
            onClick={handleCompile}
            disabled={isCompiling}
            className="w-full flex items-center justify-center px-4 py-2 bg-green-500 hover:bg-green-600 disabled:bg-green-400 rounded-lg transition-colors mb-2"
          >
            {isCompiling ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Compilation...
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2" />
                Compiler PDF
              </>
            )}
          </button>
        </div>
        <div className="p-4 flex-1">
          <div className="space-y-2 mb-6">
            <button
              onClick={handleCreateFile}
              className="w-full flex items-center px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nouveau projet
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center px-4 py-2 bg-purple-500 hover:bg-purple-600 rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4 mr-2" />
              Importer fichier
            </button>
            <input
              type="file"
              accept=".tex"
              ref={fileInputRef}
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wide">
              Fichiers du projet
            </h3>
            <div className="space-y-1">
              {files.map((file) => (
                <div
                  key={file.name}
                  onClick={() => handleFileSelect(file.name)}
                  onContextMenu={(e) => handleContextMenu(e, file.name)}
                  className={`flex items-center px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    file.name === currentFile
                      ? 'bg-blue-600'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  {file.name.endsWith('.tex') ? (
                    <FileText className="w-4 h-4 mr-2" />
                  ) : (
                    <File className="w-4 h-4 mr-2" />
                  )}
                  <span className="text-sm">{file.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-gray-700 space-y-2">
          <button className="w-full flex items-center px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
            <Download className="w-4 h-4 mr-2" />
            Télécharger PDF
          </button>
          <button className="w-full flex items-center px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
            <Save className="w-4 h-4 mr-2" />
            Sauvegarder
          </button>
          <button className="w-full flex items-center px-4 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors">
            <Settings className="w-4 h-4 mr-2" />
            Paramètres
          </button>
        </div>
      </div>
      {/* Context Menu */}
      {contextMenu && (
        <div
          className="absolute bg-gray-700 text-white rounded shadow-lg z-10"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            onClick={() => handleRenameFile(contextMenu.fileName)}
            className="block px-4 py-2 hover:bg-gray-600 w-full text-left"
          >
            Renommer
          </button>
        </div>
      )}
      {/* Main Area */}
      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Code className="w-5 h-5 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                {currentFile}
              </span>
            </div>
            <div className="h-4 w-px bg-gray-300"></div>
            <div className="text-sm text-gray-500">
              Lignes: {currentFileContent.split('\n').length} | Caractères:{' '}
              {currentFileContent.length}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button className="px-3 py-1 bg-white rounded text-sm font-medium text-gray-700 shadow-sm">
                <Split className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 flex overflow-hidden">
          <div className="w-1/2 flex flex-col border-r border-gray-200">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
              <div className="flex items-center">
                <Code className="w-4 h-4 mr-2 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">
                  Éditeur LaTeX
                </span>
              </div>
            </div>
            <div className="flex-1 bg-gray-900 overflow-auto">
              <CodeMirror
                value={currentFileContent}
                onChange={handleEditorChange}
                theme={oneDark}
                extensions={[
                  latexLanguage,
                  latexHighlightStyle,
                  EditorView.lineWrapping,
                  closeBrackets(),
                  latexAutocomplete,
                  keymap.of([
                    ...closeBracketsKeymap,
                    ...completionKeymap,
                    indentWithTab,
                  ]),
                ]}
                height="100%"
                className="font-mono text-sm bg-gray-900"
                basicSetup={{
                  highlightActiveLine: true,
                  highlightActiveLineGutter: true,
                  closeBrackets: false, // Handled by closeBrackets extension
                }}
                style={{ height: '100%', overflow: 'auto' }}
              />
            </div>
          </div>
          <div className="w-1/2 flex flex-col bg-white">
            <div className="bg-gray-100 px-4 py-2 border-b border-gray-200">
              <div className="flex items-center">
                <Eye className="w-4 h-4 mr-2 text-gray-600" />
                <span className="text-sm font-medium text-gray-700">
                  Aperçu du document
                </span>
              </div>
            </div>
            <div className="flex-1 bg-white overflow-auto">
              <div className="p-6">
                {isCompiling ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mx-auto mb-4" />
                      <p className="text-gray-600">Compilation en cours...</p>
                    </div>
                  </div>
                ) : preview ? (
                  <div className="prose max-w-none">
                    <Latex>{preview}</Latex>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center text-gray-500">
                      <Eye className="w-8 h-8 mx-auto mb-4 opacity-50" />
                      <p>Compilez le document pour voir l'aperçu</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Editor;
