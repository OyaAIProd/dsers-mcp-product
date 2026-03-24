import { DSersAuth } from "./auth.js";
import type { DSersConfig } from "./config.js";

const RETRYABLE_REASONS = new Set([
  "TOKEN_NOT_FOUND",
  "TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "INVALID_TOKEN",
]);

const RATE_LIMIT_WINDOW_MS = 1_000;
const RATE_LIMIT_MAX_REQUESTS = 15;

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
  private requestTimestamps: number[] = [];

  constructor(config: DSersConfig) {
    this.config = config;
    this.auth = new DSersAuth(config);
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter(
      (t) => now - t < RATE_LIMIT_WINDOW_MS,
    );
    if (this.requestTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
      const oldest = this.requestTimestamps[0];
      const waitMs = RATE_LIMIT_WINDOW_MS - (now - oldest) + 50;
      if (waitMs > 0)
        await new Promise((r) => setTimeout(r, waitMs));
    }
    this.requestTimestamps.push(Date.now());
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
    await this.throttle();
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
      } catch (_jsonErr: unknown) {
        // Response body is not valid JSON — fall through to throw DSersAPIError
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
