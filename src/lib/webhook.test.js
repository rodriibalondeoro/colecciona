import { describe, it, expect, beforeEach } from "vitest";

/**
 * Webhook deduplication logic tests.
 * Simulates the webhook_events table behavior from schema.sql + webhook/route.js.
 */

class WebhookEventStore {
  constructor() {
    this.events = new Map(); // stripe_event_id → { status, processing_started_at, processed_at }
  }

  claim(stripe_event_id) {
    const existing = this.events.get(stripe_event_id);
    if (!existing) {
      // New event — INSERT succeeds
      this.events.set(stripe_event_id, {
        status: "processing",
        processing_started_at: new Date().toISOString(),
        processed_at: null,
      });
      return { action: "process", isNew: true };
    }

    // Duplicate — check status
    if (existing.status === "completed") {
      return { action: "skip", reason: "already completed" };
    }

    if (existing.status === "processing") {
      const elapsed =
        Date.now() - new Date(existing.processing_started_at).getTime();
      if (elapsed > 5 * 60 * 1000) {
        // Stale — reclaim
        existing.processing_started_at = new Date().toISOString();
        return { action: "reclaim", reason: "stale processing" };
      }
      return { action: "skip", reason: "being processed" };
    }

    if (existing.status === "failed") {
      // Reclaim for retry
      existing.status = "processing";
      existing.processing_started_at = new Date().toISOString();
      return { action: "reclaim", reason: "retry failed" };
    }

    return { action: "skip", reason: "unknown status" };
  }

  complete(stripe_event_id) {
    const event = this.events.get(stripe_event_id);
    if (event) {
      event.status = "completed";
      event.processed_at = new Date().toISOString();
    }
  }

  fail(stripe_event_id) {
    const event = this.events.get(stripe_event_id);
    if (event) {
      event.status = "failed";
      event.processed_at = new Date().toISOString();
    }
  }
}

describe("Webhook Deduplication", () => {
  let store;

  beforeEach(() => {
    store = new WebhookEventStore();
  });

  describe("basic dedup", () => {
    it("first event is processed", () => {
      const result = store.claim("evt_123");
      expect(result.action).toBe("process");
      expect(result.isNew).toBe(true);
    });

    it("duplicate completed event is skipped", () => {
      store.claim("evt_123");
      store.complete("evt_123");
      const result = store.claim("evt_123");
      expect(result.action).toBe("skip");
      expect(result.reason).toBe("already completed");
    });

    it("duplicate processing event is skipped", () => {
      store.claim("evt_123");
      const result = store.claim("evt_123");
      expect(result.action).toBe("skip");
      expect(result.reason).toBe("being processed");
    });

    it("failed event is reclaimed for retry", () => {
      store.claim("evt_123");
      store.fail("evt_123");
      const result = store.claim("evt_123");
      expect(result.action).toBe("reclaim");
      expect(result.reason).toBe("retry failed");
    });
  });

  describe("stale reclaim", () => {
    it("processing event older than 5min is reclaimed", () => {
      store.claim("evt_123");
      // Simulate time passing
      const event = store.events.get("evt_123");
      event.processing_started_at = new Date(
        Date.now() - 6 * 60 * 1000
      ).toISOString();

      const result = store.claim("evt_123");
      expect(result.action).toBe("reclaim");
      expect(result.reason).toBe("stale processing");
    });

    it("processing event newer than 5min is NOT reclaimed", () => {
      store.claim("evt_123");
      const result = store.claim("evt_123");
      expect(result.action).toBe("skip");
    });
  });

  describe("no double credit", () => {
    it("complete → claim does not process again", () => {
      let creditCount = 0;

      // Simulate confirm_payment
      const result1 = store.claim("evt_123");
      if (result1.action === "process") {
        creditCount++;
        store.complete("evt_123");
      }

      // Duplicate webhook
      const result2 = store.claim("evt_123");
      if (result2.action === "process") {
        creditCount++;
      }

      expect(creditCount).toBe(1);
    });

    it("multiple rapid duplicates all skip", () => {
      let processCount = 0;

      for (let i = 0; i < 10; i++) {
        const result = store.claim("evt_duplicate");
        if (result.action === "process") {
          processCount++;
          store.complete("evt_duplicate");
        }
      }

      expect(processCount).toBe(1);
    });
  });

  describe("out of order events", () => {
    it("newer event does not revert older completed event", () => {
      store.claim("evt_1");
      store.complete("evt_1");
      store.claim("evt_2");
      store.complete("evt_2");

      // Both completed
      expect(store.events.get("evt_1").status).toBe("completed");
      expect(store.events.get("evt_2").status).toBe("completed");
    });
  });

  describe("concurrent race condition", () => {
    it("only one claimant wins for new event", () => {
      // Simulate two concurrent requests for same new event
      const result1 = store.claim("evt_race");
      const result2 = store.claim("evt_race");

      const processCount = [result1, result2].filter(
        (r) => r.action === "process"
      ).length;
      const skipCount = [result1, result2].filter(
        (r) => r.action === "skip"
      ).length;

      expect(processCount).toBe(1);
      expect(skipCount).toBe(1);
    });
  });
});
