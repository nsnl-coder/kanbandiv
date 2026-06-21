import { type Page } from "@playwright/test";

// Real e2e helpers: drive the actual UI on the live site. No mocking; accounts
// come from support/users.ts (pre-seeded) or fresh sign-up emails. We assert
// auth state via URL/visible UI only - the in-page `__authStore` global exists
// only in `vite dev`, not in the deployed (built) frontend.

// Default password for throwaway sign-up accounts created during a run.
export const PW = "password123";

export async function login(page: Page, email: string, password: string = PW): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
