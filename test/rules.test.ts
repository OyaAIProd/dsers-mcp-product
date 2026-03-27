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
      mkDraft([mkV(400, 1000)]),
      { pricing: { mode: "multiplier", multiplier: 2.5 } },
    );
    expect(draft.variants[0].offer_price).toBe(1000); // 400 * 2.5
  });

  it("uses supplier_price as base for fixed_markup", () => {
    const { draft } = applyRules(
      mkDraft([mkV(400, 1000)]),
      { pricing: { mode: "fixed_markup", fixed_markup: 3.0 } },
    );
    expect(draft.variants[0].offer_price).toBe(700); // 400 + $3.00*100
  });

  it("falls back to offer_price when supplier_price is null", () => {
    const { draft } = applyRules(
      mkDraft([mkV(null, 800)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(draft.variants[0].offer_price).toBe(1600);
  });

  it("falls back to offer_price when supplier_price is 0", () => {
    const { draft } = applyRules(
      mkDraft([mkV(0, 800)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(draft.variants[0].offer_price).toBe(1600);
  });

  it("offer_price=0 + supplier_price>0 → uses supplier_price", () => {
    const { draft } = applyRules(
      mkDraft([mkV(350, 0)]),
      { pricing: { mode: "multiplier", multiplier: 2.5 } },
    );
    expect(draft.variants[0].offer_price).toBe(875);
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
  it("multiplier rounds to integer cents by default", () => {
    const { draft } = applyRules(
      mkDraft([mkV(333, 0)]),
      { pricing: { mode: "multiplier", multiplier: 3 } },
    );
    expect(draft.variants[0].offer_price).toBe(999);
  });

  it("custom round_digits works", () => {
    const { draft } = applyRules(
      mkDraft([mkV(333, 0)]),
      { pricing: { mode: "multiplier", multiplier: 1.005, round_digits: 2 } },
    );
    expect(draft.variants[0].offer_price).toBe(335);
  });

  it("multiple variants each get their own price", () => {
    const { draft } = applyRules(
      mkDraft([mkV(200, 0), mkV(500, 0), mkV(1000, 0)]),
      { pricing: { mode: "fixed_markup", fixed_markup: 1.5 } },
    );
    expect(draft.variants[0].offer_price).toBe(350);
    expect(draft.variants[1].offer_price).toBe(650);
    expect(draft.variants[2].offer_price).toBe(1150);
  });

  it("provider_default mode leaves prices unchanged", () => {
    const { draft } = applyRules(
      mkDraft([mkV(300, 800)]),
      { pricing: { mode: "provider_default" } },
    );
    expect(draft.variants[0].offer_price).toBe(800);
    expect(draft.variants[0].supplier_price).toBe(300);
  });
});

// ═══════════════════════════════════════════════════
// Idempotency (re-apply from original)
// ═══════════════════════════════════════════════════

describe("idempotency", () => {
  it("applying different multipliers to same original gives independent results", () => {
    const original = mkDraft([mkV(400, 0)]);

    const r1 = applyRules(structuredClone(original), { pricing: { mode: "multiplier", multiplier: 2 } });
    const r2 = applyRules(structuredClone(original), { pricing: { mode: "multiplier", multiplier: 3 } });

     expect(r1.draft.variants[0].offer_price).toBe(800);
     expect(r2.draft.variants[0].offer_price).toBe(1200);
  });

  it("applyRules does not mutate the input draft", () => {
    const original = mkDraft([mkV(400, 1000)]);
    const copy = structuredClone(original);
    applyRules(original, { pricing: { mode: "multiplier", multiplier: 2 } });
    expect(copy.variants[0].offer_price).toBe(1000);
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
      mkDraft([mkV(400, 0)]),
      {
        pricing: { mode: "multiplier", multiplier: 2.5 },
        content: { title_override: "New" },
        images: { keep_first_n: 1 },
      },
    );
    expect(draft.variants[0].offer_price).toBe(1000);
    expect(draft.title).toBe("New");
    expect(draft.images).toHaveLength(1);
    expect(summary.applied).toHaveLength(3);
  });

  it("summary tracks what was applied", () => {
    const { summary } = applyRules(
      mkDraft([mkV(400, 0)]),
      { pricing: { mode: "multiplier", multiplier: 2 } },
    );
    expect(summary.applied[0].rule_family).toBe("pricing");
    expect(summary.applied[0].variants_changed).toBe(1);
  });
});

// ═══════════════════════════════════════════════════
// variant_overrides
// ═══════════════════════════════════════════════════

describe("variant_overrides normalization", () => {
  it("accepts valid overrides", () => {
    const r = normalizeRules({
      variant_overrides: [
        { match: "Green", sell_price: 12.99, compare_at_price: 19.99 },
      ],
    });
    expect(r.errors).toHaveLength(0);
    expect(r.effective_rules.variant_overrides).toHaveLength(1);
    expect(r.effective_rules.variant_overrides[0].match).toBe("Green");
    expect(r.effective_rules.variant_overrides[0].sell_price).toBe(12.99);
  });

  it("rejects override without match", () => {
    const r = normalizeRules({
      variant_overrides: [{ sell_price: 10 }],
    });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-array variant_overrides", () => {
    const r = normalizeRules({
      variant_overrides: { match: "foo" },
    });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects negative sell_price", () => {
    const r = normalizeRules({
      variant_overrides: [{ match: "A", sell_price: -5 }],
    });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("rejects non-integer stock", () => {
    const r = normalizeRules({
      variant_overrides: [{ match: "A", stock: 3.5 }],
    });
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("skips empty overrides array", () => {
    const r = normalizeRules({ variant_overrides: [] });
    expect(r.errors).toHaveLength(0);
    expect(r.effective_rules.variant_overrides).toBeUndefined();
  });

  it("warns on unknown override key", () => {
    const r = normalizeRules({
      variant_overrides: [{ match: "A", sell_price: 10, unknown_field: true }],
    });
    expect(r.warnings).toContainEqual(expect.stringContaining("unknown_field"));
  });
});

describe("variant_overrides application", () => {
  it("overrides sell_price by title match", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Green Crocodile";
    draft.variants[0].sku = "14:350850";
    const { draft: result, summary } = applyRules(draft, {
      variant_overrides: [{ match: "green", sell_price: 12.99 }],
    });
    expect(result.variants[0].offer_price).toBe(1299);
    expect(summary.applied).toContainEqual(
      expect.objectContaining({ rule_family: "variant_overrides", variants_matched: 1 }),
    );
  });

  it("overrides compare_at_price", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Red Fox";
    draft.variants[0].compare_at_price = 800;
    const { draft: result } = applyRules(draft, {
      variant_overrides: [{ match: "red", compare_at_price: 19.99 }],
    });
    expect(result.variants[0].compare_at_price).toBe(1999);
  });

  it("overrides stock", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Blue Whale";
    const { draft: result } = applyRules(draft, {
      variant_overrides: [{ match: "blue", stock: 0 }],
    });
    expect(result.variants[0].stock).toBe(0);
  });

  it("overrides title", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Old Name";
    const { draft: result } = applyRules(draft, {
      variant_overrides: [{ match: "old name", title: "New Name" }],
    });
    expect(result.variants[0].title).toBe("New Name");
  });

  it("overrides image_url", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Photo Variant";
    draft.variants[0].image_url = "https://old.img/1.jpg";
    const { draft: result } = applyRules(draft, {
      variant_overrides: [{ match: "photo", image_url: "https://new.img/2.jpg" }],
    });
    expect(result.variants[0].image_url).toBe("https://new.img/2.jpg");
  });

  it("matches by sku substring", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Something";
    draft.variants[0].sku = "SKU-ABC-123";
    const { draft: result } = applyRules(draft, {
      variant_overrides: [{ match: "abc", sell_price: 5.00 }],
    });
    expect(result.variants[0].offer_price).toBe(500);
  });

  it("applied after global pricing", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Special";
    const { draft: result } = applyRules(draft, {
      pricing: { mode: "multiplier", multiplier: 2 },
      variant_overrides: [{ match: "special", sell_price: 99.99 }],
    });
    expect(result.variants[0].offer_price).toBe(9999);
  });

  it("warns when no variants matched", () => {
    const draft = mkDraft([mkV(400, 0)]);
    draft.variants[0].title = "Nothing here";
    const { summary } = applyRules(draft, {
      variant_overrides: [{ match: "nonexistent" }],
    });
    expect(summary.warnings).toContainEqual(expect.stringContaining("no variants matched"));
  });

  it("multiple overrides can target different variants", () => {
    const draft = mkDraft([mkV(400, 0), mkV(600, 0)]);
    draft.variants[0].title = "Green";
    draft.variants[1].title = "Red";
    const { draft: result, summary } = applyRules(draft, {
      variant_overrides: [
        { match: "green", sell_price: 10.00 },
        { match: "red", sell_price: 15.00 },
      ],
    });
    expect(result.variants[0].offer_price).toBe(1000);
    expect(result.variants[1].offer_price).toBe(1500);
    expect(summary.applied).toContainEqual(
      expect.objectContaining({ rule_family: "variant_overrides", variants_matched: 2 }),
    );
  });
});

describe("image rules — add_urls, reorder, drop warnings, URL validation", () => {
  it("add_urls appends new images", () => {
    const { draft, summary } = applyRules(
      mkDraft([mkV(100, 200)]),
      { images: { add_urls: ["https://example.com/new1.jpg", "https://example.com/new2.jpg"] } },
    );
    expect(draft.images).toEqual(["img1.jpg", "img2.jpg", "img3.jpg", "https://example.com/new1.jpg", "https://example.com/new2.jpg"]);
    expect(summary.applied).toContainEqual(expect.objectContaining({ rule_family: "images", images_added: 2 }));
  });

  it("add_urls rejected if not http/https", () => {
    const caps = { images: { supported: ["add_urls"] } };
    const result = normalizeRules({ images: { add_urls: ["ftp://bad.jpg", "not-a-url"] } }, caps);
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.errors![0]).toMatch(/not a valid URL/);
  });

  it("reorder rearranges images", () => {
    const { draft } = applyRules(
      mkDraft([mkV(100, 200)]),
      { images: { reorder: [2, 0, 1] } },
    );
    expect(draft.images).toEqual(["img3.jpg", "img1.jpg", "img2.jpg"]);
  });

  it("reorder with partial indexes — unlisted images appended", () => {
    const { draft } = applyRules(
      mkDraft([mkV(100, 200)]),
      { images: { reorder: [2] } },
    );
    expect(draft.images).toEqual(["img3.jpg", "img1.jpg", "img2.jpg"]);
  });

  it("pipeline order: drop → reorder → add → truncate", () => {
    const { draft } = applyRules(
      mkDraft([mkV(100, 200)]),
      {
        images: {
          drop_indexes: [1],
          reorder: [1, 0],
          add_urls: ["https://example.com/extra.jpg"],
          keep_first_n: 3,
        },
      },
    );
    expect(draft.images).toEqual(["img3.jpg", "img1.jpg", "https://example.com/extra.jpg"]);
  });

  it("drop_indexes out-of-range generates warning", () => {
    const { summary } = applyRules(
      mkDraft([mkV(100, 200)]),
      { images: { drop_indexes: [0, 99] } },
    );
    expect(summary.warnings).toContainEqual(expect.stringContaining("index 99 is out of range"));
  });

  it("reorder out-of-range generates warning", () => {
    const { summary } = applyRules(
      mkDraft([mkV(100, 200)]),
      { images: { reorder: [0, 50] } },
    );
    expect(summary.warnings).toContainEqual(expect.stringContaining("index 50 is out of range"));
  });

  it("variant_overrides image_url requires http/https", () => {
    const caps = { variant_overrides: { supported: ["image_url"] } };
    const result = normalizeRules({
      variant_overrides: [{ match: "v1", image_url: "data:image/png;base64,abc" }],
    }, caps);
    expect(result.errors?.length).toBeGreaterThan(0);
    expect(result.errors![0]).toMatch(/must be a valid URL/);
  });

  it("variant_overrides image_url accepts https", () => {
    const caps = { variant_overrides: { supported: ["image_url"] } };
    const result = normalizeRules({
      variant_overrides: [{ match: "v1", image_url: "https://cdn.example.com/photo.jpg" }],
    }, caps);
    expect(result.errors ?? []).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════
// option_edits
// ═══════════════════════════════════════════════════

function mkOptDraft() {
  return mkDraft(
    [
      {
        variant_ref: "14:350850#Green Crocodile",
        title: "Green Crocodile",
        offer_price: 500,
        supplier_price: 200,
        sku: "GC-001",
        stock: 10,
        option_values: [
          { optionId: "14", optionName: "Color", valueId: "350850", valueName: "Green Crocodile" },
        ],
      },
      {
        variant_ref: "14:350851#Pig",
        title: "Pig",
        offer_price: 600,
        supplier_price: 300,
        sku: "PG-001",
        stock: 5,
        option_values: [
          { optionId: "14", optionName: "Color", valueId: "350851", valueName: "Pig" },
        ],
      },
      {
        variant_ref: "14:350852#Whale",
        title: "Whale",
        offer_price: 700,
        supplier_price: 350,
        sku: "WH-001",
        stock: 20,
        option_values: [
          { optionId: "14", optionName: "Color", valueId: "350852", valueName: "Whale" },
        ],
      },
    ],
    {
      options: [
        {
          id: "14",
          name: "Color",
          values: [
            { id: "350850", name: "Green Crocodile" },
            { id: "350851", name: "Pig" },
            { id: "350852", name: "Whale" },
          ],
        },
      ],
      total_inventory: 35,
    },
  );
}

describe("option_edits — normalize", () => {
  it("rejects non-array", () => {
    const result = normalizeRules({ option_edits: "not array" });
    expect(result.errors).toContainEqual(expect.stringContaining("must be an array"));
  });

  it("rejects unknown action", () => {
    const result = normalizeRules({ option_edits: [{ action: "explode", option_name: "Color" }] });
    expect(result.errors).toContainEqual(expect.stringContaining("unknown action"));
  });

  it("rejects missing option_name", () => {
    const result = normalizeRules({ option_edits: [{ action: "rename_option", new_name: "X" }] });
    expect(result.errors).toContainEqual(expect.stringContaining("option_name"));
  });

  it("rejects remove_value without value_name", () => {
    const result = normalizeRules({ option_edits: [{ action: "remove_value", option_name: "Color" }] });
    expect(result.errors).toContainEqual(expect.stringContaining("value_name"));
  });

  it("rejects rename_option without new_name", () => {
    const result = normalizeRules({ option_edits: [{ action: "rename_option", option_name: "Color" }] });
    expect(result.errors).toContainEqual(expect.stringContaining("new_name"));
  });

  it("rejects rename_value without new_name", () => {
    const result = normalizeRules({
      option_edits: [{ action: "rename_value", option_name: "Color", value_name: "Pig" }],
    });
    expect(result.errors).toContainEqual(expect.stringContaining("new_name"));
  });

  it("accepts valid rename_option", () => {
    const result = normalizeRules({
      option_edits: [{ action: "rename_option", option_name: "Color", new_name: "Style" }],
    });
    expect(result.errors ?? []).toHaveLength(0);
    expect(result.effective_rules.option_edits).toHaveLength(1);
  });

  it("accepts valid remove_value", () => {
    const result = normalizeRules({
      option_edits: [{ action: "remove_value", option_name: "Color", value_name: "Pig" }],
    });
    expect(result.errors ?? []).toHaveLength(0);
    expect(result.effective_rules.option_edits).toHaveLength(1);
  });
});

describe("option_edits — apply", () => {
  it("rename_option changes option name and variant option_values", () => {
    const { draft, summary } = applyRules(
      mkOptDraft(),
      { option_edits: [{ action: "rename_option", option_name: "Color", new_name: "Style" }] },
    );
    expect(draft.options[0].name).toBe("Style");
    expect(draft.variants[0].option_values[0].optionName).toBe("Style");
    expect(summary.applied).toContainEqual(expect.objectContaining({ rule_family: "option_edits" }));
  });

  it("rename_value changes value name and rebuilds variant title", () => {
    const { draft } = applyRules(
      mkOptDraft(),
      { option_edits: [{ action: "rename_value", option_name: "Color", value_name: "Green Crocodile", new_name: "Forest Green" }] },
    );
    expect(draft.options[0].values[0].name).toBe("Forest Green");
    expect(draft.variants[0].option_values[0].valueName).toBe("Forest Green");
    expect(draft.variants[0].title).toBe("Forest Green");
  });

  it("remove_value deletes matching variants and recalculates total_inventory", () => {
    const { draft, summary } = applyRules(
      mkOptDraft(),
      { option_edits: [{ action: "remove_value", option_name: "Color", value_name: "Pig" }] },
    );
    expect(draft.variants).toHaveLength(2);
    expect(draft.variants.map((v: any) => v.title)).toEqual(["Green Crocodile", "Whale"]);
    expect(draft.options[0].values).toHaveLength(2);
    expect(draft.options[0].values.map((v: any) => v.name)).toEqual(["Green Crocodile", "Whale"]);
    expect(draft.total_inventory).toBe(30);
    const optEdit = summary.applied.find((a: any) => a.rule_family === "option_edits");
    expect(optEdit.variants_removed).toBe(1);
    expect(optEdit.variants_remaining).toBe(2);
  });

  it("remove_option removes option dimension but keeps variants", () => {
    const { draft } = applyRules(
      mkOptDraft(),
      { option_edits: [{ action: "remove_option", option_name: "Color" }] },
    );
    expect(draft.options).toHaveLength(0);
    expect(draft.variants).toHaveLength(3);
    for (const v of draft.variants) {
      expect(v.option_values).toHaveLength(0);
    }
  });

  it("warns when option_name not found", () => {
    const { summary } = applyRules(
      mkOptDraft(),
      { option_edits: [{ action: "rename_option", option_name: "Size", new_name: "Dimension" }] },
    );
    expect(summary.warnings).toContainEqual(expect.stringContaining("'Size' not found"));
  });

  it("warns when value_name not found", () => {
    const { summary } = applyRules(
      mkOptDraft(),
      { option_edits: [{ action: "remove_value", option_name: "Color", value_name: "Unicorn" }] },
    );
    expect(summary.warnings).toContainEqual(expect.stringContaining("'Unicorn' not found"));
  });

  it("multiple edits in sequence", () => {
    const { draft } = applyRules(
      mkOptDraft(),
      {
        option_edits: [
          { action: "rename_value", option_name: "Color", value_name: "Green Crocodile", new_name: "Croc" },
          { action: "remove_value", option_name: "Color", value_name: "Pig" },
        ],
      },
    );
    expect(draft.variants).toHaveLength(2);
    expect(draft.variants[0].title).toBe("Croc");
    expect(draft.options[0].values.map((v: any) => v.name)).toEqual(["Croc", "Whale"]);
  });

  it("remove_value removes all variants using that value even with multi-option products", () => {
    const multiOptDraft = {
      ...mkDraft([
        {
          variant_ref: "v1", title: "Red / S", offer_price: 500, supplier_price: 200, sku: "RS", stock: 5,
          option_values: [
            { optionId: "1", optionName: "Color", valueId: "r1", valueName: "Red" },
            { optionId: "2", optionName: "Size", valueId: "s1", valueName: "S" },
          ],
        },
        {
          variant_ref: "v2", title: "Red / M", offer_price: 500, supplier_price: 200, sku: "RM", stock: 5,
          option_values: [
            { optionId: "1", optionName: "Color", valueId: "r1", valueName: "Red" },
            { optionId: "2", optionName: "Size", valueId: "m1", valueName: "M" },
          ],
        },
        {
          variant_ref: "v3", title: "Blue / S", offer_price: 500, supplier_price: 200, sku: "BS", stock: 5,
          option_values: [
            { optionId: "1", optionName: "Color", valueId: "b1", valueName: "Blue" },
            { optionId: "2", optionName: "Size", valueId: "s1", valueName: "S" },
          ],
        },
      ]),
      options: [
        { id: "1", name: "Color", values: [{ id: "r1", name: "Red" }, { id: "b1", name: "Blue" }] },
        { id: "2", name: "Size", values: [{ id: "s1", name: "S" }, { id: "m1", name: "M" }] },
      ],
      total_inventory: 15,
    };
    const { draft } = applyRules(multiOptDraft, {
      option_edits: [{ action: "remove_value", option_name: "Color", value_name: "Red" }],
    });
    expect(draft.variants).toHaveLength(1);
    expect(draft.variants[0].title).toBe("Blue / S");
    expect(draft.total_inventory).toBe(5);
  });

  it("option_edits with empty draft.options does nothing gracefully", () => {
    const plainDraft = mkDraft([mkV(100, 200)]);
    const { draft, summary } = applyRules(plainDraft, {
      option_edits: [{ action: "rename_option", option_name: "Color", new_name: "Style" }],
    });
    expect(draft.variants).toHaveLength(1);
    expect(summary.warnings).toContainEqual(expect.stringContaining("not found"));
  });
});
