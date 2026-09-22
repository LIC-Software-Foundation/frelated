import { expect, test } from '@playwright/test';

test.skip(
  process.env.GUEST_E2E !== '1',
  'Requires API, collab, worker and MailHog',
);

test('owner invites, guest edits and compiles, then revocation is immediate', async ({
  browser,
  request,
}) => {
  const api = 'http://localhost:3000';
  const mailhog = process.env.MAILHOG_API_URL || 'http://localhost:8025';
  const login = await request.post(`${api}/auth/login`, {
    data: { email: 'regent@frelated.dev', password: 'frelated123' },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const ownerSession = await login.json();
  const ownerHeaders = { Authorization: `Bearer ${ownerSession.token}` };
  const created = await request.post(`${api}/projects`, {
    headers: ownerHeaders,
    data: { name: 'Guest access browser test' },
  });
  const { project } = await created.json();

  try {
    await request.delete(`${mailhog}/api/v1/messages`).catch(() => undefined);
    const invited = await request.post(
      `${api}/projects/${project.id}/guest-invitations`,
      { headers: ownerHeaders, data: { email: 'guest@example.com' } },
    );
    expect(invited.status()).toBe(201);
    const { invitation } = await invited.json();
    let invitationUrl = '';
    await expect
      .poll(
        async () => {
          const messages = await request.get(`${mailhog}/api/v2/messages`);
          if (!messages.ok()) return '';
          const payload = await messages.json();
          const serialized = JSON.stringify(payload);
          const match = serialized.match(
            /https?:[^"\\\s]+\/guest\/invitations\/[A-Za-z0-9_-]+/u,
          );
          invitationUrl = match?.[0]?.replace(/=3D/gu, '=') ?? '';
          return invitationUrl;
        },
        { timeout: 20_000 },
      )
      .not.toBe('');

    const ownerContext = await browser.newContext();
    const guestContext = await browser.newContext();
    await ownerContext.addInitScript(
      (session) =>
        localStorage.setItem('frelated-api-session', JSON.stringify(session)),
      ownerSession,
    );
    const ownerPage = await ownerContext.newPage();
    const guestPage = await guestContext.newPage();
    await ownerPage.goto(`/editor/${project.id}`);
    await guestPage.goto(invitationUrl);
    await expect(guestPage.locator('.cm-content')).toBeVisible();
    await expect(guestPage).toHaveURL(
      new RegExp(`/guest/projects/${project.id}$`),
    );
    await expect(guestPage.getByText(/Se connecter/u)).toHaveCount(0);

    const source =
      '\\documentclass{article}\n\\begin{document}\nGuest collaborative edit\n\\end{document}';
    await guestPage.locator('.cm-content').fill(source);
    await expect(ownerPage.locator('.cm-content')).toContainText(
      'Guest collaborative edit',
    );
    await guestPage
      .getByRole('button', { name: 'Compiler', exact: true })
      .click();
    await expect(guestPage.getByText('✓ Succès')).toBeVisible({
      timeout: 60_000,
    });
    await expect(guestPage.getByText('Aperçu PDF')).toBeVisible();

    const revoked = await request.delete(
      `${api}/projects/${project.id}/guest-invitations/${invitation.id}`,
      { headers: ownerHeaders },
    );
    expect(revoked.status()).toBe(204);
    const guestSession = await guestPage.evaluate(() =>
      JSON.parse(sessionStorage.getItem('frelated-guest-session') || '{}'),
    );
    const denied = await request.get(`${api}/projects`, {
      headers: { Authorization: `Bearer ${guestSession.token}` },
    });
    expect(denied.status()).toBe(403);
    await guestPage.reload();
    await expect(guestPage.getByRole('alert')).toContainText(
      /révoquée|expirée/u,
    );

    await Promise.all([ownerContext.close(), guestContext.close()]);
  } finally {
    await request.delete(`${api}/projects/${project.id}`, {
      headers: ownerHeaders,
    });
  }
});
