/**
 * DSers Product API — BFF wrappers and push-flow utilities for dsers-product-bff.
 */
import type { DSersClient } from "./client.js";

export function cleanNone(value: unknown): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, cleanNone(v)]),
    );
  }
  if (Array.isArray(value)) {
    return value.filter((v) => v != null).map((v) => cleanNone(v));
  }
  return value;
}

export function coerceIntId(value: unknown): unknown {
  if (typeof value === "string") {
    const text = value.trim();
    if (/^-?\d+$/.test(text)) {
      const n = parseInt(text, 10);
      if (!Number.isNaN(n) && Number.isSafeInteger(n)) return n;
      return text;
    }
  }
  return value;
}

export function mergeLegacyPushSettings(
  target: Record<string, unknown>,
  source: unknown,
): void {
  if (source === null || typeof source !== "object" || Array.isArray(source)) return;

  const src = source as Record<string, unknown>;
  const setIfMissing = (key: string, val: unknown) => {
    if (val !== undefined && val !== null && (target[key] === undefined || target[key] === null)) {
      target[key] = val;
    }
  };

  const visibleKeys = [
    "visible",
    "publishToOnlineStore",
    "pushOnlineStore",
    "alsoPublishToOnlineStore",
    "publishOnlineStore",
  ];
  for (const key of visibleKeys) {
    if (key in src) {
      setIfMissing("visible", Boolean(src[key]));
      break;
    }
  }

  const inventoryKeys = ["inventoryPolicy", "outofStockSelling"];
  for (const key of inventoryKeys) {
    if (key in src) {
      setIfMissing("inventoryPolicy", Boolean(src[key]));
      break;
    }
  }

  if ("onlyPushSpecifications" in src) {
    setIfMissing("onlyPushSpecifications", Boolean(src.onlyPushSpecifications));
  }

  const imageKeys = ["isPushAllImage", "isPushAllImages", "pushAllImages"];
  for (const key of imageKeys) {
    if (key in src) {
      setIfMissing("isPushAllImage", Boolean(src[key]));
      break;
    }
  }

  const priceRuleKeys = [
    "withPriceRule",
    "applyPricingRule",
    "pricing",
    "pricingRuleApplied",
    "usePricingRule",
  ];
  for (const key of priceRuleKeys) {
    if (key in src) {
      setIfMissing("withPriceRule", Boolean(src[key]));
      break;
    }
  }

  const saleChannelKeys = ["saleChannels", "salesChannels", "publishChannels"];
  for (const key of saleChannelKeys) {
    if (src[key] != null) {
      setIfMissing("saleChannels", src[key]);
      break;
    }
  }

  let pushStatus = src.pushStatus;
  if (pushStatus == null && src.pushAsDraft != null) {
    const pad = String(src.pushAsDraft ?? "").trim().toUpperCase();
    if (pad === "ACTIVE" || pad === "TRUE") pushStatus = "ACTIVE";
    else if (pad === "DRAFT" || pad === "FALSE") pushStatus = "DRAFT";
  }
  if (typeof pushStatus === "string") {
    const norm = pushStatus.trim().toUpperCase();
    if (norm === "ACTIVE" || norm === "DRAFT") setIfMissing("pushStatus", norm);
  }

  let sync = target.myProductSyncSetting;
  if (sync === null || typeof sync !== "object" || Array.isArray(sync)) sync = {};
  const syncObj = sync as Record<string, unknown>;
  let syncChanged = false;
  const syncMappings: [string, string][] = [
    ["autoUpdateStock", "autoUpdateStock"],
    ["autoInventoryUpdate", "autoUpdateStock"],
    ["automaticInventoryUpdate", "autoUpdateStock"],
    ["autoUpdatePrice", "autoUpdatePrice"],
    ["automaticPriceUpdate", "autoUpdatePrice"],
    ["handleUpdatePrice", "handleUpdatePrice"],
  ];
  for (const [sk, tk] of syncMappings) {
    if (src[sk] != null && (syncObj[tk] === undefined || syncObj[tk] === null)) {
      syncObj[tk] = Boolean(src[sk]);
      syncChanged = true;
    }
  }
  if (syncChanged) {
    target.myProductSyncSetting =
      target.myProductSyncSetting == null ? syncObj : syncObj;
  }
}

