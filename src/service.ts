import { randomUUID } from "node:crypto";
import type { ImportProvider } from "./provider.js";
import type { JobStore } from "./job-store.js";
import { normalizePushOptions } from "./push-options.js";
import { validatePushSafety } from "./push-guard.js";
import { resolveSourceUrl } from "./resolver.js";
import { applyRules, normalizeRules } from "./rules.js";

function utcNow(): string {
  return new Date().toISOString();
}

function sumVariantStock(variants?: any[]): number | null {
  if (!Array.isArray(variants) || !variants.length) return null;
  let total = 0;
  let any = false;
  for (const v of variants) {
    const s = v?.stock;
    if (s != null && !isNaN(Number(s))) {
      total += Number(s);
      any = true;
    }
  }
  return any ? total : null;
}

function priceRange(draft: Record<string, any>): {
  min: number | null;
  max: number | null;
} {
  const prices: number[] = [];
  for (const variant of draft.variants ?? []) {
    for (const key of ["offer_price", "supplier_price"]) {
      const value = variant[key];
      if (value == null) continue;
      const n = Number(value);
      if (!isNaN(n)) {
        prices.push(n);
        break;
      }
    }
  }
  if (!prices.length) return { min: null, max: null };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

function parseBatchItem(
  item: any,
  shared: Record<string, any>,
  sharedRules: any,
): [string, Record<string, any>] {
  if (typeof item === "string") {
    const url = item.trim();
    if (!url) return ["", {}];
    const merged: Record<string, any> = { ...shared, source_url: url };
    if (sharedRules && !merged.rules) merged.rules = sharedRules;
    return [url, merged];
  }
  if (item && typeof item === "object") {
    const url = String(item.url ?? item.source_url ?? "").trim();
    if (!url) return ["", {}];
    const merged: Record<string, any> = { ...shared, source_url: url };
    for (const key of [
      "source_hint",
      "country",
      "target_store",
      "visibility_mode",
    ]) {
      if (item[key] != null) merged[key] = item[key];
    }
    merged.rules = item.rules ?? sharedRules ?? {};
    return [url, merged];
  }
  return ["", {}];
}

function parsePushItem(
  item: any,
  batchTargetStores: any,
  batchTargetStore: any,
  batchVisibility: any,
  batchPushOptions: any,
): [string, string[], any, any] {
  if (typeof item === "string") {
    const jobId = item.trim();
    const stores = Array.isArray(batchTargetStores)
      ? [...batchTargetStores]
      : batchTargetStore
        ? [batchTargetStore]
        : [];
    return [jobId, stores, batchPushOptions, batchVisibility];
  }
  if (item && typeof item === "object") {
    const jobId = String(item.job_id ?? "").trim();
    let stores: string[];
    if (Array.isArray(item.target_stores) && item.target_stores.length) {
      stores = item.target_stores;
    } else if (item.target_store) {
      stores = [item.target_store];
    } else if (Array.isArray(batchTargetStores) && batchTargetStores.length) {
      stores = [...batchTargetStores];
    } else if (batchTargetStore) {
      stores = [batchTargetStore];
    } else {
      stores = [];
    }
    const pushOptions =
      item.push_options != null ? item.push_options : batchPushOptions;
    const visibility = item.visibility_mode ?? batchVisibility;
    return [jobId, stores, pushOptions, visibility];
  }
  return ["", [], batchPushOptions, batchVisibility];
}

function expandPushTasks(
  jobIds: any[],
  batchTargetStores: any,
  batchTargetStore: any,
  batchVisibility: any,
  batchPushOptions: any,
): Record<string, any>[] {
  const tasks: Record<string, any>[] = [];
  for (const item of jobIds) {
    const [jobId, itemStores, itemPushOptions, itemVisibility] = parsePushItem(
      item,
      batchTargetStores,
      batchTargetStore,
      batchVisibility,
      batchPushOptions,
    );
    if (!jobId) {
      tasks.push({ job_id: "", target_store: "", error: "Empty or invalid job_id entry" });
      continue;
    }
    if (!itemStores.length) {
      const payload: Record<string, any> = { job_id: jobId };
      if (itemPushOptions != null) payload.push_options = itemPushOptions;
      if (itemVisibility) payload.visibility_mode = itemVisibility;
      tasks.push({ payload, job_id: jobId, target_store: "" });
      continue;
    }
    for (const store of itemStores) {
      const storeName = String(store).trim();
      if (!storeName) {
        tasks.push({ job_id: jobId, target_store: "", error: "Empty store name" });
        continue;
      }
      const payload: Record<string, any> = { job_id: jobId, target_store: storeName };
      if (itemPushOptions != null) payload.push_options = itemPushOptions;
      if (itemVisibility) payload.visibility_mode = itemVisibility;
      tasks.push({ payload, job_id: jobId, target_store: storeName });
    }
  }
  return tasks;
}

export class ImportFlowService {
  private provider: ImportProvider;
  private store: JobStore;

  constructor(provider: ImportProvider, store: JobStore) {
    this.provider = provider;
    this.store = store;
  }

  async getRuleCapabilities(
    payload?: Record<string, any>,
  ): Promise<Record<string, any>> {
    const targetStore = payload?.target_store;
    const caps = await this.provider.getRuleCapabilities(targetStore);
    return {
      provider_label: caps.provider_label ?? this.provider.name,
      source_support: caps.source_support ?? [],
      stores: caps.stores ?? [],
      account_info: caps.account_info ?? {},
      rule_families: caps.rule_families ?? {},
      push_options: caps.push_options ?? {},
      notes: caps.notes ?? [],
    };
  }

  async validateRules(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const targetStore = payload.target_store;
    const rules = payload.rules ?? {};
    const caps = await this.provider.getRuleCapabilities(targetStore);
    const validation = normalizeRules(rules, caps.rule_families);
    return {
      provider_label: caps.provider_label ?? this.provider.name,
      target_store: targetStore,
      requested_rules: validation.requested_rules ?? {},
      effective_rules_snapshot: validation.effective_rules ?? {},
      warnings: validation.warnings ?? [],
      errors: validation.errors ?? [],
    };
  }

  async prepareImportCandidate(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const sourceUrls = payload.source_urls;
    if (Array.isArray(sourceUrls)) {
      return this.batchPrepare(payload, sourceUrls);
    }
    return this.prepareSingle(payload);
  }

  private async prepareSingle(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const sourceUrl = String(payload.source_url ?? "").trim();
    if (!sourceUrl)
      throw new Error(
        "source_url is required. Provide a supplier product URL (AliExpress, Alibaba, or Accio).",
      );

    const sourceHint = String(payload.source_hint ?? "auto").trim() || "auto";
    const country = String(payload.country ?? "US").trim() || "US";
    const visibilityMode =
      String(payload.visibility_mode ?? "backend_only").trim() || "backend_only";
    const targetStore = payload.target_store ?? null;
    const rules = payload.rules ?? {};

    const providerCaps =
      await this.provider.getRuleCapabilities(targetStore);
    const validatedRules = normalizeRules(rules, providerCaps.rule_families);
    if (validatedRules.errors?.length) {
      throw new Error(validatedRules.errors.join("; "));
    }

    const resolved = await resolveSourceUrl(sourceUrl, sourceHint);
    const prepared = await this.provider.prepareCandidate(
      resolved.resolved_url,
      resolved.source_hint,
      country,
    );

    const originalDraft = structuredClone(prepared.draft);
    const effectiveRules = validatedRules.effective_rules ?? {};
    const ruled = applyRules(prepared.draft, effectiveRules);
    const finalDraft = ruled.draft;

    const job: Record<string, any> = {
      status: "preview_ready",
      created_at: utcNow(),
      provider_label: prepared.provider_label ?? this.provider.name,
      source_url: sourceUrl,
      resolved_source_url: resolved.resolved_url,
      source_hint: resolved.source_hint,
      resolver_mode: resolved.resolver_mode,
      country,
      target_store: targetStore,
      visibility_mode: visibilityMode,
      requested_rules: validatedRules.requested_rules ?? {},
      effective_rules_snapshot: effectiveRules,
      rules: effectiveRules,
      provider_state: prepared.provider_state,
      original_draft: originalDraft,
      draft: finalDraft,
      warnings: [
        ...(resolved.warnings ?? []),
        ...(prepared.warnings ?? []),
        ...(validatedRules.warnings ?? []),
        ...((ruled.summary?.warnings as string[]) ?? []),
      ],
      rule_summary: ruled.summary ?? {},
    };
    const jobId = this.store.create(job);
    job.job_id = jobId;
    this.store.save(jobId, job);
    return this.preview(job);
  }

  private async batchPrepare(
    payload: Record<string, any>,
    sourceUrls: any[],
  ): Promise<Record<string, any>> {
    if (!sourceUrls.length) {
      return { error: "source_urls must be a non-empty list" };
    }
    const batchId = `batch-${randomUUID().slice(0, 12)}`;
    const sharedKeys = [
      "country",
      "target_store",
      "visibility_mode",
      "source_hint",
    ] as const;
    const shared: Record<string, any> = {};
    for (const k of sharedKeys) {
      if (payload[k] != null) shared[k] = payload[k];
    }
    const sharedRules = payload.rules;

    const results: Record<string, any>[] = [];
    let succeeded = 0;
    let failed = 0;

    for (let idx = 0; idx < sourceUrls.length; idx++) {
      const [url, itemPayload] = parseBatchItem(
        sourceUrls[idx],
        shared,
        sharedRules,
      );
      if (!url) {
        results.push({ index: idx, source_url: "", error: "Empty or invalid URL entry" });
        failed++;
        continue;
      }
      try {
        const preview = await this.prepareSingle(itemPayload);
        results.push({ ...preview, index: idx });
        succeeded++;
      } catch (err: any) {
        results.push({ index: idx, source_url: url, error: String(err.message ?? err) });
        failed++;
      }
    }
    return { batch_id: batchId, total: sourceUrls.length, succeeded, failed, results };
  }

  async getImportPreview(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId)
      throw new Error(
        "job_id is required. It is returned by dsers.product.import in the response.",
      );
    const job = this.store.load(jobId);
    return this.preview(job);
  }

  async reapplyRules(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId)
      throw new Error(
        "job_id is required. Provide a job_id from a previous dsers.product.import call.",
      );
    const job = this.store.load(jobId);
    if (!job.original_draft)
      throw new Error(
        "Cannot re-apply rules: original draft not found in this job. " +
          "The job may have been created in a previous server session that is no longer available.",
      );

    const rules = payload.rules ?? {};
    const targetStore = payload.target_store ?? job.target_store ?? null;
    const providerCaps = await this.provider.getRuleCapabilities(targetStore);
    const validatedRules = normalizeRules(rules, providerCaps.rule_families);
    if (validatedRules.errors?.length) {
      throw new Error(validatedRules.errors.join("; "));
    }

    const effectiveRules = validatedRules.effective_rules ?? {};
    const ruled = applyRules(job.original_draft, effectiveRules);

    job.draft = ruled.draft;
    job.requested_rules = validatedRules.requested_rules ?? {};
    job.effective_rules_snapshot = effectiveRules;
    job.rules = effectiveRules;
    job.rule_summary = ruled.summary ?? {};
    job.status = "preview_ready";
    job.updated_at = utcNow();
    if (payload.target_store) job.target_store = payload.target_store;
    if (payload.visibility_mode) job.visibility_mode = payload.visibility_mode;
    job.warnings = [
      ...(job.warnings?.filter((w: string) => !w.startsWith("Rule re-applied")) ?? []),
      `Rule re-applied at ${job.updated_at}`,
      ...(validatedRules.warnings ?? []),
      ...((ruled.summary?.warnings as string[]) ?? []),
    ];
    this.store.save(jobId, job);
    return this.preview(job);
  }

  async setProductVisibility(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    const visibilityMode = String(payload.visibility_mode ?? "").trim();
    if (!jobId || !visibilityMode) {
      throw new Error(
        "job_id and visibility_mode are both required. " +
          "Valid visibility_mode values: backend_only, sell_immediately.",
      );
    }
    const job = this.store.load(jobId);
    job.visibility_mode = visibilityMode;
    job.updated_at = utcNow();
    this.store.save(jobId, job);
    return { job_id: jobId, status: job.status, visibility_mode: visibilityMode };
  }

  async confirmPushToStore(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobIds = payload.job_ids;
    const targetStores = payload.target_stores;

    if (Array.isArray(jobIds)) {
      return this.batchPush(payload, jobIds);
    }
    if (Array.isArray(targetStores) && targetStores.length) {
      return this.multiStorePushSingleJob(payload, targetStores);
    }
    return this.pushSingle(payload);
  }

  private async pushSingle(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId)
      throw new Error(
        "job_id is required. It is returned by dsers.product.import in the response.",
      );

    const job = this.store.load(jobId);
    if (job._recovered && !job.draft) {
      await this.recoverDraft(job);
    }
    const targetStore = payload.target_store ?? job.target_store ?? null;
    const visibilityMode =
      payload.visibility_mode ?? job.visibility_mode ?? "backend_only";
    const providerCaps =
      await this.provider.getRuleCapabilities(targetStore);
    const pushOptionCheck = normalizePushOptions(
      payload.push_options,
      visibilityMode,
      providerCaps.push_options,
    );
    if (pushOptionCheck.errors?.length) {
      throw new Error(pushOptionCheck.errors.join("; "));
    }
    const effectivePushOptions = pushOptionCheck.effective_push_options ?? {};
    const forcePush = Boolean(
      payload.force_push ?? effectivePushOptions.force_push,
    );

    const safety = validatePushSafety(job.draft, job.original_draft);
    if (!forcePush && safety.blocked.length) {
      throw new Error(
        `Push blocked by safety check:\n${safety.blocked.join("\n")}\n` +
        "To override, set force_push=true after confirming the risk with the user.",
      );
    }

    const result = await this.provider.commitCandidate(
      job.provider_state,
      job.draft,
      targetStore,
      visibilityMode,
      effectivePushOptions,
    );
    job.status = result.job_status ?? "push_requested";
    job.updated_at = utcNow();
    job.target_store = targetStore;
    job.visibility_mode = visibilityMode;
    job.requested_push_options = pushOptionCheck.requested_push_options ?? {};
    job.effective_push_options = effectivePushOptions;
    job.push_option_warnings = pushOptionCheck.warnings ?? [];
    job.push_result = result;
    this.store.save(jobId, job);

    return {
      job_id: jobId,
      status: job.status,
      target_store: targetStore,
      visibility_requested: visibilityMode,
      visibility_applied: result.visibility_applied ?? visibilityMode,
      push_options_applied: result.push_options_applied ?? effectivePushOptions,
      job_summary: result.summary ?? {},
      warnings: [
        ...(safety.warnings ?? []),
        ...(pushOptionCheck.warnings ?? []),
        ...(result.warnings ?? []),
      ],
    };
  }

  private async multiStorePushSingleJob(
    payload: Record<string, any>,
    targetStores: string[],
  ): Promise<Record<string, any>> {
    const batchId = `batch-${randomUUID().slice(0, 12)}`;
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId) {
      return {
        error:
          "job_id is required when using target_stores. It is returned by dsers.product.import.",
      };
    }

    const results: Record<string, any>[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const store of targetStores) {
      const storeName = String(store).trim();
      if (!storeName) {
        results.push({ job_id: jobId, target_store: "", error: "Empty store name" });
        failed++;
        continue;
      }
      const singlePayload: Record<string, any> = { ...payload, job_id: jobId, target_store: storeName };
      delete singlePayload.target_stores;
      try {
        const result = await this.pushSingle(singlePayload);
        results.push({ ...result, target_store: storeName });
        succeeded++;
      } catch (err: any) {
        results.push({ job_id: jobId, target_store: storeName, error: String(err.message ?? err) });
        failed++;
      }
    }
    return { batch_id: batchId, total: targetStores.length, succeeded, failed, results };
  }

  private async batchPush(
    payload: Record<string, any>,
    jobIds: any[],
  ): Promise<Record<string, any>> {
    if (!jobIds.length) {
      return { error: "job_ids must be a non-empty list" };
    }
    const batchId = `batch-${randomUUID().slice(0, 12)}`;
    const tasks = expandPushTasks(
      jobIds,
      payload.target_stores,
      payload.target_store,
      payload.visibility_mode,
      payload.push_options,
    );

    const results: Record<string, any>[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const task of tasks) {
      if (task.error) {
        results.push(task);
        failed++;
        continue;
      }
      try {
        const result = await this.pushSingle(task.payload);
        results.push({ ...result, target_store: task.target_store });
        succeeded++;
      } catch (err: any) {
        results.push({
          job_id: task.job_id ?? "",
          target_store: task.target_store ?? "",
          error: String(err.message ?? err),
        });
        failed++;
      }
    }
    return { batch_id: batchId, total: tasks.length, succeeded, failed, results };
  }

  private async recoverDraft(job: Record<string, any>): Promise<void> {
    const importItemId = job.provider_state?.import_item_id;
    if (!importItemId)
      throw new Error("Cannot recover job: missing import_item_id in state.");
    const itemPayload = await this.provider.fetchImportItem(importItemId);
    const [draft, fieldMap] = this.provider.normalizeForRecovery(itemPayload);
    const rules = job.effective_rules_snapshot ?? job.rules ?? {};
    const ruled = applyRules(draft, rules);
    job.draft = ruled.draft;
    job.original_draft = draft;
    if (fieldMap && job.provider_state) {
      job.provider_state.field_map = fieldMap;
    }
    job.status = "preview_ready";
    this.store.save(job.job_id, job);
  }

  async getJobStatus(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId)
      throw new Error(
        "job_id is required. It is returned by dsers.product.import or dsers.store.push.",
      );
    const job = this.store.load(jobId);
    const result: Record<string, any> = {
      job_id: jobId,
      status: job.status,
      created_at: job.created_at,
      updated_at: job.updated_at,
      target_store: job.target_store,
      visibility_mode: job.visibility_mode,
      warnings: [
        ...(job.warnings ?? []),
        ...(job.push_option_warnings ?? []),
      ],
      has_push_result: Boolean(job.push_result),
    };
    if (job.push_result) {
      const pr = job.push_result;
      result.push_result = {
        status: pr.job_status ?? job.status,
        target_store: job.target_store,
        visibility_applied: pr.visibility_applied ?? job.visibility_mode,
        summary: pr.summary ?? {},
        warnings: pr.warnings ?? [],
      };
    }
    return result;
  }

  private preview(job: Record<string, any>): Record<string, any> {
    const original = job.original_draft;
    const final = job.draft;

    const descBefore = original?.description_html ?? "";
    const descAfter = final?.description_html ?? "";

    const preview: Record<string, any> = {
      job_id: job.job_id,
      status: job.status,
      source_url: job.source_url,
      resolved_source_url: job.resolved_source_url,
      resolver_mode: job.resolver_mode,
      target_store: job.target_store,
      visibility_mode: job.visibility_mode,
      title_before: original?.title,
      title_after: final?.title,
      description_changed: descBefore !== descAfter,
      description_html_snippet: descAfter.length > 500
        ? descAfter.slice(0, 500) + "…"
        : descAfter || null,
      images_before: (original?.images ?? []).length,
      images_after: (final?.images ?? []).length,
      image_urls: (final?.images ?? []).slice(0, 10).map((img: any) =>
        typeof img === "string" ? img : img?.src ?? img?.url ?? null,
      ).filter(Boolean),
      variant_count: (final?.variants ?? []).length,
      price_range_before: priceRange(original ?? {}),
      price_range_after: priceRange(final ?? {}),
      tags_before: original?.tags ?? [],
      tags_after: final?.tags ?? [],
      requested_rules: job.requested_rules ?? {},
      effective_rules_snapshot: job.effective_rules_snapshot ?? {},
      rule_summary: job.rule_summary ?? {},
      warnings: job.warnings ?? [],
    };

    const stockTotal = final?.total_inventory ?? sumVariantStock(final?.variants);
    if (stockTotal != null) {
      preview.stock_total = stockTotal;
      preview.stock_low_warning = stockTotal > 0 && stockTotal < 5;
    }

    if (final?.variants?.length) {
      preview.variant_preview = final.variants.map((v: any) => ({
        title: v.title,
        supplier_price: v.supplier_price,
        offer_price: v.offer_price,
        stock: v.stock ?? null,
        sku: v.sku,
      }));
    }
    return preview;
  }
}
