import Modal from '../Modal';

interface ProjectShareModalProps {
  isOpen: boolean;
  projectName?: string;
  shareLink: string;
  linkCopied: boolean;
  onCopy: () => void;
  onClose: () => void;
}

const ProjectShareModal: React.FC<ProjectShareModalProps> = ({
  isOpen,
  projectName,
  shareLink,
  linkCopied,
  onCopy,
  onClose,
}) => (
  <Modal
    isOpen={isOpen}
    title="Partager le projet"
    onClose={onClose}
    footer={
      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors"
        >
          Fermer
        </button>
      </div>
    }
  >
    <div className="space-y-3">
      <p className="text-sm text-slate-500">
        Partagez ce lien pour donner acces a{' '}
        <span className="font-medium text-slate-700">
          {projectName ?? 'votre projet'}
        </span>
        . Le lien est affiche ici et copie automatiquement lorsque le navigateur
        l&apos;autorise.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          readOnly
          value={shareLink}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700 focus:outline-none cursor-text"
          onClick={(event) => (event.target as HTMLInputElement).select()}
        />
        <button
          onClick={onCopy}
          className={`px-3 py-2 text-sm font-medium rounded-lg transition-all flex-shrink-0 ${
            linkCopied
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-emerald-600 hover:bg-emerald-700 text-white'
          }`}
        >
          {linkCopied ? 'Copie' : 'Copier'}
        </button>
      </div>
    </div>
  </Modal>
);

export default ProjectShareModal;
