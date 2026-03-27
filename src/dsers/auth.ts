import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import type { DSersConfig } from "./config.js";

const SESSION_TTL = 3600 * 6 * 1000; // 6 hours in ms

interface SessionCache {
  session_id: string;
  state: string;
  ts: number;
}

export class DSersAuth {
  private config: DSersConfig;
  private sessionId: string | null = null;
  private state: string | null = null;
  private fetchedAt = 0;

  constructor(config: DSersConfig) {
    this.config = config;
    if (config.sessionId) {
      this.sessionId = config.sessionId;
      this.state = config.sessionState ?? "";
      this.fetchedAt = Date.now();
    }
  }

  async getSession(): Promise<[string, string]> {
    if (this.sessionId && Date.now() - this.fetchedAt < SESSION_TTL) {
      return [this.sessionId, this.state ?? ""];
    }

    if (this.config.tokenReloader) {
      const fresh = this.config.tokenReloader();
      if (fresh?.session_id && fresh.session_id !== this.sessionId) {
        this.sessionId = fresh.session_id;
        this.state = fresh.state ?? "";
        this.fetchedAt = Date.now();
        return [this.sessionId, this.state];
      }
    }

    const cached = this.readCache();
    if (cached) {
      [this.sessionId, this.state, this.fetchedAt] = cached;
      return [this.sessionId, this.state];
    }

    return this.login();
  }

  async login(): Promise<[string, string]> {
    if (!this.config.email || !this.config.password) {
      throw new Error(
        "DSers credentials not configured.\n" +
        "Recommended: run 'npx @lofder/dsers-mcp-product login' to authenticate via browser.\n" +
        "If browser login is not available, set DSERS_TOKEN environment variable.",
      );
    }

    const resp = await fetch(
      `${this.config.baseUrl}/account-user-bff/v1/users/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: this.config.email,
          password: this.config.password,
        }),
      },
    );

    if (!resp.ok) {
      throw new Error(`Login HTTP ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as Record<string, any>;
    const inner = data.data;
    if (!inner?.sessionId) {
      throw new Error(`Login failed: ${JSON.stringify(data)}`);
    }

    this.sessionId = inner.sessionId as string;
    this.state = (inner.state as string) ?? "";
    this.fetchedAt = Date.now();
    this.writeCache();
    return [this.sessionId, this.state];
  }

  invalidate(): void {
    this.sessionId = null;
    this.state = null;
    this.fetchedAt = 0;
  }

  private readCache(): [string, string, number] | null {
    try {
      const p = this.config.sessionFile;
      if (!existsSync(p)) return null;
      const obj: SessionCache = JSON.parse(readFileSync(p, "utf-8"));
      if (Date.now() - obj.ts > SESSION_TTL) return null;
      return [obj.session_id, obj.state ?? "", obj.ts];
    } catch (_readErr: unknown) {
      return null;
    }
  }

  private writeCache(): void {
    if (this.config.sessionId) return;
    try {
      const p = this.config.sessionFile;
      mkdirSync(dirname(p), { recursive: true });
      const payload: SessionCache = {
        session_id: this.sessionId!,
        state: this.state ?? "",
        ts: this.fetchedAt,
      };
      writeFileSync(p, JSON.stringify(payload), { encoding: "utf-8", mode: 0o600 });
      try { chmodSync(p, 0o600); } catch (_chmodErr: unknown) { /* Windows: chmod not fully supported */ }
    } catch (_writeErr: unknown) { /* file write failed — continue with in-memory session only */ }
  }
}
