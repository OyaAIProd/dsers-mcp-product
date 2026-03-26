const KNOWN_TOP_LEVEL_RULE_KEYS = new Set(["pricing", "content", "images", "variant_overrides", "option_edits", "instruction_text"]);
const KNOWN_PRICING_KEYS = new Set(["mode", "multiplier", "fixed_markup", "round_digits"]);
const KNOWN_CONTENT_KEYS = new Set([
  "title_override",
  "title_prefix",
  "title_suffix",
  "description_override_html",
  "description_append_html",
  "tags_add",
]);
const KNOWN_IMAGE_KEYS = new Set(["keep_first_n", "drop_indexes", "add_urls", "reorder", "translate_image_text", "remove_logo"]);
const DEFAULT_PRICING_MODES = new Set(["provider_default", "multiplier", "fixed_markup"]);

function _allowedRuleKeys(capability: Record<string, any> | undefined, defaultKeys: Set<string>): Set<string> {
  const cap = capability ?? {};
  const supported = cap.supported;
  const unsupported = new Set((cap.unsupported ?? []).map((x: any) => String(x)));
  let allowed: Set<string>;
  if (Array.isArray(supported)) {
    allowed = new Set(supported.map(String));
  } else if (supported === false) {
    allowed = new Set();
  } else {
    allowed = new Set(defaultKeys);
  }
  for (const u of unsupported) allowed.delete(String(u));
  return allowed;
}

function _asFloat(value: any, def: number | null): number | null {
  if (value == null || value === "") return def;
  const n = Number(value);
  return Number.isFinite(n) ? n : def;
}

function _normalizePricing(
  pricing: any,
  capability: Record<string, any> | undefined,
  warnings: string[],
  errors: string[],
): Record<string, any> {
  if (pricing == null || (typeof pricing === "object" && Object.keys(pricing).length === 0)) return {};
  if (typeof pricing !== "object") {
    errors.push("pricing must be an object when provided.");
    return {};
  }
  const cap = capability ?? {};
  if (cap.supported === false) {
    warnings.push("Pricing rules were ignored because the current provider does not support pricing edits.");
    return {};
  }
  const mode = String(pricing.mode ?? "provider_default");
  if (!DEFAULT_PRICING_MODES.has(mode)) {
    errors.push(`Unsupported pricing.mode '${mode}'. Valid modes: ${[...DEFAULT_PRICING_MODES].join(", ")}.`);
    return {};
  }
  const allowedModes = new Set(cap.modes ?? DEFAULT_PRICING_MODES);
  if (!allowedModes.has(mode)) {
    warnings.push(`Pricing mode '${mode}' is not supported by the current provider and was ignored.`);
    return {};
  }
  for (const k of Object.keys(pricing).sort()) {
    if (!KNOWN_PRICING_KEYS.has(k)) warnings.push(`Unknown pricing rule key '${k}' was ignored.`);
  }
  const normalized: Record<string, any> = { mode };
  if (mode === "multiplier") {
    const multiplier = _asFloat(pricing.multiplier, null);
    if (multiplier == null) {
      errors.push("pricing.multiplier must be a number when pricing.mode='multiplier'.");
      return {};
    }
    if (multiplier <= 0) {
      errors.push("pricing.multiplier must be greater than 0.");
      return {};
    }
    normalized.multiplier = multiplier;
  } else if (mode === "fixed_markup") {
    const markup = _asFloat(pricing.fixed_markup, null);
    if (markup == null) {
      errors.push("pricing.fixed_markup must be a number when pricing.mode='fixed_markup'.");
      return {};
    }
    if (markup < 0) {
      errors.push("pricing.fixed_markup must be >= 0.");
      return {};
    }
    normalized.fixed_markup = markup;
  }
  if (mode !== "provider_default") {
    const rd = pricing.round_digits ?? 0;
    const roundDigits = Number.isInteger(rd) ? rd : parseInt(String(rd), 10);
    if (Number.isNaN(roundDigits) || roundDigits < 0 || roundDigits > 10) {
      errors.push("pricing.round_digits must be an integer between 0 and 10.");
      return {};
    }
    normalized.round_digits = roundDigits;
  }
  return normalized;
}

