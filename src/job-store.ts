import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface JobStore {
  create(payload: Record<string, any>): string;
  save(jobId: string, payload: Record<string, any>): void;
  load(jobId: string): Record<string, any>;
}

export class FileJobStore implements JobStore {
  private readonly _root: string;

  constructor(root: string) {
    this._root = path.resolve(root);
    fs.mkdirSync(this._root, { recursive: true });
  }

  create(payload: Record<string, any>): string {
    const jobId = randomUUID();
    this.save(jobId, payload);
    return jobId;
  }

  save(jobId: string, payload: Record<string, any>): void {
    const filePath = this._jobPath(jobId);
    fs.writeFileSync(
      filePath,
      JSON.stringify(payload, null, 2),
      "utf-8"
    );
  }

  load(jobId: string): Record<string, any> {
    const filePath = this._jobPath(jobId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Unknown job_id: ${jobId}`);
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as Record<string, any>;
  }

  private _jobPath(jobId: string): string {
    return path.join(this._root, `${jobId}.json`);
  }
}
