import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:5173'

async function snap(page: any, name: string) {
  await page.screenshot({
    path: `tests/e2e/screenshots/${name}.png`,
    fullPage: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE: Chat Page Flow
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Chat Page Flow', () => {

  test('chat_01_homepage_renders_cover', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Cover page text should be visible
    await expect(page).toHaveURL(/\/$/)
    const text = await page.locator('html').textContent()
    expect(text?.length).toBeGreaterThan(10)

    await snap(page, 'chat_01_cover')
  })

  test('chat_02_cta_to_chat', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // CTA button "即刻唤起"
    const cta = page.getByRole('button').filter({ hasText: /即刻唤起|Start Now/i })
    await expect(cta).toBeVisible({ timeout: 10000 })
    await cta.click()

    await expect(page).toHaveURL(/\/chat/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    await snap(page, 'chat_02_cta_chat')
  })

  test('chat_03_ai_header', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    await expect(page.locator('text=AI助手')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('h2', { hasText: /Fashion Search Agent/i })).toBeVisible({ timeout: 3000 })

    await snap(page, 'chat_03_ai_header')
  })

  test('chat_04_quick_queries', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const quickBtn = page.locator('button', { hasText: /找红色连衣裙/i })
    await expect(quickBtn).toBeVisible({ timeout: 5000 })

    await snap(page, 'chat_04_quick')
  })

  test('chat_05_new_session', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    await expect(page.locator('button', { hasText: /新对话/i })).toBeVisible({ timeout: 5000 })

    await snap(page, 'chat_05_new_session')
  })

  test('chat_06_desktop_sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    await expect(page.locator('aside')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('aside img[alt="aimoda"]')).toBeVisible({ timeout: 3000 })

    await snap(page, 'chat_06_desktop_sidebar')
  })

  test('chat_07_reports_nav_unauthenticated', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const reportsLink = page.locator('aside nav a').filter({ hasText: /报告|Reports/i })
    await expect(reportsLink).toBeVisible({ timeout: 3000 })
    await reportsLink.click()

    await page.waitForTimeout(2000)

    const url = page.url()
    const redirected = url === `${BASE}/` || url === `${BASE}/#` || url.includes('/reports')
    expect(redirected).toBeTruthy()

    await snap(page, 'chat_07_reports_nav')
  })

  test('chat_08_theme_toggle', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const themeBtn = page.locator(
      'button[aria-label="切换暗色"], button[aria-label="切换亮色"], ' +
      'button[aria-label="Switch to light"], button[aria-label="Switch to dark"]'
    )
    await expect(themeBtn).toBeVisible({ timeout: 5000 })

    const before = await page.locator('html').evaluate(el => el.classList.contains('dark'))
    await themeBtn.first().click()
    await page.waitForTimeout(500)
    const after = await page.locator('html').evaluate(el => el.classList.contains('dark'))

    expect(after).not.toBe(before)
    await snap(page, 'chat_08_theme')
  })

})
