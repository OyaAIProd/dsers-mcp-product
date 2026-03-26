import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const ALG = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer | null {
  const raw = process.env.OAUTH_ENCRYPTION_KEY;
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

export interface TokenPayload {
  session_id: string;
  dsers_state: string;
  base_url: string;
  exp: number;
}

export function encrypt(payload: TokenPayload): string | null {
  try {
    const key = getKey();
    if (!key) return null;
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
    const json = JSON.stringify(payload);
    const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString("base64url");
  } catch (_encryptErr: unknown) {
    return null;
  }
}

export function decrypt(token: string): TokenPayload | null {
  try {
    const key = getKey();
    if (!key) return null;
    const buf = Buffer.from(token, "base64url");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext) as TokenPayload;
    if (!payload.session_id || !payload.dsers_state) return null;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_decryptErr: unknown) {
    return null;
  }
}

export function generateCode(
  sessionId: string,
  dsersState: string,
  baseUrl: string,
  codeChallenge: string,
): string | null {
  const payload: TokenPayload & { code_challenge: string } = {
    session_id: sessionId,
    dsers_state: dsersState,
    base_url: baseUrl,
    exp: Date.now() + 10 * 60 * 1000, // 10 min
    code_challenge: codeChallenge,
  };
  try {
    const key = getKey();
    if (!key) return null;
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
    const json = JSON.stringify(payload);
    const ct = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString("base64url");
  } catch (_codeErr: unknown) {
    return null;
  }
}

export function decryptCode(
  code: string,
): (TokenPayload & { code_challenge: string }) | null {
  try {
    const key = getKey();
    if (!key) return null;
    const buf = Buffer.from(code, "base64url");
    if (buf.length < IV_LEN + TAG_LEN + 1) return null;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_LEN });
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext);
    if (!payload.session_id || !payload.code_challenge) return null;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_decodeErr: unknown) {
    return null;
  }
}

export function generateClientCredentials(): {
  client_id: string;
  client_secret: string;
} {
  return {
    client_id: randomBytes(16).toString("hex"),
    client_secret: randomBytes(32).toString("hex"),
  };
}

export function sha256Base64url(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

export function decryptAccessToken(token: string): TokenPayload | null {
  return decrypt(token);
}
