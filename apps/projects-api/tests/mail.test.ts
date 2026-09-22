import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sendMail = vi.fn();
  return {
    sendMail,
    createTransport: vi.fn(() => ({ sendMail })),
  };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: mocks.createTransport },
}));
vi.mock('../src/config/env', () => ({
  env: {
    smtpHost: 'mailhog',
    smtpPort: 1025,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: 'Frelated <no-reply@frelated.local>',
  },
}));

import { mailService } from '../src/services/mail';

beforeEach(() => {
  mocks.sendMail.mockReset();
  mocks.sendMail.mockResolvedValue(undefined);
});

it('delivers guest invitations through the configured MailHog transport', async () => {
  await mailService.sendGuestInvitation({
    to: 'guest@example.com',
    projectName: 'Article',
    inviter: 'Owner',
    invitationUrl: 'http://localhost:5173/guest/invitations/secret',
  });

  expect(mocks.createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      host: 'mailhog',
      port: 1025,
      secure: false,
    }),
  );
  expect(mocks.sendMail).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'guest@example.com',
      subject: 'Owner vous invite sur Article',
      text: expect.stringContaining('/guest/invitations/secret'),
    }),
  );
});
