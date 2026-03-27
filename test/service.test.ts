import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportFlowService } from "../src/service.js";
import { buildRulesFromFlatParams } from "../src/tools.js";
import type { ImportProvider } from "../src/provider.js";
import type { JobStore } from "../src/job-store.js";

function createMockProvider(): ImportProvider {
  return {
    name: "test-provider",
    getRuleCapabilities: vi.fn().mockResolvedValue({
      provider_label: "Test",
      source_support: ["aliexpress"],
      stores: [{ store_ref: "store-1", display_name: "Test Store" }],
      rule_families: {
        pricing: { supported: true, modes: ["provider_default", "multiplier", "fixed_markup"] },
        content: { supported: ["title_override", "title_prefix", "title_suffix", "description_override_html", "description_append_html"] },
        images: { supported: ["keep_first_n", "drop_indexes"] },
      },
      push_options: {},
    }),
    prepareCandidate: vi.fn().mockResolvedValue({
      provider_label: "Test",
      provider_state: {
        import_item_id: "item-123",
        source_hint: "aliexpress",
        source_kind: "aliexpress",
        field_map: { variants_key: "variants", raw_variants: [] },
      },
      draft: {
        title: "Test Product",
        description_html: "<p>Test</p>",
        images: ["img1.jpg", "img2.jpg"],
        tags: [],
        variants: [
          { variant_ref: "v1", title: "Red", supplier_price: 500, offer_price: 1000, stock: 50, sku: "RED" },
          { variant_ref: "v2", title: "Blue", supplier_price: 600, offer_price: 1200, stock: 30, sku: "BLUE" },
        ],
      },
      warnings: [],
    }),
    saveDraft: vi.fn().mockResolvedValue({ warnings: [] }),
    commitCandidate: vi.fn().mockResolvedValue({
      job_status: "completed",
      visibility_applied: "backend_only",
      push_options_applied: {},
      warnings: [],
      summary: { title: "Test Product", image_count: 2, variant_count: 2 },
    }),
    getStorePricingRule: vi.fn().mockResolvedValue({ enabled: false }),
    fetchImportItem: vi.fn().mockResolvedValue({ data: {} }),
    normalizeForRecovery: vi.fn().mockReturnValue([
      {
        title: "Recovered",
        description_html: "",
        images: [],
        tags: [],
        variants: [{ variant_ref: "v1", title: "V1", supplier_price: 500, offer_price: 1000, stock: 10, sku: "V1" }],
      },
      { variants_key: "variants" },
      [],
    ]),
  };
}

function createMockJobStore(): JobStore & { _store: Map<string, any> } {
  const _store = new Map<string, any>();
  let counter = 0;
  return {
    _store,
    create(payload: Record<string, any>) {
      const id = `job-${++counter}`;
      _store.set(id, structuredClone(payload));
      return id;
    },
    save(jobId: string, payload: Record<string, any>) {
      _store.set(jobId, structuredClone(payload));
    },
    load(jobId: string) {
      const data = _store.get(jobId);
      if (!data) throw new Error(`Unknown job_id: ${jobId}`);
      return data;
    },
  };
}

// Stub resolveSourceUrl — it's an async function that makes HTTP calls
vi.mock("../src/resolver.js", () => ({
  resolveSourceUrl: vi.fn().mockResolvedValue({
    resolved_url: "https://www.aliexpress.com/item/1234567890.html",
    source_hint: "aliexpress",
    resolver_mode: "direct",
    warnings: [],
  }),
}));

