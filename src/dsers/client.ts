import { DSersAuth } from "./auth.js";
import type { DSersConfig } from "./config.js";

const RETRYABLE_REASONS = new Set([
  "TOKEN_NOT_FOUND",
  "TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "INVALID_TOKEN",
]);

export class DSersAPIError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`DSers API ${status}: ${body.slice(0, 500)}`);
    this.status = status;
    this.body = body;
  }
}

export class DSersClient {
  private config: DSersConfig;
  private auth: DSersAuth;

  constructor(config: DSersConfig) {
    this.config = config;
    this.auth = new DSersAuth(config);
  }

  async request(
    method: string,
    path: string,
    opts?: {
      params?: Record<string, any>;
      json?: Record<string, any>;
    },
    retried = false,
  ): Promise<Record<string, any>> {
    const [sessionId, state] = await this.auth.getSession();

    const url = new URL(`${this.config.baseUrl}${path}`);
    if (opts?.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionId}`,
      Cookie: `session_id=${sessionId}; state=${state}`,
    };

    const resp = await fetch(url.toString(), {
      method,
      headers,
      body: opts?.json ? JSON.stringify(opts.json) : undefined,
    });

    const bodyText = await resp.text();

    if (resp.status === 400 && !retried) {
      try {
        const body = JSON.parse(bodyText) as Record<string, any>;
        if (RETRYABLE_REASONS.has(body.reason)) {
          this.auth.invalidate();
          return this.request(method, path, opts, true);
        }
      } catch {
        // not JSON, fall through to error
      }
    }

    if (resp.status >= 400) {
      throw new DSersAPIError(resp.status, bodyText);
    }

    return JSON.parse(bodyText) as Record<string, any>;
  }

  async get(
    path: string,
    params?: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this.request("GET", path, { params });
  }

  async post(
    path: string,
    json?: Record<string, any>,
    params?: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this.request("POST", path, { json, params });
  }

  async put(
    path: string,
    json?: Record<string, any>,
    params?: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this.request("PUT", path, { json, params });
  }

  async delete(
    path: string,
    params?: Record<string, any>,
  ): Promise<Record<string, any>> {
    return this.request("DELETE", path, { params });
  }

  async login(): Promise<Record<string, any>> {
    const [sid, state] = await this.auth.login();
    return { session_id: sid, state };
  }
}
