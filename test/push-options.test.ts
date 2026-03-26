import { describe, it, expect } from "vitest";
import { normalizePushOptions } from "../src/push-options.js";

describe("normalizePushOptions", () => {
  describe("visibility mode alignment", () => {
    it("sell_immediately sets publish_to_online_store=true", () => {
      const r = normalizePushOptions({}, "sell_immediately");
      expect(r.effective_push_options.publish_to_online_store).toBe(true);
    });

    it("backend_only sets publish_to_online_store=false", () => {
      const r = normalizePushOptions({}, "backend_only");
      expect(r.effective_push_options.publish_to_online_store).toBe(false);
    });

    it("overriding publish_to_online_store warns", () => {
      const r = normalizePushOptions(
        { publish_to_online_store: true },
        "backend_only",
      );
      expect(r.effective_push_options.publish_to_online_store).toBe(false);
      expect(r.warnings).toContainEqual(expect.stringContaining("overridden"));
    });
  });

  describe("defaults", () => {
    it("returns sensible defaults with null input", () => {
      const r = normalizePushOptions(null, "backend_only");
      expect(r.errors).toHaveLength(0);
      expect(r.effective_push_options.image_strategy).toBe("selected_only");
      expect(r.effective_push_options.pricing_rule_behavior).toBe("keep_manual");
      expect(r.effective_push_options.auto_inventory_update).toBe(false);
      expect(r.effective_push_options.auto_price_update).toBe(false);
    });

    it("returns sensible defaults with undefined input", () => {
      const r = normalizePushOptions(undefined, "backend_only");
      expect(r.errors).toHaveLength(0);
    });
  });

  describe("image_strategy", () => {
    it("accepts selected_only", () => {
      const r = normalizePushOptions({ image_strategy: "selected_only" }, "backend_only");
      expect(r.effective_push_options.image_strategy).toBe("selected_only");
    });

    it("accepts all_available", () => {
      const r = normalizePushOptions({ image_strategy: "all_available" }, "backend_only");
      expect(r.effective_push_options.image_strategy).toBe("all_available");
    });

    it("rejects unknown strategy", () => {
      const r = normalizePushOptions({ image_strategy: "random" }, "backend_only");
      expect(r.errors.length).toBeGreaterThan(0);
    });
  });

  describe("pricing_rule_behavior", () => {
    it("accepts keep_manual", () => {
      const r = normalizePushOptions({ pricing_rule_behavior: "keep_manual" }, "backend_only");
      expect(r.effective_push_options.pricing_rule_behavior).toBe("keep_manual");
    });

    it("accepts apply_store_pricing_rule", () => {
      const r = normalizePushOptions({ pricing_rule_behavior: "apply_store_pricing_rule" }, "backend_only");
      expect(r.effective_push_options.pricing_rule_behavior).toBe("apply_store_pricing_rule");
    });

    it("rejects unknown behavior", () => {
      const r = normalizePushOptions({ pricing_rule_behavior: "auto" }, "backend_only");
      expect(r.errors.length).toBeGreaterThan(0);
    });
  });

  describe("sales_channels", () => {
    it("sell_immediately includes online_store by default", () => {
      const r = normalizePushOptions({}, "sell_immediately");
      expect(r.effective_push_options.sales_channels).toContain("online_store");
    });

    it("backend_only clears sales_channels", () => {
      const r = normalizePushOptions({ sales_channels: ["online_store"] }, "backend_only");
      expect(r.effective_push_options.sales_channels).toEqual([]);
    });

    it("non-array sales_channels errors", () => {
      const r = normalizePushOptions({ sales_channels: "online_store" }, "sell_immediately");
      expect(r.errors.length).toBeGreaterThan(0);
    });
  });

  describe("boolean options", () => {
    it("auto_inventory_update coerced to boolean", () => {
      const r = normalizePushOptions({ auto_inventory_update: 1 }, "backend_only");
      expect(r.effective_push_options.auto_inventory_update).toBe(true);
    });

    it("only_push_specifications coerced to boolean", () => {
      const r = normalizePushOptions({ only_push_specifications: "yes" }, "backend_only");
      expect(r.effective_push_options.only_push_specifications).toBe(true);
    });
  });

  describe("unknown keys", () => {
    it("warns on unknown option", () => {
      const r = normalizePushOptions({ my_custom_option: true }, "backend_only");
      expect(r.warnings).toContainEqual(expect.stringContaining("my_custom_option"));
    });
  });

  describe("type validation", () => {
    it("rejects non-object input", () => {
      const r = normalizePushOptions("bad" as any, "backend_only");
      expect(r.errors).toContainEqual(expect.stringContaining("must be an object"));
    });

    it("rejects array input", () => {
      const r = normalizePushOptions([] as any, "backend_only");
      expect(r.errors).toContainEqual(expect.stringContaining("must be an object"));
    });
  });

  describe("capability restrictions", () => {
    it("unsupported option is warned and ignored", () => {
      const cap = { supported: ["image_strategy"], unsupported: [] };
      const r = normalizePushOptions(
        { pricing_rule_behavior: "keep_manual" },
        "backend_only",
        cap,
      );
      expect(r.warnings).toContainEqual(expect.stringContaining("not supported"));
    });

    it("supported=false disables all options", () => {
      const cap = { supported: false };
      const r = normalizePushOptions(
        { image_strategy: "all_available" },
        "backend_only",
        cap,
      );
      expect(r.warnings).toContainEqual(expect.stringContaining("not supported"));
    });
  });
});
