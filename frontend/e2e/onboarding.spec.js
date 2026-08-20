import { expect, test } from '@playwright/test';

// The three onboarding paths a real user takes. Each registration uses a unique
// email so the suite can be re-run; the accounts created are inert (no program,
// no data) unless the test explicitly joins one.

test.describe.configure({ mode: 'serial' });

const PASSWORD = 'e2e_registration_password';

function uniqueEmail(prefix) {
  return `e2e-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.invalid`;
}

test('registration asks only for a name, an email and a password', async ({ page }) => {
  await page.goto('/register');

  await expect(page.getByLabel('Name')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();

  // The metadata that was collected but never used is gone.
  await expect(page.getByText('User category')).toHaveCount(0);
  await expect(page.getByText('Desired app role')).toHaveCount(0);
  await expect(page.getByText('Clinical identity')).toHaveCount(0);
  await expect(page.getByText('Home specialty')).toHaveCount(0);
  await expect(page.locator('form select')).toHaveCount(0);

  // Someone arriving without an invite is told what their options are.
  await expect(page.getByTestId('no-invite-note')).toContainText('ask your Program Admin');
});

test('registering without an invite signs you in and explains the next step', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E No Invite');
  await page.getByLabel('Email').fill(uniqueEmail('noinvite'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /Register/ }).click();

  // Auto-login: no second trip through the login form.
  await page.waitForURL(/\/setup$/, { timeout: 20_000 });
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeTruthy();

  // Flow C: a clear explanation rather than an organization form.
  const choice = page.getByTestId('setup-choice');
  await expect(choice).toBeVisible();
  await expect(choice).toContainText('Ask your Program Admin for an invitation link');
  await expect(choice).toContainText('Starting a new program?');

  // Flow B remains one click away.
  await page.getByTestId('setup-create-program').click();
  await expect(page.getByText('Organization / Hospital name')).toBeVisible();
});

test('an invited registration joins the program automatically at the invited role', async ({ page }) => {
  // A Program Admin mints a viewer invite.
  await page.goto('/login');
  await page.getByLabel('Email').fill('qa-admin@medrota.local');
  await page.locator('#lg-password').fill('QA_only_password_123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(/\/dashboard|\/setup/, { timeout: 20_000 });

  // Invitations live in the Access & Permissions section of Program Settings.
  await page.goto('/settings?tab=access');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Invite role').selectOption('viewer');
  await page.getByRole('button', { name: /Generate invite link/i }).click();
  const inviteLink = await page.getByLabel('Invite link').inputValue();
  const inviteToken = inviteLink.split('/join/')[1];
  expect(inviteToken).toBeTruthy();

  // A new person follows it.
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/register?invite=${inviteToken}`);
  await expect(page.getByTestId('invite-note')).toContainText('access level is set by the invitation');

  await page.getByLabel('Name').fill('E2E Invited Viewer');
  await page.getByLabel('Email').fill(uniqueEmail('invited'));
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: /Register/ }).click();

  // Straight into the application, already in the program.
  await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByText('QA Vascular Surgery').first()).toBeVisible();

  // The invitation decided the role: a viewer gets no scheduling powers, and
  // the server agrees, not just the UI.
  await page.goto('/calendar');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /Auto-generate/i })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Clear schedule/i })).toBeDisabled();

  const role = await page.evaluate(async () => {
    const r = await fetch('/api/programs/mine', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    return (await r.json()).role;
  });
  expect(role).toBe('viewer');
});
