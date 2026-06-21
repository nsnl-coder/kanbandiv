import { type Page, expect } from "@playwright/test";

// Real-backend e2e helpers: drive the actual UI against the test backend.
// No network mocking - state is seeded/reset via support/db.ts.

export const PW = "password123";

export async function login(page: Page, email: string, password: string = PW): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

export interface StoreUser {
  email: string;
  isSuperuser: boolean;
  permissions: string[];
}

export async function getStore(page: Page): Promise<{ user: StoreUser | null }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __authStore: { getState: () => unknown } }).__authStore;
    const st = s.getState() as { user: StoreUser | null };
    return { user: st.user };
  });
}

export async function expectLoggedOut(page: Page): Promise<void> {
  const store = await getStore(page);
  expect(store.user).toBeNull();
}
