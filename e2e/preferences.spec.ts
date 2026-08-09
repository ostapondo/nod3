import { test, expect } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'

/**
 * The language is a once-per-install decision stored on the server, so these
 * specs reset it through the API rather than by clearing browser storage —
 * clearing the browser is exactly what must NOT lose the setting.
 */
async function clearLanguage(request: APIRequestContext) {
  await request.patch('/api/settings', { data: { language: null } })
}

test.describe('language preference', () => {
  test.beforeEach(async ({ request }) => {
    await clearLanguage(request)
  })

  test.afterAll(async ({ request }) => {
    await clearLanguage(request)
  })

  test('asks on first run and remembers the answer', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('Which language will you interview in?')).toBeVisible()
    for (const id of ['python', 'javascript', 'typescript', 'java', 'cpp', 'go']) {
      await expect(page.locator(`[data-language="${id}"]`)).toBeVisible()
    }

    await page.locator('[data-language="go"]').click()

    await expect(page.getByText('Problem bank')).toBeVisible()
    await expect(page.getByTestId('language-setting')).toContainText('Go')

    // No second interrogation.
    await page.reload()
    await expect(page.getByText('Which language will you interview in?')).toHaveCount(0)
    await expect(page.getByTestId('language-setting')).toContainText('Go')
  })

  test('survives a browser with no stored state at all', async ({ page, browser }) => {
    await page.goto('/')
    await page.locator('[data-language="cpp"]').click()
    await expect(page.getByTestId('language-setting')).toContainText('C++')

    // A brand-new context: no localStorage, no cookies, nothing carried over.
    const fresh = await browser.newContext()
    const freshPage = await fresh.newPage()
    await freshPage.goto('/')
    await expect(freshPage.getByText('Which language will you interview in?')).toHaveCount(0)
    await expect(freshPage.getByTestId('language-setting')).toContainText('C++')
    await fresh.close()
  })

  test('is written to disk where the rest of your data lives', async ({ page, request }) => {
    await page.goto('/')
    await page.locator('[data-language="java"]').click()
    await expect(page.getByTestId('language-setting')).toContainText('Java')

    const settings = await (await request.get('/api/settings')).json()
    expect(settings.language).toBe('java')
  })

  test('the choice is what a new session actually starts in', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-language="typescript"]').click()
    await page.getByRole('button', { name: 'Start session' }).click()

    await expect(page.getByText(/minutes in TypeScript/)).toBeVisible()
    await page.getByRole('button', { name: /Allow microphone and begin/ }).click()

    // A typed stub, not the plain JavaScript one. Which problem "Up next"
    // offers depends on your history, so assert on the annotation shape rather
    // than on one problem's parameter types.
    await expect(page.locator('.monaco-editor')).toContainText(/\(\w+:\s*(string|number|boolean)/)
  })

  test('settings can change it later', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-language="python"]').click()
    await expect(page.getByTestId('language-setting')).toContainText('Python')

    await page.getByTestId('language-setting').click()
    await expect(page.getByText('Interview language')).toBeVisible()
    await page.locator('[data-language="cpp"]').click()

    await expect(page.getByText('Interview language')).toHaveCount(0)
    await expect(page.getByTestId('language-setting')).toContainText('C++')
  })

  test('escape closes settings without changing anything', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-language="java"]').click()
    await page.getByTestId('language-setting').click()
    await expect(page.getByText('Interview language')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByText('Interview language')).toHaveCount(0)
    await expect(page.getByTestId('language-setting')).toContainText('Java')
  })
})

test.describe('language preference feedback', () => {
  test.beforeEach(async ({ request }) => {
    await request.patch('/api/settings', { data: { language: null } })
  })

  test.afterAll(async ({ request }) => {
    await request.patch('/api/settings', { data: { language: 'python' } })
  })

  test('the chosen card is marked, not left looking inert', async ({ page }) => {
    await page.goto('/')
    await page
      .getByTestId('language-setting')
      .isVisible()
      .catch(() => {})
    await page.locator('[data-language="go"]').click()
    // Either still saving, or already confirmed — never neither.
    await expect(page.getByTestId('language-setting')).toContainText('Go')

    await page.getByTestId('language-setting').click()
    await expect(page.locator('[data-language="go"]')).toHaveAttribute('data-state', 'selected')
    await expect(page.locator('[data-language="python"]')).toHaveAttribute('data-state', 'idle')
  })

  test('a failed save is reported instead of silently reverting', async ({ page }) => {
    // The exact failure a user hit: the write does not land, and the old code
    // pretended it had, so the first-run screen returned with no explanation.
    await page.route('**/api/settings', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 500, body: '{"error":"disk on fire"}' })
        : route.continue(),
    )

    await page.goto('/')
    await expect(page.getByText('Which language will you interview in?')).toBeVisible()
    await page.locator('[data-language="java"]').click()

    await expect(page.getByTestId('settings-error')).toBeVisible()
    await expect(page.getByTestId('settings-error')).toContainText('Could not save')
    // Still on the chooser, because the choice genuinely was not stored.
    await expect(page.getByText('Which language will you interview in?')).toBeVisible()
  })
})
