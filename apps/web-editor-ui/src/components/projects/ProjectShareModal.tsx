import { useEffect, useState } from 'react';
import type { GuestInvitation } from '@frelated/types';
import { guestAccessApiService } from '../../services/api/guestAccessApiService';
import { projectJoinLinkForCurrentOrigin } from '../../services/projectJoinLink';
import Modal from '../Modal';

interface ProjectShareModalProps {
  isOpen: boolean;
  projectId?: string;
  projectName?: string;
  onClose: () => void;
}

const ProjectShareModal: React.FC<ProjectShareModalProps> = ({
  isOpen,
  projectId,
  projectName,
  onClose,
}) => {
  const [joinLink, setJoinLink] = useState('');
  const [linkCopied, setLinkCopied] = useState(false);
  const [email, setEmail] = useState('');
  const [invitations, setInvitations] = useState<GuestInvitation[]>([]);
  const [maximumActiveInvitations, setMaximumActiveInvitations] = useState(10);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!isOpen || !projectId) return;
    let active = true;
    setMessage('');
    void Promise.all([
      guestAccessApiService.listInvitations(projectId),
      guestAccessApiService.createJoinLink(projectId),
    ])
      .then(([invitationPage, link]) => {
        if (!active) return;
        setInvitations(invitationPage.invitations);
        setMaximumActiveInvitations(invitationPage.maximumActiveInvitations);
        setJoinLink(
          projectJoinLinkForCurrentOrigin(link, window.location.origin),
        );
      })
      .catch((error: unknown) => {
        if (active) {
          setMessage(
            error instanceof Error ? error.message : 'Chargement impossible.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, projectId]);

  const activeInvitationCount = invitations.filter(
    (invitation) => invitation.status === 'active',
  ).length;
  const invitationLimitReached =
    activeInvitationCount >= maximumActiveInvitations;

  const invite = async () => {
    if (!projectId || !email.trim() || invitationLimitReached) return;
    setLoading(true);
    setMessage('');
    try {
      const invitation = await guestAccessApiService.createInvitation(
        projectId,
        email,
      );
      setInvitations((current) => [invitation, ...current]);
      setEmail('');
      setMessage('Invitation envoyée.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Échec de l'envoi.");
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (invitationId: string) => {
    if (!projectId) return;
    await guestAccessApiService.revokeInvitation(projectId, invitationId);
    setInvitations((current) =>
      current.map((invitation) =>
        invitation.id === invitationId
          ? {
              ...invitation,
              status: 'revoked',
              revokedAt: new Date().toISOString(),
            }
          : invitation,
      ),
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      title="Partager le projet"
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100"
          >
            Fermer
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-800">
            Lien collaborateur sécurisé
          </h3>
          <p className="text-xs text-slate-500">
            Un utilisateur connecté rejoindra directement « {projectName} »
            comme éditeur approuvé.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Lien collaborateur"
              readOnly
              value={joinLink}
              className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50"
              onClick={(event) => event.currentTarget.select()}
            />
            <button
              disabled={!joinLink}
              onClick={() => {
                void navigator.clipboard.writeText(joinLink).then(() => {
                  setLinkCopied(true);
                  window.setTimeout(() => setLinkCopied(false), 1800);
                });
              }}
              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white disabled:opacity-50"
            >
              {linkCopied ? 'Copié' : 'Copier'}
            </button>
          </div>
        </section>

        <section className="space-y-2 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Inviter une personne sans compte
          </h3>
          <p className="text-xs text-slate-500">
            {activeInvitationCount}/{maximumActiveInvitations} invitations
            actives
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Email de l'invité"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) =>
                event.key === 'Enter' &&
                !invitationLimitReached &&
                void invite()
              }
              placeholder="guest@example.com"
              disabled={invitationLimitReached}
              className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
            <button
              disabled={loading || !email.trim() || invitationLimitReached}
              onClick={() => void invite()}
              className="px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white disabled:opacity-50"
            >
              {loading ? 'Envoi…' : "Envoyer l'invitation"}
            </button>
          </div>
          {invitationLimitReached && (
            <p className="text-xs text-amber-700">
              La limite est atteinte. Révoquez une invitation pour en envoyer
              une nouvelle.
            </p>
          )}
          {message && (
            <p role="status" className="text-xs text-slate-600">
              {message}
            </p>
          )}
        </section>

        <section className="space-y-2 border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">Invités</h3>
          {invitations.length === 0 ? (
            <p className="text-xs text-slate-500">Aucune invitation.</p>
          ) : (
            <ul className="max-h-48 space-y-2 overflow-auto">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">
                      {invitation.email}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {invitation.status} ·{' '}
                      {new Date(invitation.createdAt).toLocaleDateString(
                        'fr-FR',
                      )}
                      {invitation.expiresAt
                        ? ` · expire ${new Date(invitation.expiresAt).toLocaleDateString('fr-FR')}`
                        : ''}
                    </p>
                  </div>
                  {invitation.status === 'active' && (
                    <button
                      className="text-xs font-medium text-red-600 hover:text-red-700"
                      onClick={() => void revoke(invitation.id)}
                    >
                      Révoquer
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Modal>
  );
};

export default ProjectShareModal;
