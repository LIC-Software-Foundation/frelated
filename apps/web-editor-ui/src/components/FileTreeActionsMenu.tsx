import { useState } from 'react';
import { MoreHorizontal, type LucideIcon } from 'lucide-react';

interface FileTreeAction {
  id: string;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  tone?: 'default' | 'danger';
}

interface FileTreeActionsMenuProps {
  label: string;
  actions: FileTreeAction[];
  buttonClassName?: string;
  menuClassName?: string;
}

const FileTreeActionsMenu: React.FC<FileTreeActionsMenuProps> = ({
  label,
  actions,
  buttonClassName = '',
  menuClassName = '',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  if (actions.length === 0) return null;

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        className={`p-1 rounded text-slate-500 hover:text-white hover:bg-white/10 transition-colors ${buttonClassName}`.trim()}
        aria-label={`Actions pour ${label}`}
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setMenuOpen(false)}
          />
          <div
            className={`absolute right-0 top-7 z-20 min-w-48 rounded-xl border border-slate-200 bg-white py-1 shadow-xl shadow-black/10 ${menuClassName}`.trim()}
          >
            {actions.map((action) => {
              const Icon = action.icon;
              const textClassName =
                action.tone === 'danger'
                  ? 'text-red-600 hover:bg-red-50'
                  : 'text-slate-600 hover:bg-slate-50';

              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    action.onClick();
                  }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-[13px] transition-colors ${textClassName}`.trim()}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export default FileTreeActionsMenu;
