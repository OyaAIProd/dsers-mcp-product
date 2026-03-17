/**
 * DSers Account API – BFF wrappers for stores, users, staffs, suppliers, and apps.
 */
import type { DSersClient } from "./client.js";

export async function listStores(client: DSersClient): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/stores/user/list");
}

export async function getStoreDetail(
  client: DSersClient,
  storeId: string,
): Promise<Record<string, unknown>> {
  return client.get("/account-user-bff/v1/stores/detail", { storeId });
}

export async function getUserInfo(client: DSersClient): Promise<Record<string, unknown>> {
  return client.get("/account-user-bff/v1/users/info");
}

export async function updateUserInfo(
  client: DSersClient,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/users/info", body);
}

export async function bindStore(
  client: DSersClient,
  platform: string,
  authCode: string,
): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/stores/bindStore", { platform, authCode });
}

export async function unbindStore(
  client: DSersClient,
  storeId: string,
): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/stores/unbind", { storeId });
}

export async function listStaff(client: DSersClient): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/staffs/list");
}

export async function inviteStaff(
  client: DSersClient,
  email: string,
  permissions: string[],
): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/staffs/invite", { email, permissions });
}

export async function removeStaff(
  client: DSersClient,
  staffId: string,
): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/staffs/remove", { staffId });
}

export async function updateStaffPermission(
  client: DSersClient,
  staffId: string,
  permissions: string[],
): Promise<Record<string, unknown>> {
  return client.post("/account-user-bff/v1/staffs/permission", { staffId, permissions });
}

export async function listSuppliers(client: DSersClient): Promise<Record<string, unknown>> {
  return client.get("/account-user-bff/v1/suppliers/list");
}

export async function listApps(client: DSersClient): Promise<Record<string, unknown>> {
  return client.get("/account-user-bff/v1/apps/list");
}
