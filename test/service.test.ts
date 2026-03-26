import { describe, it, expect, vi, beforeEach } from "vitest";
import { ImportFlowService } from "../src/service.js";
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
          { variant_ref: "v1", title: "Red", supplier_price: 5.0, offer_price: 10.0, stock: 50, sku: "RED" },
          { variant_ref: "v2", title: "Blue", supplier_price: 6.0, offer_price: 12.0, stock: 30, sku: "BLUE" },
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
    fetchImportItem: vi.fn().mockResolvedValue({ data: {} }),
    normalizeForRecovery: vi.fn().mockReturnValue([
      {
        title: "Recovered",
        description_html: "",
        images: [],
        tags: [],
        variants: [{ variant_ref: "v1", title: "V1", supplier_price: 5, offer_price: 10, stock: 10, sku: "V1" }],
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
      expect(result.title_after).toBe("Test Product");
      expect(result.variant_count).toBe(2);
    });

    it("applies pricing rules during import", async () => {
      const result = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
        rules: { pricing: { mode: "multiplier", multiplier: 3 } },
      });
      expect(result.price_range_after.min).toBe(15);
      expect(result.price_range_after.max).toBe(18);
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
      expect(preview.title_after).toBe("Test Product");
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

      expect(reapplied.price_range_after.min).toBe(10);
      expect(reapplied.price_range_after.max).toBe(12);
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

      expect(reapplied.price_range_after.min).toBe(15);
      expect(reapplied.price_range_after.max).toBe(18);
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
          variants: [{ variant_ref: "v1", title: "V", supplier_price: 5, offer_price: 0, stock: 10, sku: "V" }],
        },
        warnings: [],
      });

      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/999.html",
      });
      await expect(
        service.confirmPushToStore({ job_id: importResult.job_id }),
      ).rejects.toThrow("Push blocked by safety check");
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
          variants: [{ variant_ref: "v1", title: "V", supplier_price: 5, offer_price: 0, stock: 10, sku: "V" }],
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
    it("returns job status", async () => {
      const importResult = await service.prepareImportCandidate({
        source_url: "https://www.aliexpress.com/item/1234567890.html",
      });
      const status = await service.getJobStatus({ job_id: importResult.job_id });
      expect(status.job_id).toBe(importResult.job_id);
      expect(status.status).toBe("preview_ready");
    });

    it("requires job_id", async () => {
      await expect(service.getJobStatus({})).rejects.toThrow("job_id is required");
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
});
