/**
 * REAL LOAD TEST — Execute against running server
 * Target: http://localhost:3000
 */
const autocannon = require("autocannon");

const BASE = "http://localhost:3000";

const endpoints = [
  { name: "Health", url: "/api/health", method: "GET" },
  { name: "Homepage", url: "/", method: "GET" },
  { name: "Marketplace", url: "/marketplace", method: "GET" },
  { name: "Auth page", url: "/auth", method: "GET" },
  { name: "Search (empty)", url: "/api/products/search?limit=20", method: "GET" },
  { name: "Search (q=Messi)", url: "/api/products/search?q=Messi&limit=20", method: "GET" },
  { name: "Auth guard: orders", url: "/api/orders", method: "GET" },
  { name: "Auth guard: offers", url: "/api/offers", method: "GET" },
  { name: "Auth guard: notifications", url: "/api/notifications", method: "GET" },
  { name: "Auth guard: threads", url: "/api/threads", method: "GET" },
  { name: "Auth guard: reviews", url: "/api/reviews?userId=fake", method: "GET" },
  { name: "Webhook (no sig)", url: "/api/stripe/webhook", method: "POST", body: "{}" },
];

async function runTest(ep, connections, duration) {
  return new Promise((resolve, reject) => {
    const opts = {
      url: `${BASE}${ep.url}`,
      method: ep.method,
      connections,
      duration,
      timeout: 10,
      headers: { "content-type": "application/json" },
    };
    if (ep.body) opts.body = ep.body;

    const instance = autocannon(opts, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function main() {
  console.log("🔥 REAL LOAD TEST — LIVE SERVER");
  console.log("═".repeat(70));
  console.log(`Target: ${BASE}`);
  console.log(`Connections: 10 | Duration: 15s per endpoint`);
  console.log("═".repeat(70));

  const CONN = 10;
  const DUR = 15;
  const results = [];

  for (const ep of endpoints) {
    process.stdout.write(`  ⏳ ${ep.name.padEnd(25)}...`);
    try {
      const r = await runTest(ep, CONN, DUR);
      const status = r.errors === 0 && r.latency.p95 < 2000 ? "✅" : "⚠️";
      console.log(`${status} req/s=${String(r.requests.average).padStart(6)} P50=${String(r.latency.p50).padStart(4)}ms P95=${String(r.latency.p95).padStart(5)}ms P99=${String(r.latency.p99).padStart(5)}ms err=${r.errors}`);
      results.push({ name: ep.name, ...r });
    } catch (err) {
      console.log(`❌ ${err.message}`);
      results.push({ name: ep.name, error: err.message });
    }
  }

  // Spike test: 50 connections on health
  console.log("\n🔥 SPIKE TEST: Health endpoint × 50 connections × 10s");
  try {
    const spike = await runTest({ url: "/api/health", method: "GET" }, 50, 10);
    console.log(`  ✅ req/s=${spike.requests.average} P50=${spike.latency.p50}ms P95=${spike.latency.p95}ms err=${spike.errors}`);
    results.push({ name: "SPIKE Health x50", ...spike });
  } catch (err) {
    console.log(`  ❌ ${err.message}`);
  }

  // Soak test: 20 connections × 30s on marketplace
  console.log("\n🔥 SOAK TEST: Homepage × 20 connections × 30s");
  try {
    const soak = await runTest({ url: "/", method: "GET" }, 20, 30);
    console.log(`  ✅ req/s=${soak.requests.average} P50=${soak.latency.p50}ms P95=${soak.latency.p95}ms err=${soak.errors} total=${soak.requests.total}`);
    results.push({ name: "SOAK Homepage x20", ...soak });
  } catch (err) {
    console.log(`  ❌ ${err.message}`);
  }

  // Summary table
  console.log("\n📊 RESULTS MATRIX");
  console.log("═".repeat(90));
  console.log("  Endpoint                    | Req/s  | P50   | P95    | P99    | Max    | Errors | Total");
  console.log("  " + "─".repeat(88));
  for (const r of results) {
    if (r.error) {
      console.log(`  ${r.name.padEnd(27)} | ERROR  | -     | -      | -      | -      | -      | ${r.error}`);
    } else {
      const lat = r.latency;
      console.log(`  ${r.name.padEnd(27)} | ${String(r.requests.average).padStart(6)} | ${String(lat.p50).padStart(4)}ms | ${String(lat.p95).padStart(5)}ms | ${String(lat.p99).padStart(5)}ms | ${String(lat.max).padStart(5)}ms | ${String(r.errors).padStart(6)} | ${r.requests.total}`);
    }
  }

  // Thresholds check
  console.log("\n🎯 THRESHOLD CHECK");
  console.log("─".repeat(50));
  const thresholds = [
    { name: "Health P95 < 300ms", test: (r) => r.name === "Health" && r.latency?.p95 < 300 },
    { name: "Search P95 < 1000ms", test: (r) => r.name?.includes("Search") && r.latency?.p95 < 1000 },
    { name: "Auth guard error rate < 5%", test: (r) => r.name?.includes("Auth guard") && (!r.errors || r.requests.total === 0 || (r.errors / r.requests.total) < 0.05) },
    { name: "Spike: P95 < 2000ms", test: (r) => r.name?.includes("SPIKE") && r.latency?.p95 < 2000 },
    { name: "Soak: No memory errors", test: (r) => r.name?.includes("SOAK") && r.errors === 0 },
  ];
  for (const t of thresholds) {
    const pass = results.some(t.test);
    console.log(`  ${pass ? "✅" : "⚠️"} ${t.name}`);
  }

  console.log("\n🏁 LOAD TEST COMPLETE");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
