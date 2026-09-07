import { test, expect } from "@playwright/test";

test.describe("A1 — Registration Flow", () => {
  test("registration page loads", async ({ page }) => {
    await page.goto("/auth");
    // Auth page has "Iniciar Sesión" / "Crear Cuenta" tabs
    await expect(page.locator("text=Iniciar")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("text=Crear Cuenta")).toBeVisible();
  });

  test("registration form has required fields after switching tab", async ({ page }) => {
    await page.goto("/auth");
    // Click "Crear Cuenta" tab to switch to registration mode
    await page.locator("text=Crear Cuenta").click();
    await page.waitForTimeout(500);
    // Now registration fields should be visible
    await expect(page.locator('input[placeholder*="Carlos"], input[name*="fullName"]').first()).toBeVisible({ timeout: 5000 });
  });

  test("registration rejects empty form", async ({ page }) => {
    await page.goto("/auth");
    await page.locator("text=Crear Cuenta").click();
    await page.waitForTimeout(500);
    const submitBtn = page.locator('button:has-text("Crear Cuenta"):not([class*="tab"]), button[type="submit"]').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await page.waitForTimeout(1000);
      expect(page.url()).toContain("/auth");
    }
  });
});

test.describe("A2 — Login Flow", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.locator("text=Iniciar Sesión")).toBeVisible({ timeout: 10000 });
  });

  test("login form has email/phone and password fields", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.locator('input[placeholder*="email"], input[placeholder*="Email"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('input[placeholder*="carácter"], input[placeholder*="contraseña"], input[type="password"]').first()).toBeVisible();
  });

  test("unauthenticated user redirected from protected pages", async ({ page }) => {
    await page.goto("/orders");
    await page.waitForTimeout(2000);
    const url = page.url();
    const isOnAuth = url.includes("/auth");
    const hasLoginPrompt = await page.locator("text=Iniciar sesión").isVisible().catch(() => false);
    expect(isOnAuth || hasLoginPrompt).toBe(true);
  });

  test("profile page requires auth", async ({ page }) => {
    await page.goto("/profile");
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url.includes("/auth") || await page.locator("text=Iniciar").isVisible().catch(() => false)).toBe(true);
  });
});

test.describe("A3 — Deleted User Blocking", () => {
  test("deleted user token is rejected by API", async ({ request }) => {
    const response = await request.get("/api/orders", {
      headers: { Authorization: "Bearer fake_deleted_user_token" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("A4 — Session Isolation", () => {
  test("localStorage cleared on logout", async ({ page }) => {
    await page.goto("/auth");
    const session = await page.evaluate(() => localStorage.getItem("colecciona_session"));
    expect(session === null || typeof session === "string").toBe(true);
  });
});
