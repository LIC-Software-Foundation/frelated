import nodemailer from 'nodemailer';
import { env } from '../config/env';

export interface GuestInvitationMail {
  to: string;
  projectName: string;
  inviter: string;
  invitationUrl: string;
  expiresAt?: string;
}

export interface MailService {
  sendGuestInvitation(message: GuestInvitationMail): Promise<void>;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/gu, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return entities[character] ?? character;
  });

class UnavailableMailService implements MailService {
  async sendGuestInvitation() {
    throw new Error('SMTP_NOT_CONFIGURED');
  }
}

class SmtpMailService implements MailService {
  private readonly transport = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    secure: env.smtpSecure,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 10_000,
  });

  async sendGuestInvitation(message: GuestInvitationMail) {
    const projectName = escapeHtml(message.projectName);
    const inviter = escapeHtml(message.inviter);
    const invitationUrl = escapeHtml(message.invitationUrl);
    const expiration = message.expiresAt
      ? `<p>Ce lien expire le ${escapeHtml(new Date(message.expiresAt).toLocaleString('fr-FR'))}.</p>`
      : '';
    await this.transport.sendMail({
      from: env.smtpFrom,
      to: message.to,
      subject: `${message.inviter} vous invite sur ${message.projectName}`,
      text: `${message.inviter} vous invite à modifier « ${message.projectName} ». Aucun compte n'est nécessaire. ${message.invitationUrl}`,
      html: `<p>${inviter} vous invite à modifier <strong>${projectName}</strong>.</p><p>Aucun compte n'est nécessaire.</p><p><a href="${invitationUrl}">Accéder au document</a></p>${expiration}`,
    });
  }
}

export const mailService: MailService = env.smtpHost
  ? new SmtpMailService()
  : new UnavailableMailService();
