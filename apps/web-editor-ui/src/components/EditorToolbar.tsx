import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorView } from 'codemirror';
import { undo, redo } from '@codemirror/commands';
import {
  AlignCenter,
  Bold,
  BookOpen,
  ChevronDown,
  Hash,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Moon,
  Redo2,
  Search,
  Sun,
  Table,
  Underline,
  Undo2,
  Users,
  Wifi,
  WifiOff,
  ZoomIn,
} from 'lucide-react';

import {
  insertAbstract,
  insertAlign,
  insertBold,
  insertCenter,
  insertCite,
  insertDescription,
  insertDisplayMath,
  insertEmph,
  insertEnumerate,
  insertEquation,
  insertFigure,
  insertFootnote,
  insertFraction,
  insertInlineMath,
  insertIntegral,
  insertItem,
  insertItemize,
  insertItalic,
  insertLabel,
  insertParagraph,
  insertQuote,
  insertRef,
  insertSection,
  insertSqrt,
  insertSubsection,
  insertSubsubsection,
  insertSubscript,
  insertSuperscript,
  insertSum,
  insertTable,
  insertUnderline,
  insertVerbatim,
} from '../utils/latexInsert';

import { CollaboratorWithColor } from '../types';

// ─── Atom: ToolbarBtn ─────────────────────────────────────────────────────────

interface ToolbarBtnProps {
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  isDark: boolean;
  children: React.ReactNode;
}

const ToolbarBtn: React.FC<ToolbarBtnProps> = ({
  onClick,
  title,
  active = false,
  disabled = false,
  isDark,
  children,
}) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={`p-1.5 rounded transition-colors disabled:opacity-40 flex-shrink-0 ${
      isDark
        ? `text-slate-300 hover:bg-slate-700 hover:text-white ${active ? 'bg-slate-700 text-white' : ''}`
        : `text-slate-600 hover:bg-slate-200 hover:text-slate-900 ${active ? 'bg-slate-200 text-slate-900' : ''}`
    }`}
  >
    {children}
  </button>
);

// ─── Atom: ToolbarDivider ─────────────────────────────────────────────────────

const ToolbarDivider: React.FC<{ isDark: boolean }> = ({ isDark }) => (
  <div
    className={`w-px h-4 self-center flex-shrink-0 mx-0.5 ${isDark ? 'bg-slate-700' : 'bg-slate-300'}`}
  />
);

// ─── Molecule: DropdownMenu ───────────────────────────────────────────────────

interface DropdownItem {
  label: string;
  sub?: string;
  icon?: React.ReactNode;
  onSelect: () => void;
}

interface DropdownMenuProps {
  id: string;
  label: string;
  icon: React.ReactNode;
  items?: DropdownItem[];
  /** Custom panel content (e.g. TablePicker) — rendered above items */
  children?: React.ReactNode;
  openId: string | null;
  onToggle: (id: string) => void;
  onClose: () => void;
  isDark: boolean;
}

const DropdownMenu: React.FC<DropdownMenuProps> = ({
  id,
  label,
  icon,
  items,
  children,
  openId,
  onToggle,
  onClose,
  isDark,
}) => {
  const isOpen = openId === id;
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onClose]);

  const panelCls = isDark
    ? 'bg-[#1c1c2e] border-slate-700 text-slate-200'
    : 'bg-white border-slate-200 text-slate-700';

  const itemHover = isDark ? 'hover:bg-white/10' : 'hover:bg-slate-50';

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      <button
        onClick={() => onToggle(id)}
        title={label}
        className={`flex items-center gap-1 px-1.5 py-1 rounded text-xs transition-colors ${
          isOpen
            ? isDark
              ? 'bg-slate-700 text-white'
              : 'bg-slate-200 text-slate-900'
            : isDark
              ? 'text-slate-300 hover:bg-slate-700 hover:text-white'
              : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
        }`}
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="hidden xl:inline whitespace-nowrap">{label}</span>
        <ChevronDown
          className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute top-full left-0 mt-1 min-w-[200px] rounded-lg border shadow-xl z-50 py-1 animate-fade-in ${panelCls}`}
        >
          {children}

          {children && items && items.length > 0 && (
            <div
              className={`mx-3 my-1 h-px ${isDark ? 'bg-slate-700' : 'bg-slate-100'}`}
            />
          )}

          {items?.map((item, i) => (
            <button
              key={i}
              onClick={() => {
                item.onSelect();
                onClose();
              }}
              className={`w-full flex items-start gap-2.5 px-3 py-1.5 text-left transition-colors ${itemHover}`}
            >
              {item.icon && (
                <span className="flex-shrink-0 mt-0.5 opacity-60 w-4">
                  {item.icon}
                </span>
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium leading-tight">
                  {item.label}
                </div>
                {item.sub && (
                  <div
                    className={`text-[10px] font-mono leading-tight mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}
                  >
                    {item.sub}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Molecule: TablePicker ────────────────────────────────────────────────────

