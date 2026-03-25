import { DSersClient, DSersAPIError } from "./dsers/client.js";
import { DSersConfig, configFromEnv, configFromParams } from "./dsers/config.js";
import * as account from "./dsers/account.js";
import * as product from "./dsers/product.js";
import * as settings from "./dsers/settings.js";

async function safeCall<T extends Record<string, any>>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DSersAPIError) {
      const result: Record<string, any> = { error: err.message };
      result.status = err.status;
      result.detail = err.body;
      return result as T;
    }
    throw err;
  }
}

// Public DSers platform identifiers — NOT secrets.
// Override via env for custom/test accounts.
const FALLBACK_ALIEXPRESS_APP_ID = "159831080";
const FALLBACK_ALIBABA_APP_ID = "1902659021782450176";

const DEFAULT_PUSH_CHANNELS = [
  "online_store",
  "shop_app",
  "google_youtube",
  "tiktok",
  "facebook_instagram",
  "amazon",
];

const ALIEXPRESS_ID_PATTERN = /\/(?:item|i)\/(\d+)\.html/i;
const ALIBABA_ID_PATTERN = /\/product-detail\/[^_]*_(\d+)\.html/i;
const ALI1688_ID_PATTERN = /1688\.com\/(?:offer|product-detail)\/(\d+)\.html/i;

export interface ImportProvider {
  name: string;
  getRuleCapabilities(targetStore?: string): Promise<Record<string, any>>;
  prepareCandidate(
    sourceUrl: string,
    sourceHint: string,
    country: string,
  ): Promise<Record<string, any>>;
  commitCandidate(
    providerState: Record<string, any>,
    draft: Record<string, any>,
    targetStore: string | null,
    visibilityMode: string,
    pushOptions: Record<string, any>,
  ): Promise<Record<string, any>>;
  fetchImportItem(importItemId: string): Promise<Record<string, any>>;
  normalizeForRecovery(
    itemPayload: Record<string, any>,
  ): [Record<string, any>, Record<string, any>];
}

export class PrivateDsersProvider implements ImportProvider {
  name = "private-dsers";
  private client: DSersClient;
  private aliexpressAppId: string;
  private alibabaAppId: string;
  private resolvedAlibabaAppId: string | null = null;

  constructor(config?: DSersConfig) {
    const cfg = config ?? configFromEnv();
    this.client = new DSersClient(cfg);
    this.aliexpressAppId = String(
      process.env.PRIVATE_DSERS_ALIEXPRESS_APP_ID || FALLBACK_ALIEXPRESS_APP_ID,
    );
    this.alibabaAppId = String(
      process.env.PRIVATE_DSERS_ALIBABA_APP_ID || FALLBACK_ALIBABA_APP_ID,
    );
  }

  // ── ImportProvider interface ──

  async getRuleCapabilities(
    targetStore?: string,
  ): Promise<Record<string, any>> {
    let stores = await this.listStores();
    stores = await this.enrichShopifyProfiles(stores);
    const visibilityModes = ["backend_only", "sell_immediately"];

    const notes: string[] = [
      "Provider-native pricing and auto-sync capabilities are available through the private adapter.",
      "Advanced image transformations are not auto-applied in this MVP.",
    ];
    if (targetStore) {
      notes.push(`Target store hint received: ${targetStore}`);
    }

    const account_info: Record<string, any> = {};
    try {
      const ilRes = await product.getImportList(this.client, { page: 1, size: 1 }) as Record<string, any>;
      const ilData = ilRes?.data;
      account_info.import_list_count = Array.isArray(ilData) ? ilData.length : (ilData?.total ?? null);
    } catch (e: unknown) { account_info._errors ??= []; account_info._errors.push(`import_list: ${e instanceof Error ? e.message : String(e)}`); }
    try {
      const planRes = await settings.getCurrentPlan(this.client) as Record<string, any>;
      const pd = planRes?.data ?? {};
      account_info.plan = pd.type ?? pd.planType ?? pd.name ?? null;
      account_info.plan_status = pd.status ?? null;
      account_info.plan_deadline = pd.deadline ?? null;
    } catch (e: unknown) { account_info._errors ??= []; account_info._errors.push(`plan: ${e instanceof Error ? e.message : String(e)}`); }
    try {
      const limRes = await settings.getPlanLimits(this.client) as Record<string, any>;
      const ld = limRes?.data ?? {};
      account_info.limits = {
        store_limit: ld.storeLimit,
        product_limit: ld.productLimit,
        import_limit: ld.importLimit,
        import_day_limit: ld.importDayLimit,
      };
    } catch (e: unknown) { account_info._errors ??= []; account_info._errors.push(`limits: ${e instanceof Error ? e.message : String(e)}`); }
    try {
      const authCheck = await this.checkAliExpressAuth();
      account_info.aliexpress_auth = {
        valid: authCheck.valid,
        all_expired: authCheck.all_expired,
        detail: authCheck.details,
      };
    } catch (e: unknown) { account_info._errors ??= []; account_info._errors.push(`ae_auth: ${e instanceof Error ? e.message : String(e)}`); }

    return {
      provider_label: "Private DSers Adapter",
      source_support: ["aliexpress", "alibaba", "1688"],
      stores,
      account_info,
      rule_families: {
        pricing: {
          supported: true,
          modes: ["provider_default", "multiplier", "fixed_markup"],
          native_snapshot_available: true,
        },
        content: {
          supported: [
            "title_override",
            "title_prefix",
            "title_suffix",
            "description_override_html",
            "description_append_html",
          ],
          unsupported: ["tags_add"],
        },
        images: {
          supported: ["keep_first_n", "drop_indexes"],
          unsupported: ["translate_image_text", "remove_logo"],
        },
        visibility: { supported_modes: visibilityModes },
      },
      push_options: {
        supported: [
          "publish_to_online_store",
          "only_push_specifications",
          "image_strategy",
          "pricing_rule_behavior",
          "auto_inventory_update",
          "auto_price_update",
          "sales_channels",
          "store_shipping_profile",
          "shipping_profile_name",
        ],
        image_strategy_modes: ["selected_only", "all_available"],
        pricing_rule_behavior_modes: [
          "keep_manual",
          "apply_store_pricing_rule",
        ],
        sales_channels: DEFAULT_PUSH_CHANNELS,
        shipping_profile_name_hint:
          "For Shopify stores, specify a delivery profile name " +
          "(e.g. 'DSers Shipping Profile') to override the default. " +
          "If omitted, the profile marked as default (isChecked) is used automatically.",
      },
      notes,
    };
  }