function _normalizeContent(
  content: any,
  capability: Record<string, any> | undefined,
  warnings: string[],
  errors: string[],
): Record<string, any> {
  if (content == null || (typeof content === "object" && Object.keys(content).length === 0)) return {};
  if (typeof content !== "object") {
    errors.push("content must be an object when provided.");
    return {};
  }
  const allowedKeys = _allowedRuleKeys(capability, KNOWN_CONTENT_KEYS);
  const normalized: Record<string, any> = {};
  for (const key of Object.keys(content).sort()) {
    if (!KNOWN_CONTENT_KEYS.has(key)) {
      warnings.push(`Unknown content rule key '${key}' was ignored.`);
      continue;
    }
    if (!allowedKeys.has(key)) {
      warnings.push(`Content rule '${key}' is not supported by the current provider and was ignored.`);
      continue;
    }
    const value = content[key];
    if (key === "tags_add") {
      if (value == null || (Array.isArray(value) && value.length === 0)) continue;
      if (!Array.isArray(value)) {
        errors.push("content.tags_add must be an array of strings when provided.");
        continue;
      }
      const tags: string[] = [];
      for (const raw of value) {
        const tag = String(raw).trim();
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
      if (tags.length) normalized[key] = tags;
      continue;
    }
    if (value != null && value !== "") normalized[key] = String(value);
  }
  return normalized;
}

function _normalizeImages(
  images: any,
  capability: Record<string, any> | undefined,
  warnings: string[],
  errors: string[],
): Record<string, any> {
  if (images == null || (typeof images === "object" && Object.keys(images).length === 0)) return {};
  if (typeof images !== "object") {
    errors.push("images must be an object when provided.");
    return {};
  }
  const allowedKeys = _allowedRuleKeys(capability, KNOWN_IMAGE_KEYS);
  const normalized: Record<string, any> = {};
  for (const key of Object.keys(images).sort()) {
    if (!KNOWN_IMAGE_KEYS.has(key)) {
      warnings.push(`Unknown image rule key '${key}' was ignored.`);
      continue;
    }
    if (!allowedKeys.has(key)) {
      warnings.push(`Image rule '${key}' is not supported by the current provider and was ignored.`);
      continue;
    }
    const value = images[key];
    if (key === "keep_first_n") {
      if (value == null) continue;
      const n = Number(value);
      const keepFirstN = Number.isInteger(n) ? n : parseInt(String(value), 10);
      if (Number.isNaN(keepFirstN)) {
        errors.push("images.keep_first_n must be an integer when provided.");
        continue;
      }
      if (keepFirstN < 0) {
        errors.push("images.keep_first_n must be >= 0.");
        continue;
      }
      normalized[key] = keepFirstN;
      continue;
    }
    if (key === "drop_indexes") {
      if (value == null || (Array.isArray(value) && value.length === 0)) continue;
      if (!Array.isArray(value)) {
        errors.push("images.drop_indexes must be an array of integers when provided.");
        continue;
      }
      const indexes: number[] = [];
      for (const raw of value) {
        const idx = Number(raw);
        const i = Number.isInteger(idx) ? idx : parseInt(String(raw), 10);
        if (Number.isNaN(i)) {
          errors.push("images.drop_indexes must contain only integers.");
          indexes.length = 0;
          break;
        }
        if (i >= 0 && !indexes.includes(i)) indexes.push(i);
      }
      if (indexes.length) normalized[key] = [...indexes].sort((a, b) => a - b);
      continue;
    }
    if (key === "add_urls") {
      if (value == null || (Array.isArray(value) && value.length === 0)) continue;
      if (!Array.isArray(value)) {
        errors.push("images.add_urls must be an array of URL strings.");
        continue;
      }
      const urls: string[] = [];
      for (const raw of value) {
        const url = String(raw ?? "").trim();
        if (!url) continue;
        if (!/^https?:\/\//i.test(url)) {
          errors.push(`images.add_urls: "${url.slice(0, 60)}" is not a valid URL (must start with http:// or https://).`);
          urls.length = 0;
          break;
        }
        urls.push(url);
      }
      if (urls.length) normalized[key] = urls;
      continue;
    }
    if (key === "reorder") {
      if (value == null || (Array.isArray(value) && value.length === 0)) continue;
      if (!Array.isArray(value)) {
        errors.push("images.reorder must be an array of index numbers representing the new order.");
        continue;
      }
      const order: number[] = [];
      for (const raw of value) {
        const i = Number(raw);
        if (!Number.isInteger(i) || i < 0) {
          errors.push("images.reorder must contain only non-negative integers.");
          order.length = 0;
          break;
        }
        order.push(i);
      }
      if (order.length) normalized[key] = order;
      continue;
    }
    normalized[key] = Boolean(value);
  }
  return normalized;
}

const KNOWN_VARIANT_OVERRIDE_KEYS = new Set([
  "match", "sell_price", "compare_at_price", "stock", "title", "image_url",
]);

function _normalizeVariantOverrides(
  overrides: any,
  warnings: string[],
  errors: string[],
): Record<string, any>[] | null {
  if (overrides == null) return null;
  if (!Array.isArray(overrides)) {
    errors.push("variant_overrides must be an array of objects, each with a 'match' field.");
    return null;
  }
  if (!overrides.length) return null;
  const result: Record<string, any>[] = [];
  for (let i = 0; i < overrides.length; i++) {
    const entry = overrides[i];
    if (!entry || typeof entry !== "object") {
      warnings.push(`variant_overrides[${i}] is not an object and was skipped.`);
      continue;
    }
    const match = String(entry.match ?? "").trim();
    if (!match) {
      errors.push(`variant_overrides[${i}].match is required (variant title or SKU substring to match).`);
      continue;
    }
    const normalized: Record<string, any> = { match };
    for (const key of Object.keys(entry).sort()) {
      if (!KNOWN_VARIANT_OVERRIDE_KEYS.has(key)) {
        warnings.push(`Unknown variant_overrides key '${key}' at index ${i} was ignored.`);
        continue;
      }
      if (key === "match") continue;
      if (key === "sell_price" || key === "compare_at_price") {
        const val = _asFloat(entry[key], null);
        if (val == null || val < 0) {
          errors.push(`variant_overrides[${i}].${key} must be a non-negative number (in dollars).`);
          continue;
        }
        normalized[key] = val;
      } else if (key === "stock") {
        const val = _asFloat(entry[key], null);
        if (val == null || val < 0 || !Number.isInteger(val)) {
          errors.push(`variant_overrides[${i}].stock must be a non-negative integer.`);
          continue;
        }
        normalized[key] = val;
      } else if (key === "title") {
        const sv = String(entry[key] ?? "").trim();
        if (sv) normalized[key] = sv;
      } else if (key === "image_url") {
        const sv = String(entry[key] ?? "").trim();
        if (sv) {
          if (!/^https?:\/\//i.test(sv)) {
            errors.push(`variant_overrides[${i}].image_url must be a valid URL starting with http:// or https://.`);
            continue;
          }
          normalized[key] = sv;
        }
      }
    }
    if (Object.keys(normalized).length > 1) result.push(normalized);
  }
  return result.length ? result : null;
}

export function normalizeRules(
  rules: Record<string, any>,
  ruleCapabilities?: Record<string, any>,
): { requested_rules: Record<string, any>; effective_rules: Record<string, any>; warnings: string[]; errors: string[] } {
  const requested = structuredClone(rules ?? {});
  const warnings: string[] = [];
  const errors: string[] = [];
  const effective: Record<string, any> = {};

  if (requested != null && (typeof requested !== "object" || Array.isArray(requested))) {
    return { requested_rules: requested, effective_rules: {}, warnings: [], errors: ["rules must be an object"] };
  }
  const req = typeof requested === "object" ? requested : {};
  const caps = ruleCapabilities ?? {};

  for (const key of Object.keys(req).sort()) {
    if (!KNOWN_TOP_LEVEL_RULE_KEYS.has(key)) warnings.push(`Unknown top-level rule key '${key}' was ignored.`);
  }

  const pricing = _normalizePricing(req.pricing, caps.pricing, warnings, errors);
  if (Object.keys(pricing).length) effective.pricing = pricing;

  const content = _normalizeContent(req.content, caps.content, warnings, errors);
  if (Object.keys(content).length) effective.content = content;

  const images = _normalizeImages(req.images, caps.images, warnings, errors);
  if (Object.keys(images).length) effective.images = images;

  const variantOverrides = _normalizeVariantOverrides(req.variant_overrides, warnings, errors);
  if (variantOverrides) effective.variant_overrides = variantOverrides;

  const optionEdits = _normalizeOptionEdits(req.option_edits, warnings, errors);
  if (optionEdits) effective.option_edits = optionEdits;

  const instructionText = req.instruction_text;
  if (instructionText != null && instructionText !== "") {
    if (typeof instructionText === "string") {
      effective.instruction_text = instructionText;
      warnings.push(
        "instruction_text is stored in the rule snapshot for operator context, but only structured rules are applied automatically.",
      );
    } else {
      errors.push("instruction_text must be a string when provided.");
    }
  }

  return { requested_rules: req, effective_rules: effective, warnings, errors };
}

function _costPrice(variant: Record<string, any>): number | null {
  const cost = _asFloat(variant.supplier_price, null);
  if (cost != null && cost > 0) return cost;
  const offer = _asFloat(variant.offer_price, null);
  if (offer != null && offer > 0) return offer;
  return null;
}

function _applyPricing(draft: Record<string, any>, pricing: Record<string, any>, summary: Record<string, any>): void {
  const mode = pricing.mode ?? "provider_default";
  if (mode === "provider_default") return;
  const multiplier = _asFloat(pricing.multiplier, 1) ?? 1;
  const markup = _asFloat(pricing.fixed_markup, 0) ?? 0;
  const roundDigits = pricing.round_digits ?? 0;
  const roundTo = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
  const variants = draft.variants ?? [];
  let changed = 0;
  for (const v of variants) {
    const base = _costPrice(v);
    if (base == null) continue;
    let newPrice: number;
    if (mode === "multiplier") newPrice = roundTo(base * multiplier, roundDigits);
    else if (mode === "fixed_markup") newPrice = roundTo(base + markup * 100, roundDigits);
    else {
      summary.warnings.push(`Unsupported pricing mode '${mode}' was ignored.`);
      return;
    }
    v.offer_price = newPrice;
    changed++;
  }
  summary.applied.push({ rule_family: "pricing", mode, variants_changed: changed });
}

function _applyContent(draft: Record<string, any>, content: Record<string, any>, summary: Record<string, any>): void {
  let title = draft.title ?? "";
  if (content.title_override) title = String(content.title_override).trim();
  if (content.title_prefix) {
    const prefix = String(content.title_prefix);
    if (!title.startsWith(prefix)) title = prefix + title;
  }
  if (content.title_suffix) {
    const suffix = String(content.title_suffix);
    if (!title.endsWith(suffix)) title = title + suffix;
  }
  if (title) draft.title = title;

  if (content.description_override_html) {
    draft.description_html = String(content.description_override_html);
  } else if (content.description_append_html) {
    draft.description_html = (draft.description_html ?? "") + String(content.description_append_html);
  }

  if (content.tags_add) {
    const existing = [...(draft.tags ?? [])];
    for (const tag of content.tags_add ?? []) {
      if (!existing.includes(tag)) existing.push(tag);
    }
    draft.tags = existing;
  }
  summary.applied.push({ rule_family: "content" });
}

function _applyImages(draft: Record<string, any>, images: Record<string, any>, summary: Record<string, any>): void {
  let imageList = [...(draft.images ?? [])];
  const originalCount = imageList.length;

  // Step 1: drop_indexes (descending to preserve positions)
  const dropIndexes = [...new Set((images.drop_indexes as number[]) ?? [])].sort((a: number, b: number) => b - a);
  for (const idx of dropIndexes) {
    const i = Number(idx);
    if (i >= 0 && i < imageList.length) {
      imageList.splice(i, 1);
    } else if (i >= originalCount) {
      summary.warnings.push(`images.drop_indexes: index ${i} is out of range (product has ${originalCount} images, valid range 0–${originalCount - 1}).`);
    }
  }

  // Step 2: reorder (remap by old index positions)
  const reorder: number[] | undefined = images.reorder;
  if (Array.isArray(reorder) && reorder.length) {
    const snapshot = [...imageList];
    const reordered: string[] = [];
    for (const idx of reorder) {
      if (idx >= 0 && idx < snapshot.length) {
        reordered.push(snapshot[idx]);
      } else {
        summary.warnings.push(`images.reorder: index ${idx} is out of range (${snapshot.length} images after drops). Skipped.`);
      }
    }
    const usedSet = new Set(reorder.filter(i => i >= 0 && i < snapshot.length));
    for (let i = 0; i < snapshot.length; i++) {
      if (!usedSet.has(i)) reordered.push(snapshot[i]);
    }
    imageList = reordered;
  }

  // Step 3: add_urls (append new images)
  const addUrls: string[] | undefined = images.add_urls;
  if (Array.isArray(addUrls) && addUrls.length) {
    imageList.push(...addUrls);
  }

  // Step 4: keep_first_n (truncate)
  const keepFirstN = images.keep_first_n;
  const final = keepFirstN != null ? imageList.slice(0, keepFirstN) : imageList;

  if (images.translate_image_text) summary.warnings.push("translate_image_text is not auto-applied in this MVP.");
  if (images.remove_logo) summary.warnings.push("remove_logo is not auto-applied in this MVP.");
  draft.images = final;
  const details: Record<string, any> = { rule_family: "images", image_count_before: originalCount, image_count_after: final.length };
  if (addUrls?.length) details.images_added = addUrls.length;
  if (reorder?.length) details.reordered = true;
  if (dropIndexes.length) details.images_dropped = originalCount - (imageList.length - (addUrls?.length ?? 0));
  summary.applied.push(details);
}

function _applyVariantOverrides(
  draft: Record<string, any>,
  overrides: Record<string, any>[],
  summary: Record<string, any>,
): void {
  const variants: Record<string, any>[] = draft.variants ?? [];
  if (!variants.length) return;
  let matched = 0;
  for (const override of overrides) {
    const pattern = String(override.match ?? "").toLowerCase();
    if (!pattern) continue;
    for (const v of variants) {
      const titleLower = String(v.title ?? "").toLowerCase();
      const skuLower = String(v.sku ?? "").toLowerCase();
      if (!titleLower.includes(pattern) && !skuLower.includes(pattern)) continue;
      if (override.sell_price != null) {
        v.offer_price = Math.round(Number(override.sell_price) * 100);
      }
      if (override.compare_at_price != null) {
        v.compare_at_price = Math.round(Number(override.compare_at_price) * 100);
      }
      if (override.stock != null) {
        v.stock = Number(override.stock);
      }
      if (override.title != null) {
        v.title = String(override.title);
      }
      if (override.image_url != null) {
        v.image_url = String(override.image_url);
      }
      matched++;
    }
  }
  if (matched) {
    summary.applied.push({ rule_family: "variant_overrides", variants_matched: matched });
  } else {
    summary.warnings.push(
      "variant_overrides were provided but no variants matched. Check the 'match' values against variant titles/SKUs.",
    );
  }
}

const KNOWN_OPTION_EDIT_ACTIONS = new Set(["rename_option", "rename_value", "remove_value", "remove_option"]);

function _normalizeOptionEdits(
  raw: unknown,
  warnings: string[],
  errors: string[],
): Record<string, any>[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    errors.push("option_edits must be an array of edit actions.");
    return null;
  }
  const result: Record<string, any>[] = [];
  for (let i = 0; i < raw.length; i++) {
    const edit = raw[i];
    if (!edit || typeof edit !== "object" || Array.isArray(edit)) {
      errors.push(`option_edits[${i}] must be an object.`);
      continue;
    }
    const action = String(edit.action ?? "");
    if (!KNOWN_OPTION_EDIT_ACTIONS.has(action)) {
      errors.push(`option_edits[${i}]: unknown action '${action}'. Allowed: ${[...KNOWN_OPTION_EDIT_ACTIONS].join(", ")}.`);
      continue;
    }
    if (!edit.option_name || typeof edit.option_name !== "string") {
      errors.push(`option_edits[${i}]: 'option_name' (string) is required.`);
      continue;
    }
    if ((action === "rename_value" || action === "remove_value") && (!edit.value_name || typeof edit.value_name !== "string")) {
      errors.push(`option_edits[${i}]: '${action}' requires 'value_name' (string).`);
      continue;
    }
    if (action === "rename_option" && (!edit.new_name || typeof edit.new_name !== "string")) {
      errors.push(`option_edits[${i}]: 'rename_option' requires 'new_name' (string).`);
      continue;
    }
    if (action === "rename_value" && (!edit.new_name || typeof edit.new_name !== "string")) {
      errors.push(`option_edits[${i}]: 'rename_value' requires 'new_name' (string).`);
      continue;
    }
    result.push(edit);
  }
  return result.length ? result : null;
}

