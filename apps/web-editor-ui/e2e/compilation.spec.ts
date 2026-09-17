import { test, expect } from '@playwright/test';

test('real editor saves, compiles and shares its PDF', async ({
  browser,
  request,
}) => {
  const api = 'http://localhost:3000';
  const login = await request.post(api + '/auth/login', {
    data: { email: 'regent@frelated.dev', password: 'frelated123' },
  });
  expect(login.ok(), login.ok() ? undefined : await login.text()).toBeTruthy();
  const session = await login.json();
  const headers = { Authorization: `Bearer ${session.token}` };
  const created = await request.post(api + '/projects', {
    headers,
    data: { name: 'Compilation browser test' },
  });
  expect(created.ok()).toBeTruthy();
  const { project } = await created.json();
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  try {
    const pages = await Promise.all(
      contexts.map(async (context) => {
        await context.addInitScript(
          (value) =>
            localStorage.setItem('frelated-api-session', JSON.stringify(value)),
          session,
        );
        const page = await context.newPage();
        await page.goto(`/editor/${project.id}`);
        await expect(page.locator('.cm-content')).toBeVisible();
        return page;
      }),
    );
    const [page, collaborator] = pages;
    const endpoint = api + `/projects/${project.id}/compilation`;
    const state = async () => (await request.get(endpoint, { headers })).json();
    await collaborator
      .getByRole('button', { name: 'Split', exact: true })
      .click();
    expect((await state()).status).toBe('idle');
    const source =
      '\\documentclass{article}\n\\begin{document}\nBrowser compilation test\n\\end{document}';
    await page.locator('.cm-content').fill(source);
    await page.locator('.cm-content').press('Control+s');
    await expect
      .poll(async () => (await state()).status, { timeout: 60000 })
      .toBe('success');
    await expect(
      collaborator.locator('.pdfViewer .page canvas').first(),
    ).toBeVisible({ timeout: 20000 });
    const first = await state();
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    const pdfPage = page.locator('.pdfViewer .page').first();
    const initialWidth = await pdfPage.evaluate(
      (element) => element.getBoundingClientRect().width,
    );
    await page.getByTitle('Zoom avant', { exact: true }).click();
    await expect
      .poll(() =>
        pdfPage.evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeGreaterThan(initialWidth);
    await expect(page.getByTitle('Télécharger le PDF')).toHaveAttribute(
      'href',
      /^blob:/,
    );
    await expect(page.locator('.cm-content')).toHaveCount(0);
    expect((await state()).jobId).toBe(first.jobId);
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page
      .locator('.cm-content')
      .fill(source.replace('Browser compilation test', 'Modified document'));
    await page.getByRole('button', { name: 'PDF', exact: true }).click();
    await expect
      .poll(async () => (await state()).pdfJobId, { timeout: 60000 })
      .not.toBe(first.pdfJobId);
    await page.getByRole('button', { name: 'Compiler', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await expect
      .poll(async () => (await state()).status, { timeout: 60000 })
      .toBe('success');
    const pdf = await request.get(endpoint + '/pdf', { headers });
    expect((await pdf.body()).subarray(0, 5).toString()).toBe('%PDF-');
    const good = await state();
    await page
      .locator('.cm-content')
      .fill(source.replace('Browser compilation test', '\\undefinedcommand'));
    await page.locator('.cm-content').press('Control+s');
    await expect
      .poll(async () => (await state()).status, { timeout: 60000 })
      .toBe('error');
    expect((await state()).pdfJobId).toBe(good.pdfJobId);
    await expect(page.locator('.pdfViewer .page canvas').first()).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: 'Dernier PDF réussi conservé' }),
    ).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await request.delete(api + `/projects/${project.id}`, { headers });
  }
});

test('a prepared room without an editor never overrides saved sources', async ({
  request,
}) => {
  const api = 'http://localhost:3000';
  const login = await request.post(api + '/auth/login', {
    data: { email: 'regent@frelated.dev', password: 'frelated123' },
  });
  expect(login.ok()).toBeTruthy();
  const session = await login.json();
  const headers = { Authorization: `Bearer ${session.token}` };
  const created = await request.post(api + '/projects', {
    headers,
    data: { name: 'Empty room regression' },
  });
  const { project } = await created.json();
  try {
    const file = project.files.find(
      (file: { name: string }) => file.name === 'main.tex',
    );
    const room = await request.put(
      `http://localhost:8080/rooms/${project.id}___${file.id}`,
      { headers },
    );
    expect(room.ok()).toBeTruthy();
    const endpoint = `${api}/projects/${project.id}/compilation`;
    expect((await request.post(endpoint, { headers, data: {} })).status()).toBe(
      202,
    );
    await expect
      .poll(
        async () =>
          (await (await request.get(endpoint, { headers })).json()).status,
        { timeout: 60000 },
      )
      .toBe('success');
  } finally {
    await request.delete(`${api}/projects/${project.id}`, { headers });
  }
});