  async prepareCandidate(
    sourceUrl: string,
    sourceHint: string,
    country: string,
  ): Promise<Record<string, any>> {
    let [sourceKind, appId, supplyProductId] =
      this.resolveSourceIdentifier(sourceUrl);

    if (sourceKind === "alibaba" || sourceKind === "1688") {
      appId = await this.detectAlibabaAppId();
    }

    const cleanUrl = this.cleanProductUrl(sourceUrl);
    const parsePayload = await safeCall(() =>
      product.parseProductUrl(this.client, cleanUrl, appId),
    );
    const canonicalId = this.extractSupplyProductId(parsePayload ?? {});
    const afTraceId = this.extractAfTraceId(sourceUrl);
    if (!supplyProductId) {
      this.raiseIfError(
        parsePayload,
        "Could not resolve the supplier product URL. Verify the URL is a valid AliExpress, Alibaba, or 1688 product link.",
      );
      supplyProductId = canonicalId || afTraceId;
    }
    if (canonicalId && canonicalId !== supplyProductId) {
      supplyProductId = canonicalId;
    }
    if (!supplyProductId) {
      throw new Error(
        `Could not extract a supplier product ID from the URL: ${sourceUrl}. Ensure it contains a numeric product ID.`,
      );
    }

    const importPayload = await safeCall(() =>
      product.importByProductId(this.client, {
        supplyProductId: supplyProductId!,
        supplyAppId: appId,
        country,
        language: ["EN"],
      }),
    );
    if (this.hasReason(importPayload, "ALIBABA_NOT_AVAILABLE")) {
      throw new Error(
        "The Alibaba/1688 product cannot be imported. Most likely cause: the product's " +
        "Minimum Order Quantity (MOQ) is greater than 1. DSers only supports Alibaba " +
        "products with MOQ = 1. Try a different product with single-piece ordering, " +
        "or find the same product on AliExpress instead.",
      );
    }
    if (this.hasReason(importPayload, "PRODUCT_STATUS_NOT_ONSELLING")) {
      throw new Error(
        "The supplier product cannot be imported — DSers reports PRODUCT_STATUS_NOT_ONSELLING. " +
        "The product is likely delisted, off-shelf, or unavailable in the selected country/region. " +
        "Try verifying the product URL in a browser, or use a different product.",
      );
    }
    const alreadyExists = this.hasReason(
      importPayload,
      "IMPORT_LIST_PRODUCT_ALREADY_EXISTS",
    );
    if (!alreadyExists) {
      this.raiseIfError(
        importPayload,
        `Could not import this ${sourceKind} product. The DSers account may not have the required source app enabled, or the product is unavailable.`,
      );
    }

    let importItemId = this.extractImportItemId(importPayload);

    let localProductId = this.extractLocalProductId(importPayload);

    if (!importItemId) {
      if (!localProductId) {
        localProductId = await this.resolveLocalProductId(
          supplyProductId!, appId, country,
        );
      }
      const searchIds = new Set(
        [supplyProductId, canonicalId, afTraceId, localProductId].filter(Boolean),
      );
      importItemId = await this.recoverImportItemId(searchIds);
    }
    if (!importItemId) {
      throw new Error(
        "Could not locate the imported product draft in the import list. The import may have failed silently.",
      );
    }
    if (localProductId && localProductId !== supplyProductId) {
      supplyProductId = localProductId;
    }

    const itemPayload = await safeCall(() =>
      product.getImportListItem(this.client, importItemId),
    );
    this.raiseIfError(
      itemPayload,
      "Could not fetch the imported product draft. The item may have been deleted from the import list.",
    );
    const [draft, fieldMap, warnings] = this.normalizeImportItem(itemPayload);

    const providerState = {
      import_item_id: importItemId,
      source_hint: sourceHint,
      source_kind: sourceKind,
      source_app_id: appId,
      country,
      field_map: fieldMap,
      supply_product_id: supplyProductId,
    };

    return {
      provider_label: "Private DSers Adapter",
      provider_state: providerState,
      draft,
      warnings,
      resolved_source: sourceUrl,
    };
  }

  async commitCandidate(
    providerState: Record<string, any>,
    draft: Record<string, any>,
    targetStore: string | null,
    visibilityMode: string,
    pushOptions: Record<string, any>,
  ): Promise<Record<string, any>> {
    const fieldMap: Record<string, any> = providerState.field_map ?? {};
    const warnings: string[] = [];
    const pricingRuleBehavior = String(
      pushOptions.pricing_rule_behavior ?? "keep_manual",
    );

    const updateArgs: Record<string, any> = {
      id: providerState.import_item_id,
    };
    const titleKey = fieldMap.title_key ?? "title";
    const descriptionKey = fieldMap.description_key ?? "description";
    const tagsKey = fieldMap.tags_key;

    updateArgs[titleKey] = draft.title;
    updateArgs[descriptionKey] = draft.description_html;
    if (tagsKey) {
      updateArgs[tagsKey] = draft.tags ?? [];
    } else if (draft.tags?.length) {
      warnings.push(
        "Tag edits were skipped because the DSers import list API does not support direct tag writes for this item type.",
      );
    }

    const variantsKey = fieldMap.variants_key;
    if (variantsKey && fieldMap.raw_variants?.length) {
      updateArgs[variantsKey] = this.denormalizeVariants(
        draft.variants ?? [],
        fieldMap,
      );
      const priceEditFlagKey = fieldMap.price_edit_flag_key;
      if (priceEditFlagKey) {
        updateArgs[priceEditFlagKey] =
          pricingRuleBehavior !== "apply_store_pricing_rule";
      }
      const supplyKey = fieldMap.supply_key;
      if (supplyKey && fieldMap.raw_supply) {
        updateArgs[supplyKey] = this.denormalizeSupply(
          draft.variants ?? [],
          fieldMap,
        );
      }
      const priceBounds = this.computePriceBounds(draft.variants ?? []);
      if (fieldMap.min_price_key && priceBounds[0] != null) {
        updateArgs[fieldMap.min_price_key] = priceBounds[0];
      }
      if (fieldMap.max_price_key && priceBounds[1] != null) {
        updateArgs[fieldMap.max_price_key] = priceBounds[1];
      }
    }

    const imagesKey = fieldMap.images_key;
    if (
      imagesKey &&
      (fieldMap.images_mode === "string_list" ||
        fieldMap.images_mode === "dict_list")
    ) {
      updateArgs[imagesKey] = this.denormalizeImages(
        draft.images ?? [],
        fieldMap,
      );
      const mainImageKey = fieldMap.main_image_key;
      if (mainImageKey) {
        updateArgs[mainImageKey] = (draft.images ?? [null])[0];
      }
    } else if (imagesKey && draft.images != null) {
      warnings.push(
        "Image edits were skipped because the detected image structure could not be safely written back.",
      );
    }

    const updatePayload = await safeCall(() =>
      product.updateImportListItem(
        this.client,
        providerState.import_item_id,
        updateArgs,
      ),
    );
    this.raiseIfError(
      updatePayload,
      "Could not save the updated product draft. The import list item may have been modified or deleted.",
    );

    const store = await this.resolveStore(targetStore);
    const pushArgs = this.buildPushArguments(
      providerState.import_item_id,
      store.store_ref,
      visibilityMode,
      pushOptions,
    );
    warnings.push(
      ...(await this.refreshProductShippingInfo(providerState)),
    );
    warnings.push(
      ...(await this.attachShippingTemplateLogistics(
        providerState,
        store.store_ref,
        pushArgs,
      )),
    );
    warnings.push(
      ...(await this.attachStoreShippingProfile(
        store,
        pushArgs,
        pushOptions,
        providerState.import_item_id,
      )),
    );

    const pushPayload = await safeCall(() =>
      product.pushToStore(this.client, pushArgs),
    );
    this.raiseIfError(
      pushPayload,
      "Could not push the product to the store. Check that the store is connected and the product draft is valid.",
    );

    const eventId = this.findFirstValueByKeys(pushPayload, [
      "event_id",
      "eventId",
      "id",
    ]);
    let pushState = "requested";
    let statusPayload: Record<string, any> | null = null;
    if (eventId) {
      try {
        for (let attempt = 0; attempt < 4; attempt++) {
          statusPayload = await product.getPushStatus(
            this.client,
            String(eventId),
          );
          pushState = this.extractPushState(statusPayload);
          if (pushState === "failed" || pushState === "completed") break;
          if (attempt < 3) await sleep(10000);
        }
      } catch (pollErr: unknown) {
        warnings.push(
          `Push status polling failed (${pollErr instanceof Error ? pollErr.message : "unknown error"}). The push may still be processing — call dsers.job.status later to check.`,
        );
      }
    }
    if (pushState === "failed") {
      const pushError = this.extractPushError(statusPayload ?? {});
      if (pushError) warnings.push(`Provider push failed: ${pushError}`);
    }

    const visibilityApplied = pushOptions.publish_to_online_store
      ? "sell_immediately"
      : "backend_only";
    if (
      visibilityMode === "sell_immediately" &&
      !pushOptions.publish_to_online_store
    ) {
      warnings.push(
        "sell_immediately was requested, but publish_to_online_store resolved to false in push_options.",
      );
    }

    return {
      provider_label: "Private DSers Adapter",
      job_status: pushState,
      event_id: eventId,
      visibility_requested: visibilityMode,
      visibility_applied: visibilityApplied,
      push_options_applied: pushOptions,
      target_store: store.display_name ?? store.store_ref,
      warnings,
      summary: {
        title: draft.title,
        image_count: (draft.images ?? []).length,
        variant_count: (draft.variants ?? []).length,
      },
    };
  }

