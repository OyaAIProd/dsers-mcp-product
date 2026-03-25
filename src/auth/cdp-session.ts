import { spawn, type ChildProcess } from "node:child_process";
import { request as httpReq } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Socket } from "node:net";

const DSERS_LOGIN_URL = "https://accounts.dsers.com/accounts/login";
const COOKIE_CHECK_URLS = [
  "https://accounts.dsers.com",
  "https://app.dsers.com",
  "https://www.dsers.com",
];
const POLL_MS = 2_000;
const PORT_TIMEOUT_MS = 30_000;
const TARGET_RETRY_MS = 500;
const TARGET_MAX_RETRIES = 30;

export interface CDPLoginResult {
  session_id: string;
  state: string;
}

/* ------------------------------------------------------------------ */
/*  Minimal WebSocket client — text frames only, for CDP on Node 18+  */
/* ------------------------------------------------------------------ */

class CDPClient {
  private sock: Socket;
  private nextId = 1;
  private pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  private buf = Buffer.alloc(0);
  private _closed = false;

  constructor(sock: Socket) {
    this.sock = sock;
    sock.on("data", (c) => this.onData(c));
    sock.on("close", () => this.shutdown());
    sock.on("error", () => this.shutdown());
  }

  get closed() { return this._closed; }

  send(method: string, params?: Record<string, unknown>): Promise<any> {
    if (this._closed) return Promise.reject(new Error("CDP closed"));
    const id = this.nextId++;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.writeText(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    if (this._closed) return;
    const mask = randomBytes(4);
    const f = Buffer.alloc(6);
    f[0] = 0x88; f[1] = 0x80;
    mask.copy(f, 2);
    try { this.sock.write(f); } catch { /* ignore */ }
    try { this.sock.end(); } catch { /* ignore */ }
    this._closed = true;
  }

  /* ---- framing ---- */

  private writeText(text: string) {
    const payload = Buffer.from(text, "utf-8");
    const mask = randomBytes(4);
    const masked = Buffer.alloc(payload.length);
    for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];

    let hdr: Buffer;
    if (payload.length < 126) {
      hdr = Buffer.alloc(6);
      hdr[0] = 0x81; hdr[1] = 0x80 | payload.length;
      mask.copy(hdr, 2);
    } else {
      hdr = Buffer.alloc(8);
      hdr[0] = 0x81; hdr[1] = 0xfe;
      hdr.writeUInt16BE(payload.length, 2);
      mask.copy(hdr, 4);
    }
    this.sock.write(Buffer.concat([hdr, masked]));
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.parseFrame()) { /* keep consuming */ }
  }

  private parseFrame(): boolean {
    if (this.buf.length < 2) return false;
    let payloadLen = this.buf[1] & 0x7f;
    let off = 2;
    if (payloadLen === 126) {
      if (this.buf.length < 4) return false;
      payloadLen = this.buf.readUInt16BE(2);
      off = 4;
    } else if (payloadLen === 127) {
      if (this.buf.length < 10) return false;
      payloadLen = Number(this.buf.readBigUInt64BE(2));
      off = 10;
    }
    if (this.buf.length < off + payloadLen) return false;

    const opcode = this.buf[0] & 0x0f;
    const data = this.buf.subarray(off, off + payloadLen);
    this.buf = this.buf.subarray(off + payloadLen);

    if (opcode === 0x01) {
      try {
        const msg = JSON.parse(data.toString("utf-8"));
        if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          if (p) { this.pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
        }
      } catch { /* malformed */ }
    } else if (opcode === 0x08) {
      this.shutdown();
    }
    return true;
  }

  private shutdown() {
    this._closed = true;
    for (const [, p] of this.pending) p.rej(new Error("CDP connection closed"));
    this.pending.clear();
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function httpGetJson(port: number, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const r = httpReq({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      let d = "";
      res.on("data", (c: Buffer) => { d += c; });
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { reject(new Error("bad json")); } });
    });
    r.on("error", reject);
    r.setTimeout(5000, () => { r.destroy(); reject(new Error("http timeout")); });
    r.end();
  });
}

function wsConnect(url: string): Promise<CDPClient> {
  return new Promise((resolve, reject) => {
    const u = new URL(url.replace(/^ws:/, "http:"));
    const key = randomBytes(16).toString("base64");
    const r = httpReq({
      hostname: u.hostname, port: u.port,
      path: u.pathname + u.search, method: "GET",
      headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" },
    });
    r.on("upgrade", (_res: any, socket: Socket) => resolve(new CDPClient(socket)));
    r.on("error", reject);
    r.setTimeout(5000, () => { r.destroy(); reject(new Error("ws timeout")); });
    r.end();
  });
}