function _applyOptionEdits(
  draft: Record<string, any>,
  edits: Record<string, any>[],
  summary: Record<string, any>,
): void {
  const options: Record<string, any>[] = draft.options ?? [];
  const variants: Record<string, any>[] = draft.variants ?? [];
  let variantsRemoved = 0;

  for (const edit of edits) {
    const action = edit.action;
    const optionName = String(edit.option_name);
    const opt = options.find((o: any) => o.name === optionName);

    if (!opt) {
      summary.warnings.push(`option_edits: option '${optionName}' not found — skipped.`);
      continue;
    }

    if (action === "rename_option") {
      const newName = String(edit.new_name);
      opt.name = newName;
      for (const v of variants) {
        if (!Array.isArray(v.option_values)) continue;
        for (const ov of v.option_values) {
          if (ov.optionId === opt.id) ov.optionName = newName;
        }
      }
    } else if (action === "rename_value") {
      const valueName = String(edit.value_name);
      const newName = String(edit.new_name);
      const val = opt.values.find((v: any) => v.name === valueName);
      if (!val) {
        summary.warnings.push(`option_edits: value '${valueName}' not found in option '${optionName}' — skipped.`);
        continue;
      }
      val.name = newName;
      for (const v of variants) {
        if (!Array.isArray(v.option_values)) continue;
        for (const ov of v.option_values) {
          if (ov.optionId === opt.id && ov.valueId === val.id) {
            ov.valueName = newName;
          }
        }
        _rebuildVariantTitle(v);
      }
    } else if (action === "remove_value") {
      const valueName = String(edit.value_name);
      const valIdx = opt.values.findIndex((v: any) => v.name === valueName);
      if (valIdx === -1) {
        summary.warnings.push(`option_edits: value '${valueName}' not found in option '${optionName}' — skipped.`);
        continue;
      }
      const removedVal = opt.values[valIdx];
      opt.values.splice(valIdx, 1);
      const before = variants.length;
      for (let i = variants.length - 1; i >= 0; i--) {
        const ov = variants[i].option_values;
        if (Array.isArray(ov) && ov.some((o: any) => o.optionId === opt.id && o.valueId === removedVal.id)) {
          variants.splice(i, 1);
        }
      }
      variantsRemoved += before - variants.length;
    } else if (action === "remove_option") {
      const optIdx = options.findIndex((o: any) => o.id === opt.id);
      if (optIdx !== -1) options.splice(optIdx, 1);
      for (const v of variants) {
        if (!Array.isArray(v.option_values)) continue;
        v.option_values = v.option_values.filter((ov: any) => ov.optionId !== opt.id);
        _rebuildVariantTitle(v);
      }
    }
  }

  draft.variants = variants;
  draft.options = options;

  if (variantsRemoved > 0) {
    draft.total_inventory = variants.reduce(
      (sum: number, v: Record<string, any>) => sum + (Number(v.stock) || 0),
      0,
    );
  }

  summary.applied.push({
    rule_family: "option_edits",
    edits_count: edits.length,
    ...(variantsRemoved > 0 ? { variants_removed: variantsRemoved, variants_remaining: variants.length } : {}),
  });
}