  // ── Internal helpers ──

  private raiseIfError(
    payload: Record<string, any>,
    genericMessage: string,
  ): void {
    if (payload?.error) {
      const detail = String(payload.detail ?? payload.error);
      if (detail.includes("PERMISSION_DENIED")) throw new Error(genericMessage);
      throw new Error(`${genericMessage} Provider detail: ${payload.error}`);
    }
  }

  private buildPushArguments(
    importItemId: string,
    storeRef: string,
    visibilityMode: string,
    pushOptions: Record<string, any>,
  ): Record<string, any> {
    const importListId = coerceNumericId(importItemId);
    const storeId = coerceNumericId(storeRef);
    const visible = Boolean(pushOptions.publish_to_online_store);
    const pushAllImages =
      String(pushOptions.image_strategy ?? "selected_only") === "all_available";
    const withPriceRule =
      String(pushOptions.pricing_rule_behavior ?? "keep_manual") ===
      "apply_store_pricing_rule";
    const autoInventoryUpdate = Boolean(pushOptions.auto_inventory_update);
    const autoPriceUpdate = Boolean(pushOptions.auto_price_update);
    const salesChannels: string[] = Array.isArray(pushOptions.sales_channels)
      ? pushOptions.sales_channels
      : [];

    const request: Record<string, any> = {
      importListIds: [importListId],
      storeIds: [storeId],
      visible,
      pushStatus: visibilityMode === "sell_immediately" ? "ACTIVE" : "DRAFT",
      inventoryPolicy: false,
      onlyPushSpecifications: Boolean(pushOptions.only_push_specifications),
      isPushAllImage: pushAllImages,
      storeLanguageList: [{ storeId, language: "EN" }],
      pushProducts: [{ importListId, pushLanguageCode: "EN" }],
      skus: [],
      stores: [],
      saleChannels: salesChannels,
      logistics: [
        {
          storeId,
          importListId,
          shipCost: "",
          logisticId: "",
          switch: true,
        },
      ],
      pricingRuleImportListIds: [{ importListId, storeId }],
    };
    if (withPriceRule) request.withPriceRule = true;
    request.myProductSyncSetting = {
      autoUpdateStock: autoInventoryUpdate,
      autoUpdatePrice: autoPriceUpdate,
      handleUpdatePrice: autoPriceUpdate,
    };
    return request;
  }

  private async refreshProductShippingInfo(
    providerState: Record<string, any>,
  ): Promise<string[]> {
    const sourceAppId = providerState.source_app_id;
    if (sourceAppId == null || sourceAppId === "") return [];

    const payload = await safeCall(() =>
      settings.getProductShippingInfo(
        this.client,
        coerceNumericId(sourceAppId),
      ),
    );
    if (payload?.error)
      return [
        "DSers product shipping config could not be loaded before refresh.",
      ];

    const data = payload.data as Record<string, any> | undefined;
    if (!data || typeof data !== "object")
      return [
        "DSers product shipping config payload was empty before refresh.",
      ];

    const shippingInfo = data.shippingInfo;
    if (
      !shippingInfo ||
      typeof shippingInfo !== "object" ||
      !Object.keys(shippingInfo).length
    )
      return [
        "DSers product shipping config did not include a reusable shippingInfo object.",
      ];

    const warns: string[] = [];
    let enabled = data.status;
    if (enabled == null) {
      enabled = Boolean(shippingInfo);
    } else if (!enabled) {
      enabled = true;
      warns.push(
        "Enabled DSers product shipping config because a shipping template already exists.",
      );
    }

    const updatePayload = await safeCall(() =>
      settings.updateProductShippingInfo(this.client, {
        status: Boolean(enabled),
        shippingInfo,
      }),
    );
    if (updatePayload?.error) {
      warns.push("DSers product shipping config refresh failed before push.");
      return warns;
    }
    warns.push("Refreshed DSers product shipping config before push.");
    return warns;
  }

  private async attachShippingTemplateLogistics(
    providerState: Record<string, any>,
    storeRef: string,
    pushArgs: Record<string, any>,
  ): Promise<string[]> {
    if (pushArgs.logistics?.length) return [];
    const sourceAppId = providerState.source_app_id;
    if (sourceAppId == null || sourceAppId === "") return [];

    const importListId = coerceNumericId(providerState.import_item_id);
    const storeId = coerceNumericId(storeRef);
    const country = String(providerState.country ?? "").trim().toUpperCase();
    const supplyProductId = String(
      providerState.supply_product_id ?? "",
    ).trim();

    const [serviceIds, sourceLabel, serviceWarnings] =
      await this.getTemplateServiceIds(sourceAppId, supplyProductId, country);
    const warnings = [...serviceWarnings];
    if (!serviceIds.length) return warnings;

    const availableIds = await this.getPushLogisticsIds(
      importListId,
      storeId,
    );
    let selectedId = "";
    if (availableIds.length) {
      selectedId = serviceIds.find((id) => availableIds.includes(id)) ?? "";
      if (!selectedId) {
        warnings.push(
          "DSers returned push-logistics options for the selected store, but none matched the current shipping template.",
        );
        return warnings;
      }
    } else {
      selectedId = serviceIds[0];
    }

    pushArgs.logistics = [
      { importListId, storeId, logisticId: selectedId },
    ];
    const appliedFrom = sourceLabel ? ` from ${sourceLabel}` : "";
    warnings.push(
      `Applied DSers shipping template logistic '${selectedId}'${appliedFrom} to the push request.`,
    );
    return warnings;
  }

