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
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 980 },
];
const routes = ['/', '/chat', '/reports', '/inspiration', '/profile', '/profile?tab=access'];
const out = [];
for (const vp of viewports) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  for (const route of routes) {
    const url = `http://127.0.0.1:38182${route}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1200);
      const metrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const body = document.body;
        const overflowX = Math.max(doc.scrollWidth, body ? body.scrollWidth : 0) - window.innerWidth;
        const overflowing = Array.from(document.querySelectorAll('*'))
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > window.innerWidth + 2 || r.left < -2);
          })
          .slice(0, 12)
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              tag: el.tagName.toLowerCase(),
              cls: (el.className || '').toString().slice(0, 140),
              text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
              left: Math.round(r.left),
              right: Math.round(r.right),
              width: Math.round(r.width),
            };
          });
        return { title: document.title, overflowX, overflowing };
      });
      out.push({ viewport: vp.name, route, ...metrics });
    } catch (error) {
      out.push({ viewport: vp.name, route, error: String(error) });
    }
  }
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
