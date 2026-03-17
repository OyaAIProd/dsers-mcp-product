import { randomUUID } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import type { JobStore } from "./job-store.js";

function encodeState(state: Record<string, any>): string {
  const json = JSON.stringify(state);
  const compressed = deflateSync(Buffer.from(json, "utf-8"));
  return compressed.toString("base64url");
}

function decodeState(token: string): Record<string, any> | null {
  try {
    const buf = Buffer.from(token, "base64url");
    const json = inflateSync(buf).toString("utf-8");
    return JSON.parse(json) as Record<string, any>;
  } catch {
    return null;
  }
}

export class MemoryJobStore implements JobStore {
  private readonly _data = new Map<string, string>();

  create(payload: Record<string, any>): string {
    const uuid = randomUUID();
    const compact = {
      provider_state: payload.provider_state,
      effective_rules_snapshot: payload.effective_rules_snapshot,
      rules: payload.rules,
      source_url: payload.source_url,
      resolved_source_url: payload.resolved_source_url,
      source_hint: payload.source_hint,
      country: payload.country,
      visibility_mode: payload.visibility_mode,
    };
    const token = encodeState(compact);
    const jobId = `${uuid}.${token}`;
    this.save(jobId, payload);
    return jobId;
  }

  save(jobId: string, payload: Record<string, any>): void {
    this._data.set(jobId, JSON.stringify(payload));
  }

  load(jobId: string): Record<string, any> {
    const raw = this._data.get(jobId);
    if (raw) return JSON.parse(raw) as Record<string, any>;

    const dotIdx = jobId.indexOf(".");
    if (dotIdx < 0) throw new Error(`Unknown job_id: ${jobId}`);

    const token = jobId.slice(dotIdx + 1);
    const state = decodeState(token);
    if (!state) throw new Error(`Unknown job_id: ${jobId}`);

    return {
      ...state,
      status: "recovered",
      job_id: jobId,
      created_at: new Date().toISOString(),
      _recovered: true,
    };
  }
}