  private async attachStoreShippingProfile(
    store: Record<string, any>,
    pushArgs: Record<string, any>,
    pushOptions: Record<string, any>,
    _importItemId?: string,
  ): Promise<string[]> {
    if (pushArgs.storeShippingProfile) return [];

    const storeRef = store.store_ref ?? "";
    const storeDomain = store.domain ?? "";
    const storeName = store.display_name ?? storeRef;
    const isShopify =
      storeDomain.includes(".myshopify.com") ||
      String(store.platform ?? "").toLowerCase() === "shopify";
    if (!isShopify) return [];

    const warnings: string[] = [];
    const storeId = coerceNumericId(storeRef);
    let profileItems: Record<string, any>[] | null = null;
    const desiredName = String(
      pushOptions.shipping_profile_name ?? "",
    ).trim();

    try {
      const profilesByStore = await this.fetchShopifyProfiles();
      const targetKey = String(storeId);
      const rawProfiles = profilesByStore[targetKey] ?? [];

      if (desiredName) {
        for (const profile of rawProfiles) {
          if (
            (profile.name ?? "").trim().toLowerCase() ===
            desiredName.toLowerCase()
          ) {
            profileItems = extractProfileGids(profile, targetKey);
            if (profileItems)
              warnings.push(
                `Matched shipping profile by name: '${desiredName}'.`,
              );
            break;
          }
        }
        if (!profileItems) {
          const available = rawProfiles.map((p: any) => p.name ?? "");
          warnings.push(
            `shipping_profile_name '${desiredName}' not found. Available profiles: ${JSON.stringify(available)}. Falling back to default.`,
          );
        }
      }

      if (!profileItems) {
        for (const profile of rawProfiles) {
          if (profile.isChecked) {
            profileItems = extractProfileGids(profile, targetKey);
            break;
          }
        }
      }
    } catch (profileErr: unknown) {
      warnings.push(`Could not query Shopify delivery profiles: ${profileErr instanceof Error ? profileErr.message : "unknown error"}`);
    }

    if (!profileItems) {
      const fallback = pushOptions.store_shipping_profile;
      if (Array.isArray(fallback) && fallback.length) {
        profileItems = fallback;
        warnings.push(
          "Using store_shipping_profile from push_options (API returned empty).",
        );
      }
    }

    if (profileItems) {
      pushArgs.storeShippingProfile = profileItems;
      warnings.push(
        "Attached Shopify delivery profile to the push request.",
      );
    } else {
      warnings.push(
        `Shopify store '${storeName}' (${storeDomain}) has no Delivery Profile ` +
          `configured in DSers. The push will likely fail with 'shipping profile ` +
          `not found'. To fix: open DSers web UI -> Settings -> Shipping -> configure ` +
          `a Delivery Profile for this store, or provide store_shipping_profile ` +
          `in push_options.`,
      );
    }
    return warnings;
  }

  private async getTemplateServiceIds(
    sourceAppId: any,
    supplyProductId: string,
    country: string,
  ): Promise<[string[], string, string[]]> {
    const warnings: string[] = [];
    const productPayload = await safeCall(() =>
      settings.getProductShipSettings(this.client, {
        supplierProductId: supplyProductId ? [supplyProductId] : undefined,
        supplierAppId: [coerceNumericId(sourceAppId)],
      }),
    );
    const [productIds, productScope] = this.extractProductShipServiceIds(
      productPayload,
      country,
    );
    if (productIds.length) {
      return [
        productIds,
        productScope || "product shipping settings",
        warnings,
      ];
    }

    if (productPayload?.error) {
      warnings.push(
        "DSers product-level shipping settings were unavailable; falling back to the user shipping template.",
      );
    }

    const shippingPayload = await safeCall(() =>
      settings.getProductShippingInfo(
        this.client,
        coerceNumericId(sourceAppId),
      ),
    );
    const [shippingIds, shippingScope] =
      this.extractShippingTemplateServiceIds(shippingPayload, country);
    if (shippingIds.length) {
      return [shippingIds, shippingScope || "shipping template", warnings];
    }

    if (shippingPayload?.error) {
      warnings.push(
        "DSers user shipping template could not be loaded before push.",
      );
    } else {
      warnings.push(
        "No DSers shipping template service was found for the selected source app and country.",
      );
    }
    return [[], "", warnings];
  }

  private async getPushLogisticsIds(
    importListId: any,
    storeId: any,
  ): Promise<string[]> {
    const payload = await safeCall(() =>
      product.getPushLogistics(this.client, {
        importListIds: [importListId],
        storeIds: [storeId],
      }),
    );
    if (payload?.error) return [];
    const data = payload.data;
    if (!data || typeof data !== "object") return [];

    const targetStore = String(storeId);
    const ids: string[] = [];
    for (const importPayload of Object.values(data as Record<string, any>)) {
      if (!importPayload || typeof importPayload !== "object") continue;
      for (const storePayload of (importPayload as any).storeLogistics ?? []) {
        if (!storePayload || typeof storePayload !== "object") continue;
        const currentStoreId = String(storePayload.storeId ?? "");
        if (currentStoreId && currentStoreId !== targetStore) continue;
        for (const item of storePayload.logistics ?? []) {
          if (!item || typeof item !== "object") continue;
          const serviceId = firstPresent(item, [
            "logisticId",
            "serviceId",
            "id",
          ]);
          if (serviceId && !ids.includes(String(serviceId))) {
            ids.push(String(serviceId));
          }
        }
      }
    }
    return ids;
  }

  private extractProductShipServiceIds(
    payload: Record<string, any>,
    country: string,
  ): [string[], string] {
    const data = payload.data;
    if (!Array.isArray(data)) return [[], ""];

    const candidates: [number, string[], string][] = [];
    for (const item of data) {
      if (!item || typeof item !== "object") continue;
      const freightInfo = item.freightInfo;
      if (!Array.isArray(freightInfo)) continue;
      const countryIds = this.pickFreightServiceIds(freightInfo, country);
      if (countryIds.length) {
        candidates.push([
          2,
          countryIds,
          country || "product shipping settings",
        ]);
        continue;
      }
      const globalIds = this.pickFreightServiceIds(freightInfo, "GLOBAL");
      if (globalIds.length) {
        candidates.push([
          1,
          globalIds,
          "Global product shipping settings",
        ]);
      }
    }
    if (!candidates.length) return [[], ""];
    candidates.sort((a, b) => b[0] - a[0]);
    return [candidates[0][1], candidates[0][2]];
  }

  private extractShippingTemplateServiceIds(
    payload: Record<string, any>,
    country: string,
  ): [string[], string] {
    const data = payload.data;
    if (!data || typeof data !== "object") return [[], ""];
    const shippingInfo = (data as any).shippingInfo;
    if (!shippingInfo || typeof shippingInfo !== "object") return [[], ""];

    const candidates: [number, string[], string][] = [];
    for (const entry of shippingInfo.shippingCountryList ?? []) {
      if (!entry || typeof entry !== "object") continue;
      const entryCountry = String(entry.country ?? "").trim();
      let score = 0;
      if (entryCountry.toUpperCase() === country && country) score = 2;
      else if (entryCountry.toUpperCase() === "GLOBAL") score = 1;
      if (!score) continue;
      const serviceIds = this.extractServiceIdsFromCountryEntry(entry);
      if (serviceIds.length) {
        candidates.push([
          score,
          serviceIds,
          entryCountry || "shipping template",
        ]);
      }
    }
    if (!candidates.length) return [[], ""];
    candidates.sort((a, b) => b[0] - a[0]);
    return [candidates[0][1], candidates[0][2]];
  }

