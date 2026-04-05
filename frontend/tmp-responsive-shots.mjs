import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
  window.localStorage.setItem('fashion-report-session', JSON.stringify({
    id: 'debug-user',
    name: 'AIMODA Studio',
    role: 'admin',
    email: 'studio@aimoda.ai',
    permissions: ['users:manage'],
  }));
});
const page = await context.newPage();
const jobs = [
  { name: 'chat-mobile', route: '/chat', width: 390, height: 844 },
  { name: 'reports-mobile', route: '/reports', width: 390, height: 844 },
  { name: 'profile-access-mobile', route: '/profile?tab=access', width: 390, height: 844 },
  { name: 'chat-tablet', route: '/chat', width: 820, height: 1180 },
  { name: 'reports-tablet', route: '/reports', width: 820, height: 1180 },
  { name: 'profile-access-tablet', route: '/profile?tab=access', width: 820, height: 1180 }
];
for (const job of jobs) {
  await page.setViewportSize({ width: job.width, height: job.height });
  await page.goto(`http://127.0.0.1:38182${job.route}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/${job.name}.png`, fullPage: true });
  console.log(`/tmp/${job.name}.png`);
}
await browser.close();