interface TablePickerProps {
  onSelect: (rows: number, cols: number) => void;
  isDark: boolean;
}

const TablePicker: React.FC<TablePickerProps> = ({ onSelect, isDark }) => {
  const [hover, setHover] = useState({ rows: 0, cols: 0 });
  const MAX = 8;

  return (
    <div className="px-3 py-2.5">
      <p
        className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}
      >
        Dimensions du tableau
      </p>

      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${MAX}, 1fr)` }}
        onMouseLeave={() => setHover({ rows: 0, cols: 0 })}
      >
        {Array.from({ length: MAX * MAX }).map((_, idx) => {
          const row = Math.floor(idx / MAX) + 1;
          const col = (idx % MAX) + 1;
          const isActive = row <= hover.rows && col <= hover.cols;
          return (
            <div
              key={idx}
              className={`w-4 h-4 rounded-sm border cursor-pointer transition-colors ${
                isActive
                  ? 'bg-emerald-500 border-emerald-400'
                  : isDark
                    ? 'bg-slate-700 border-slate-600 hover:border-slate-400'
                    : 'bg-slate-100 border-slate-300 hover:border-slate-400'
              }`}
              onMouseEnter={() => setHover({ rows: row, cols: col })}
              onClick={() => onSelect(row, col)}
            />
          );
        })}
      </div>

      <p
        className={`text-center text-[10px] mt-2 tabular-nums ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
      >
        {hover.rows > 0
          ? `${hover.rows} lignes × ${hover.cols} colonnes`
          : 'Survolez pour choisir'}
      </p>
    </div>
  );
};

// ─── Main: EditorToolbar ──────────────────────────────────────────────────────

