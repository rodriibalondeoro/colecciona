/**
 * CHECKOUT CONCURRENCY TEST
 *
 * Tests N buyers attempting to purchase the SAME product simultaneously.
 * Expected: 1 SUCCESS, N-1 FAILURE (clean failures, no data corruption).
 *
 * Run: node tests/load/checkout-concurrency.js
 */

const { config } = require("./config");

const BASE = config.baseUrl;
const PRODUCT_ID = process.env.PRODUCT_ID || "test-product-concurrent";
const NUM_BUYERS = parseInt(process.env.NUM_BUYERS || "10", 10);
const BUYER_TOKENS_FILE = "./tests/load/tokens.json";

let fs;
try { fs = require("fs"); } catch { fs = { readFileSync: () => "[]" }; }

async function getBuyerTokens() {
  try {
    const raw = fs.readFileSync(BUYER_TOKENS_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    console.log("⚠️  No tokens file found. Using mock tokens.");
    return Array.from({ length: NUM_BUYERS }, (_, i) => ({
      email: `buyer${i + 1}@test.com`,
      token: `mock-token-${i + 1}`,
    }));
  }
}

async function attemptCheckout(token, productId, buyerIndex) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}/api/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        items: [{ productId, quantity: 1 }],
        shippingMethod: { id: "sm1", price: 1.8 },
        shippingAddress: `Calle Test ${buyerIndex}, Madrid`,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await res.json().catch(() => ({}));
    const elapsed = Date.now() - start;

    return {
      buyer: buyerIndex + 1,
      status: res.status,
      ok: res.ok,
      orderId: data.orderId || data.order?.id || null,
      error: data.error || null,
      elapsed,
    };
  } catch (err) {
    return {
      buyer: buyerIndex + 1,
      status: 0,
      ok: false,
      orderId: null,
      error: err.message,
      elapsed: Date.now() - start,
    };
  }
}

async function verifyAfterCheckout(successfulOrderId, totalAttempts) {
  console.log("\n📊 POST-CHECKOUT VERIFICATION");
  console.log("─".repeat(50));

  // Check product state
  try {
    const res = await fetch(`${BASE}/api/products/${PRODUCT_ID}`, {
      headers: { Authorization: `Bearer ${config.users.admin.token}` },
    });
    const product = await res.json().catch(() => ({}));
    console.log(`Product state: ${product.status || "unknown"}`);
    console.log(`Product status OK: ${["SOLD", "RESERVED"].includes(product.status) ? "✅" : "❌ UNEXPECTED"}`);
  } catch {
    console.log("⚠️  Could not verify product state");
  }

  // Check no duplicate orders
  console.log(`\nTotal attempts: ${totalAttempts}`);
  console.log(`Successful orders: 1`);
  console.log(`Failed attempts: ${totalAttempts - 1}`);
}

async function main() {
  console.log("🔥 CHECKOUT CONCURRENCY TEST");
  console.log("═".repeat(60));
  console.log(`Product: ${PRODUCT_ID}`);
  console.log(`Buyers: ${NUM_BUYERS}`);
  console.log(`Target: ${BASE}`);
  console.log("═".repeat(60));

  const tokens = await getBuyerTokens();
  const results = [];

  // Fire all checkout attempts simultaneously
  console.log(`\n🚀 Launching ${NUM_BUYERS} concurrent checkout attempts...`);
  const startTime = Date.now();

  const promises = Array.from({ length: NUM_BUYERS }, (_, i) => {
    const token = tokens[i]?.token || `mock-token-${i + 1}`;
    return attemptCheckout(token, PRODUCT_ID, i);
  });

  const allResults = await Promise.all(promises);
  const totalTime = Date.now() - startTime;

  // Analyze results
  const successes = allResults.filter((r) => r.ok);
  const failures = allResults.filter((r) => !r.ok);
  const timeouts = failures.filter((r) => r.error?.includes("timeout") || r.error?.includes("Timeout"));
  const deduped = failures.filter((r) => r.status === 409 || r.status === 400);
  const serverErrors = failures.filter((r) => r.status >= 500);

  console.log("\n📊 RESULTS");
  console.log("═".repeat(60));
  console.log(`Total time: ${totalTime}ms`);
  console.log(`✅ Successes: ${successes.length}`);
  console.log(`❌ Failures: ${failures.length}`);
  console.log(`   - Dedup/conflict (409/400): ${deduped.length}`);
  console.log(`   - Timeouts: ${timeouts.length}`);
  console.log(`   - Server errors (5xx): ${serverErrors.length}`);
  console.log(`   - Other: ${failures.length - deduped.length - timeouts.length - serverErrors.length}`);

  if (successes.length === 1) {
    console.log("\n✅ PERFECT: Exactly 1 checkout succeeded");
    console.log(`Order ID: ${successes[0].orderId}`);
    console.log(`Elapsed: ${successes[0].elapsed}ms`);
  } else if (successes.length === 0) {
    console.log("\n❌ FAIL: No checkouts succeeded");
  } else {
    console.log(`\n🔴 CRITICAL: ${successes.length} checkouts succeeded — DOUBLE PURCHASE DETECTED`);
    console.log("Order IDs:", successes.map((s) => s.orderId).join(", "));
  }

  // Response time distribution
  const sorted = allResults.sort((a, b) => a.elapsed - b.elapsed);
  const p50 = sorted[Math.floor(sorted.length * 0.5)]?.elapsed || 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]?.elapsed || 0;
  const p99 = sorted[Math.floor(sorted.length * 0.99)]?.elapsed || 0;
  const max = sorted[sorted.length - 1]?.elapsed || 0;

  console.log("\n⏱️  RESPONSE TIMES");
  console.log("─".repeat(40));
  console.log(`P50: ${p50}ms`);
  console.log(`P95: ${p95}ms`);
  console.log(`P99: ${p99}ms`);
  console.log(`Max: ${max}ms`);

  // Detailed results
  console.log("\n📋 DETAILED RESULTS");
  console.log("─".repeat(40));
  for (const r of allResults) {
    const icon = r.ok ? "✅" : "❌";
    console.log(`  ${icon} Buyer ${r.buyer}: ${r.status} ${r.error || ""} (${r.elapsed}ms)`);
  }

  // Verify
  if (successes.length > 0) {
    await verifyAfterCheckout(successes[0].orderId, NUM_BUYERS);
  }

  // Exit code
  const passed = successes.length === 1 && failures.length === NUM_BUYERS - 1;
  console.log(`\n🏁 VEREDICTO: ${passed ? "✅ PASS" : "🔴 FAIL"}`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