  private pickFreightServiceIds(
    freightInfo: any[],
    country: string,
  ): string[] {
    const picked: string[] = [];
    for (const item of freightInfo) {
      if (!item || typeof item !== "object") continue;
      const shipTo = String(item.shipTo ?? "").trim().toUpperCase();
      if (shipTo !== country) continue;
      const serviceId = firstPresent(item, ["serviceId", "logisticId", "id"]);
      if (serviceId && !picked.includes(String(serviceId))) {
        picked.push(String(serviceId));
      }
    }
    return picked;
  }

  private extractServiceIdsFromCountryEntry(
    entry: Record<string, any>,
  ): string[] {
    const serviceIds: string[] = [];
    for (const item of entry.list ?? []) {
      const text = String(item ?? "").trim();
      if (text && !serviceIds.includes(text)) serviceIds.push(text);
    }
    for (const item of entry.logisticsInfo ?? []) {
      if (!item || typeof item !== "object") continue;
      const serviceId = firstPresent(item, ["serviceId", "logisticId", "id"]);
      if (serviceId && !serviceIds.includes(String(serviceId))) {
        serviceIds.push(String(serviceId));
      }
    }
    return serviceIds;
  }

  private hasReason(payload: Record<string, any>, reason: string): boolean {
    if (!payload || typeof payload !== "object") return false;
    const detail = String(payload.detail ?? payload.error ?? "");
    return detail.includes(reason);
  }

  private async listStores(): Promise<Record<string, any>[]> {
    const payload = await safeCall(() => account.listStores(this.client));
    const storeDicts = extractStoreDicts(payload);
    const stores: Record<string, any>[] = [];
    for (const item of storeDicts) {
      const storeRef = firstPresent(item, ["storeId", "id", "sellerStoreId"]);
      if (!storeRef) continue;
      const domain = String(firstPresent(item, ["domain"]) ?? "");
      let platform = firstPresent(item, ["platform", "storeType"]);
      if (!platform && domain.includes(".myshopify.com")) platform = "shopify";
      stores.push({
        store_ref: String(storeRef),
        display_name: String(
          firstPresent(item, [
            "sellerName",
            "storeName",
            "name",
            "nickname",
          ]) ?? storeRef,
        ),
        platform,
        domain,
      });
    }
    return stores;
  }

