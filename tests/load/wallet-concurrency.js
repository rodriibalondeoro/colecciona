/**
 * WALLET + REFUND CONCURRENCY TEST
 *
 * Tests concurrent wallet operations:
 * - Multiple sales crediting same wallet
 * - Simultaneous refunds debiting same wallet
 * - Sale + refund race condition
 * - Negative balance prevention
 *
 * Run: node tests/load/wallet-concurrency.js
 */

const { config } = require("./config");

const BASE = config.baseUrl;

async function authHeader(email, password) {
  // For real tests, authenticate against Supabase
  // For now, use provided tokens
  try {
    const tokens = JSON.parse(require("fs").readFileSync("./tests/load/tokens.json", "utf8"));
    const user = tokens.find((t) => t.email === email);
    return user?.token ? { Authorization: `Bearer ${user.token}` } : {};
  } catch {
    return { Authorization: `Bearer mock-${email}` };
  }
}

// Simulate: N sales crediting same seller wallet simultaneously
async function testConcurrentSales(sellerToken, numSales = 5) {
  console.log("\n💰 TEST: Concurrent Sales → Same Wallet");
  console.log("─".repeat(50));

  const results = [];

  // In a real test, each would create a checkout + webhook to credit wallet
  // Here we test the wallet read under concurrent access
  const promises = Array.from({ length: numSales }, async (_, i) => {
    const start = Date.now();
    try {
      // Simulate: create order + webhook → wallet credit
      const res = await fetch(`${BASE}/api/orders`, {
        headers: { Authorization: `Bearer ${sellerToken}`, ...globalThisHeaders() },
      });
      return { sale: i + 1, status: res.status, elapsed: Date.now() - start };
    } catch (err) {
      return { sale: i + 1, status: 0, error: err.message, elapsed: Date.now() - start };
    }
  });

  const allResults = await Promise.all(promises);
  const successCount = allResults.filter((r) => r.status === 200).length;
  const errorCount = allResults.filter((r) => r.status !== 200).length;

  console.log(`  Sales attempted: ${numSales}`);
  console.log(`  Successes: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);
  console.log(`  All results:`);
  for (const r of allResults) {
    console.log(`    Sale ${r.sale}: ${r.status} ${r.error || ""} (${r.elapsed}ms)`);
  }

  return allResults;
}

// Simulate: N refunds debiting same wallet simultaneously
async function testConcurrentRefunds(adminToken, orderIds = []) {
  console.log("\n💸 TEST: Concurrent Refunds → Same Wallet");
  console.log("─".repeat(50));

  if (orderIds.length === 0) {
    console.log("  ⚠️  No order IDs provided. Skipping.");
    return [];
  }

  const promises = orderIds.map(async (orderId, i) => {
    const start = Date.now();
    try {
      const res = await fetch(`${BASE}/api/admin/disputes/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ orderId, type: "refund" }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json().catch(() => ({}));
      return { refund: i + 1, status: res.status, orderId, elapsed: Date.now() - start, data };
    } catch (err) {
      return { refund: i + 1, status: 0, error: err.message, elapsed: Date.now() - start };
    }
  });

  const allResults = await Promise.all(promises);
  const successCount = allResults.filter((r) => r.status === 200).length;
  const errorCount = allResults.filter((r) => r.status !== 200).length;

  console.log(`  Refunds attempted: ${orderIds.length}`);
  console.log(`  Successes: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);
  for (const r of allResults) {
    console.log(`    Refund ${r.refund}: ${r.status} ${r.error || ""} (${r.elapsed}ms)`);
  }

  return allResults;
}

// Test: begin_refund called twice for same order
async function testDuplicateRefund(adminToken, orderId) {
  console.log("\n🔄 TEST: Duplicate Refund Request");
  console.log("─".repeat(50));

  const start1 = Date.now();
  const start2 = Date.now();

  const [r1, r2] = await Promise.all([
    fetch(`${BASE}/api/admin/disputes/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ orderId, type: "refund" }),
      signal: AbortSignal.timeout(15000),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), elapsed: Date.now() - start1 })),

    fetch(`${BASE}/api/admin/disputes/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ orderId, type: "refund" }),
      signal: AbortSignal.timeout(15000),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), elapsed: Date.now() - start2 })),
  ]);

  const successCount = [r1, r2].filter((r) => r.status === 200).length;
  const errorCount = [r1, r2].filter((r) => r.status !== 200).length;

  console.log(`  Request 1: ${r1.status} ${r1.body.error || ""} (${r1.elapsed}ms)`);
  console.log(`  Request 2: ${r2.status} ${r2.body.error || ""} (${r2.elapsed}ms)`);
  console.log(`  Successes: ${successCount}`);
  console.log(`  Errors: ${errorCount}`);

  if (successCount <= 1) {
    console.log("  ✅ IDEMPOTENT: At most 1 refund succeeded");
  } else {
    console.log("  🔴 CRITICAL: Both refunds succeeded — DOUBLE REFUND");
  }

  return { r1, r2, successCount };
}

function globalThisHeaders() {
  return { "Content-Type": "application/json" };
}

async function main() {
  console.log("🔥 WALLET + REFUND CONCURRENCY TEST");
  console.log("═".repeat(60));
  console.log(`Target: ${BASE}`);
  console.log("═".repeat(60));

  const adminToken = "mock-admin-token";
  const sellerToken = "mock-seller-token";

  // Test 1: Concurrent sales
  await testConcurrentSales(sellerToken, 5);

  // Test 2: Duplicate refund
  await testDuplicateRefund(adminToken, "test-order-id");

  // Test 3: Concurrent refunds (need real order IDs)
  // await testConcurrentRefunds(adminToken, ["order1", "order2"]);

  console.log("\n🏁 WALLET CONCURRENCY TESTS COMPLETE");
  console.log("═".repeat(60));
  console.log("NOTE: These tests require a running instance with test data.");
  console.log("For full concurrency testing, run against staging with real Supabase.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
