import { describe, it, expect } from "vitest";
import { validatePushSafety } from "../src/push-guard.js";

function mkDraft(variants: Record<string, any>[]) {
  return { variants };
}

function mkVariant(offer: any, cost: any, stock: any = 10, title = "V") {
  return { title, offer_price: offer, supplier_price: cost, stock, variant_ref: title };
}

describe("validatePushSafety", () => {
  // ── Price unit correctness (was cents, now dollars) ──

  describe("price display (dollars not cents)", () => {
    it("$5.99 should NOT show $0.06 in messages", () => {
      const r = validatePushSafety(mkDraft([mkVariant(599, 300)]));
      const all = [...r.blocked, ...r.warnings].join(" ");
      expect(all).not.toContain("$0.06");
    });

    it("$5.99 should not trigger low-price warning", () => {
      const r = validatePushSafety(mkDraft([mkVariant(599, 300)]));
      expect(r.warnings).not.toContainEqual(expect.stringContaining("very low price"));
    });

    it("$0.50 should trigger low-price warning with correct amount", () => {
      const r = validatePushSafety(mkDraft([mkVariant(50, 20)]));
      expect(r.warnings).toContainEqual(expect.stringContaining("very low price"));
      expect(r.warnings).toContainEqual(expect.stringContaining("$0.50"));
    });

    it("below-cost message shows correct dollars", () => {
      const r = validatePushSafety(mkDraft([mkVariant(200, 500)]));
      expect(r.blocked[0]).toContain("$2.00");
      expect(r.blocked[0]).toContain("$5.00");
    });
  });

  // ── Zero / negative price blocking ──

  describe("zero and negative price blocking", () => {
    it("offer=0, cost=null → blocked", () => {
      const r = validatePushSafety(mkDraft([mkVariant(0, null)]));
      expect(r.blocked.length).toBeGreaterThan(0);
    });

    it("offer=0, cost=0 → blocked", () => {
      const r = validatePushSafety(mkDraft([mkVariant(0, 0)]));
      expect(r.blocked.length).toBeGreaterThan(0);
    });

    it("offer=0, cost=5 → blocked", () => {
      const r = validatePushSafety(mkDraft([mkVariant(0, 5)]));
      expect(r.blocked.length).toBeGreaterThan(0);
    });

    it("offer=-1, cost=3 → blocked", () => {
      const r = validatePushSafety(mkDraft([mkVariant(-1, 3)]));
      expect(r.blocked.length).toBeGreaterThan(0);
    });

    it("normal price → not blocked", () => {
      const r = validatePushSafety(mkDraft([mkVariant(10, 5)]));
      expect(r.blocked).toHaveLength(0);
    });
  });

  // ── toNum edge cases ──

  describe("toNum edge cases", () => {
    it("empty string treated as null, not 0", () => {
      const r = validatePushSafety(mkDraft([mkVariant("", "")]));
      expect(r.blocked).toHaveLength(0);
    });

    it("Infinity treated as null", () => {
      const r = validatePushSafety(mkDraft([mkVariant(Infinity, 3)]));
      expect(r.blocked).toHaveLength(0);
    });

    it("-Infinity treated as null", () => {
      const r = validatePushSafety(mkDraft([mkVariant(-Infinity, 3)]));
      expect(r.blocked).toHaveLength(0);
    });

    it("NaN treated as null", () => {
      const r = validatePushSafety(mkDraft([mkVariant(NaN, 3)]));
      expect(r.blocked).toHaveLength(0);
    });

    it("string number '5.99' works", () => {
      const r = validatePushSafety(mkDraft([mkVariant("5.99", "3.00")]));
      expect(r.blocked).toHaveLength(0);
    });
  });

  // ── Margin checks ──

  describe("margin checks", () => {
    it("thin margin warns (<10%)", () => {
      const r = validatePushSafety(mkDraft([mkVariant(5.4, 5.0)]));
      expect(r.warnings).toContainEqual(expect.stringContaining("thin margin"));
    });

    it("healthy margin does not warn", () => {
      const r = validatePushSafety(mkDraft([mkVariant(10, 5)]));
      expect(r.warnings.filter(w => w.includes("margin"))).toHaveLength(0);
    });

    it("below cost → blocked (not just warned)", () => {
      const r = validatePushSafety(mkDraft([mkVariant(3, 5)]));
      expect(r.blocked.length).toBeGreaterThan(0);
    });
  });

  // ── Stock checks ──

  describe("stock checks", () => {
    it("all zero stock → blocked", () => {
      const r = validatePushSafety(mkDraft([mkVariant(10, 5, 0), mkVariant(10, 5, 0)]));
      expect(r.blocked).toContainEqual(expect.stringContaining("zero stock"));
    });

    it("low stock warns", () => {
      const r = validatePushSafety(mkDraft([mkVariant(10, 5, 3)]));
      expect(r.warnings).toContainEqual(expect.stringContaining("very low"));
    });

    it("adequate stock → no warning", () => {
      const r = validatePushSafety(mkDraft([mkVariant(10, 5, 50)]));
      expect(r.warnings.filter(w => w.includes("stock") || w.includes("inventory"))).toHaveLength(0);
    });

    it("null stock → warns about unavailable stock data", () => {
      const r = validatePushSafety(mkDraft([mkVariant(10, 5, null)]));
      expect(r.warnings.filter(w => w.includes("No stock/inventory data"))).toHaveLength(1);
      expect(r.blocked.filter(b => b.includes("stock"))).toHaveLength(0);
    });
  });

  // ── originalDraft comparison ──

  describe("originalDraft price drop detection", () => {
    it(">80% drop warns", () => {
      const orig = mkDraft([mkVariant(50, 20)]);
      const modified = mkDraft([mkVariant(5, 20)]);
      const r = validatePushSafety(modified, orig);
      expect(r.warnings).toContainEqual(expect.stringContaining("dropped"));
    });

    it("normal price change does not warn about drops", () => {
      const orig = mkDraft([mkVariant(50, 20)]);
      const modified = mkDraft([mkVariant(40, 20)]);
      const r = validatePushSafety(modified, orig);
      expect(r.warnings.filter(w => w.includes("dropped"))).toHaveLength(0);
    });

    it("no originalDraft → no drop warnings", () => {
      const r = validatePushSafety(mkDraft([mkVariant(1, 20)]));
      expect(r.warnings.filter(w => w.includes("dropped"))).toHaveLength(0);
    });
  });

  // ── Multiple variants ──

  describe("multiple variants", () => {
    it("one bad variant blocks even if others are fine", () => {
      const r = validatePushSafety(mkDraft([
        mkVariant(10, 5),
        mkVariant(0, 3),
      ]));
      expect(r.blocked.length).toBeGreaterThan(0);
    });

    it("empty variants → no issues", () => {
      const r = validatePushSafety(mkDraft([]));
      expect(r.blocked).toHaveLength(0);
      expect(r.warnings).toHaveLength(0);
    });
  });
});
