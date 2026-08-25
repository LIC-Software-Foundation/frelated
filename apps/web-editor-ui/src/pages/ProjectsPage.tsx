import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Upload,
  Search,
  BookOpen,
  LogOut,
  FolderOpen,
  SortAsc,
  X,
  FileText,
  Bell,
  Clock,
} from 'lucide-react';
import type { User } from '@frelated/types';
import { useProjects, ImportResult } from '../hooks/useProjects';
import { appServices } from '../services';
import { downloadProjectSources } from '../services/projectService';
import ProjectCard from '../components/projects/ProjectCard';
import ImportModal from '../components/projects/ImportModal';
import ProjectShareModal from '../components/projects/ProjectShareModal';
import NotificationBell from '../components/NotificationBell';
import { Avatar, Badge, Button } from '../components/ui';
import { useToast } from '../components/ui/ToastContext';
import { ProjectWithFiles } from '../types';

interface ProjectsPageProps {
  user: User;
  onLogout: () => void;
}

type SortKey = 'recent' | 'name' | 'files';

const ProjectsPage: React.FC<ProjectsPageProps> = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    projects,
    loadProjects,
    createProject,
    importProject,
    deleteProject,
    renameProject,
    approveCollaborator,
    removeCollaborator,
  } = useProjects(user);

  // Poll every 30s to pick up new pending collaboration requests
  useEffect(() => {
    const id = window.setInterval(() => {
      void loadProjects();
    }, 30_000);
    return () => window.clearInterval(id);
  }, [loadProjects]);

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [projectToShare, setProjectToShare] = useState<ProjectWithFiles | null>(
    null,
  );
  const [linkCopied, setLinkCopied] = useState(false);

  const shareLink = projectToShare
    ? `${window.location.origin}/project/${projectToShare.owner}/${projectToShare.id}`
    : '';

  // ── Pending collaboration requests (owned projects only) ──
  const pendingProjects = projects.filter(
    (p) =>
      p.owner === user.email &&
      p.collaborators.some(
        (c) => (c as { status?: string }).status === 'pending',
      ),
  );
  const totalPending = pendingProjects.reduce(
    (sum, p) =>
      sum +
      p.collaborators.filter(
        (c) => (c as { status?: string }).status === 'pending',
      ).length,
    0,
  );

  // ── Sort + filter ──
  const filtered = projects
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'files') return b.files.length - a.files.length;
      // recent
      const ta = new Date(
        a.lastOpenedAt ?? a.updatedAt ?? a.createdAt,
      ).getTime();
      const tb = new Date(
        b.lastOpenedAt ?? b.updatedAt ?? b.createdAt,
      ).getTime();
      return tb - ta;
    });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    await new Promise((r) => setTimeout(r, 300));
    const p = await createProject(newName.trim());
    setCreating(false);
    setShowCreate(false);
    setNewName('');
    navigate(`/editor/${p.id}`);
  };

  const handleImport = async (name: string, result: ImportResult) => {
    await importProject(name, result);
    const msg = result.hasTexFile
      ? `Projet "${name}" importé avec succès — fichier(s) .tex détecté(s).`
      : `Projet "${name}" importé — aucun fichier .tex trouvé.`;
    toast(msg, result.hasTexFile ? 'success' : 'warning');
  };

  const handleOpen = (projectId: string) => {
    navigate(`/editor/${projectId}`);
  };

  const handleExport = (project: ProjectWithFiles) => {
    downloadProjectSources(project);
    toast(`Le projet "${project.name}" a ete exporte en ZIP.`, 'success');
  };

  const resetShareState = () => {
    setProjectToShare(null);
    setLinkCopied(false);
  };

  const handleCopyShareLink = async (nextShareLink = shareLink) => {
    if (!nextShareLink) return;

    try {
      await navigator.clipboard.writeText(nextShareLink);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch (error) {
      console.error(error);
      toast('Impossible de copier le lien de partage.', 'error');
    }
  };

  const handleShare = async (project: ProjectWithFiles) => {
    const nextShareLink = `${window.location.origin}/project/${project.owner}/${project.id}`;

    setProjectToShare(project);
    setLinkCopied(false);
    await handleCopyShareLink(nextShareLink);
  };

  const handleLogout = () => {
    appServices.auth.logout();
    onLogout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#f0f4f2]">
      {/* ── Topbar ────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-100 shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 h-14 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5 flex-shrink-0">
            <div className="h-8 w-8 rounded-xl bg-[#2d6a4f] flex items-center justify-center">
              <BookOpen className="h-4 w-4 text-white" />
            </div>
            <span className="text-[15px] font-bold text-slate-900 hidden sm:block">
              Frelated
            </span>
          </div>

          <div className="w-px h-5 bg-slate-200 hidden sm:block" />

          <span className="text-[14px] font-semibold text-slate-700 hidden sm:block">
            Mes projets
          </span>

          <div className="flex-1" />

          {/* Notification bell */}
          <NotificationBell
            theme="dark"
            onApprove={approveCollaborator}
            onReject={removeCollaborator}
          />

          {/* User + logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2.5">
              <Avatar name={user.name} size={32} />
              <div className="hidden md:block">
                <p className="text-[13px] font-semibold text-slate-900 leading-tight">
                  {user.name}
                </p>
                <p className="text-[11px] text-slate-400 leading-tight">
                  {user.email}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12.5px] text-slate-500 hover:text-slate-700 hover:bg-slate-50 border border-slate-200 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Déconnexion</span>
            </button>
          </div>
        </div>
      </header>

      {/* ── Content ────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10 py-8">
        {/* ── Pending collaboration banner ─────────────────────────────── */}
        {totalPending > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 flex items-start gap-3 shadow-sm">
            <div className="flex-shrink-0 h-9 w-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center">
              <Bell className="h-4 w-4 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-amber-900">
                {totalPending === 1
                  ? '1 demande de collaboration en attente'
                  : `${totalPending} demandes de collaboration en attente`}
              </p>
              <div className="mt-2 flex flex-col gap-1.5">
                {pendingProjects.map((p) => {
                  const count = p.collaborators.filter(
                    (c) => (c as { status?: string }).status === 'pending',
                  );
                  return (
                    <div
                      key={p.id}
                      className="flex items-center gap-2 flex-wrap"
                    >
                      <span className="text-[12px] text-amber-700 font-medium">
                        {p.name}
                      </span>
                      {count.map((c) => (
                        <span
                          key={c.id ?? c.email}
                          className="inline-flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full"
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {c.name || c.email}
                          <button
                            onClick={() =>
                              void approveCollaborator(p.id, c.id!)
                            }
                            className="ml-1 text-emerald-600 hover:text-emerald-700 font-semibold text-[11px]"
                            title="Approuver"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => void removeCollaborator(p.id, c.id!)}
                            className="text-red-500 hover:text-red-600 font-semibold text-[11px]"
                            title="Rejeter"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-8">
          <div>
            <h1 className="text-[24px] sm:text-[28px] font-extrabold text-slate-950 tracking-tight">
              Bonjour, {user.name.split(' ')[0]} 👋
            </h1>
            <p className="text-[14px] text-slate-500 mt-1">
              {projects.length === 0
                ? 'Commencez par créer ou importer un projet LaTeX.'
                : (() => {
                    const owned = projects.filter(
                      (p) => p.owner === user.email,
                    ).length;
                    const collab = projects.length - owned;
                    const parts: string[] = [];
                    if (owned > 0)
                      parts.push(`${owned} projet${owned > 1 ? 's' : ''}`);
                    if (collab > 0)
                      parts.push(
                        `${collab} collaboration${collab > 1 ? 's' : ''}`,
                      );
                    return parts.join(' · ') + ' dans votre espace';
                  })()}
            </p>
          </div>

          {/* Action buttons */}
          <div className="sm:ml-auto flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:text-slate-900 shadow-sm transition-all"
            >
              <Upload className="h-4 w-4" />
              Importer un projet
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-[#2d6a4f] hover:bg-[#245a41] shadow-sm shadow-emerald-900/20 transition-all hover:-translate-y-0.5"
            >
              <Plus className="h-4 w-4" />
              Nouveau projet
            </button>
          </div>
        </div>

        {/* Search + sort bar */}
        {projects.length > 0 && (
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher un projet…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-[#40916c] focus:ring-3 focus:ring-[#52b788]/20"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              <SortAsc className="h-3.5 w-3.5 text-slate-400 ml-1.5" />
              {(['recent', 'name', 'files'] as SortKey[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSort(s)}
                  className={`px-2.5 py-1 rounded-lg text-[12px] font-medium transition-colors ${
                    sort === s
                      ? 'bg-[#2d6a4f] text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {{ recent: 'Récents', name: 'Nom', files: 'Fichiers' }[s]}
                </button>
              ))}
            </div>

            {search && (
              <Badge color="slate">
                {filtered.length} résultat{filtered.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────── */}
        {projects.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="h-20 w-20 rounded-3xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-6">
              <FolderOpen className="h-9 w-9 text-emerald-400" />
            </div>
            <h2 className="text-[20px] font-bold text-slate-900 mb-2">
              Aucun projet pour l&apos;instant
            </h2>
            <p className="text-[14px] text-slate-500 max-w-sm mb-8 leading-relaxed">
              Créez votre premier projet LaTeX collaboratif ou importez une
              archive ZIP existante.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowImport(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13.5px] font-medium text-slate-700 bg-white border border-slate-200 hover:border-slate-300 shadow-sm transition-all"
              >
                <Upload className="h-4 w-4" />
                Importer un ZIP
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13.5px] font-semibold text-white bg-[#2d6a4f] hover:bg-[#245a41] shadow-sm shadow-emerald-900/20 transition-all"
              >
                <Plus className="h-4 w-4" />
                Créer un projet
              </button>
            </div>
          </div>
        )}

        {/* ── No search results ─────────────────────────────────────── */}
        {projects.length > 0 && filtered.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center">
            <Search className="h-10 w-10 text-slate-300 mb-4" />
            <p className="text-[15px] font-medium text-slate-700">
              Aucun projet trouvé pour &quot;{search}&quot;
            </p>
            <button
              onClick={() => setSearch('')}
              className="mt-3 text-[13px] text-emerald-600 hover:text-emerald-700 font-medium"
            >
              Effacer la recherche
            </button>
          </div>
        )}

        {/* ── Project grid ─────────────────────────────────────────── */}
        {filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                currentUserEmail={user.email}
                onOpen={handleOpen}
                onDelete={(id) => setDeleteConfirm(id)}
                onRename={renameProject}
                onExport={handleExport}
                onShare={handleShare}
              />
            ))}
          </div>
        )}
      </main>

      {/* ── Create modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowCreate(false)}
          />
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl shadow-black/20 p-7 animate-fade-in">
            <button
              onClick={() => setShowCreate(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <FileText className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-[16px] font-bold text-slate-900">
                  Nouveau projet LaTeX
                </h2>
                <p className="text-[12px] text-slate-500">
                  Un fichier main.tex sera créé automatiquement
                </p>
              </div>
            </div>

            <div className="mb-5">
              <label className="text-sm font-medium text-slate-700 block mb-1.5">
                Nom du projet
              </label>
              <input
                autoFocus
                type="text"
                placeholder="ex : Thèse de doctorat 2025"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-[#40916c] focus:ring-3 focus:ring-[#52b788]/20"
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreate(false);
                  setNewName('');
                }}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                loading={creating}
                disabled={!newName.trim()}
                onClick={handleCreate}
              >
                {creating ? 'Création…' : 'Créer et ouvrir'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setDeleteConfirm(null)}
          />
          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 animate-fade-in">
            <h2 className="text-[16px] font-bold text-slate-900 mb-2">
              Supprimer ce projet ?
            </h2>
            <p className="text-[13px] text-slate-500 mb-5">
              Cette action est irréversible. Tous les fichiers du projet seront
              supprimés.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setDeleteConfirm(null)}
              >
                Annuler
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const proj = projects.find((p) => p.id === deleteConfirm);
                  void deleteProject(deleteConfirm!);
                  setDeleteConfirm(null);
                  toast(`Projet "${proj?.name ?? ''}" supprimé.`, 'info');
                }}
              >
                Supprimer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Import modal ─────────────────────────────────────────────── */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={handleImport}
        />
      )}

      <ProjectShareModal
        isOpen={Boolean(projectToShare)}
        projectName={projectToShare?.name}
        shareLink={shareLink}
        linkCopied={linkCopied}
        onCopy={() => void handleCopyShareLink()}
        onClose={resetShareState}
      />
    </div>
  );
};

export default ProjectsPage;
