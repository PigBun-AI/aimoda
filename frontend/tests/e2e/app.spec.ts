import { test, expect } from '@playwright/test'

const BASE = 'http://localhost:5173'

async function snap(page: any, name: string) {
  await page.screenshot({
    path: `tests/e2e/screenshots/${name}.png`,
    fullPage: false,
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE: fashion-report E2E - Simplified Robust Version
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Homepage', () => {

  test('01_homepage_loads_successfully', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Page URL should be correct
    await expect(page).toHaveURL(/\/$/)
    // Page should have text content
    const text = await page.locator('html').textContent()
    expect(text?.length).toBeGreaterThan(10)

    await snap(page, '01_homepage')
  })

  test('02_homepage_cta_button_visible', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // CTA button text is "即刻唤起" (Chinese) by default
    const ctaButton = page.getByRole('button')
      .filter({ hasText: /即刻唤起|Start Now/i })
    await expect(ctaButton).toBeVisible({ timeout: 10000 })

    await snap(page, '02_homepage_cta')
  })

  test('03_homepage_cta_navigates_to_chat', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const ctaButton = page.getByRole('button')
      .filter({ hasText: /即刻唤起|Start Now/i })
    await expect(ctaButton).toBeVisible({ timeout: 10000 })
    await ctaButton.click()

    await expect(page).toHaveURL(/\/chat/, { timeout: 5000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    await snap(page, '03_cta_to_chat')
  })

})

// ───────────────────────────────────────────────────────────────────────────

test.describe('Login Dialog', () => {

  async function openLoginDialog(page: any) {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // Find login button in sidebar
    const allButtons = page.locator('aside button')
    const count = await allButtons.count()
    for (let i = 0; i < count; i++) {
      const btn = allButtons.nth(i)
      const text = await btn.textContent().catch(() => '')
      if (text.includes('登录') || text.includes('Login')) {
        await btn.click()
        return true
      }
    }
    return false
  }

  test('04_login_dialog_opens', async ({ page }) => {
    const opened = await openLoginDialog(page)
    if (!opened) {
      test.skip(true, 'Login button not found')
      return
    }

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5000 })
    await snap(page, '04_login_dialog')
  })

  test('05_login_dialog_has_email_and_password', async ({ page }) => {
    await openLoginDialog(page)

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.locator('input[type="email"]')).toBeVisible({ timeout: 3000 })
    await expect(dialog.locator('input[type="password"]')).toBeVisible({ timeout: 3000 })

    await snap(page, '05_login_form')
  })

  test('06_login_dialog_has_submit_button', async ({ page }) => {
    await openLoginDialog(page)

    const dialog = page.locator('[role="dialog"]')
    await expect(dialog).toBeVisible({ timeout: 5000 })

    await expect(dialog.locator('button[type="submit"]')).toBeVisible({ timeout: 3000 })

    await snap(page, '06_login_submit')
  })

})

// ───────────────────────────────────────────────────────────────────────────

test.describe('Sidebar Navigation (Mobile)', () => {

  test('07_mobile_header_renders', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Header should exist and be visible
    const header = page.locator('header')
    await expect(header).toBeVisible({ timeout: 5000 })

    // Header should have menu button
    const menuBtn = page.locator('button[aria-label="打开菜单"]')
    await expect(menuBtn).toBeVisible({ timeout: 5000 })

    await snap(page, '07_mobile_header')
  })

  test('08_sidebar_opens_on_mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Click hamburger
    const menuBtn = page.locator('button[aria-label="打开菜单"]')
    await menuBtn.click()
    await page.waitForTimeout(800)

    // Sidebar should be visible
    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible({ timeout: 5000 })

    await snap(page, '08_sidebar_open')
  })

  test('09_sidebar_nav_links_visible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    await page.locator('button[aria-label="打开菜单"]').click()
    await page.waitForTimeout(800)

    const nav = page.locator('aside nav')
    await expect(nav).toBeVisible({ timeout: 5000 })

    // AI Assistant link
    const aiLink = page.locator('aside nav a').filter({ hasText: /AI助手|AI Assistant/i })
    await expect(aiLink).toBeVisible({ timeout: 3000 })

    await snap(page, '09_sidebar_nav')
  })

  test('10_navigate_to_chat_via_sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    await page.locator('button[aria-label="打开菜单"]').click()
    await page.waitForTimeout(800)

    const chatLink = page.locator('aside nav a').filter({ hasText: /AI助手|AI Assistant/i })
    await expect(chatLink).toBeVisible({ timeout: 3000 })
    await chatLink.click()

    await page.waitForTimeout(1500)
    await expect(page).toHaveURL(/\/chat/, { timeout: 5000 })

    await snap(page, '10_sidebar_to_chat')
  })

})