export function normalizePushProductPayload(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const rawData = args.data;
  let payload: Record<string, unknown>;
  if (rawData !== null && typeof rawData === "object" && !Array.isArray(rawData)) {
    payload = Object.fromEntries(
      Object.entries(rawData).filter(([, v]) => v != null),
    );
  } else {
    const exclude = new Set(["data", "storeId", "pushOptions", "storeParams"]);
    payload = Object.fromEntries(
      Object.entries(args).filter(
        ([k, v]) => v != null && !exclude.has(k),
      ),
    );
  }

  if (payload.storeIds == null && args.storeId != null) {
    payload.storeIds = [args.storeId];
  }

  const storeParams = args.storeParams;
  if (payload.storeIds == null && Array.isArray(storeParams)) {
    const storeIds = storeParams
      .filter(
        (item): item is Record<string, unknown> =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
      .map((item) => item.storeId)
      .filter((id): id is unknown => id != null);
    if (storeIds.length > 0) payload.storeIds = storeIds;
  }

  mergeLegacyPushSettings(payload, args.pushOptions);
  if (Array.isArray(storeParams) && storeParams.length > 0) {
    mergeLegacyPushSettings(payload, storeParams[0]);
  }

  const coerce = (v: unknown) => coerceIntId(v);

  if (Array.isArray(payload.importListIds)) {
    payload.importListIds = payload.importListIds.map(coerce);
  }
  if (Array.isArray(payload.storeIds)) {
    payload.storeIds = payload.storeIds.map(coerce);
  }
  if (Array.isArray(payload.pushProducts)) {
    for (const item of payload.pushProducts) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).importListId != null
      ) {
        (item as Record<string, unknown>).importListId = coerce(
          (item as Record<string, unknown>).importListId,
        );
      }
    }
  }
  if (Array.isArray(payload.stores)) {
    for (const item of payload.stores) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).storeId != null
      ) {
        (item as Record<string, unknown>).storeId = coerce(
          (item as Record<string, unknown>).storeId,
        );
      }
    }
  }
  if (Array.isArray(payload.pricingRuleImportListIds)) {
    for (const item of payload.pricingRuleImportListIds) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        if (o.importListId != null) o.importListId = coerce(o.importListId);
        if (o.storeId != null) o.storeId = coerce(o.storeId);
      }
    }
  }
  if (Array.isArray(payload.storeLanguageList)) {
    for (const item of payload.storeLanguageList) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).storeId != null
      ) {
        (item as Record<string, unknown>).storeId = coerce(
          (item as Record<string, unknown>).storeId,
        );
      }
    }
  }
  if (Array.isArray(payload.logistics)) {
    for (const item of payload.logistics) {
      if (item !== null && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        if (o.importListId != null) o.importListId = coerce(o.importListId);
        if (o.storeId != null) o.storeId = coerce(o.storeId);
      }
    }
  }
  if (Array.isArray(payload.storeShippingProfile)) {
    for (const item of payload.storeShippingProfile) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        (item as Record<string, unknown>).storeId != null
      ) {
        (item as Record<string, unknown>).storeId = coerce(
          (item as Record<string, unknown>).storeId,
        );
      }
    }
  }

  return cleanNone(payload) as Record<string, unknown>;
}

export async function getImportList(
  client: DSersClient,
  params?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const p = params ?? {};
  const filtered = Object.fromEntries(
    Object.entries(p).filter(([, v]) => v != null),
  );
  return client.get("/dsers-product-bff/import-list", filtered);
}