describe("ImportFlowService", () => {
  let provider: ReturnType<typeof createMockProvider>;
  let store: ReturnType<typeof createMockJobStore>;
  let service: ImportFlowService;

  beforeEach(() => {
    provider = createMockProvider();
    store = createMockJobStore();
    service = new ImportFlowService(provider, store);
  });

  // ── Import flow ──

  describe("prepareImportCandidate", () => {
    it("returns preview with job_id", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result.job_id).toBeDefined();
      expect(result.status).toBe("preview_ready");
      expect(result.title).toBe("Test Product");
      expect(result.variants_count).toBe(2);
    });

    it("applies pricing rules during import", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 3 } },
      });
      expect(result.sell_price).toEqual({ min: 15, max: 18 });
      expect(result.no_markup).toBeUndefined();
      expect((provider.saveDraft as any).mock.calls.length).toBeGreaterThan(0);
    });

    it("requires source_url", async () => {
      await expect(service.prepareImportCandidate({})).rejects.toThrow("source_url is required");
    });

    it("validates rules before import", async () => {
      await expect(
        service.prepareImportCandidate({
          source_url: "https://www.aliexpress.com/item/1234567890.html",
          rules: { pricing: { mode: "multiplier", multiplier: -1 } },
        }),
      ).rejects.toThrow("greater than 0");
    });
  });

  // ── Preview ──

  describe("getImportPreview", () => {
    it("returns preview for existing job", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const preview = await service.getImportPreview({ job_id: importResult.job_id });
      expect(preview.job_id).toBe(importResult.job_id);
      expect(preview.title).toBe("Test Product");
    });

    it("requires job_id", async () => {
      await expect(service.getImportPreview({})).rejects.toThrow("job_id is required");
    });

    it("throws on unknown job_id", async () => {
      await expect(service.getImportPreview({ job_id: "nonexistent" })).rejects.toThrow("Unknown job_id");
    });
  });

  // ── Re-apply rules ──

  describe("reapplyRules", () => {
    it("re-applies new pricing rules from original draft", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });

      const reapplied = await service.reapplyRules({
        job_id: importResult.job_id,
        rules: { pricing: { mode: "multiplier", multiplier: 2 } },
      });

      expect(reapplied.sell_price).toEqual({ min: 10, max: 12 });
    });

    it("preserves existing rules when _keep_existing_rules is set", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 3 } },
      });

      const reapplied = await service.reapplyRules({
        job_id: importResult.job_id,
        _keep_existing_rules: true,
      });

      expect(reapplied.sell_price).toEqual({ min: 15, max: 18 });
    });

    it("requires job_id", async () => {
      await expect(service.reapplyRules({})).rejects.toThrow("job_id is required");
    });

    it("content rules work in re-apply", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const reapplied = await service.reapplyRules({
        job_id: importResult.job_id,
        rules: { content: { title_override: "New Title" } },
      });
      expect(reapplied.title_after).toBe("New Title");
      expect(reapplied.title_before).toBe("Test Product");
    });
  });

  // ── Push flow ──

  describe("confirmPushToStore", () => {
    it("pushes product to store", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const pushResult = await service.confirmPushToStore({
        job_id: importResult.job_id,
      });
      expect(pushResult.status).toBe("completed");
      expect(provider.commitCandidate).toHaveBeenCalled();
    });

    it("blocks push on zero price", async () => {
      (provider.prepareCandidate as any).mockResolvedValueOnce({
        provider_label: "Test",
        provider_state: { import_item_id: "item-x", field_map: {} },
        draft: {
          title: "Zero Price Product",
          description_html: "",
          images: [],
          tags: [],
          variants: [{ variant_ref: "v1", title: "V", supplier_price: 500, offer_price: 0, stock: 10, sku: "V" }],
        },
        warnings: [],
      });

      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/999.html",
      });
      await expect(
        service.confirmPushToStore({ job_id: importResult.job_id }),
      ).rejects.toThrow("push_blocked_by_safety_check");
    });

    it("force_push overrides safety block", async () => {
      (provider.prepareCandidate as any).mockResolvedValueOnce({
        provider_label: "Test",
        provider_state: { import_item_id: "item-y", field_map: {} },
        draft: {
          title: "Zero Price Product",
          description_html: "",
          images: [],
          tags: [],
          variants: [{ variant_ref: "v1", title: "V", supplier_price: 500, offer_price: 0, stock: 10, sku: "V" }],
        },
        warnings: [],
      });

      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/998.html",
      });
      const pushResult = await service.confirmPushToStore({
        job_id: importResult.job_id,
        force_push: true,
      });
      expect(pushResult.status).toBe("completed");
    });
  });

  // ── Batch push error handling ──

  describe("batch operations", () => {
    it("batchPush with empty array throws", async () => {
      await expect(
        service.confirmPushToStore({ job_ids: [] }),
      ).rejects.toThrow("non-empty list");
    });

    it("batchPrepare with empty array throws", async () => {
      await expect(
        service.prepareImportCandidate({ source_urls: [] }),
      ).rejects.toThrow("non-empty list");
    });
  });

  // ── Multi-store push ──

  describe("multi-store push", () => {
    it("pushes to multiple stores and collects results", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });

      const pushResult = await service.confirmPushToStore({
        job_id: importResult.job_id,
        target_stores: ["store-a", "store-b"],
      });

      expect(pushResult.total).toBe(2);
      expect(pushResult.results).toHaveLength(2);
    });
  });

  // ── Job status ──

  describe("getJobStatus", () => {
    it("returns compact status", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const status = await service.getJobStatus({ job_id: importResult.job_id });
      expect(status.job_id).toBe(importResult.job_id);
      expect(status.status).toBe("preview_ready");
      expect(status).not.toHaveProperty("created_at");
      expect(status).not.toHaveProperty("has_push_result");
    });

    it("requires job_id", async () => {
      await expect(service.getJobStatus({})).rejects.toThrow("job_id is required");
    });
  });

  // ── Response compactness ──

  describe("response compactness", () => {
    it("preview omits echoed-back fields", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result).not.toHaveProperty("source_url");
      expect(result).not.toHaveProperty("rules");
      expect(result).not.toHaveProperty("rule_summary");
      expect(result).not.toHaveProperty("resolver_mode");
      expect(result).not.toHaveProperty("requested_rules");
    });

    it("sell_price and cost clearly separated", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result).toHaveProperty("sell_price");
      expect(result).toHaveProperty("cost");
    });

    it("no_markup=true when sell equals cost", async () => {
      (provider.prepareCandidate as any).mockResolvedValueOnce({
        provider_label: "Test",
        provider_state: { import_item_id: "item-nm", field_map: {} },
        draft: {
          title: "No Markup", description_html: "", images: [], tags: [],
          variants: [{ variant_ref: "v1", title: "V", supplier_price: 500, offer_price: 500, stock: 10, sku: "V" }],
        },
        warnings: [],
      });
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/nomarkup.html",
      });
      expect(result.sell_price).toBe(5);
      expect(result.cost).toBe(5);
      expect(result.no_markup).toBe(true);
    });

    it("no_markup absent when rules applied", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 2 } },
      });
      expect(result.no_markup).toBeUndefined();
    });

    it("skus has header row", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result.skus[0]).toEqual(["name", "sell", "qty"]);
      expect(result.skus.length).toBeGreaterThan(1);
    });

    it("title_before/after only when changed", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result).toHaveProperty("title", "Test Product");
      expect(result).not.toHaveProperty("title_before");
      expect(result).not.toHaveProperty("title_after");
    });

    it("visibility only when non-default", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result).not.toHaveProperty("visibility");
    });

    it("skus capped at 3 data rows + 1 header", async () => {
      const manyVariants = Array.from({ length: 20 }, (_, i) => ({
        variant_ref: `v${i}`, title: `V${i}`, supplier_price: 500, offer_price: 1000, stock: 10, sku: `V${i}`,
      }));
      (provider.prepareCandidate as any).mockResolvedValueOnce({
        provider_label: "Test",
        provider_state: { import_item_id: "item-many", field_map: {} },
        draft: { title: "Many", description_html: "", images: [], tags: [], variants: manyVariants },
        warnings: [],
      });
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/many.html",
      });
      expect(result.skus[0]).toEqual(["name", "sell", "qty"]);
      expect(result.skus).toHaveLength(21); // 1 header + 20 data (compact shows all)
      expect(result.skus_more).toBeUndefined();
      expect(result.variants_count).toBe(20);
    });

    it("push response is compact", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const pushResult = await service.confirmPushToStore({ job_id: importResult.job_id });
      expect(pushResult).not.toHaveProperty("push_options_applied");
      expect(pushResult).toHaveProperty("summary");
    });

    it("warnings are truncated to 100 chars", async () => {
      const longWarning = "A".repeat(200);
      (provider.prepareCandidate as any).mockResolvedValueOnce({
        provider_label: "Test",
        provider_state: { import_item_id: "item-w", field_map: {} },
        draft: { title: "W", description_html: "", images: [], tags: [], variants: [{ variant_ref: "v1", title: "V", supplier_price: 500, offer_price: 1000, stock: 10, sku: "V" }] },
        warnings: [longWarning],
      });
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/warn.html",
      });
      expect(result.warnings[0].length).toBeLessThanOrEqual(120);
      expect(result.warnings[0]).toContain("...");
    });
  });

  // ── Visibility ──

  describe("setProductVisibility", () => {
    it("changes visibility mode", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const result = await service.setProductVisibility({
        job_id: importResult.job_id,
        visibility_mode: "sell_immediately",
      });
      expect(result.visibility_mode).toBe("sell_immediately");
    });

    it("requires both parameters", async () => {
      await expect(service.setProductVisibility({})).rejects.toThrow("required");
    });
  });

  // ── Options in preview ──

  describe("options in preview", () => {
    it("exposes options in preview when present", async () => {
      (provider.prepareCandidate as any).mockResolvedValueOnce({
        provider_label: "Test",
        provider_state: { import_item_id: "item-opt", field_map: {} },
        draft: {
          title: "Plush Toys",
          description_html: "",
          images: [],
          tags: [],
          variants: [
            { variant_ref: "v1", title: "Red", supplier_price: 200, offer_price: 500, stock: 10, sku: "R" },
            { variant_ref: "v2", title: "Blue", supplier_price: 200, offer_price: 500, stock: 10, sku: "B" },
          ],
          options: [
            { id: "1", name: "Color", values: [{ id: "r1", name: "Red" }, { id: "b1", name: "Blue" }] },
          ],
          total_inventory: 20,
        },
        warnings: [],
      });
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/opts.html",
      });
      expect(result.options).toEqual([
        { name: "Color", values: ["Red", "Blue"], values_count: 2 },
      ]);
    });

    it("omits options from preview when not present", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      expect(result).not.toHaveProperty("options");
    });
  });

  describe("pricing rule conflict detection", () => {
    it("warns when MCP pricing and DSers pricing rule both active", async () => {
      (provider.getStorePricingRule as any).mockResolvedValueOnce({ enabled: true, multiplier: 2 });
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 3 } },
      });
      const pushResult = await service.confirmPushToStore({ job_id: importResult.job_id });
      expect(pushResult.warnings).toBeDefined();
      expect(pushResult.warnings.some((w: string) => w.includes("DSers store pricing rule"))).toBe(true);
    });

    it("no warning when DSers pricing rule is disabled", async () => {
      (provider.getStorePricingRule as any).mockResolvedValueOnce({ enabled: false });
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 3 } },
      });
      const pushResult = await service.confirmPushToStore({ job_id: importResult.job_id });
      const hasConflict = (pushResult.warnings ?? []).some((w: string) => w.includes("DSers store pricing rule"));
      expect(hasConflict).toBe(false);
    });

    it("no warning when no MCP pricing rules", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const pushResult = await service.confirmPushToStore({ job_id: importResult.job_id });
      expect(provider.getStorePricingRule).not.toHaveBeenCalled();
    });

    it("no warning when pricing_rule_behavior is apply_store_pricing_rule", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 2 } },
      });
      const pushResult = await service.confirmPushToStore({
        job_id: importResult.job_id,
        push_options: { pricing_rule_behavior: "apply_store_pricing_rule" },
      });
      expect(provider.getStorePricingRule).not.toHaveBeenCalled();
    });

    it("warns when API fails to query pricing rule", async () => {
      (provider.getStorePricingRule as any).mockResolvedValueOnce({ enabled: false, _error: "HTTP 403: Forbidden" });
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 2 } },
      });
      const pushResult = await service.confirmPushToStore({ job_id: importResult.job_id });
      expect(pushResult.warnings).toBeDefined();
      expect(pushResult.warnings.some((w: string) => w.includes("Could not verify"))).toBe(true);
      expect(pushResult.warnings.some((w: string) => w.includes("HTTP 403"))).toBe(true);
    });
  });

  describe("discover returns version", () => {
    it("includes version field", async () => {
      const caps = await service.getRuleCapabilities({});
      expect(caps.version).toBeDefined();
      expect(typeof caps.version).toBe("string");
      expect(caps.version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});

describe("buildRulesFromFlatParams", () => {
  it("passes empty string as clear signal for content fields", () => {
    const rules = buildRulesFromFlatParams({ title_prefix: "" });
    expect(rules.content).toBeDefined();
    expect(rules.content.title_prefix).toBe("");
  });

  it("passes empty string for all five content fields", () => {
    const rules = buildRulesFromFlatParams({
      title_override: "",
      title_prefix: "",
      title_suffix: "",
      description_override_html: "",
      description_append_html: "",
    });
    expect(rules.content.title_override).toBe("");
    expect(rules.content.title_prefix).toBe("");
    expect(rules.content.title_suffix).toBe("");
    expect(rules.content.description_override_html).toBe("");
    expect(rules.content.description_append_html).toBe("");
  });

  it("does not include content when fields are undefined", () => {
    const rules = buildRulesFromFlatParams({});
    expect(rules.content).toBeUndefined();
  });

  it("builds pricing rules normally", () => {
    const rules = buildRulesFromFlatParams({
      pricing_mode: "multiplier",
      pricing_multiplier: 2.5,
    });
    expect(rules.pricing).toEqual({ mode: "multiplier", multiplier: 2.5 });
  });

  it("combines pricing and content", () => {
    const rules = buildRulesFromFlatParams({
      pricing_mode: "fixed_markup",
      pricing_fixed_markup: 5,
      title_prefix: "NEW: ",
    });
    expect(rules.pricing.mode).toBe("fixed_markup");
    expect(rules.content.title_prefix).toBe("NEW: ");
  });
});
