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
  return sumVariantField(variants, "stock");
}

function sumVariantField(variants?: any[], field?: string): number | null {
  if (!Array.isArray(variants) || !variants.length || !field) return null;
  let total = 0;
  let found = false;
  for (const v of variants) {
    const s = v?.[field];
    if (s != null && !isNaN(Number(s))) {
      total += Number(s);
      found = true;
    }
  }
  return found ? total : null;
}

function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

function rangeOf(
  variants: Record<string, any>[],
  key: string,
): { min: number; max: number } | number | null {
  const prices: number[] = [];
  for (const v of variants) {
    const val = v[key];
    if (val == null) continue;
    const n = Number(val);
    if (!isNaN(n)) prices.push(n);
  }
  if (!prices.length) return null;
  const min = centsToDollars(Math.min(...prices));
  const max = centsToDollars(Math.max(...prices));
  return min === max ? min : { min, max };
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

    const stores = (caps.stores ?? []).map((s: any) => {
      const slim: Record<string, any> = { id: s.store_ref, name: s.display_name };
      if (s.platform) slim.platform = s.platform;
      if (s.shipping_profiles?.length) {
        slim.ship = s.shipping_profiles.map((p: any) =>
          p.is_default ? `${p.name} *` : p.name,
        );
      }
      return slim;
    });

    const rf = caps.rule_families ?? {};
    const rules: Record<string, any> = {};
    if (rf.pricing) {
      const modes = rf.pricing.modes ?? rf.pricing.supported;
      if (Array.isArray(modes)) rules.pricing = modes.filter((m: string) => m !== "provider_default");
    }
    if (rf.content) {
      const supported = rf.content.supported;
      rules.content = Array.isArray(supported) ? supported : true;
    }
    if (rf.images) {
      const supported = rf.images.supported;
      rules.images = Array.isArray(supported) ? supported : true;
    }

    const result: Record<string, any> = { stores, rules };

    const acct = caps.account_info ?? {};
    if (acct.aliexpress_auth?.all_expired) result.ae_expired = true;
    if (acct.plan_status && acct.plan_status !== "active") result.plan_issue = acct.plan_status;

    return result;
  }

  async validateRules(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const targetStore = payload.target_store;
    const rules = payload.rules ?? {};
    const caps = await this.provider.getRuleCapabilities(targetStore);
    const validation = normalizeRules(rules, caps.rule_families);
    const resp: Record<string, any> = {
      effective_rules: validation.effective_rules ?? {},
    };
    if (validation.errors?.length) resp.errors = validation.errors;
    if (validation.warnings?.length) resp.warnings = validation.warnings;
    return resp;
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
      throw new Error(
        "Rule validation failed: " + validatedRules.errors.join("; ") +
          " RECOVERY: Fix the rule parameters and retry. Call dsers.rules.validate to pre-check rules.",
      );
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

    const hasRuleChanges = ruled.summary?.applied?.length > 0;
    const saveWarnings: string[] = [];
    if (hasRuleChanges && prepared.provider_state) {
      try {
        const saveResult = await this.provider.saveDraft(
          prepared.provider_state,
          finalDraft,
        );
        saveWarnings.push(...(saveResult.warnings ?? []));
      } catch (err: any) {
        saveWarnings.push(`Failed to persist rule changes to DSers: ${err.message ?? err}`);
      }
    }

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
        ...saveWarnings,
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
      throw new Error(
        "source_urls must be a non-empty list. " +
          "RECOVERY: Provide source_urls_json with at least one supplier product URL.",
      );
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
        "job_id is required. RECOVERY: Use the job_id returned by a previous dsers.product.import call.",
      );
    const job = this.store.load(jobId);
    if (job._recovered && !job.draft) {
      await this.recoverDraft(job);
    }
    const variantOffset = Number(payload.variant_offset ?? 0) || 0;
    const variantLimit = Number(payload.variant_limit ?? 0) || 0;
    return this.preview(job, variantOffset, variantLimit);
  }

  async reapplyRules(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId)
      throw new Error(
        "job_id is required. RECOVERY: Use the job_id returned by a previous dsers.product.import call. " +
          "If the job_id is lost, re-import the product with dsers.product.import using the source_url.",
      );
    const job = this.store.load(jobId);
    if (!job.original_draft) {
      if (job.provider_state?.import_item_id) {
        await this.recoverDraft(job);
      } else {
        throw new Error(
          "Cannot re-apply rules: the draft data for this job has expired and cannot be recovered. " +
            "RECOVERY: Call dsers.product.import with the original source_url to create a fresh import, " +
            "then apply rules to the new job_id. " +
            "USER_HINT: Ask the user for the product URL if you don't have it.",
        );
      }
    }

    const rules = payload._keep_existing_rules
      ? (job.effective_rules_snapshot ?? job.rules ?? {})
      : (payload.rules ?? {});
    const targetStore = payload.target_store ?? job.target_store ?? null;
    const providerCaps = await this.provider.getRuleCapabilities(targetStore);
    const validatedRules = normalizeRules(rules, providerCaps.rule_families);
    if (validatedRules.errors?.length) {
      throw new Error(
        "Rule validation failed: " + validatedRules.errors.join("; ") +
          " RECOVERY: Fix the rule parameters and retry. Call dsers.rules.validate to pre-check rules.",
      );
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

    const saveWarnings: string[] = [];
    if (job.provider_state) {
      try {
        const saveResult = await this.provider.saveDraft(
          job.provider_state,
          job.draft,
        );
        saveWarnings.push(...(saveResult.warnings ?? []));
      } catch (err: any) {
        saveWarnings.push(`Failed to persist changes to DSers: ${err.message ?? err}`);
      }
    }

    job.warnings = [
      ...(job.warnings?.filter((w: string) =>
        !w.startsWith("Rule re-applied") && !w.startsWith("Failed to persist"),
      ) ?? []),
      `Rule re-applied at ${job.updated_at}`,
      ...(validatedRules.warnings ?? []),
      ...((ruled.summary?.warnings as string[]) ?? []),
      ...saveWarnings,
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
          "RECOVERY: Provide job_id (from dsers.product.import) and visibility_mode " +
          "(backend_only = draft/hidden, sell_immediately = published on storefront).",
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
        "job_id is required. RECOVERY: Use the job_id from dsers.product.import. " +
          "If the job_id is lost, re-import the product first.",
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
      throw new Error(
        "Push option validation failed: " + pushOptionCheck.errors.join("; ") +
          " RECOVERY: Fix the push_options parameters and retry. Omit push_options_json to use defaults.",
      );
    }
    const effectivePushOptions = pushOptionCheck.effective_push_options ?? {};
    const forcePush = Boolean(
      payload.force_push ?? effectivePushOptions.force_push,
    );

    const safety = validatePushSafety(job.draft, job.original_draft);
    if (!forcePush && safety.blocked.length) {
      throw new Error(
        `Push blocked by safety check:\n${safety.blocked.join("\n")}\n` +
          "RECOVERY: Either (1) fix pricing with dsers.product.import (re-apply mode: job_id + rules_json), " +
          "or (2) set force_push=true ONLY after showing the user the exact risk and getting explicit confirmation. " +
          "USER_HINT: Show the user each blocked reason in plain language before asking to override.",
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
    if (!job.push_results) job.push_results = [];
    job.push_results.push({
      target_store: targetStore,
      status: result.job_status ?? "push_requested",
      pushed_at: job.updated_at,
      summary: result.summary ?? {},
    });
    this.store.save(jobId, job);

    const allWarnings = [
      ...(safety.warnings ?? []),
      ...(pushOptionCheck.warnings ?? []),
      ...(result.warnings ?? []),
    ];
    const pushResponse: Record<string, any> = {
      job_id: jobId,
      status: job.status,
      target_store: targetStore,
      visibility: result.visibility_applied ?? visibilityMode,
      summary: result.summary ?? {},
    };
    if (allWarnings.length) {
      pushResponse.warnings = [...new Set(allWarnings)]
        .map((w: string) => w.length > 120 ? w.slice(0, 117) + "..." : w)
        .slice(0, 8);
    }
    return pushResponse;
  }

  private async multiStorePushSingleJob(
    payload: Record<string, any>,
    targetStores: string[],
  ): Promise<Record<string, any>> {
    const batchId = `batch-${randomUUID().slice(0, 12)}`;
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId) {
      throw new Error(
        "job_id is required when using target_stores. " +
          "RECOVERY: Use the job_id from dsers.product.import. " +
          "If the job_id is lost, re-import the product first.",
      );
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
      throw new Error(
        "job_ids must be a non-empty list. " +
          "RECOVERY: Provide job_ids_json with at least one job_id from dsers.product.import.",
      );
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
      throw new Error(
        "Cannot recover job: no import_item_id found in the job state. " +
          "RECOVERY: Call dsers.product.import with the original source_url to create a fresh import. " +
          "USER_HINT: Ask the user for the product URL if you don't have it.",
      );
    const itemPayload = await this.provider.fetchImportItem(importItemId);
    const [draft, fieldMap, recoverWarnings] = this.provider.normalizeForRecovery(itemPayload);
    const rules = job.effective_rules_snapshot ?? job.rules ?? {};
    const ruled = applyRules(draft, rules);
    job.draft = ruled.draft;
    job.original_draft = draft;
    if (fieldMap && job.provider_state) {
      job.provider_state.field_map = fieldMap;
    }
    job.rule_summary = ruled.summary ?? {};
    job.updated_at = utcNow();

    const saveWarnings: string[] = [];
    const hasRuleChanges = ruled.summary?.applied?.length > 0;
    if (hasRuleChanges && job.provider_state) {
      try {
        const saveResult = await this.provider.saveDraft(
          job.provider_state,
          job.draft,
        );
        saveWarnings.push(...(saveResult.warnings ?? []));
      } catch (err: any) {
        saveWarnings.push(`Failed to persist rule changes to DSers: ${err.message ?? err}`);
      }
    }

    job.warnings = [
      ...(job.warnings ?? []),
      ...(recoverWarnings ?? []),
      ...((ruled.summary?.warnings as string[]) ?? []),
      ...saveWarnings,
    ];
    job.status = "preview_ready";
    this.store.save(job.job_id, job);
  }

  async getJobStatus(
    payload: Record<string, any>,
  ): Promise<Record<string, any>> {
    const jobId = String(payload.job_id ?? "").trim();
    if (!jobId)
      throw new Error(
        "job_id is required. RECOVERY: Use the job_id returned by dsers.product.import or dsers.store.push.",
      );
    const job = this.store.load(jobId);
    const result: Record<string, any> = {
      job_id: jobId,
      status: job.status,
      target_store: job.target_store,
    };
    if (job.push_result) {
      result.push_status = job.push_result.job_status ?? job.status;
    }
    const allWarns = [...new Set([
      ...(job.warnings ?? []),
      ...(job.push_option_warnings ?? []),
    ])]
      .map((w: string) => w.length > 120 ? w.slice(0, 117) + "..." : w)
      .slice(0, 8);
    if (allWarns.length) result.warnings = allWarns;
    return result;
  }

  private preview(
    job: Record<string, any>,
    variantOffset = 0,
    variantLimit = 0,
  ): Record<string, any> {
    const original = job.original_draft;
    const final = job.draft;
    const DEFAULT_MAX = 3;
    const maxVariants = variantLimit > 0 ? variantLimit : DEFAULT_MAX;
    const offset = Math.max(0, variantOffset);

    const variants = final?.variants ?? [];
    const preview: Record<string, any> = {
      job_id: job.job_id,
      status: job.status,
    };

    const titleBefore = original?.title ?? "";
    const titleAfter = final?.title ?? "";
    if (titleBefore !== titleAfter) {
      preview.title_before = titleBefore;
      preview.title_after = titleAfter;
    } else {
      preview.title = titleAfter;
    }

    const sell = rangeOf(variants, "offer_price");
    const cost = rangeOf(variants, "supplier_price");
    const compareAt = rangeOf(variants, "compare_at_price");
    if (sell != null) preview.sell_price = sell;
    if (cost != null) preview.cost = cost;
    if (compareAt != null) preview.compare_at_price = compareAt;
    if (sell != null && cost != null && JSON.stringify(sell) === JSON.stringify(cost)) {
      preview.no_markup = true;
    }

    preview.variants_count = variants.length;
    preview.images = (final?.images ?? []).length;

    if ((original?.description_html ?? "") !== (final?.description_html ?? "")) {
      preview.desc_changed = true;
    }

    const stockTotal = final?.total_inventory ?? sumVariantStock(variants);
    if (stockTotal != null) {
      preview.stock = stockTotal;
      if (stockTotal > 0 && stockTotal < 5) preview.stock_low = true;
    }

    const supplierStockTotal = sumVariantField(variants, "supplier_stock");
    if (supplierStockTotal != null && supplierStockTotal !== stockTotal) {
      preview.supplier_stock = supplierStockTotal;
    }

    const shipTo = final?.ship_to;
    const shipFrom = final?.ship_from;
    if (shipTo) preview.ship_to = shipTo;
    if (shipFrom) preview.ship_from = shipFrom;

    if (variants.length) {
      const sliced = variants.slice(offset, offset + maxVariants);
      preview.skus = [
        ["name", "sell", "compare_at", "cost", "qty", "supplier_qty"],
        ...sliced.map((v: any) => [
          v.title,
          v.offer_price != null ? centsToDollars(Number(v.offer_price)) : null,
          v.compare_at_price != null ? centsToDollars(Number(v.compare_at_price)) : null,
          v.supplier_price != null ? centsToDollars(Number(v.supplier_price)) : null,
          v.stock ?? null,
          v.supplier_stock ?? null,
        ]),
      ];
      const remaining = variants.length - offset - sliced.length;
      if (remaining > 0) preview.skus_more = remaining;
      if (offset > 0) preview.skus_offset = offset;
    }

    if (job.target_store) preview.store = job.target_store;
    if (job.visibility_mode && job.visibility_mode !== "backend_only")
      preview.visibility = job.visibility_mode;

    const warns = [...new Set<string>(job.warnings ?? [])]
      .map((w: string) => w.length > 100 ? w.slice(0, 97) + "..." : w)
      .slice(0, 5);
    if (warns.length) preview.warnings = warns;

    return preview;
  }
}