export interface EditorToolbarProps {
  viewRef: React.RefObject<EditorView | null>;
  isDark: boolean;
  fontSize: number;
  isConnected: boolean;
  collaborators: CollaboratorWithColor[];
  onToggleTheme: () => void;
  onFontSizeChange: (newSize: number) => void;
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({
  viewRef,
  isDark,
  fontSize,
  isConnected,
  collaborators,
  onToggleTheme,
  onFontSizeChange,
}) => {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const toggleMenu = useCallback(
    (id: string) => setOpenMenu((prev) => (prev === id ? null : id)),
    [],
  );
  const closeMenu = useCallback(() => setOpenMenu(null), []);

  /**
   * Execute a LaTeX insert action on the editor view.
   * Also closes any open dropdown menu.
   */
  const act = useCallback(
    (fn: (v: EditorView) => void) => {
      const v = viewRef.current;
      if (v) fn(v);
      closeMenu();
    },
    [viewRef, closeMenu],
  );

  // ── Shared props ──────────────────────────────────────────────────────────
  const dropdownProps = {
    openId: openMenu,
    onToggle: toggleMenu,
    onClose: closeMenu,
    isDark,
  };

  const toolbarBg = isDark
    ? 'bg-[#252535] border-slate-700'
    : 'bg-slate-50 border-slate-200';

  return (
    <div
      className={`flex items-center border-b flex-shrink-0 px-2 py-1 gap-0.5 ${toolbarBg}`}
    >
      {/* ══════════════════════════════════
          LEFT: LaTeX tools
      ══════════════════════════════════ */}
      <div className="flex items-center gap-0.5 flex-1 min-w-0 overflow-visible">
        {/* ── Inline formatting ── */}
        <ToolbarBtn
          isDark={isDark}
          onClick={() => act(insertBold)}
          title="Gras — \textbf{texte}"
        >
          <Bold className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <ToolbarBtn
          isDark={isDark}
          onClick={() => act(insertItalic)}
          title="Italique — \textit{texte}"
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <ToolbarBtn
          isDark={isDark}
          onClick={() => act(insertEmph)}
          title="Emphase — \emph{texte}"
        >
          <span className="text-[11px] font-semibold italic leading-none px-px">
            em
          </span>
        </ToolbarBtn>

        <ToolbarBtn
          isDark={isDark}
          onClick={() => act(insertUnderline)}
          title="Souligné — \underline{texte}"
        >
          <Underline className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <ToolbarDivider isDark={isDark} />

        {/* ── Structure ── */}
        <DropdownMenu
          {...dropdownProps}
          id="structure"
          label="Structure"
          icon={<Hash className="w-3.5 h-3.5" />}
          items={[
            {
              label: 'Section',
              sub: '\\section{…}',
              icon: (
                <span className="text-[10px] font-bold tabular-nums">H1</span>
              ),
              onSelect: () => act(insertSection),
            },
            {
              label: 'Sous-section',
              sub: '\\subsection{…}',
              icon: (
                <span className="text-[10px] font-bold tabular-nums">H2</span>
              ),
              onSelect: () => act(insertSubsection),
            },
            {
              label: 'Sous-sous-section',
              sub: '\\subsubsection{…}',
              icon: (
                <span className="text-[10px] font-bold tabular-nums">H3</span>
              ),
              onSelect: () => act(insertSubsubsection),
            },
            {
              label: 'Paragraphe',
              sub: '\\paragraph{…}',
              icon: <span className="text-xs leading-none">¶</span>,
              onSelect: () => act(insertParagraph),
            },
          ]}
        />

        {/* ── Math ── */}
        <DropdownMenu
          {...dropdownProps}
          id="math"
          label="Math"
          icon={
            <span className="text-sm font-bold leading-none w-3.5 text-center">
              Σ
            </span>
          }
          items={[
            {
              label: 'Inline $…$',
              sub: '$expression$',
              onSelect: () => act(insertInlineMath),
            },
            {
              label: 'Display \\[…\\]',
              sub: '\\[\\n  …\\n\\]',
              onSelect: () => act(insertDisplayMath),
            },
            {
              label: 'Équation',
              sub: '\\begin{equation}',
              onSelect: () => act(insertEquation),
            },
            {
              label: 'Alignement',
              sub: '\\begin{align}',
              onSelect: () => act(insertAlign),
            },
            {
              label: 'Fraction',
              sub: '\\frac{a}{b}',
              onSelect: () => act(insertFraction),
            },
            {
              label: 'Racine carrée',
              sub: '\\sqrt{…}',
              onSelect: () => act(insertSqrt),
            },
            {
              label: 'Somme Σ',
              sub: '\\sum_{i=1}^{n}',
              onSelect: () => act(insertSum),
            },
            {
              label: 'Intégrale ∫',
              sub: '\\int_{a}^{b} f(x) dx',
              onSelect: () => act(insertIntegral),
            },
            {
              label: 'Indice _',
              sub: '_{…}',
              onSelect: () => act(insertSubscript),
            },
            {
              label: 'Exposant ^',
              sub: '^{…}',
              onSelect: () => act(insertSuperscript),
            },
          ]}
        />

        {/* ── Lists ── */}
        <DropdownMenu
          {...dropdownProps}
          id="lists"
          label="Listes"
          icon={<List className="w-3.5 h-3.5" />}
          items={[
            {
              label: 'Liste à puces',
              sub: '\\begin{itemize}',
              icon: <List className="w-3.5 h-3.5" />,
              onSelect: () => act(insertItemize),
            },
            {
              label: 'Liste numérotée',
              sub: '\\begin{enumerate}',
              icon: <ListOrdered className="w-3.5 h-3.5" />,
              onSelect: () => act(insertEnumerate),
            },
            {
              label: 'Description',
              sub: '\\begin{description}',
              onSelect: () => act(insertDescription),
            },
            {
              label: 'Nouvel item',
              sub: '\\item',
              onSelect: () => act(insertItem),
            },
          ]}
        />

        {/* ── Table with grid picker ── */}
        <DropdownMenu
          {...dropdownProps}
          id="table"
          label="Tableau"
          icon={<Table className="w-3.5 h-3.5" />}
        >
          <TablePicker
            isDark={isDark}
            onSelect={(rows, cols) => act((v) => insertTable(v, rows, cols))}
          />
        </DropdownMenu>

        {/* ── Insert environments ── */}
        <DropdownMenu
          {...dropdownProps}
          id="insert"
          label="Insérer"
          icon={<ImageIcon className="w-3.5 h-3.5" />}
          items={[
            {
              label: 'Figure',
              sub: '\\begin{figure}',
              icon: <ImageIcon className="w-3.5 h-3.5" />,
              onSelect: () => act(insertFigure),
            },
            {
              label: 'Résumé',
              sub: '\\begin{abstract}',
              icon: <BookOpen className="w-3.5 h-3.5" />,
              onSelect: () => act(insertAbstract),
            },
            {
              label: 'Citation',
              sub: '\\begin{quote}',
              onSelect: () => act(insertQuote),
            },
            {
              label: 'Centré',
              sub: '\\begin{center}',
              icon: <AlignCenter className="w-3.5 h-3.5" />,
              onSelect: () => act(insertCenter),
            },
            {
              label: 'Verbatim',
              sub: '\\begin{verbatim}',
              onSelect: () => act(insertVerbatim),
            },
          ]}
        />

        {/* ── References ── */}
        <DropdownMenu
          {...dropdownProps}
          id="refs"
          label="Refs"
          icon={<Link className="w-3.5 h-3.5" />}
          items={[
            {
              label: 'Étiquette',
              sub: '\\label{…}',
              onSelect: () => act(insertLabel),
            },
            {
              label: 'Référence',
              sub: '\\ref{…}',
              onSelect: () => act(insertRef),
            },
            {
              label: 'Citation biblio',
              sub: '\\cite{…}',
              onSelect: () => act(insertCite),
            },
            {
              label: 'Note de bas de page',
              sub: '\\footnote{…}',
              onSelect: () => act(insertFootnote),
            },
          ]}
        />

        <ToolbarDivider isDark={isDark} />

        {/* ── Undo / Redo ── */}
        <ToolbarBtn
          isDark={isDark}
          onClick={() =>
            act((v) => {
              undo(v);
            })
          }
          title="Annuler (Ctrl+Z)"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <ToolbarBtn
          isDark={isDark}
          onClick={() =>
            act((v) => {
              redo(v);
            })
          }
          title="Rétablir (Ctrl+Shift+Z)"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <ToolbarDivider isDark={isDark} />

        {/* ── Search (opens CodeMirror's native panel) ── */}
        <ToolbarBtn
          isDark={isDark}
          onClick={() => {
            const v = viewRef.current;
            // Trigger CodeMirror's built-in search panel (bound to Ctrl+F by basicSetup)
            if (v)
              v.contentDOM.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: 'f',
                  ctrlKey: true,
                  bubbles: true,
                  cancelable: true,
                }),
              );
            closeMenu();
          }}
          title="Rechercher dans le document (Ctrl+F)"
        >
          <Search className="w-3.5 h-3.5" />
        </ToolbarBtn>

        <ToolbarDivider isDark={isDark} />

        {/* ── Font size ── */}
        <div
          className={`flex items-center rounded border flex-shrink-0 ${isDark ? 'border-slate-700' : 'border-slate-300'}`}
        >
          <ToolbarBtn
            isDark={isDark}
            onClick={() => onFontSizeChange(Math.max(12, fontSize - 1))}
            title="Réduire la taille de police"
          >
            <Minus className="w-3 h-3" />
          </ToolbarBtn>
          <span
            className={`px-1.5 text-xs tabular-nums select-none w-7 text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
          >
            {fontSize}
          </span>
          <ToolbarBtn
            isDark={isDark}
            onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}
            title="Augmenter la taille de police"
          >
            <ZoomIn className="w-3 h-3" />
          </ToolbarBtn>
        </div>
      </div>

      {/* ══════════════════════════════════
          RIGHT: Status indicators
      ══════════════════════════════════ */}
      <div className="flex items-center gap-2 flex-shrink-0 ml-2 pl-2">
        {/* Connection status */}
        <div className="flex items-center gap-1.5">
          {isConnected ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-500" />
              <span
                className={`text-xs hidden sm:inline ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}
              >
                Connecté
              </span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-red-500" />
              <span
                className={`text-xs hidden sm:inline ${isDark ? 'text-red-400' : 'text-red-600'}`}
              >
                Hors ligne
              </span>
            </>
          )}
        </div>

        {/* Collaborator avatars */}
        {collaborators.length > 0 && (
          <div className="flex items-center gap-1">
            <Users
              className={`w-3.5 h-3.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}
            />
            <div className="flex -space-x-1.5">
              {collaborators.slice(0, 3).map((collab, i) => (
                <div
                  key={i}
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-semibold border-2 ${
                    isDark ? 'border-[#252535]' : 'border-white'
                  }`}
                  style={{ backgroundColor: collab.color || '#666' }}
                  title={collab.name}
                >
                  {collab.name!.charAt(0).toUpperCase()}
                </div>
              ))}
              {collaborators.length > 3 && (
                <div
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold border-2 ${
                    isDark
                      ? 'bg-slate-700 text-slate-300 border-[#252535]'
                      : 'bg-slate-200 text-slate-600 border-white'
                  }`}
                >
                  +{collaborators.length - 3}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Theme toggle */}
        <ToolbarBtn
          isDark={isDark}
          onClick={onToggleTheme}
          title={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
        >
          {isDark ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </ToolbarBtn>
      </div>
    </div>
  );
};

export default EditorToolbar;
