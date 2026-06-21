import { test as base } from "@playwright/test";

// The backend rate-limits per client IP (in-memory sliding window). Running the
// suite serially from one host would otherwise pool every request into a single
// bucket and trip the limit mid-run. Give each test its own X-Forwarded-For
// (the API trusts one proxy hop) so buckets never bleed across tests.
let ipCounter = 1;

export const test = base.extend({
  context: async ({ browser }, use) => {
    const n = ipCounter++;
    const ctx = await browser.newContext({
      extraHTTPHeaders: { "X-Forwarded-For": `10.10.${(n >> 8) & 255}.${n & 255}` },
    });
    await use(ctx);
    await ctx.close();
  },
});

export { expect } from "@playwright/test";
