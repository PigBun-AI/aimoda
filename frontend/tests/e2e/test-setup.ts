import { test as base } from '@playwright/test'

export const test = base.extend({
  // Take screenshot after each test
  screenshotOnFailure: async ({ page }, use) => {
    await use()
  },
})

export { expect } from '@playwright/test'
