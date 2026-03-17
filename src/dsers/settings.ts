/**
 * DSers Settings API – BFF wrappers for pricing, shipping, billing, and plan settings.
 */
import type { DSersClient } from "./client.js";

export async function getGlobalSettings(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/infra-setting-bff/setting/list");
}

export async function getPricingRules(
  client: DSersClient,
  storeId: string,
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/product/pricing-rule", { storeId });
}

export async function updatePricingRule(
  client: DSersClient,
  rule: Record<string, any>,
): Promise<Record<string, any>> {
  return client.put("/dsers-settings-bff/product/pricing-rule", rule);
}

export async function getAutoSyncPrice(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/product/auto-sync-price");
}

export async function updateAutoSyncPrice(
  client: DSersClient,
  settings: Record<string, any>,
): Promise<Record<string, any>> {
  return client.put("/dsers-settings-bff/product/auto-sync-price", settings);
}

export async function getAutomatedMapping(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/product/automated-mapping");
}

export async function updateAutomatedMapping(
  client: DSersClient,
  settings: Record<string, any>,
): Promise<Record<string, any>> {
  return client.put("/dsers-settings-bff/product/automated-mapping", settings);
}

export async function getProductShippingInfo(
  client: DSersClient,
  supplierAppId: string | number,
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/product/shipping/get", {
    supplierAppId,
  });
}

export async function updateProductShippingInfo(
  client: DSersClient,
  body: { shippingInfo: Record<string, any>; status?: boolean },
): Promise<Record<string, any>> {
  return client.put("/dsers-settings-bff/product/shipping/update", body);
}

export async function getProductShipSettings(
  client: DSersClient,
  params?: { supplierProductId?: string[]; supplierAppId?: (string | number)[] },
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/product/pro-shipping/get", params);
}

export async function getShippingAddresses(
  client: DSersClient,
  page?: number,
  pageSize?: number,
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/order/shipping-address", {
    page,
    pageSize,
  });
}

export async function addShippingAddress(
  client: DSersClient,
  address: Record<string, any>,
): Promise<Record<string, any>> {
  return client.post("/dsers-settings-bff/order/shipping-address", address);
}

export async function getPhoneList(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-settings-bff/order/phone-list");
}

export async function getBillList(
  client: DSersClient,
  page?: number,
  pageSize?: number,
): Promise<Record<string, any>> {
  return client.get("/dsers-pay-bff/v1/bill/list", { page, pageSize });
}

export async function getBillDetail(
  client: DSersClient,
  billId: string,
): Promise<Record<string, any>> {
  return client.get("/dsers-pay-bff/v1/bill/detail", { billId });
}

export async function getPaymentMethods(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-pay-bff/v1/pay/methods");
}

export async function getCurrentPlan(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-plan-bff/plan");
}

export async function getPlanLimits(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-plan-bff/limit");
}

export async function getAllPlans(
  client: DSersClient,
): Promise<Record<string, any>> {
  return client.get("/dsers-plan-bff/plan/all-type-limit");
}
