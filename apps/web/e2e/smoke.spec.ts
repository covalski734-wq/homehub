import { test, expect } from '@playwright/test';
test('local login and household pages', async ({ page }) => {
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD)
    throw new Error('Set E2E_EMAIL and E2E_PASSWORD for a local test account');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(process.env.E2E_EMAIL);
  await page.getByLabel('Пароль', { exact: true }).fill(process.env.E2E_PASSWORD);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).not.toHaveURL(/login/);
  for (const route of [
    '/',
    '/incomes',
    '/recurring',
    '/purchases',
    '/savings',
    '/shopping',
    '/chores',
    '/settings',
  ]) {
    await page.goto(route);
    await expect(page.locator('#main')).toBeVisible();
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByText('Внутренняя ошибка сервера', { exact: true })).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
