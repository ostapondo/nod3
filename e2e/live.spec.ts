import { test, expect } from '@playwright/test'

/**
 * The point of the socket is that the UI stops lying when the backend is gone.
 * Before this, a session could keep recording against a dead API and look fine
 * until Finish threw everything away.
 */
test.describe('live connection', () => {
  test('the dashboard says it is receiving live updates', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('connection-badge')).toHaveAttribute('data-connection', 'live')
  })

  test('the interview room shows the connection alongside the recorder', async ({
    page,
    request,
  }) => {
    const res = await request.post('/api/sessions', {
      data: { problemId: 'two-sum-sorted', language: 'python' },
    })
    const { id } = await res.json()
    await page.goto(`/session/${id}`)
    await page.getByRole('button', { name: /Allow microphone and begin/ }).click()

    await expect(page.getByText('rec', { exact: true })).toBeVisible()
    await expect(page.getByTestId('connection-badge')).toHaveAttribute('data-connection', 'live')
    // Nothing is wrong, so nothing shouts.
    await expect(page.getByTestId('connection-alert')).toHaveCount(0)
  })

  test('losing the backend mid-session is visible immediately', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.getByTestId('connection-badge')).toHaveAttribute('data-connection', 'live')

    await context.setOffline(true)
    await expect(page.getByTestId('connection-badge')).not.toHaveAttribute(
      'data-connection',
      'live',
      { timeout: 25_000 },
    )

    await context.setOffline(false)
    await expect(page.getByTestId('connection-badge')).toHaveAttribute('data-connection', 'live', {
      timeout: 30_000,
    })
  })

  test('a dropped connection during a session raises a banner, not silence', async ({
    page,
    context,
    request,
  }) => {
    const res = await request.post('/api/sessions', {
      data: { problemId: 'two-sum-sorted', language: 'python' },
    })
    const { id } = await res.json()
    await page.goto(`/session/${id}`)
    await page.getByRole('button', { name: /Allow microphone and begin/ }).click()
    await expect(page.getByTestId('connection-badge')).toHaveAttribute('data-connection', 'live')

    await context.setOffline(true)
    await expect(page.getByTestId('connection-alert')).toBeVisible({ timeout: 25_000 })
    await expect(page.getByTestId('connection-alert')).toContainText(/local server/i)

    // The clock keeps running: the session is not silently abandoned.
    await expect(page.getByText('rec', { exact: true })).toBeVisible()
    await context.setOffline(false)
  })
})
