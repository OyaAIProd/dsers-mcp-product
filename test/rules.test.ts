import { describe, it, expect } from "vitest";
import { applyRules, normalizeRules } from "../src/rules.js";

function mkDraft(variants: Record<string, any>[], extra: Record<string, any> = {}) {
  return {
    title: "Original Title",
    description_html: "<p>Original</p>",
    tags: ["existing"],
    images: ["img1.jpg", "img2.jpg", "img3.jpg"],
    variants,
    ...extra,
  };
}

function mkV(supplier: number | null, offer: number | null, title = "V") {
  return { variant_ref: title, title, supplier_price: supplier, offer_price: offer, sku: title, stock: 10 };
}

// ═══════════════════════════════════════════════════
// Pricing base field (_costPrice)
// ═══════════════════════════════════════════════════

describe("pricing base field", () => {
  it("uses supplier_price as base for multiplier", () => {
    const { draft } = applyRules(
      mkDraft([mkV(4.0, 10.0)]),
      { pricing: { mode: "multiplier", multiplier: 2.5 } },
    );
    expect(draft.variants[0].offer_price).toBe(10.0); // 4.0 * 2.5
  });

  it("uses supplier_price as base for fixed_markup", () => {
    const { draft } = applyRules(
      mkDraft([mkV(4.0, 10.0)]),
      { pricing: { mode: "fixed_markup", fixed_markup: 3.0 } },
    );
    expect(draft.variants[0].offer_price).toBe(7.0); // 4.0 + 3.0
  });

  it("falls back to offer_price when supplier_price is null", () => {
    const { draft } = applyRules(
      mkDraft([mkV(null, 8.0)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(draft.variants[0].offer_price).toBe(16.0);
  });

  it("falls back to offer_price when supplier_price is 0", () => {
    const { draft } = applyRules(
      mkDraft([mkV(0, 8.0)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(draft.variants[0].offer_price).toBe(16.0);
  });

  it("offer_price=0 + supplier_price>0 → uses supplier_price", () => {
    const { draft } = applyRules(
      mkDraft([mkV(3.5, 0)]),
      { pricing: { mode: "multiplier", multiplier: 2.5 } },
    );
    expect(draft.variants[0].offer_price).toBe(8.75);
  });

  it("both null → variant skipped", () => {
    const { draft } = applyRules(
      mkDraft([mkV(null, null)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(draft.variants[0].offer_price).toBeNull();
  });

  it("both 0 → variant skipped", () => {
    const { draft } = applyRules(
      mkDraft([mkV(0, 0)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(draft.variants[0].offer_price).toBe(0);
  });
});

// ═══════════════════════════════════════════════════
// Pricing accuracy
// ═══════════════════════════════════════════════════

describe("pricing accuracy", () => {
  it("multiplier rounds to 2 digits by default", () => {
    const { draft } = applyRules(
      mkDraft([mkV(3.33, 0)]),
      { pricing: { mode: "multiplier", multiplier: 3 } },
    );
    expect(draft.variants[0].offer_price).toBe(9.99);
  });

  it("custom round_digits works", () => {
    const { draft } = applyRules(
      mkDraft([mkV(3.333, 0)]),
      { pricing: { mode: "multiplier", multiplier: 3, round_digits: 0 } },
    );
    expect(draft.variants[0].offer_price).toBe(10);
  });

  it("multiple variants each get their own price", () => {
    const { draft } = applyRules(
      mkDraft([mkV(2.0, 0), mkV(5.0, 0), mkV(10.0, 0)]),
      { pricing: { mode: "fixed_markup", fixed_markup: 1.5 } },
    );
    expect(draft.variants[0].offer_price).toBe(3.5);
    expect(draft.variants[1].offer_price).toBe(6.5);
    expect(draft.variants[2].offer_price).toBe(11.5);
  });

  it("provider_default mode leaves prices unchanged", () => {
    const { draft } = applyRules(
      mkDraft([mkV(3.0, 8.0)]),
      { pricing: { mode: "provider_default" } },
    );
    expect(draft.variants[0].offer_price).toBe(8.0);
    expect(draft.variants[0].supplier_price).toBe(3.0);
  });
});

// ═══════════════════════════════════════════════════
// Idempotency (re-apply from original)
// ═══════════════════════════════════════════════════

describe("idempotency", () => {
  it("applying different multipliers to same original gives independent results", () => {
    const original = mkDraft([mkV(4.0, 0)]);

    const r1 = applyRules(structuredClone(original), { pricing: { mode: "multiplier", multiplier: 2 } });
    const r2 = applyRules(structuredClone(original), { pricing: { mode: "multiplier", multiplier: 3 } });

    expect(r1.draft.variants[0].offer_price).toBe(8.0);
    expect(r2.draft.variants[0].offer_price).toBe(12.0);
  });

  it("applyRules does not mutate the input draft", () => {
    const original = mkDraft([mkV(4.0, 10.0)]);
    const copy = structuredClone(original);
    applyRules(original, { pricing: { mode: "multiplier", multiplier: 2 } });
    expect(copy.variants[0].offer_price).toBe(10.0);
  });
});

// ═══════════════════════════════════════════════════
// Content rules
// ═══════════════════════════════════════════════════

describe("content rules", () => {
  it("title_override replaces title", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { content: { title_override: "New Title" } },
    );
    expect(draft.title).toBe("New Title");
  });

  it("title_prefix prepends", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { content: { title_prefix: "[US] " } },
    );
    expect(draft.title).toBe("[US] Original Title");
  });

  it("title_suffix appends", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { content: { title_suffix: " | Free Ship" } },
    );
    expect(draft.title).toBe("Original Title | Free Ship");
  });

  it("description_override_html replaces", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { content: { description_override_html: "<p>New</p>" } },
    );
    expect(draft.description_html).toBe("<p>New</p>");
  });

  it("description_append_html appends", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { content: { description_append_html: "<p>Extra</p>" } },
    );
    expect(draft.description_html).toBe("<p>Original</p><p>Extra</p>");
  });

  it("tags_add adds without duplicates", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { content: { tags_add: ["existing", "new-tag"] } },
    );
    expect(draft.tags).toEqual(["existing", "new-tag"]);
  });
});

