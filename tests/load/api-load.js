/**
 * API LOAD TEST — Using autocannon
 *
 * Measures throughput and latency for key endpoints.
 * Run: node tests/load/api-load.js
 *
 * Requires: npm install -D autocannon
 */

const autocannon = require("autocannon");
const { config } = require("./config");

const BASE = config.baseUrl;

const endpoints = [
  {
    name: "Health",
    method: "GET",
    url: "/api/health",
    headers: {},
  },
  {
    name: "Marketplace (20 products)",
    method: "GET",
    url: "/api/products/search?limit=20&sort=recent",
    headers: {},
  },
  {
    name: "Marketplace (100 products)",
    method: "GET",
    url: "/api/products/search?limit=100&sort=recent",
    headers: {},
  },
  {
    name: "Search 'Messi'",
    method: "GET",
    url: "/api/products/search?q=Messi&limit=20",
    headers: {},
  },
  {
    name: "Product detail",
    method: "GET",
    url: "/api/products/test-product-id",
    headers: {},
  },
];

async function runLoadTest(endpoint, connections = 10, duration = 10) {
  return new Promise((resolve, reject) => {
    const instance = autocannon({
      url: `${BASE}${endpoint.url}`,
      method: endpoint.method,
      headers: endpoint.headers,
      connections,
      duration,
      pipelining: 1,
      timeout: 10,
    }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });

    autocannon.track(instance, { renderProgressBar: false });
  });
}

function formatResult(name, result) {
  const lat = result.latency;
  return [
    `  ${name}:`,
    `    Requests/sec: ${result.requests.average}`,
    `    Throughput:   ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`,
    `    Latency P50:  ${lat.p50}ms`,
    `    Latency P95:  ${lat.p95}ms`,
    `    Latency P99:  ${lat.p99}ms`,
    `    Latency Max:  ${lat.max}ms`,
    `    Errors:       ${result.errors}`,
    `    Timeouts:     ${result.timeouts}`,
    `    Total Reqs:   ${result.requests.total}`,
  ].join("\n");
}

async function main() {
  console.log("🔥 API LOAD TEST (autocannon)");
  console.log("═".repeat(60));
  console.log(`Target: ${BASE}`);
  console.log(`Connections: ${config.load.normal.connections}`);
  console.log(`Duration: ${config.load.normal.duration}s`);
  console.log("═".repeat(60));

  const results = [];

  for (const ep of endpoints) {
    console.log(`\n⏳ Testing: ${ep.name}...`);
    try {
      const result = await runLoadTest(ep, config.load.normal.connections, config.load.normal.duration);
      console.log(formatResult(ep.name, result));
      results.push({ name: ep.name, result });
    } catch (err) {
      console.log(`  ❌ Error: ${err.message}`);
    }
  }

  // Summary
  console.log("\n📊 SUMMARY");
  console.log("═".repeat(60));
  console.log("  Endpoint                          | Req/s | P95    | P99    | Errors");
  console.log("  " + "─".repeat(60));
  for (const { name, result } of results) {
    const padded = name.padEnd(34);
    const passed = result.latency.p95 < 1000 ? "✅" : "⚠️";
    console.log(`  ${padded} | ${String(result.requests.average).padStart(5)} | ${String(result.latency.p50).padStart(5)}ms | ${String(result.latency.p95).padStart(5)}ms | ${result.errors}`);
  }

  console.log("\n🏁 LOAD TEST COMPLETE");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
