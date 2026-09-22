import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  createJoinLink: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

vi.mock('../src/services/api/guestAccessApiService', () => ({
  guestAccessApiService: mocks,
}));

import ProjectShareModal from '../src/components/projects/ProjectShareModal';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listInvitations.mockResolvedValue({
    maximumActiveInvitations: 10,
    invitations: Array.from({ length: 10 }, (_, index) => ({
      id: `invitation-${index}`,
      projectId: 'project-a',
      email: `guest-${index}@example.com`,
      role: 'editor',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      invitedByUserId: 'owner-a',
      invitedByEmail: 'owner@example.com',
    })),
  });
  mocks.createJoinLink.mockResolvedValue({
    path: `/join/${'x'.repeat(32)}`,
    url: `http://localhost:5173/join/${'x'.repeat(32)}`,
  });
  mocks.revokeInvitation.mockResolvedValue(undefined);
});

afterEach(cleanup);

it('blocks an eleventh active invitation until one is revoked', async () => {
  render(
    <ProjectShareModal
      isOpen
      projectId="project-a"
      projectName="Article"
      onClose={vi.fn()}
    />,
  );

  expect(await screen.findByText('10/10 invitations actives')).toBeTruthy();
  const email = screen.getByLabelText("Email de l'invité") as HTMLInputElement;
  expect(email.disabled).toBe(true);
  expect(
    (
      screen.getByRole('button', {
        name: "Envoyer l'invitation",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);

  fireEvent.click(screen.getAllByRole('button', { name: 'Révoquer' })[0]);
  await waitFor(() => expect(email.disabled).toBe(false));
  expect(screen.getByText('9/10 invitations actives')).toBeTruthy();
});
