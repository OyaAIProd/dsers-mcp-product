import {
  randomBytes, createCipheriv, createDecipheriv, createHash,
} from "node:crypto";
import {
  readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync,
} from "node:fs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, userInfo } from "node:os";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const PACKAGE_SEED = "dsers-mcp-product-v1";

export interface StoredSession {
  session_id: string;
  state: string;
  base_url: string;
  ts: number;
}

function getCredDir(): string {
  return join(homedir(), ".dsers-mcp");
}

function getCredFile(): string {
  return join(getCredDir(), "credentials");
}

function deriveKey(): Buffer {
  const host = hostname();
  let user = "";
  try { user = userInfo().username; } catch (_osErr: unknown) { user = process.env.USER ?? process.env.USERNAME ?? "default"; }
  return createHash("sha256").update(`${PACKAGE_SEED}:${host}:${user}`).digest();
}

function encrypt(data: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decrypt(encoded: string): string | null {
  try {
    const key = deriveKey();
    const buf = Buffer.from(encoded, "base64");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (_decryptErr: unknown) {
    return null;
  }
}

export function saveToken(session: StoredSession): void {
  const dir = getCredDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const json = JSON.stringify(session);
  const encrypted = encrypt(json);
  const file = getCredFile();
  writeFileSync(file, encrypted, "utf-8");
  try { chmodSync(file, 0o600); } catch (_chmodErr: unknown) { /* Windows: chmod not fully supported */ }
}

export function loadToken(): StoredSession | null {
  const file = getCredFile();
  if (!existsSync(file)) return null;
  try {
    const encrypted = readFileSync(file, "utf-8").trim();
    const json = decrypt(encrypted);
    if (!json) return null;
    const session = JSON.parse(json) as StoredSession;
    if (!session.session_id) return null;
    return session;
  } catch (_readErr: unknown) {
    return null;
  }
}

export function clearToken(): boolean {
  const file = getCredFile();
  if (!existsSync(file)) return false;
  try { unlinkSync(file); return true; } catch (_rmErr: unknown) { return false; }
}

export function tokenFilePath(): string {
  return getCredFile();
}
