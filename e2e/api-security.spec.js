import { test, expect } from "@playwright/test";

test.describe("Health Endpoint", () => {
  test("GET /api/health returns 200 or 503", async ({ request }) => {
    const response = await request.get("/api/health");
    expect([200, 503]).toContain(response.status());
    const body = await response.json();
    expect(body).toHaveProperty("status");
  });

  test("health endpoint returns JSON", async ({ request }) => {
    const response = await request.get("/api/health");
    const contentType = response.headers()["content-type"] || "";
    expect(contentType).toContain("json");
  });
});

test.describe("API Auth Guards", () => {
  test("POST /api/checkout requires auth", async ({ request }) => {
    const response = await request.post("/api/checkout", {
      data: { items: [] },
    });
    expect(response.status()).toBe(401);
  });

  test("POST /api/reviews requires auth", async ({ request }) => {
    const response = await request.post("/api/reviews", {
      data: { order_id: "test", rating: 5, comment: "test" },
    });
    expect(response.status()).toBe(401);
  });

  test("GET /api/orders requires auth", async ({ request }) => {
    const response = await request.get("/api/orders");
    expect(response.status()).toBe(401);
  });

  test("GET /api/threads requires auth", async ({ request }) => {
    const response = await request.get("/api/threads");
    expect(response.status()).toBe(401);
  });

  test("GET /api/offers requires auth", async ({ request }) => {
    const response = await request.get("/api/offers");
    expect(response.status()).toBe(401);
  });

  test("GET /api/notifications requires auth", async ({ request }) => {
    const response = await request.get("/api/notifications");
    expect(response.status()).toBe(401);
  });

  test("POST /api/stripe/webhook requires valid signature", async ({ request }) => {
    const response = await request.post("/api/stripe/webhook", {
      data: {},
      headers: { "content-type": "application/json" },
    });
    // Should reject without valid Stripe signature
    expect([400, 401, 403]).toContain(response.status());
  });

  test("POST /api/dispute requires auth", async ({ request }) => {
    const response = await request.post("/api/dispute", {
      data: { order_id: "fake", reason: "test" },
    });
    expect(response.status()).toBe(401);
  });

  test("POST /api/publish requires auth", async ({ request }) => {
    const response = await request.post("/api/publish", {
      data: { title: "test" },
    });
    expect(response.status()).toBe(401);
  });

  test("GET /api/favorites requires auth", async ({ request }) => {
    const response = await request.get("/api/favorites");
    expect(response.status()).toBe(401);
  });

  test("POST /api/follow requires auth", async ({ request }) => {
    const response = await request.post("/api/follow", {
      data: { user_id: "fake" },
    });
    expect(response.status()).toBe(401);
  });

  test("DELETE /api/account/delete requires auth", async ({ request }) => {
    const response = await request.delete("/api/account/delete");
    expect(response.status()).toBe(401);
  });
});

test.describe("Security Headers", () => {
  test("X-Frame-Options is DENY", async ({ request }) => {
    const response = await request.get("/");
    const xframe = response.headers()["x-frame-options"];
    expect(xframe?.toUpperCase()).toBe("DENY");
  });

  test("X-Content-Type-Options is nosniff", async ({ request }) => {
    const response = await request.get("/");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  });

  test("Strict-Transport-Security present", async ({ request }) => {
    const response = await request.get("/");
    const hsts = response.headers()["strict-transport-security"];
    expect(hsts).toBeTruthy();
  });

  test("X-Powered-By is removed", async ({ request }) => {
    const response = await request.get("/");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("Content-Security-Policy present", async ({ request }) => {
    const response = await request.get("/");
    const csp = response.headers()["content-security-policy"];
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src");
  });
});

test.describe("Static Pages", () => {
  const pages = [
    "/",
    "/marketplace",
    "/auth",
    "/about",
    "/terms",
    "/privacy",
    "/help",
  ];

  for (const path of pages) {
    test(`${path} loads without 5xx error`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator("body")).toBeVisible();
    });
  }
});

test.describe("404 Handling", () => {
  test("non-existent page shows 404 or redirect", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist-abc123");
    const status = response?.status();
    expect(status === 404 || status === 302 || status === 200).toBe(true);
  });
});
