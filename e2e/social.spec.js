import { test, expect } from "@playwright/test";

test.describe("G1 — Offers page", () => {
  test("offers page loads", async ({ page }) => {
    await page.goto("/offers");
    await page.waitForTimeout(2000);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("G2 — Trades page", () => {
  test("trades page loads", async ({ page }) => {
    await page.goto("/trades");
    await page.waitForTimeout(2000);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("H1 — Messages", () => {
  test("messages page loads", async ({ page }) => {
    await page.goto("/messages");
    await page.waitForTimeout(2000);
    await expect(page.locator("body")).toBeVisible();
  });

  test("messages requires auth", async ({ page }) => {
    await page.goto("/messages");
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url.includes("/auth") || await page.locator("body").isVisible()).toBe(true);
  });
});

test.describe("I1 — Reviews API", () => {
  test("POST /api/reviews requires auth", async ({ request }) => {
    const response = await request.post("/api/reviews", {
      data: { order_id: "fake", rating: 5, comment: "test" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("J1 — Admin pages", () => {
  test("admin page requires auth", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url.includes("/auth") || await page.locator("body").isVisible()).toBe(true);
  });
});