function waitForPort(proc: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Browser did not expose debug port within 30 s")), PORT_TIMEOUT_MS);
    let settled = false;
    const fail = (msg: string) => { if (settled) return; settled = true; clearTimeout(timer); reject(new Error(msg)); };
    let acc = "";
    proc.stderr?.on("data", (c: Buffer) => {
      acc += c.toString();
      const m = acc.match(/DevTools listening on ws:\/\/[\d.]+:(\d+)\//);
      if (m && !settled) { settled = true; clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.on("exit", (code) => fail(`Browser exited (code ${code}) before debug ready`));
    proc.on("error", (err) => fail(`Browser launch failed: ${err.message}`));
  });
}

async function findPageWs(port: number): Promise<string> {
  for (let i = 0; i < TARGET_MAX_RETRIES; i++) {
    try {
      const list: any[] = await httpGetJson(port, "/json/list");
      const pg = list.find((t) => t.type === "page" && !t.url.startsWith("chrome"));
      if (pg?.webSocketDebuggerUrl) return pg.webSocketDebuggerUrl as string;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, TARGET_RETRY_MS));
  }
  throw new Error("No page target found in browser");
}

/* ------------------------------------------------------------------ */
/*  Session extraction — tries cookies, document.cookie, localStorage */
/* ------------------------------------------------------------------ */

async function extractSession(cdp: CDPClient): Promise<CDPLoginResult | null> {
  // 1) CDP Network.getCookies (includes HttpOnly)
  try {
    const { cookies = [] } = await cdp.send("Network.getCookies", { urls: COOKIE_CHECK_URLS });
    const sid = (cookies as any[]).find((c) => c.name === "session_id" && c.value);
    if (sid) {
      const st = (cookies as any[]).find((c) => c.name === "state");
      return { session_id: sid.value, state: st?.value ?? "" };
    }
  } catch { /* domain not enabled or page navigating */ }

  // 2) JS document.cookie (non-HttpOnly)
  try {
    const { result } = await cdp.send("Runtime.evaluate", { expression: "document.cookie" });
    const s = (result?.value ?? "") as string;
    const sm = s.match(/session_id=([^;]+)/);
    if (sm?.[1]) {
      const tm = s.match(/state=([^;]+)/);
      return { session_id: sm[1].trim(), state: tm?.[1]?.trim() ?? "" };
    }
  } catch { /* context destroyed during navigation */ }

  // 3) localStorage / sessionStorage
  try {
    const expr =
      'JSON.stringify({s:localStorage.getItem("session_id")||localStorage.getItem("sessionId")||sessionStorage.getItem("session_id")||"",t:localStorage.getItem("state")||sessionStorage.getItem("state")||""})';
    const { result } = await cdp.send("Runtime.evaluate", { expression: expr });
    const d = JSON.parse(result?.value ?? "{}");
    if (d.s) return { session_id: d.s, state: d.t ?? "" };
  } catch { /* not available */ }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export async function loginViaCDP(
  browserPath: string,
  log: (msg: string) => void = () => {},
): Promise<CDPLoginResult | null> {
  const tempDir = mkdtempSync(join(tmpdir(), "dsers-mcp-"));
  let proc: ChildProcess | null = null;
  let cdp: CDPClient | null = null;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    try { cdp?.close(); } catch { /* ignore */ }
    if (proc && !proc.killed) { try { proc.kill(); } catch { /* ignore */ } }
    setTimeout(() => { try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ } }, 500);
  };

  const onSig = () => { cleanup(); process.exit(130); };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);

  try {
    const label = browserPath.split("/").pop() ?? "browser";
    log(`Opening DSers login page in ${label}...`);

    proc = spawn(browserPath, [
      "--remote-debugging-port=0",
      `--user-data-dir=${tempDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-extensions",
      "--mute-audio",
      DSERS_LOGIN_URL,
    ], { stdio: ["ignore", "pipe", "pipe"], detached: false });

    proc.on("error", () => { /* handled by waitForPort exit handler */ });

    const port = await waitForPort(proc);
    const wsUrl = await findPageWs(port);
    cdp = await wsConnect(wsUrl);

    try { await cdp.send("Network.enable"); } catch { /* optional */ }

    log("Waiting for DSers login... (close browser or Ctrl+C to cancel)");

    const result = await new Promise<CDPLoginResult | null>((resolve) => {
      let exited = false;
      proc!.on("exit", () => { exited = true; resolve(null); });

      const tick = async () => {
        if (exited || cdp!.closed) return resolve(null);
        try {
          const session = await extractSession(cdp!);
          if (session) return resolve(session);
        } catch { /* polling error, retry */ }
        setTimeout(tick, POLL_MS);
      };
      tick();
    });

    if (result) log("Login detected!");
    else log("Browser closed without completing login.");

    return result;
  } finally {
    cleanup();
    process.removeListener("SIGINT", onSig);
    process.removeListener("SIGTERM", onSig);
  }
}
