import React, { useState } from 'react';
import {
  Users,
  Crown,
  Eye,
  Edit2,
  ChevronDown,
  ChevronRight,
  Clock,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import { User, Collaborator } from '@frelated/types';

interface CollaboratorsListProps {
  collaborators: Collaborator[];
  currentUser: User;
  owner?: string;
  isOwner?: boolean;
  onUpdateRole?: (collaboratorId: string, role: 'viewer' | 'editor') => void;
  onApprove?: (collaboratorId: string) => void;
  onRemove?: (collaboratorId: string) => void;
}

// Deterministic color from email so each user always gets the same color
const AVATAR_COLORS = [
  '#4ade80',
  '#60a5fa',
  '#f472b6',
  '#facc15',
  '#fb923c',
  '#a78bfa',
  '#34d399',
  '#38bdf8',
];

const getAvatarColor = (email: string): string => {
  const idx =
    (email.charCodeAt(0) + email.charCodeAt(email.length - 1)) %
    AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
};

const CollaboratorsList: React.FC<CollaboratorsListProps> = ({
  collaborators,
  currentUser,
  owner,
  isOwner = false,
  onUpdateRole,
  onApprove,
  onRemove,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const pendingCollaborators = collaborators.filter(
    (c) => c.status === 'pending',
  );
  const approvedCollaborators = collaborators.filter(
    (c) => c.status !== 'pending',
  );

  const isCollabOwner = (collab: Collaborator) =>
    owner ? collab.email === owner : collab.email === currentUser.email;

  const getPermissionIcon = (collab: Collaborator) => {
    if (isCollabOwner(collab))
      return <Crown className="w-3 h-3 text-yellow-400 flex-shrink-0" />;
    if (collab.role === 'viewer')
      return <Eye className="w-3 h-3 text-sky-400 flex-shrink-0" />;
    return <Edit2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />;
  };

  const isAlone =
    approvedCollaborators.length === 1 &&
    approvedCollaborators[0].email === currentUser.email &&
    pendingCollaborators.length === 0;

  const totalCount = collaborators.length;
  const pendingCount = pendingCollaborators.length;

  return (
    <div className="px-3 py-3">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full mb-2 text-[10px] font-semibold tracking-widest uppercase text-slate-400 hover:text-slate-200 transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>
            Collaborateurs ({totalCount})
            {pendingCount > 0 && (
              <span className="ml-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-1">
          {/* Pending collaborators — shown first for owner */}
          {pendingCollaborators.length > 0 && (
            <div className="space-y-0.5">
              {isOwner && (
                <p className="text-[9px] font-semibold tracking-widest uppercase text-amber-500/80 px-2 pt-1 pb-0.5">
                  En attente d&apos;approbation
                </p>
              )}
              {pendingCollaborators.map((collab, idx) => (
                <div
                  key={collab.email || idx}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20"
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold text-white opacity-60"
                      style={{
                        backgroundColor: getAvatarColor(collab.email || ''),
                      }}
                    >
                      {(collab.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <Clock className="absolute -bottom-0.5 -right-0.5 w-3 h-3 text-amber-400 bg-[#1b2635] rounded-full" />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-slate-300 truncate block">
                      {collab.name || 'Anonyme'}
                    </span>
                    <p className="text-[10px] text-slate-500 truncate">
                      {collab.email}
                    </p>
                  </div>

                  {/* Owner actions */}
                  {isOwner && collab.id && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {onApprove && (
                        <button
                          onClick={() => onApprove(collab.id!)}
                          title="Approuver"
                          className="p-1 rounded text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onRemove && (
                        <button
                          onClick={() => onRemove(collab.id!)}
                          title="Rejeter"
                          className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Approved collaborators */}
          {approvedCollaborators.map((collab, idx) => (
            <div
              key={collab.email || idx}
              className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors group"
            >
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold text-white"
                  style={{
                    backgroundColor: getAvatarColor(collab.email || ''),
                  }}
                >
                  {(collab.name || '?').charAt(0).toUpperCase()}
                </div>
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#1b2635] ${
                    collab.isOnline !== false
                      ? 'bg-emerald-400'
                      : 'bg-slate-500'
                  }`}
                />
              </div>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-slate-200 truncate">
                    {collab.name || 'Anonyme'}
                    {collab.email === currentUser.email && (
                      <span className="text-slate-500 font-normal ml-1">
                        (vous)
                      </span>
                    )}
                  </span>
                  {getPermissionIcon(collab)}
                </div>
                <p className="text-[10px] text-slate-500 truncate">
                  {collab.email}
                </p>
              </div>

              {/* Owner controls: role dropdown + remove */}
              {isOwner && !isCollabOwner(collab) && collab.id && (
                <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onUpdateRole && (
                    <select
                      value={collab.role || 'editor'}
                      onChange={(e) =>
                        onUpdateRole(
                          collab.id!,
                          e.target.value as 'viewer' | 'editor',
                        )
                      }
                      className="text-[10px] bg-slate-700 border border-slate-600 text-slate-300 rounded px-1 py-0.5 cursor-pointer"
                      title="Changer le rôle"
                    >
                      <option value="editor">Éditeur</option>
                      <option value="viewer">Lecteur</option>
                    </select>
                  )}
                  {onRemove && (
                    <button
                      onClick={() => onRemove(collab.id!)}
                      title="Retirer ce collaborateur"
                      className="p-1 rounded text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {isAlone && (
            <p className="text-[11px] text-slate-500 text-center py-2 px-2 leading-relaxed">
              Partagez le projet pour collaborer
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default CollaboratorsList;