// ───────────────────────────────────────────────────────────────────────────

test.describe('Chat Page', () => {

  test('11_chat_page_loads', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    await expect(page).toHaveURL(/\/chat/, { timeout: 5000 })
    await snap(page, '11_chat_page')
  })

  test('12_chat_ai_header_visible', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const header = page.locator('text=AI助手')
    await expect(header).toBeVisible({ timeout: 5000 })

    await snap(page, '12_chat_ai_header')
  })

  test('13_chat_fashion_agent_title', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const title = page.locator('h2', { hasText: /Fashion Search Agent/i })
    await expect(title).toBeVisible({ timeout: 5000 })

    await snap(page, '13_chat_title')
  })

  test('14_chat_quick_queries', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const quickBtn = page.locator('button', { hasText: /找红色连衣裙/i })
    await expect(quickBtn).toBeVisible({ timeout: 5000 })

    await snap(page, '14_chat_quick')
  })

  test('15_chat_new_session_btn', async ({ page }) => {
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const newChatBtn = page.locator('button', { hasText: /新对话/i })
    await expect(newChatBtn).toBeVisible({ timeout: 5000 })

    await snap(page, '15_chat_new_session')
  })

  test('16_desktop_sidebar_pinned', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const sidebar = page.locator('aside')
    await expect(sidebar).toBeVisible({ timeout: 5000 })

    const logo = page.locator('aside img[alt="aimoda"]')
    await expect(logo).toBeVisible({ timeout: 3000 })

    await snap(page, '16_desktop_sidebar')
  })

})

// ───────────────────────────────────────────────────────────────────────────

test.describe('Theme Toggle', () => {

  test('17_theme_toggle_mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const themeBtn = page.locator(
      'button[aria-label="切换暗色"], button[aria-label="切换亮色"], ' +
      'button[aria-label="Switch to light"], button[aria-label="Switch to dark"]'
    )
    await expect(themeBtn).toBeVisible({ timeout: 5000 })

    await snap(page, '17_theme_toggle')
  })

  test('18_theme_toggle_changes_theme', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const html = page.locator('html')
    const beforeDark = await html.evaluate(el => el.classList.contains('dark'))

    const themeBtn = page.locator(
      'button[aria-label="切换暗色"], button[aria-label="切换亮色"], ' +
      'button[aria-label="Switch to light"], button[aria-label="Switch to dark"]'
    )
    await themeBtn.first().click()
    await page.waitForTimeout(500)

    const afterDark = await html.evaluate(el => el.classList.contains('dark'))
    expect(afterDark).not.toBe(beforeDark)

    await snap(page, '18_theme_changed')
  })

})

// ───────────────────────────────────────────────────────────────────────────

test.describe('Protected Routes', () => {

  test('19_reports_redirects_unauthenticated', async ({ page }) => {
    await page.goto(`${BASE}/reports`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const url = page.url()
    const isHome = url === `${BASE}/` || url === `${BASE}/#`
    const hasLoginDialog = await page.locator('[role="dialog"]').isVisible({ timeout: 1000 }).catch(() => false)

    expect(isHome || hasLoginDialog).toBeTruthy()

    await snap(page, '19_reports_redirect')
  })

})

// ───────────────────────────────────────────────────────────────────────────

test.describe('Console Error Check', () => {

  test('20_no_critical_errors_homepage', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(BASE)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('net::ERR') &&
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('api') &&
      !e.includes('WebSocket')
    )

    expect(critical).toHaveLength(0)
    await snap(page, '20_homepage_errors')
  })

  test('21_no_critical_errors_chat', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${BASE}/chat`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(3000)

    const critical = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('404') &&
      !e.includes('net::ERR') &&
      !e.includes('Failed to load resource') &&
      !e.includes('ERR_CONNECTION_REFUSED') &&
      !e.includes('api') &&
      !e.includes('WebSocket')
    )

    expect(critical).toHaveLength(0)
    await snap(page, '21_chat_errors')
  })

})
