import { describe, it, expect } from "vitest";
import {
  ORDER_STATES,
  normalizeOrderStatus,
  canTransitionOrder,
} from "./orderStates";

describe("ORDER_STATES", () => {
  it("contains all 12 states", () => {
    expect(Object.keys(ORDER_STATES)).toHaveLength(12);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(ORDER_STATES)).toBe(true);
  });

  it("each value matches its key", () => {
    for (const [key, value] of Object.entries(ORDER_STATES)) {
      expect(value).toBe(key);
    }
  });
});

describe("normalizeOrderStatus", () => {
  it("returns PENDING for null/undefined/empty", () => {
    expect(normalizeOrderStatus(null)).toBe("PENDING");
    expect(normalizeOrderStatus(undefined)).toBe("PENDING");
    expect(normalizeOrderStatus("")).toBe("PENDING");
  });

  it("normalizes lowercase to uppercase", () => {
    expect(normalizeOrderStatus("pending")).toBe("PENDING");
    expect(normalizeOrderStatus("paid")).toBe("PAID");
    expect(normalizeOrderStatus("shipped")).toBe("SHIPPED");
  });

  it("maps legacy states", () => {
    expect(normalizeOrderStatus("review")).toBe("DELIVERED");
    expect(normalizeOrderStatus("canceled")).toBe("CANCELLED");
    expect(normalizeOrderStatus("failed")).toBe("CANCELLED");
  });

  it("passes through unknown states uppercase", () => {
    expect(normalizeOrderStatus("CUSTOM_STATE")).toBe("CUSTOM_STATE");
  });

  it("handles whitespace", () => {
    expect(normalizeOrderStatus("  PAID  ")).toBe("PAID");
  });
});

describe("canTransitionOrder", () => {
  describe("happy path transitions", () => {
    it("PENDING → PAYMENT_PROCESSING", () => {
      expect(canTransitionOrder("PENDING", "PAYMENT_PROCESSING")).toBe(true);
    });

    it("PAYMENT_PROCESSING → PAID", () => {
      expect(canTransitionOrder("PAYMENT_PROCESSING", "PAID")).toBe(true);
    });

    it("PAYMENT_PROCESSING → CAPTURING", () => {
      expect(canTransitionOrder("PAYMENT_PROCESSING", "CAPTURING")).toBe(true);
    });

    it("CAPTURING → PAID", () => {
      expect(canTransitionOrder("CAPTURING", "PAID")).toBe(true);
    });

    it("PAID → PREPARING", () => {
      expect(canTransitionOrder("PAID", "PREPARING")).toBe(true);
    });

    it("PREPARING → SHIPPED", () => {
      expect(canTransitionOrder("PREPARING", "SHIPPED")).toBe(true);
    });

    it("SHIPPED → DELIVERED", () => {
      expect(canTransitionOrder("SHIPPED", "DELIVERED")).toBe(true);
    });

    it("DELIVERED → COMPLETED", () => {
      expect(canTransitionOrder("DELIVERED", "COMPLETED")).toBe(true);
    });
  });

  describe("refund transitions", () => {
    it("PAID → REFUND_PENDING", () => {
      expect(canTransitionOrder("PAID", "REFUND_PENDING")).toBe(true);
    });

    it("PREPARING → REFUND_PENDING", () => {
      expect(canTransitionOrder("PREPARING", "REFUND_PENDING")).toBe(true);
    });

    it("SHIPPED → REFUND_PENDING", () => {
      expect(canTransitionOrder("SHIPPED", "REFUND_PENDING")).toBe(true);
    });

    it("DELIVERED → REFUND_PENDING", () => {
      expect(canTransitionOrder("DELIVERED", "REFUND_PENDING")).toBe(true);
    });

    it("REFUND_PENDING → REFUNDED", () => {
      expect(canTransitionOrder("REFUND_PENDING", "REFUNDED")).toBe(true);
    });
  });

  describe("dispute transitions", () => {
    it("PAID → DISPUTED", () => {
      expect(canTransitionOrder("PAID", "DISPUTED")).toBe(true);
    });

    it("SHIPPED → DISPUTED", () => {
      expect(canTransitionOrder("SHIPPED", "DISPUTED")).toBe(true);
    });

    it("DISPUTED → REFUND_PENDING", () => {
      expect(canTransitionOrder("DISPUTED", "REFUND_PENDING")).toBe(true);
    });

    it("DISPUTED → COMPLETED", () => {
      expect(canTransitionOrder("DISPUTED", "COMPLETED")).toBe(true);
    });

    it("DISPUTED → CANCELLED", () => {
      expect(canTransitionOrder("DISPUTED", "CANCELLED")).toBe(true);
    });
  });

  describe("cancellation", () => {
    it("PENDING → CANCELLED", () => {
      expect(canTransitionOrder("PENDING", "CANCELLED")).toBe(true);
    });

    it("PAYMENT_PROCESSING → CANCELLED", () => {
      expect(canTransitionOrder("PAYMENT_PROCESSING", "CANCELLED")).toBe(true);
    });

    it("PAID → CANCELLED", () => {
      expect(canTransitionOrder("PAID", "CANCELLED")).toBe(true);
    });
  });

  describe("role-based guards", () => {
    it("buyer cannot mark as SHIPPED", () => {
      expect(canTransitionOrder("PAID", "SHIPPED", "buyer")).toBe(false);
    });

    it("seller CAN mark as SHIPPED", () => {
      expect(canTransitionOrder("PAID", "SHIPPED", "seller")).toBe(true);
    });

    it("seller cannot mark as DELIVERED", () => {
      expect(canTransitionOrder("SHIPPED", "DELIVERED", "seller")).toBe(false);
    });

    it("buyer CAN mark as DELIVERED", () => {
      expect(canTransitionOrder("SHIPPED", "DELIVERED", "buyer")).toBe(true);
    });

    it("seller cannot mark as COMPLETED", () => {
      expect(canTransitionOrder("DELIVERED", "COMPLETED", "seller")).toBe(false);
    });
  });

  describe("impossible transitions", () => {
    it("COMPLETED → anything is false", () => {
      expect(canTransitionOrder("COMPLETED", "PAID")).toBe(false);
      expect(canTransitionOrder("COMPLETED", "CANCELLED")).toBe(false);
      expect(canTransitionOrder("COMPLETED", "REFUNDED")).toBe(false);
    });

    it("REFUNDED → anything is false", () => {
      expect(canTransitionOrder("REFUNDED", "PAID")).toBe(false);
      expect(canTransitionOrder("REFUNDED", "CANCELLED")).toBe(false);
    });

    it("CANCELLED → anything is false", () => {
      expect(canTransitionOrder("CANCELLED", "PAID")).toBe(false);
      expect(canTransitionOrder("CANCELLED", "SHIPPED")).toBe(false);
    });

    it("PENDING → PAID is false (must go through PAYMENT_PROCESSING)", () => {
      expect(canTransitionOrder("PENDING", "PAID")).toBe(false);
    });

    it("PENDING → SHIPPED is false", () => {
      expect(canTransitionOrder("PENDING", "SHIPPED")).toBe(false);
    });

    it("ACTIVE → SOLD is false (not an order transition)", () => {
      expect(canTransitionOrder("ACTIVE", "SOLD")).toBe(false);
    });
  });

  describe("normalizeOrderStatus integration", () => {
    it("accepts lowercase input", () => {
      expect(canTransitionOrder("pending", "payment_processing")).toBe(true);
    });

    it("accepts legacy input", () => {
      expect(canTransitionOrder("review", "completed")).toBe(true);
    });
  });
});
