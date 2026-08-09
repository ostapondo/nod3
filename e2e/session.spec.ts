import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Monaco's visible textarea is readonly — it exists for IME, not for input.
 * Driving the model directly is how Monaco itself recommends being automated,
 * and it fires the same change events the app listens to.
 */
/**
 * Opens a session for a specific problem. Clicking "Start session" would work
 * too, but "Up next" is chosen from your weak patterns, so which problem you
 * land on changes as history builds up.
 */
async function openSession(page: Page, problemId: string, language = 'python') {
  const res = await page.request.post('/api/sessions', {
    data: { problemId, language },
  })
  const { id } = await res.json()
  await page.goto(`/session/${id}`)
  await page.getByRole('button', { name: /Allow microphone and begin/ }).click()
  return id as string
}

async function setEditorValue(page: Page, code: string) {
  await expect(page.locator('.monaco-editor').first()).toBeVisible({ timeout: 20_000 })
  await page.waitForFunction(() => Boolean((window as unknown as { monaco?: unknown }).monaco))
  await page.evaluate((value) => {
    const monaco = (
      window as unknown as {
        monaco: { editor: { getModels: () => Array<{ setValue: (v: string) => void }> } }
      }
    ).monaco
    monaco.editor.getModels()[0]!.setValue(value)
  }, code)
}

// preferences.spec.ts deliberately clears the stored language; these specs need
// the ordinary dashboard, so they assert their own precondition.
test.beforeEach(async ({ request }) => {
  await request.patch('/api/settings', { data: { language: 'python' } })
})

test.describe('languages', () => {
  test('offers the languages Google allows, and says which are installed', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Up next')).toBeVisible()

    // The picker lives behind the header control now.
    await page.getByTestId('language-setting').click()
    await expect(page.getByText('Interview language')).toBeVisible()
    for (const id of ['python', 'javascript', 'typescript', 'java', 'cpp', 'go']) {
      await expect(page.locator(`[data-language="${id}"]`)).toBeVisible()
    }
    await page.keyboard.press('Escape')
  })

  test('a Java session gets a typed stub and grades a real solution', async ({ page, request }) => {
    const health = await (await request.get('/api/health')).json()
    const java = health.languages.find((l: { id: string }) => l.id === 'java')
    test.skip(!java?.available, 'no JDK on this machine')

    await openSession(page, 'two-sum-sorted', 'java')

    // The stub is generated from the problem's declared signature.
    await expect(page.locator('.monaco-editor')).toContainText(
      'int[] twoSumSorted(int[] nums, int target)',
    )

    await setEditorValue(
      page,
      `import java.util.*;

class Solution {
    public int[] twoSumSorted(int[] nums, int target) {
        int lo = 0, hi = nums.length - 1;
        while (lo < hi) {
            int s = nums[lo] + nums[hi];
            if (s == target) return new int[]{lo, hi};
            if (s < target) lo++; else hi--;
        }
        return new int[]{};
    }
}`,
    )
    await page.getByRole('button', { name: /Run tests/ }).click()
    await expect(page.getByText('all passing — now argue why it is correct')).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText('6/6')).toBeVisible()
  })

  test('a compile error is reported as a compile error', async ({ page, request }) => {
    const health = await (await request.get('/api/health')).json()
    const go = health.languages.find((l: { id: string }) => l.id === 'go')
    test.skip(!go?.available, 'no Go toolchain on this machine')

    await openSession(page, 'two-sum-sorted', 'go')
    await setEditorValue(
      page,
      'func twoSumSorted(nums []int, target int) []int {\n\treturn "nope"\n}',
    )
    await page.getByRole('button', { name: /Run tests/ }).click()
    await expect(page.getByText('compile', { exact: true })).toBeVisible({ timeout: 60_000 })
  })
})

test.describe('dashboard', () => {
  test('lists the problem bank and offers a next problem', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Think out loud.')).toBeVisible()
    await expect(page.getByText('Problem bank')).toBeVisible()
    // Titles appear twice — once in "Up next", once in the list — so scope to the panel.
    const bank = page.locator('section').filter({ hasText: 'Problem bank' })
    await expect(bank.getByText('Minimum Window Substring')).toBeVisible()
    await expect(bank.getByText('Valid Parentheses')).toBeVisible()
    await expect(bank.getByText('Best Time to Buy and Sell Stock')).toBeVisible()
    await expect(page.getByText('Up next')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start session' })).toBeEnabled()
  })

  test('reports that whisper and the analyser are wired up', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/whisper (ready|missing)/)).toBeVisible()
    await expect(page.getByText('Everything stays on this machine')).toBeVisible()
  })
})

test.describe('interview room', () => {
  test('briefs the rules before starting the clock', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Start session' }).click()

    await expect(page).toHaveURL(/\/session\/[0-9a-f-]+$/)
    await expect(page.getByText('Talk the whole way through')).toBeVisible()
    await expect(page.getByText('State complexity out loud')).toBeVisible()
    await expect(page.getByRole('button', { name: /Allow microphone and begin/ })).toBeVisible()
  })

  test('records, runs the tests, and reports failures', async ({ page }) => {
    await openSession(page, 'two-sum-sorted')

    // Recording indicator and the clock replace the briefing.
    await expect(page.getByText('rec', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Run tests/ })).toBeVisible()

    // A deliberately wrong solution: the drawer must say so rather than pass.
    await setEditorValue(page, 'def two_sum_sorted(nums, target):\n    return [0, 0]\n')
    await page.getByRole('button', { name: /Run tests/ }).click()

    await expect(page.getByText('failing cases below')).toBeVisible({ timeout: 20_000 })
    // Two of the visible cases legitimately expect [0,1], so scope to the first.
    await expect(page.getByText(/want \[0,1\]/).first()).toBeVisible()
  })

  test('hidden cases stay hidden during the session', async ({ page }) => {
    await openSession(page, 'two-sum-sorted')
    await setEditorValue(page, 'def two_sum_sorted(nums, target):\n    return [0, 0]\n')
    await page.getByRole('button', { name: /Run tests/ }).click()
    await expect(page.getByText('failing cases below')).toBeVisible({ timeout: 20_000 })

    await expect(page.getByText(/hidden case #4/)).toBeVisible()
    // The inputs behind a hidden case must never reach the browser.
    await expect(page.getByText('-10')).toHaveCount(0)
  })
})
