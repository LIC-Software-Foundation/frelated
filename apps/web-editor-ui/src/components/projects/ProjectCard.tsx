import { useEffect, useState } from 'react';
import {
  FileText,
  Users,
  Calendar,
  Crown,
  FolderOpen,
  Upload,
  ExternalLink,
  Check,
  Clock,
} from 'lucide-react';
import { ProjectWithFiles } from '../../types';
import ProjectActionsMenu from './ProjectActionsMenu';

interface ProjectCardProps {
  project: ProjectWithFiles;
  currentUserEmail: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onExport: (project: ProjectWithFiles) => void;
  onShare: (project: ProjectWithFiles) => void;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "À l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  if (hours < 24) return `il y a ${hours}h`;
  if (days < 7) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}

const CARD_COLORS = [
  'from-emerald-500 to-teal-600',
  'from-blue-500 to-indigo-600',
  'from-violet-500 to-purple-600',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
];

function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CARD_COLORS[Math.abs(h) % CARD_COLORS.length];
}

const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  currentUserEmail,
  onOpen,
  onDelete,
  onRename,
  onExport,
  onShare,
}) => {
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(project.name);
  const isOwner = project.owner === currentUserEmail;

  useEffect(() => {
    setNameInput(project.name);
  }, [project.name]);

  const texCount = project.files.filter((f) => f.type === 'tex').length;
  const fileCount = project.files.length;
  const gradient = colorFromId(project.id);
  const date = project.updatedAt ?? project.createdAt;
  const pendingCount = isOwner
    ? project.collaborators.filter(
        (c) => (c as { status?: string }).status === 'pending',
      ).length
    : 0;

  const commitRename = () => {
    if (nameInput.trim() && nameInput.trim() !== project.name) {
      onRename(project.id, nameInput.trim());
    } else {
      setNameInput(project.name);
    }
    setEditing(false);
  };

  return (
    <div className="card-lift group bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden flex flex-col relative">
      {/* Color header */}
      <div className={`h-2 w-full bg-gradient-to-r ${gradient}`} />

      {/* Pending badge */}
      {pendingCount > 0 && (
        <div className="absolute top-1.5 right-2.5 flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm z-10">
          <Clock className="h-2.5 w-2.5" />
          {pendingCount} en attente
        </div>
      )}

      <div className="flex flex-col flex-1 p-5">
        {/* Top row */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`h-9 w-9 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center flex-shrink-0 shadow-sm`}
            >
              <FolderOpen className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              {editing ? (
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') {
                      setNameInput(project.name);
                      setEditing(false);
                    }
                  }}
                  className="text-[14px] font-semibold text-slate-900 bg-transparent border-b-2 border-[#2d6a4f] outline-none w-full"
                />
              ) : (
                <h3 className="text-[14px] font-semibold text-slate-900 truncate">
                  {project.name}
                </h3>
              )}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                {isOwner ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                    <Crown className="h-2.5 w-2.5" />
                    Propriétaire
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.5 rounded-full">
                    <Users className="h-2.5 w-2.5" />
                    Collaborateur
                  </span>
                )}
                {project.imported && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-600 bg-violet-50 border border-violet-100 px-1.5 py-0.5 rounded-full">
                    <Upload className="h-2.5 w-2.5" />
                    Importé
                  </span>
                )}
                {project.hasTexFile && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded-full">
                    <Check className="h-2.5 w-2.5" />
                    .tex
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Menu */}
          <ProjectActionsMenu
            projectName={project.name}
            onOpen={() => onOpen(project.id)}
            onShare={isOwner ? () => onShare(project) : undefined}
            onExport={() => onExport(project)}
            onRename={isOwner ? () => setEditing(true) : undefined}
            onDelete={isOwner ? () => onDelete(project.id) : undefined}
            buttonClassName="opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          />
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 text-[12px] text-slate-400 mb-4">
          <span className="flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            {texCount} .tex / {fileCount} fichier{fileCount !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {project.collaborators.length}
          </span>
        </div>

        {/* Date */}
        <div className="flex items-center gap-1.5 text-[11.5px] text-slate-400 mb-5">
          <Calendar className="h-3 w-3" />
          Modifié {timeAgo(date)}
        </div>

        {/* CTA */}
        <button
          onClick={() => onOpen(project.id)}
          className="mt-auto w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#2d6a4f] hover:bg-[#245a41] transition-all hover:-translate-y-0.5 shadow-sm shadow-emerald-900/20"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ouvrir l&apos;éditeur
        </button>
      </div>
    </div>
  );
};

export default ProjectCard;