  private async fetchShopifyProfiles(): Promise<
    Record<string, Record<string, any>[]>
  > {
    try {
      const payload = await product.getShopifyShippingProfiles(this.client);
      const data = payload.data;
      if (!Array.isArray(data)) return {};
      const result: Record<string, Record<string, any>[]> = {};
      for (const entry of data) {
        if (entry?.storeId) {
          result[String(entry.storeId)] = entry.profiles ?? [];
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  private async enrichShopifyProfiles(
    stores: Record<string, any>[],
  ): Promise<Record<string, any>[]> {
    const hasShopify = stores.some(
      (s) =>
        (s.domain ?? "").includes(".myshopify.com") ||
        String(s.platform ?? "").toLowerCase() === "shopify",
    );
    if (!hasShopify) return stores;

    const profilesByStore = await this.fetchShopifyProfiles();
    if (!Object.keys(profilesByStore).length) return stores;

    return stores.map((s) => {
      const isShopify =
        (s.domain ?? "").includes(".myshopify.com") ||
        String(s.platform ?? "").toLowerCase() === "shopify";
      if (!isShopify) return s;
      const rawProfiles = profilesByStore[s.store_ref] ?? [];
      const readable = rawProfiles.map((p: any) => {
        const groups = p.profileGroups ?? [];
        const firstGroup = groups[0] ?? {};
        return {
          name: p.name ?? "",
          is_default: Boolean(p.isChecked),
          countries: Number(firstGroup.countryCount ?? 0),
          rate: firstGroup.rate ?? "",
          currency: firstGroup.currency ?? "",
        };
      });
      return { ...s, shipping_profiles: readable };
    });
  }

  private async resolveStore(
    targetStore: string | null,
  ): Promise<Record<string, any>> {
    const stores = await this.listStores();
    if (!stores.length)
      throw new Error(
        "No linked stores found. Connect a Shopify store in DSers before pushing products.",
      );
    const storeNames = stores
      .map((s) => `${s.display_name} (${s.store_ref})`)
      .join(", ");
    if (!targetStore) {
      if (stores.length === 1) return stores[0];
      throw new Error(
        `Multiple stores are available: ${storeNames}. Provide target_store with the store_ref or display_name from dsers.store.discover.`,
      );
    }
    const target = targetStore.trim().toLowerCase();
    for (const store of stores) {
      if (store.store_ref.toLowerCase() === target) return store;
      if (String(store.display_name ?? "").trim().toLowerCase() === target)
        return store;
    }
    throw new Error(
      `Unknown target_store '${targetStore}'. Available stores: ${storeNames}. Use the store_ref or display_name from dsers.store.discover.`,
    );
  }

  private extractSupplyProductId(payload: Record<string, any>): string {
    return String(
      this.findFirstValueByKeys(payload, [
        "supplyProductId",
        "productId",
        "itemId",
        "id",
      ]) ?? "",
    ).trim();
  }

  /**
   * Extract the DSers-internal (local) supplyProductId from a successful
   * import response.  AliExpress .us URLs use global IDs (3256…) that DSers
   * converts to standard IDs (1005…) at import time.
   */
  private extractLocalProductId(payload: Record<string, any>): string {
    const data = payload?.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const localId = String((data as Record<string, any>).supplyProductId ?? "").trim();
      if (localId && /^\d{5,}$/.test(localId)) return localId;
    }
    return "";
  }

  /**
   * Look up the product pool to discover the DSers-internal (local) product ID
   * for a given global product ID.  `.us` AliExpress URLs yield global IDs
   * (3256…) which DSers maps to standard IDs (1005…) internally.
   */
  private async resolveLocalProductId(
    globalId: string, appId: string, country: string,
  ): Promise<string> {
    try {
      const pool = await safeCall(() =>
        product.getPoolProductDetail(this.client, {
          productId: globalId,
          appId: Number(appId) || 0,
          shipTo: country,
        }),
      );
      const data = pool?.data;
      if (data && typeof data === "object") {
        const poolPid = String((data as Record<string, any>).supplyProductId ?? "").trim();
        if (poolPid && /^\d{5,}$/.test(poolPid) && poolPid !== globalId) return poolPid;
        const poolPid2 = String((data as Record<string, any>).productId ?? "").trim();
        if (poolPid2 && /^\d{5,}$/.test(poolPid2) && poolPid2 !== globalId) return poolPid2;
      }
    } catch (_resolveErr: unknown) { /* best-effort local ID resolution */ }
    return "";
  }

  // ── URL & ID parsing ──

  private extractAfTraceId(sourceUrl: string): string {
    try {
      const url = new URL(sourceUrl);
      const trace = url.searchParams.get("afTraceInfo") ?? "";
      const m = /^(\d{10,})/.exec(trace);
      return m ? m[1] : "";
    } catch (_urlErr: unknown) {
      return "";
    }
  }

  /**
   * Returns {valid, best_account, all_expired} for AliExpress suppliers.
   * Uses the /account-user-bff/v1/suppliers/list endpoint.
   */
  private async checkAliExpressAuth(): Promise<{
    valid: boolean;
    best_account: Record<string, any> | null;
    all_expired: boolean;
    details: string;
  }> {
    try {
      const payload = await account.listSuppliers(this.client) as Record<string, any>;
      const list: Record<string, any>[] =
        payload?.data?.list ?? payload?.data ?? [];
      const aeAppId = this.aliexpressAppId;
      const aeAccounts = list.filter(
        (s) => String(s.appid) === String(aeAppId),
      );
      if (aeAccounts.length === 0) {
        return {
          valid: false,
          best_account: null,
          all_expired: true,
          details:
            "No AliExpress supplier accounts linked. Go to DSers > Settings > Supplier to authorize your AliExpress account.",
        };
      }
      const now = Math.floor(Date.now() / 1000);
      let bestAccount: Record<string, any> | null = null;
      let bestExpire = 0;
      for (const a of aeAccounts) {
        const expire = parseInt(String(a.expireTime || "0"), 10) || 0;
        if (expire > bestExpire) {
          bestExpire = expire;
          bestAccount = a;
        }
      }
      if (bestExpire > now) {
        const daysLeft = Math.ceil((bestExpire - now) / 86400);
        return {
          valid: true,
          best_account: bestAccount,
          all_expired: false,
          details: `AliExpress authorization valid (${daysLeft} days remaining).`,
        };
      }
      const expiredAgo = Math.ceil((now - bestExpire) / 86400);
      return {
        valid: false,
        best_account: bestAccount,
        all_expired: true,
        details:
          `All AliExpress authorizations expired (most recent expired ${expiredAgo} day(s) ago). ` +
          "Re-authorize at DSers > Settings > Supplier > AliExpress > Reauthorize.",
      };
    } catch (authErr: unknown) {
      return {
        valid: true,
        best_account: null,
        all_expired: false,
        details: `Could not verify AliExpress authorization status: ${authErr instanceof Error ? authErr.message : "unknown error"}`,
      };
    }
  }

  /**
   * Auto-detect the correct appId for Alibaba.com imports.  DSers accounts
   * bind Alibaba via a specific supplier entry whose appId varies per account.
   * We discover it by trying parseProductUrl with a probe URL against each
   * supplier.  The result is cached for the session.
   */
  private async detectAlibabaAppId(): Promise<string> {
    if (this.resolvedAlibabaAppId) return this.resolvedAlibabaAppId;
    try {
      const payload = await account.listSuppliers(this.client) as Record<string, any>;
      const list: Record<string, any>[] =
        payload?.data?.list ?? payload?.data ?? [];
      const probeUrl = "https://www.alibaba.com/product-detail/probe_1.html";
      const seen = new Set<string>();
      for (const s of list) {
        const appId = String(s.appid ?? "");
        if (!appId || seen.has(appId) || appId === this.aliexpressAppId) continue;
        seen.add(appId);
        try {
          const r = await safeCall(() =>
            product.parseProductUrl(this.client, probeUrl, appId),
          );
          if (r && !r.error) {
            this.resolvedAlibabaAppId = appId;
            return appId;
          }
        } catch (_probeErr: unknown) { /* probe failed for this appId, try next */ }
      }
    } catch (_listErr: unknown) { /* could not list suppliers, use default */ }
    return this.alibabaAppId;
  }

  private cleanProductUrl(sourceUrl: string): string {
    try {
      const url = new URL(sourceUrl);
      return `${url.origin}${url.pathname}`;
    } catch (_parseErr: unknown) {
      return sourceUrl;
    }
  }

  private resolveSourceIdentifier(
    sourceUrl: string,
  ): [string, string, string] {
    sourceUrl = sourceUrl ?? "";
    let match = ALIEXPRESS_ID_PATTERN.exec(sourceUrl);
    if (match) return ["aliexpress", this.aliexpressAppId, match[1]];
    match = ALIBABA_ID_PATTERN.exec(sourceUrl);
    if (match) return ["alibaba", this.alibabaAppId, match[1]];
    match = ALI1688_ID_PATTERN.exec(sourceUrl);
    if (match) return ["1688", this.alibabaAppId, match[1]];
    return ["unknown", this.aliexpressAppId, ""];
  }

  private extractImportItemId(payload: Record<string, any>): string {
    const candidates = findAllValuesByKeys(payload, [
      "importListId",
      "id",
    ]);
    for (const value of candidates) {
      const text = String(value).trim();
      if (text) return text;
    }
    return "";
  }

  private async recoverImportItemId(searchIds: Set<string>): Promise<string> {
    if (searchIds.size === 0) return "";
    for (let page = 1; page <= 5; page++) {
      const listing = await product.getImportList(this.client, {
        page,
        pageSize: 100,
      });
      const items = extractImportItems(listing);
      for (const item of items) {
        const itemId = firstPresent(item, ["id", "importListId"]);
        if (!itemId) continue;
        const haystack = JSON.stringify(item);
        for (const needle of searchIds) {
          if (haystack.includes(needle)) return String(itemId);
        }
      }
      if (items.length < 100) break;
    }
    return "";
  }

  // ── Draft normalisation & de-normalisation ──

  private normalizeImportItem(
    payload: Record<string, any>,
  ): [Record<string, any>, Record<string, any>, string[]] {
    const item = extractImportItem(payload);
    const warnings: string[] = [];

    const titleKey = firstMatchingKey(item, [
      "title",
      "productTitle",
      "name",
    ]);
    const descriptionKey = firstMatchingKey(item, [
      "description",
      "descriptionHtml",
      "desc",
    ]);
    const rawTagsKey = firstMatchingKey(item, ["tags", "tagList"]);
    const tagsKey: string | null = null;
    const [imagesKey, images, imagesMode] = extractImages(item);
    const [variantsKey, variants] = extractVariants(item);
    const mainImageKey = firstMatchingKey(item, [
      "mainImgUrl",
      "mainImageUrl",
    ]);
    const priceEditFlagKey = firstMatchingKey(item, ["isPriceEdited"]);
    const minPriceKey = firstMatchingKey(item, ["minPrice"]);
    const maxPriceKey = firstMatchingKey(item, ["maxPrice"]);
    const supplyKey = firstMatchingKey(item, ["supply"]);
    const totalInventoryKey = firstMatchingKey(item, [
      "totalInventory",
      "totalStock",
      "inventoryQuantity",
    ]);

    if (!titleKey)
      warnings.push(
        "Could not detect a title field in the imported product. Using an empty title fallback.",
      );
    if (!imagesKey)
      warnings.push(
        "Could not detect a top-level images field. Image edits may be limited.",
      );
    if (!variantsKey)
      warnings.push(
        "Could not detect a variants field. Pricing rule edits may be limited.",
      );
    if (rawTagsKey)
      warnings.push(
        "Tag edits are preview-only because the DSers import list API does not support direct tag writes for this item type.",
      );

    const totalInventory = totalInventoryKey
      ? asFloat(item[totalInventoryKey])
      : null;

    const draft = {
      title: String(item[titleKey!] ?? ""),
      description_html: String(item[descriptionKey!] ?? ""),
      images,
      tags: rawTagsKey ? [...(item[rawTagsKey] ?? [])] : [],
      variants,
      total_inventory: totalInventory,
    };
    const fieldMap: Record<string, any> = {
      title_key: titleKey,
      description_key: descriptionKey,
      tags_key: tagsKey,
      images_key: imagesKey,
      images_mode: imagesMode,
      main_image_key: mainImageKey,
      raw_images: imagesKey ? structuredClone(item[imagesKey] ?? []) : [],
      variants_key: variantsKey,
      raw_variants: variantsKey
        ? structuredClone(item[variantsKey] ?? [])
        : [],
      price_edit_flag_key: priceEditFlagKey,
      min_price_key: minPriceKey,
      max_price_key: maxPriceKey,
      supply_key: supplyKey,
      raw_supply: supplyKey ? structuredClone(item[supplyKey] ?? {}) : {},
      variant_ref_key: "variant_ref",
    };
    return [draft, fieldMap, warnings];
  }

  private denormalizeVariants(
    normalizedVariants: Record<string, any>[],
    fieldMap: Record<string, any>,
  ): Record<string, any>[] {
    const rawVariants: Record<string, any>[] = structuredClone(
      fieldMap.raw_variants ?? [],
    );
    if (!rawVariants.length) return normalizedVariants;

    for (let idx = 0; idx < normalizedVariants.length; idx++) {
      if (idx >= rawVariants.length) break;
      const normalized = normalizedVariants[idx];
      const rawVariant = rawVariants[idx];
      const offerKey = firstMatchingKey(rawVariant, [
        "sellPrice",
        "salePrice",
        "price",
      ]);
      const supplierKey = firstMatchingKey(rawVariant, [
        "supplierPrice",
        "buyPrice",
        "cost",
      ]);
      const ttlKey = firstMatchingKey(rawVariant, [
        "title",
        "name",
        "skuTitle",
      ]);
      const skuKey = firstMatchingKey(rawVariant, [
        "sku",
        "sellerSku",
        "itemSku",
        "skuCode",
      ]);
      const imageKey = firstMatchingKey(rawVariant, [
        "imageUrl",
        "image",
        "imgUrl",
      ]);

      if (offerKey)
        rawVariant[offerKey] = coerceLike(
          rawVariant[offerKey],
          normalized.offer_price,
        );
      if (supplierKey && normalized.supplier_price != null)
        rawVariant[supplierKey] = coerceLike(
          rawVariant[supplierKey],
          normalized.supplier_price,
        );
      if (ttlKey) rawVariant[ttlKey] = normalized.title;
      if (skuKey) rawVariant[skuKey] = normalized.sku;
      if (imageKey && normalized.image_url)
        rawVariant[imageKey] = normalized.image_url;
    }
    return rawVariants;
  }

  private denormalizeSupply(
    normalizedVariants: Record<string, any>[],
    fieldMap: Record<string, any>,
  ): Record<string, any> {
    const rawSupply: Record<string, any> = structuredClone(
      fieldMap.raw_supply ?? {},
    );
    if (typeof rawSupply !== "object") return {};

    const variantsByRef: Record<string, Record<string, any>> = {};
    for (const item of normalizedVariants) {
      const ref = String(
        item[fieldMap.variant_ref_key ?? "variant_ref"] ?? "",
      );
      if (ref) variantsByRef[ref] = item;
    }
    for (const [supplyRef, rawEntry] of Object.entries(rawSupply)) {
      if (!rawEntry || typeof rawEntry !== "object") continue;
      const normalized = variantsByRef[supplyRef];
      if (!normalized) continue;
      const offerKey = firstMatchingKey(rawEntry as Record<string, any>, [
        "sellPrice",
        "salePrice",
        "price",
      ]);
      const supplierKey = firstMatchingKey(rawEntry as Record<string, any>, [
        "supplierPrice",
        "buyPrice",
        "cost",
      ]);
      const compareKey = firstMatchingKey(rawEntry as Record<string, any>, [
        "compareAtPrice",
      ]);
      if (offerKey)
        (rawEntry as any)[offerKey] = coerceLike(
          (rawEntry as any)[offerKey],
          normalized.offer_price,
        );
      if (supplierKey && normalized.supplier_price != null)
        (rawEntry as any)[supplierKey] = coerceLike(
          (rawEntry as any)[supplierKey],
          normalized.supplier_price,
        );
      if (compareKey && normalized.offer_price != null)
        (rawEntry as any)[compareKey] = coerceLike(
          (rawEntry as any)[compareKey],
          normalized.offer_price,
        );
    }
    return rawSupply;
  }

  private denormalizeImages(
    normalizedImages: string[],
    fieldMap: Record<string, any>,
  ): any[] {
    const rawImages: any[] = structuredClone(fieldMap.raw_images ?? []);
    if (!rawImages.length) return normalizedImages;
    if (fieldMap.images_mode === "string_list") {
      return normalizedImages.filter((item) => item);
    }
    if (fieldMap.images_mode !== "dict_list") return rawImages;

    const result: any[] = [];
    for (let idx = 0; idx < normalizedImages.length; idx++) {
      const url = normalizedImages[idx];
      if (!url) continue;
      const template =
        idx < rawImages.length && typeof rawImages[idx] === "object"
          ? rawImages[idx]
          : {};
      const entry = { ...template };
      const imgKey = firstMatchingKey(entry, [
        "url",
        "imageUrl",
        "src",
        "originUrl",
        "imgUrl",
      ]);
      if (imgKey) {
        entry[imgKey] = url;
      } else if (Object.keys(entry).length) {
        const firstKey = Object.keys(entry)[0];
        entry[firstKey] = url;
      } else {
        result.push({ url });
        continue;
      }
      result.push(entry);
    }
    return result;
  }

  private computePriceBounds(
    normalizedVariants: Record<string, any>[],
  ): [string | null, string | null] {
    const prices = normalizedVariants
      .map((v) => asFloat(v.offer_price))
      .filter((p): p is number => p != null);
    if (!prices.length) return [null, null];
    return [formatScalar(Math.min(...prices)), formatScalar(Math.max(...prices))];
  }

  // ── Push status parsing ──

  private extractPushState(payload: Record<string, any>): string {
    const state = this.findFirstValueByKeys(payload, [
      "status",
      "state",
      "result",
    ]);
    const mapped: Record<string, string> = {
      "0": "requested",
      "1": "requested",
      "4": "failed",
      "5": "completed",
    };
    return mapped[String(state)] ?? String(state ?? "requested");
  }

  private extractPushError(payload: Record<string, any>): string {
    const message = this.findFirstValueByKeys(payload, [
      "errmsg",
      "message",
      "detail",
      "error",
    ]);
    const reason = this.findFirstValueByKeys(payload, ["reason"]);
    const pieces = [message, reason]
      .filter((p) => p != null && p !== "")
      .map((p) => String(p).trim());
    return [...new Set(pieces)].join(" | ");
  }

  // ── Generic JSON traversal helpers ──

  private findFirstValueByKeys(node: any, keys: string[]): any {
    return findFirstValueByKeys(node, keys);
  }

  async fetchImportItem(importItemId: string): Promise<Record<string, any>> {
    const payload = await safeCall(() =>
      product.getImportListItem(this.client, importItemId),
    );
    this.raiseIfError(
      payload,
      "Could not re-fetch the import list item for job recovery. The item may have been deleted.",
    );
    return payload;
  }

  normalizeForRecovery(
    itemPayload: Record<string, any>,
  ): [Record<string, any>, Record<string, any>] {
    const [draft, fieldMap] = this.normalizeImportItem(itemPayload);
    return [draft, fieldMap];
  }
}

// ── Standalone utility functions ──

function coerceNumericId(value: any): any {
  const text = String(value ?? "").trim();
  if (!/^-?\d+$/.test(text)) return value;
  const num = Number(text);
  return Number.isSafeInteger(num) ? num : text;
}

function firstPresent(node: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const value = node[key];
    if (value != null && value !== "") return value;
  }
  return null;
}

function firstMatchingKey(
  node: Record<string, any>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (key in node) return key;
  }
  return null;
}

function findFirstValueByKeys(node: any, keys: string[]): any {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const key of keys) {
      if (key in node && node[key] != null && node[key] !== "")
        return node[key];
    }
    for (const value of Object.values(node)) {
      const found = findFirstValueByKeys(value, keys);
      if (found != null && found !== "") return found;
    }
  } else if (Array.isArray(node)) {
    for (const value of node) {
      const found = findFirstValueByKeys(value, keys);
      if (found != null && found !== "") return found;
    }
  }
  return null;
}

