/**
 * Load Test Configuration
 * All tests run against BASE_URL (default: http://localhost:3000)
 * For real load testing, deploy to staging first.
 */

export const config = {
  baseUrl: process.env.BASE_URL || "http://localhost:3000",

  // Test user credentials (created by seed script)
  users: {
    buyer1: { email: "load-buyer1@test.com", password: "Test1234!" },
    buyer2: { email: "load-buyer2@test.com", password: "Test1234!" },
    seller1: { email: "load-seller1@test.com", password: "Test1234!" },
    admin: { email: "load-admin@test.com", password: "Test1234!" },
  },

  // Load test parameters
  load: {
    baseline: { connections: 1, duration: 10 },
    normal: { connections: 10, duration: 30 },
    heavy: { connections: 50, duration: 30 },
    stress: { connections: 100, duration: 30 },
    spike: { connections: 200, duration: 10 },
    soak: { connections: 20, duration: 1800 }, // 30 min
  },

  // Concurrency test parameters
  concurrency: {
    checkout10: 10,
    checkout50: 50,
    checkout100: 100,
  },

  // Thresholds (milliseconds)
  thresholds: {
    p95_normal: 500,
    p99_normal: 1000,
    p95_checkout: 2000,
    errorRate: 0.01, // 1%
  },
};
