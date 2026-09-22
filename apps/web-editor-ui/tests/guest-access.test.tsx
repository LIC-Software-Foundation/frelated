import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restoreSession: vi.fn().mockResolvedValue(null),
  login: vi.fn(),
  register: vi.fn(),
  redeemInvitation: vi.fn(),
  redeemJoinLink: vi.fn(),
}));

vi.mock('../src/services', () => ({
  appServices: {
    auth: {
      restoreSession: mocks.restoreSession,
      login: mocks.login,
      register: mocks.register,
      logout: vi.fn(),
    },
  },
}));
vi.mock('../src/services/api/guestAccessApiService', () => ({
  guestAccessApiService: {
    redeemInvitation: mocks.redeemInvitation,
    redeemJoinLink: mocks.redeemJoinLink,
  },
}));
vi.mock('../src/services/notificationService', () => ({
  clearNotifications: vi.fn(),
  connectNotifications: vi.fn(),
  disconnectNotifications: vi.fn(),
}));
vi.mock('../src/components/Dashboard', () => ({
  default: ({ user }: { user: { kind: string; email: string } }) => (
    <div>
      Document invité {user.kind} {user.email}
    </div>
  ),
}));

import App from '../src/App';
import { projectJoinLinkForCurrentOrigin } from '../src/services/projectJoinLink';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(
    {},
    '',
    '/guest/invitations/raw-secret-token-value-123456789',
  );
  mocks.redeemInvitation.mockResolvedValue({
    token: 'short-guest-session',
    projectId: 'project-a',
    principal: {
      kind: 'guest',
      guestInvitationId: 'invitation-a',
      projectId: 'project-a',
      email: 'guest@example.com',
      name: 'Invité — guest@example.com',
    },
  });
  mocks.restoreSession.mockResolvedValue(null);
  mocks.login.mockResolvedValue({
    id: 'friend-id',
    name: 'Friend',
    email: 'friend@example.com',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
  mocks.register.mockResolvedValue({
    id: 'new-friend-id',
    name: 'New Friend',
    email: 'new.friend@example.com',
    joinedAt: '2026-01-01T00:00:00.000Z',
  });
  mocks.redeemJoinLink.mockResolvedValue({
    project: { id: 'project-a' },
  });
});

afterEach(cleanup);

it('redeems a public guest link without showing login and removes the raw token', async () => {
  render(<App />);
  expect(await screen.findByText(/Document invité guest/u)).toBeTruthy();
  expect(screen.queryByText(/Se connecter/u)).toBeNull();
  await waitFor(() =>
    expect(window.location.pathname).toBe('/guest/projects/project-a'),
  );
  expect(window.location.href).not.toContain('raw-secret-token');
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.getItem('frelated-guest-session')).toContain(
    'short-guest-session',
  );
});

it('returns to a collaborator link after login and joins the project', async () => {
  const token = 'valid-project-join-token-value-1234567890';
  window.history.replaceState({}, '', `/join/${token}`);

  render(<App />);
  fireEvent.change(await screen.findByPlaceholderText('vous@exemple.com'), {
    target: { value: 'friend@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), {
    target: { value: 'frelated123' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }));

  await waitFor(() => expect(mocks.redeemJoinLink).toHaveBeenCalledWith(token));
  await waitFor(() =>
    expect(window.location.pathname).toBe('/editor/project-a'),
  );
});

it('preserves a collaborator link while the friend creates an account', async () => {
  const token = 'valid-project-join-token-value-0987654321';
  window.history.replaceState({}, '', `/join/${token}`);

  render(<App />);
  fireEvent.click(await screen.findByRole('link', { name: 'Créer un compte' }));
  expect(window.location.pathname).toBe('/register');
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(
    `/join/${token}`,
  );

  fireEvent.change(screen.getByPlaceholderText('Amina Kotto'), {
    target: { value: 'New Friend' },
  });
  fireEvent.change(screen.getByPlaceholderText('vous@exemple.com'), {
    target: { value: 'new.friend@example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('8 caractères minimum'), {
    target: { value: 'frelated123' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Créer mon compte' }));

  await waitFor(() => expect(mocks.redeemJoinLink).toHaveBeenCalledWith(token));
  await waitFor(() =>
    expect(window.location.pathname).toBe('/editor/project-a'),
  );
});

it('rebuilds a configured localhost link with the current public origin', () => {
  const token = 'valid-project-join-token-value-1234567890';
  expect(
    projectJoinLinkForCurrentOrigin(
      { url: `http://localhost:5173/join/${token}` },
      'https://latex.example.org',
    ),
  ).toBe(`https://latex.example.org/join/${token}`);
});
