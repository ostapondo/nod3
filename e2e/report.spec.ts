import { test, expect } from '@playwright/test'
import { FIXTURE_SESSION_ID } from './seed'

test.describe('report', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/report/${FIXTURE_SESSION_ID}`)
    await expect(page.getByRole('heading', { name: 'Two Sum in a Sorted Array' })).toBeVisible()
  })

  test('leads with the verdict and the reason for it', async ({ page }) => {
    await expect(page.getByText('Lean no hire')).toBeVisible()
    await expect(page.getByText('17/28')).toBeVisible()
    await expect(page.getByText(/nearly four minutes of silent coding/i)).toBeVisible()
  })

  test('surfaces the silent-coding measurement', async ({ page }) => {
    const silentCoding = page.locator('div', { hasText: /^Silent coding$/ }).first()
    await expect(silentCoding).toBeVisible()
    // 227s -> 03:47
    await expect(page.getByText('03:47')).toBeVisible()
    await expect(page.getByText('1 stretch(es) over 15s')).toBeVisible()
  })

  test('draws both timeline tracks with a silent-coding band', async ({ page }) => {
    await expect(page.getByText('Speech against keystrokes')).toBeVisible()
    await expect(page.getByText('speaking')).toBeVisible()
    await expect(page.getByText('editing')).toBeVisible()
    await expect(page.getByTitle(/224s of unnarrated coding \(\+270 −50 chars\)/)).toBeVisible()
  })

  test('scrubbing the timeline plays back what was said at that moment', async ({ page }) => {
    const track = page.locator('div.cursor-crosshair')
    const box = await track.boundingBox()
    if (!box) throw new Error('timeline not rendered')

    // ~5% in — inside the 2s..9s speech passage of a 300s session.
    await page.mouse.move(box.x + box.width * 0.02, box.y + box.height / 2)
    await expect(page.getByText(/can the values be negative/i).last()).toBeVisible()

    // Mid-session is the silent stretch. It must read as silence, not as the
    // last thing said — that framing is the whole point of the view.
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2)
    await expect(page.getByText('— silence —')).toBeVisible()
    await expect(page.getByText(/last said \d+s earlier/)).toBeVisible()
  })

  test('scores every rubric dimension', async ({ page }) => {
    for (const dimension of [
      'Clarifying questions',
      'Approach & tradeoffs',
      'Complexity analysis',
      'Correctness',
      'Edge cases',
      'Code quality',
      'Communication',
    ]) {
      await expect(page.getByText(dimension, { exact: true })).toBeVisible()
    }
  })

  test('findings jump the transcript to their timestamp', async ({ page }) => {
    // Scoped to the findings panel: the same finding also has a pin on the
    // timeline, and both are legitimately named after it.
    await page
      .locator('section')
      .filter({ hasText: 'What decided it' })
      .getByRole('button', { name: /Went silent for the entire implementation/ })
      .click()
    await expect(page.getByText('00:23').first()).toBeVisible()
  })

  test('shows the reference answer and follow-ups only after the fact', async ({ page }) => {
    await expect(page.getByText('The reference answer')).toBeVisible()
    await expect(page.getByText(/Two pointers from both ends/)).toBeVisible()
    await expect(page.getByText('The array is no longer sorted. What changes?')).toBeVisible()
  })
})