function findAllValuesByKeys(node: any, keys: string[]): any[] {
  const found: any[] = [];
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const key of keys) {
      if (key in node && node[key] != null && node[key] !== "")
        found.push(node[key]);
    }
    for (const value of Object.values(node)) {
      found.push(...findAllValuesByKeys(value, keys));
    }
  } else if (Array.isArray(node)) {
    for (const value of node) {
      found.push(...findAllValuesByKeys(value, keys));
    }
  }
  return found;
}

function findListCandidates(
  node: any,
  prefix = "root",
): [string, Record<string, any>[]][] {
  const results: [string, Record<string, any>[]][] = [];
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      const childPrefix = `${prefix}.${key}`;
      if (
        Array.isArray(value) &&
        value.length &&
        value.every((item) => item && typeof item === "object")
      ) {
        results.push([childPrefix, value]);
      }
      results.push(...findListCandidates(value, childPrefix));
    }
  } else if (Array.isArray(node)) {
    for (let idx = 0; idx < node.length; idx++) {
      results.push(...findListCandidates(node[idx], `${prefix}[${idx}]`));
    }
  }
  return results;
}

function extractStoreDicts(
  payload: Record<string, any>,
): Record<string, any>[] {
  const candidates = findListCandidates(payload);
  const scored: [number, Record<string, any>[]][] = [];
  for (const [key, items] of candidates) {
    if (!items.length) continue;
    let score = 0;
    if (key.toLowerCase().includes("store")) score += 2;
    if (firstPresent(items[0], ["storeId", "id"])) score += 1;
    scored.push([score, items]);
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b[0] - a[0]);
  return scored[0][1];
}

