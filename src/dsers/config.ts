import { resolve, dirname } from "node:path";

const PROD_URL = "https://bff-api-gw.dsers.com";
const TEST_URL = "https://bff-api-gw-test.dsers.com";

function getSafeDir(): string {
  try {
    if (typeof import.meta?.url === "string" && import.meta.url.startsWith("file:")) {
      const { fileURLToPath } = require("node:url");
      return dirname(fileURLToPath(import.meta.url));
    }
  } catch (_fsErr: unknown) { /* Serverless/Workers: fs unavailable, skip file-based session */ }
  return process.cwd?.() ?? "/tmp";
}

export interface DSersConfig {
  baseUrl: string;
  email: string;
  password: string;
  sessionFile: string;
  /** Pre-authenticated session ID from token store or CLI login */
  sessionId?: string;
  /** Pre-authenticated state value */
  sessionState?: string;
}

/**
 * Credential resolution order (highest to lowest priority):
 *   1. Token file (~/.dsers-mcp/credentials) — created by `npx … login`
 *   2. Environment variables DSERS_EMAIL / DSERS_PASSWORD
 * Only one source is used; they are NOT merged.
 * See cli.ts startServer() for the actual resolution logic.
 */
export function configFromEnv(): DSersConfig {
  const env = (process.env.DSERS_ENV ?? "production").toLowerCase();
  const baseUrl =
    process.env.DSERS_BASE_URL || (env === "test" ? TEST_URL : PROD_URL);
  const email = process.env.DSERS_EMAIL ?? "";
  const password = process.env.DSERS_PASSWORD ?? "";

  const sessionFile =
    process.env.DSERS_SESSION_FILE ||
    resolve(getSafeDir(), "..", "..", ".session.json");

  return { baseUrl, email, password, sessionFile };
}

export function configFromParams(
  email: string,
  password: string,
  env: string = "production",
): DSersConfig {
  const baseUrl = env === "test" ? TEST_URL : PROD_URL;
  const sessionFile = resolve(getSafeDir(), "..", "..", ".session.json");
  return { baseUrl, email, password, sessionFile };
}

/**
 * Create config from a pre-authenticated session token (from CLI login or token store).
 * No email/password needed — session_id is used directly.
 */
export function configFromToken(
  sessionId: string,
  state: string = "",
  baseUrl: string = PROD_URL,
): DSersConfig {
  const sessionFile = resolve(getSafeDir(), "..", "..", ".session.json");
  return { baseUrl, email: "", password: "", sessionFile, sessionId, sessionState: state };
}