// ═══════════════════════════════════════════════════
// Image rules
// ═══════════════════════════════════════════════════

describe("image rules", () => {
  it("keep_first_n truncates", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { images: { keep_first_n: 2 } },
    );
    expect(draft.images).toHaveLength(2);
  });

  it("drop_indexes removes specific images", () => {
    const { draft } = applyRules(
      mkDraft([mkV(1, 1)]),
      { images: { drop_indexes: [1] } },
    );
    expect(draft.images).toEqual(["img1.jpg", "img3.jpg"]);
  });
});

// ═══════════════════════════════════════════════════
// normalizeRules validation
// ═══════════════════════════════════════════════════

describe("normalizeRules validation", () => {
  it("rejects multiplier=0", () => {
    const r = normalizeRules({ pricing: { mode: "multiplier", multiplier: 0 } });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects multiplier=-2", () => {
    const r = normalizeRules({ pricing: { mode: "multiplier", multiplier: -2 } });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects fixed_markup=-5", () => {
    const r = normalizeRules({ pricing: { mode: "fixed_markup", fixed_markup: -5 } });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects round_digits=100", () => {
    const r = normalizeRules({ pricing: { mode: "multiplier", multiplier: 2, round_digits: 100 } });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects round_digits=-1", () => {
    const r = normalizeRules({ pricing: { mode: "multiplier", multiplier: 2, round_digits: -1 } });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("accepts valid multiplier", () => {
    const r = normalizeRules({ pricing: { mode: "multiplier", multiplier: 2.5 } });
    expect(r.errors).toHaveLength(0);
    expect(r.effective_rules.pricing.multiplier).toBe(2.5);
  });

  it("accepts fixed_markup=0 (free add-on)", () => {
    const r = normalizeRules({ pricing: { mode: "fixed_markup", fixed_markup: 0 } });
    expect(r.errors).toHaveLength(0);
  });

  it("rejects unknown pricing mode", () => {
    const r = normalizeRules({ pricing: { mode: "discount" } });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("warns on unknown rule keys", () => {
    const r = normalizeRules({ pricing: { mode: "multiplier", multiplier: 2, unknown_key: true } });
    expect(r.warnings).toContainEqual(expect.stringContaining("unknown_key"));
  });

  it("empty rules → no errors", () => {
    const r = normalizeRules({});
    expect(r.errors).toHaveLength(0);
    expect(r.effective_rules).toEqual({});
  });
});

// ═══════════════════════════════════════════════════
// Combined rules
// ═══════════════════════════════════════════════════

describe("combined rules", () => {
  it("all three families applied together", () => {
    const { draft, summary } = applyRules(
      mkDraft([mkV(4.0, 0)]),
      {
        pricing: { mode: "multiplier", multiplier: 2.5 },
        content: { title_override: "New" },
        images: { keep_first_n: 1 },
      },
    );
    expect(draft.variants[0].offer_price).toBe(10.0);
    expect(draft.title).toBe("New");
    expect(draft.images).toHaveLength(1);
    expect(summary.applied).toHaveLength(3);
  });

  it("summary tracks what was applied", () => {
    const { summary } = applyRules(
      mkDraft([mkV(4.0, 0)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(summary.applied[0].rule_family).toBe("pricing");
    expect(summary.applied[0].variants_changed).toBe(1);
  });
});