function _rebuildVariantTitle(v: Record<string, any>): void {
  if (!Array.isArray(v.option_values) || !v.option_values.length) return;
  v.title = v.option_values.map((ov: any) => ov.valueName).join(" / ");
}

export function applyRules(
  draft: Record<string, any>,
  rules: Record<string, any>,
): { draft: Record<string, any>; summary: { applied: Record<string, any>[]; warnings: string[] } } {
  const d = structuredClone(draft);
  const summary: { applied: Record<string, any>[]; warnings: string[] } = { applied: [], warnings: [] };

  const pricing = rules.pricing ?? {};
  if (Object.keys(pricing).length) _applyPricing(d, pricing, summary);

  const content = rules.content ?? {};
  if (Object.keys(content).length) _applyContent(d, content, summary);

  const images = rules.images ?? {};
  if (Object.keys(images).length) _applyImages(d, images, summary);

  const variantOverrides = rules.variant_overrides;
  if (Array.isArray(variantOverrides) && variantOverrides.length) {
    _applyVariantOverrides(d, variantOverrides, summary);
  }

  const optionEdits = rules.option_edits;
  if (Array.isArray(optionEdits) && optionEdits.length) {
    _applyOptionEdits(d, optionEdits, summary);
  }

  const variants: Record<string, any>[] = d.variants ?? [];
  if (variants.length) {
    d.total_inventory = variants.reduce(
      (sum: number, v: Record<string, any>) => sum + (Number(v.stock) || 0),
      0,
    );
  }

  if (rules.instruction_text) {
    summary.warnings.push(
      "Freeform instruction_text is recorded for operator context, but only structured rules are applied automatically in this MVP.",
    );
  }

  return { draft: d, summary };
}
