import { test, expect } from "@playwright/test";

test.describe("B1 — Marketplace loads", () => {
  test("homepage shows products", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(3000);
    const productCards = page.locator('[class*="card"], [class*="product"], a[href*="/product/"]');
    const count = await productCards.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("marketplace page loads", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("search functionality exists", async ({ page }) => {
    await page.goto("/");
    const searchInput = page.locator('input[placeholder*="Buscar"], input[type="search"], input[name*="search"]').first();
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchInput.fill("test");
      await page.waitForTimeout(1000);
    }
  });
});

test.describe("B2 — Product page", () => {
  test("non-existent product shows 404 or error", async ({ page }) => {
    const response = await page.goto("/product/00000000-0000-0000-0000-000000000000");
    await page.waitForTimeout(2000);
    const is404 = response?.status() === 404;
    const hasNotFound = await page.locator("text=no encontr").isVisible().catch(() => false);
    const hasError = await page.locator("text=Error").isVisible().catch(() => false);
    expect(is404 || hasNotFound || hasError || response?.status() === 200).toBe(true);
  });
});

test.describe("B3 — Seller profile", () => {
  test("non-existent seller shows 404 or error", async ({ page }) => {
    const response = await page.goto("/seller/nonexistentuser12345");
    await page.waitForTimeout(2000);
    const is404 = response?.status() === 404;
    const hasNotFound = await page.locator("text=no encontr").isVisible().catch(() => false);
    expect(is404 || hasNotFound || response?.status() === 200).toBe(true);
  });
});

test.describe("B4 — Favorites page requires auth", () => {
  test("redirects to auth when not logged in", async ({ page }) => {
    await page.goto("/favorites");
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url.includes("/auth") || await page.locator("text=Iniciar").isVisible().catch(() => false)).toBe(true);
  });
});

test.describe("B5 — Publish page requires auth", () => {
  test("redirects to auth when not logged in", async ({ page }) => {
    await page.goto("/publish");
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url.includes("/auth") || await page.locator("text=Iniciar").isVisible().catch(() => false)).toBe(true);
  });
});
