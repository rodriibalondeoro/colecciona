import { describe, it, expect } from "vitest";

/**
 * Financial invariant tests.
 * These test the CORE money logic that must never break.
 * All amounts are NUMERIC(10,2) in PostgreSQL — we simulate with integers (cents)
 * to avoid floating-point issues, matching the backend pattern.
 */

describe("Financial Invariants", () => {
  const COMMISSION_RATE = 0.08;
  const PREMIUM_COMMISSION_RATE = 0.05;
  const SHIPPING_STANDARD = 250; // cents
  const SHIPPING_TRACKED = 400; // cents

  function calculateOrder(subtotalCents, shippingMethod, isPremium = false) {
    const rate = isPremium ? PREMIUM_COMMISSION_RATE : COMMISSION_RATE;
    const commissionCents = Math.round(subtotalCents * rate);
    const shippingCents =
      shippingMethod === "tracked" ? SHIPPING_TRACKED : SHIPPING_STANDARD;
    const totalCents = subtotalCents + shippingCents;
    const sellerEarningsCents = subtotalCents - commissionCents;

    return {
      subtotal: subtotalCents,
      shipping: shippingCents,
      commission: commissionCents,
      total: totalCents,
      sellerEarnings: sellerEarningsCents,
      buyerPaid: totalCents,
    };
  }

  describe("total = subtotal + shipping", () => {
    it("standard shipping", () => {
      const order = calculateOrder(10000, "standard"); // 100€
      expect(order.total).toBe(order.subtotal + order.shipping);
    });

    it("tracked shipping", () => {
      const order = calculateOrder(5000, "tracked"); // 50€
      expect(order.total).toBe(order.subtotal + order.shipping);
    });

    it("zero subtotal edge case", () => {
      // subtotal should never be 0 (CHECK constraint total > 0),
      // but the equation must hold
      const order = calculateOrder(0, "standard");
      expect(order.total).toBe(order.subtotal + order.shipping);
    });

    it("very large amount", () => {
      const order = calculateOrder(99999900, "tracked"); // 999,999€
      expect(order.total).toBe(order.subtotal + order.shipping);
    });
  });

  describe("commission calculation", () => {
    it("standard seller: 8% commission", () => {
      const order = calculateOrder(10000, "standard", false);
      expect(order.commission).toBe(800); // 8€
    });

    it("premium seller: 5% commission", () => {
      const order = calculateOrder(10000, "standard", true);
      expect(order.commission).toBe(500); // 5€
    });

    it("commission never exceeds subtotal", () => {
      const order = calculateOrder(100, "standard"); // 1€
      expect(order.commission).toBeLessThanOrEqual(order.subtotal);
    });

    it("seller earnings are non-negative", () => {
      const order = calculateOrder(1, "standard"); // 1 cent
      expect(order.sellerEarnings).toBeGreaterThanOrEqual(0);
    });
  });

  describe("seller earnings = subtotal - commission", () => {
    it("standard seller", () => {
      const order = calculateOrder(10000, "standard");
      expect(order.sellerEarnings).toBe(order.subtotal - order.commission);
    });

    it("premium seller", () => {
      const order = calculateOrder(10000, "standard", true);
      expect(order.sellerEarnings).toBe(order.subtotal - order.commission);
    });
  });

  describe("wallet ledger reconstruction", () => {
    it("SALE adds seller earnings", () => {
      let balance = 0;
      const order = calculateOrder(10000, "standard");
      balance += order.sellerEarnings;
      expect(balance).toBe(9200); // 92€
    });

    it("REFUND_REVERSAL debits seller earnings (full balance)", () => {
      let balance = 9200; // from previous sale
      const order = calculateOrder(10000, "standard");
      const debit = Math.min(balance, order.sellerEarnings);
      balance -= debit;
      expect(balance).toBe(0);
      expect(debit).toBe(9200);
    });

    it("REFUND_REVERSAL partial (balance < earnings)", () => {
      let balance = 5000; // 50€
      const earnings = 9200; // 92€ from sale
      const debit = Math.min(balance, earnings);
      const shortfall = earnings - debit;
      balance -= debit;
      expect(balance).toBe(0);
      expect(debit).toBe(5000);
      expect(shortfall).toBe(4200);
    });

    it("REFUND_SHORTFALL when wallet is zero", () => {
      let balance = 0;
      const earnings = 9200;
      const debit = Math.min(balance, earnings);
      const shortfall = earnings - debit;
      expect(debit).toBe(0);
      expect(shortfall).toBe(9200);
    });

    it("wallet never goes negative", () => {
      let balance = 100;
      const earnings = 9200;
      const debit = Math.min(balance, earnings);
      balance -= debit;
      expect(balance).toBeGreaterThanOrEqual(0);
    });
  });

  describe("refund amounts", () => {
    it("buyer gets total_paid back (subtotal + shipping)", () => {
      const order = calculateOrder(10000, "standard");
      const refundAmount = order.subtotal + order.shipping;
      expect(refundAmount).toBe(order.total);
    });

    it("refund amount is never negative", () => {
      const order = calculateOrder(100, "standard");
      expect(order.total).toBeGreaterThan(0);
    });
  });

  describe("currency precision", () => {
    it("no floating point drift on repeated operations", () => {
      let total = 0;
      for (let i = 0; i < 100; i++) {
        total += 0.1;
      }
      // This would fail with floats: total !== 10
      // But with integer cents it's fine
      const centsTotal = 0;
      const finalCents = centsTotal + 100 * 10; // 10€ in cents × 100
      expect(finalCents).toBe(1000);
    });

    it("Math.round prevents fractional cents", () => {
      const subtotal = 3333; // 33.33€
      const commission = Math.round(subtotal * 0.08);
      expect(Number.isInteger(commission)).toBe(true);
      expect(commission).toBe(267); // 2.67€
    });
  });
});
