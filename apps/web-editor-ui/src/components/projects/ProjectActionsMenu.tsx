import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Download,
  ExternalLink,
  MoreVertical,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';

interface ProjectActionsMenuProps {
  projectName: string;
  onOpen?: () => void;
  onRename?: () => void;
  onExport?: () => void;
  onShare?: () => void;
  onDelete?: () => void;
  buttonClassName?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
}

const ProjectActionsMenu: React.FC<ProjectActionsMenuProps> = ({
  projectName,
  onOpen,
  onRename,
  onExport,
  onShare,
  onDelete,
  buttonClassName = '',
  menuClassName = '',
  align = 'right',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const actions = [
    {
      id: 'open',
      label: 'Ouvrir',
      icon: ExternalLink,
      onClick: onOpen,
      className: 'text-slate-600 hover:bg-slate-50',
    },
    {
      id: 'share',
      label: 'Partager',
      icon: Share2,
      onClick: onShare,
      className: 'text-slate-600 hover:bg-slate-50',
    },
    {
      id: 'export',
      label: 'Exporter',
      icon: Download,
      onClick: onExport,
      className: 'text-slate-600 hover:bg-slate-50',
    },
    {
      id: 'rename',
      label: 'Renommer',
      icon: Pencil,
      onClick: onRename,
      className: 'text-slate-600 hover:bg-slate-50',
    },
    {
      id: 'delete',
      label: 'Supprimer',
      icon: Trash2,
      onClick: onDelete,
      className: 'text-red-600 hover:bg-red-50',
    },
  ].filter((action) => action.onClick);

  if (actions.length === 0) return null;

  const openMenu = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPos({
      top: rect.bottom + window.scrollY + 4,
      left:
        align === 'right'
          ? rect.right + window.scrollX
          : rect.left + window.scrollX,
    });
    setMenuOpen((open) => !open);
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={openMenu}
        className={`p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all ${buttonClassName}`.trim()}
        aria-label={`Actions du projet ${projectName}`}
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {menuOpen &&
        createPortal(
          <>
            {/* Invisible full-screen backdrop to close on outside click */}
            <div
              className="fixed inset-0"
              style={{ zIndex: 9998 }}
              onClick={() => setMenuOpen(false)}
            />
            {/* Menu rendered at the top of the DOM tree — escapes any stacking context */}
            <div
              className={`fixed min-w-44 bg-white rounded-xl border border-slate-100 shadow-xl shadow-black/10 py-1 ${menuClassName}`.trim()}
              style={{
                zIndex: 9999,
                top: menuPos.top,
                ...(align === 'right'
                  ? { right: window.innerWidth - menuPos.left }
                  : { left: menuPos.left }),
              }}
            >
              {actions.map((action) => {
                const Icon = action.icon;

                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setMenuOpen(false);
                      action.onClick?.();
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${action.className}`.trim()}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {action.label}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
};

export default ProjectActionsMenu;