export async function getImportListItem(
  client: DSersClient,
  id: string,
): Promise<Record<string, unknown>> {
  return client.get(`/dsers-product-bff/import-list/${id}`);
}

export async function importByProductId(
  client: DSersClient,
  body: {
    supplyProductId: string;
    supplyAppId: string | number;
    country: string;
    language?: string[];
  },
): Promise<Record<string, unknown>> {
  return client.post("/dsers-product-bff/import-list/product-id", body);
}

export async function importByProductIdBatch(
  client: DSersClient,
  body: {
    supplyProductIds: string[];
    supplyAppId: string | number;
    country: string;
    isBackError?: number;
  },
): Promise<Record<string, unknown>> {
  return client.post("/dsers-product-bff/import-list/product-id-batch", body);
}

export async function updateImportListItem(
  client: DSersClient,
  id: string,
  updates: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const existing = await client.get(`/dsers-product-bff/import-list/${id}`);
  const product =
    existing?.data != null ? existing.data : existing;
  const data =
    product !== null && typeof product === "object" && !Array.isArray(product)
      ? { ...(product as Record<string, unknown>), ...updates }
      : updates;
  return client.put(`/dsers-product-bff/import-list/${id}`, data as Record<string, unknown>);
}

export async function deleteImportList(
  client: DSersClient,
  ids: string,
): Promise<Record<string, unknown>> {
  return client.delete(`/dsers-product-bff/import-list/${ids}`);
}

export async function pushToStore(
  client: DSersClient,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const normalized = normalizePushProductPayload(payload);
  return client.post("/dsers-product-bff/import-list/push", {
    data: normalized,
  });
}

export async function pushBeforeCheck(
  client: DSersClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return client.post("/dsers-product-bff/import-list/push-before/check", body);
}

export async function getPushPrice(
  client: DSersClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return client.post("/dsers-product-bff/import-list/push-price", body);
}

export async function getPushLogistics(
  client: DSersClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return client.post("/dsers-product-bff/import-list/push-logistics", body);
}

export async function getPushStatus(
  client: DSersClient,
  eventId: string,
): Promise<Record<string, unknown>> {
  return client.get(`/dsers-product-bff/import-list/push/${eventId}`);
}

export async function getStoreShippingProfile(
  client: DSersClient,
  storeId?: string,
): Promise<Record<string, unknown>> {
  const params = storeId != null ? { storeId } : undefined;
  return client.get(
    "/dsers-product-bff/import-list/push/store-shipping-profile",
    params,
  );
}

export async function getShopifyShippingProfiles(
  client: DSersClient,
): Promise<Record<string, unknown>> {
  return client.get("/dsers-product-bff/import-list/shopify/shipping-profile/get");
}

export async function listImportTags(
  client: DSersClient,
): Promise<Record<string, unknown>> {
  return client.get("/dsers-product-bff/import-list/all/tags");
}

export async function getMyProducts(
  client: DSersClient,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return client.get("/dsers-product-bff/my-product", params);
}

export async function getMapping(
  client: DSersClient,
  dsersProductId: string,
): Promise<Record<string, unknown>> {
  return client.get(`/dsers-product-bff/mapping/${dsersProductId}`);
}

export async function findSuppliers(
  client: DSersClient,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return client.get("/dsers-product-bff/find-suppliers/products", params);
}

export async function parseProductUrl(
  client: DSersClient,
  url: string,
  appId: string | number,
): Promise<Record<string, unknown>> {
  return client.post("/dsers-product-bff/supplier/parse-product-url", {
    url,
    appId,
  });
}

export async function getPoolProductDetail(
  client: DSersClient,
  params: { productId: string; appId: number; shipTo: string },
): Promise<Record<string, unknown>> {
  return client.get(
    "/dsers-product-bff/product-pool/product/detail",
    params as Record<string, unknown>,
  );
}