function extractImportItems(
  payload: Record<string, any>,
): Record<string, any>[] {
  const candidates = findListCandidates(payload);
  const scored: [number, Record<string, any>[]][] = [];
  for (const [key, items] of candidates) {
    if (!items.length) continue;
    let score = 0;
    if (key.toLowerCase().includes("import")) score += 2;
    if (firstPresent(items[0], ["id", "importListId"])) score += 1;
    scored.push([score, items]);
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b[0] - a[0]);
  return scored[0][1];
}

function extractImportItem(payload: Record<string, any>): Record<string, any> {
  const data = payload.data ?? payload;
  if (data && typeof data === "object" && !Array.isArray(data)) return data;
  if (Array.isArray(data) && data.length && typeof data[0] === "object")
    return data[0];
  if (payload && typeof payload === "object") return payload;
  throw new Error(
    "Could not parse the imported product data. The API response format may have changed.",
  );
}

function extractImages(
  item: Record<string, any>,
): [string | null, string[], string] {
  for (const key of [
    "medias",
    "images",
    "productImages",
    "imageList",
    "mainImages",
  ]) {
    const value = item[key];
    if (!Array.isArray(value)) continue;
    if (!value.length) return [key, [], "string_list"];
    if (value.every((entry) => typeof entry === "string")) {
      return [key, value.filter((e) => e), "string_list"];
    }
    const urls: string[] = [];
    for (const entry of value) {
      if (entry && typeof entry === "object") {
        const url = firstPresent(entry, [
          "url",
          "imageUrl",
          "src",
          "originUrl",
          "imgUrl",
        ]);
        if (url) urls.push(String(url));
      }
    }
    if (urls.length) return [key, urls, "dict_list"];
  }
  return [null, variantImages(item), "unknown"];
}

function extractVariants(
  item: Record<string, any>,
): [string | null, Record<string, any>[]] {
  for (const key of [
    "variants",
    "skuList",
    "variantList",
    "productSkuList",
  ]) {
    const value = item[key];
    if (!Array.isArray(value)) continue;
    const normalized: Record<string, any>[] = [];
    for (let idx = 0; idx < value.length; idx++) {
      const raw = value[idx];
      if (!raw || typeof raw !== "object") continue;
      const variantRef =
        firstPresent(raw, ["id", "variantId", "skuId", "sellerSku"]) ??
        `variant-${idx}`;
      normalized.push({
        variant_ref: String(variantRef),
        title: String(
          firstPresent(raw, ["title", "name", "skuTitle", "skuAttr"]) ??
            `Variant ${idx + 1}`,
        ),
        supplier_price: asFloat(
          firstPresent(raw, [
            "supplierPrice",
            "buyPrice",
            "cost",
            "price",
          ]),
        ),
        offer_price: asFloat(
          firstPresent(raw, ["sellPrice", "salePrice", "price"]),
        ),
        stock: asFloat(
          firstPresent(raw, [
            "stock",
            "quantity",
            "inventory",
            "availableStock",
            "skuStock",
          ]),
        ),
        sku: String(
          firstPresent(raw, [
            "sku",
            "sellerSku",
            "itemSku",
            "skuCode",
          ]) ?? "",
        ),
        image_url: String(
          firstPresent(raw, ["imageUrl", "image", "imgUrl"]) ?? "",
        ),
      });
    }
    return [key, normalized];
  }
  return [null, []];
}

function variantImages(item: Record<string, any>): string[] {
  const [, variants] = extractVariants(item);
  const seen: string[] = [];
  for (const variant of variants) {
    const url = variant.image_url;
    if (url && !seen.includes(url)) seen.push(url);
  }
  return seen;
}

function extractProfileGids(
  profile: Record<string, any>,
  storeId: string,
): Record<string, any>[] | null {
  const profileId = profile.id ?? "";
  const groups = profile.profileGroups ?? [];
  const locationId = groups.length ? groups[0].id ?? "" : "";
  if (profileId && locationId)
    return [{ storeId, locationId, profileId }];
  return null;
}

function asFloat(value: any): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

function coerceLike(original: any, value: any): any {
  if (value == null) return value;
  if (typeof original === "string") return formatScalar(value);
  return value;
}

function formatScalar(value: any): string {
  const n = Number(value);
  if (isNaN(n)) return String(value);
  if (Number.isInteger(n)) return String(n);
  let text = n.toFixed(2);
  text = text.replace(/0+$/, "").replace(/\.$/, "");
  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildProvider(config?: DSersConfig): ImportProvider {
  return new PrivateDsersProvider(config);
}
