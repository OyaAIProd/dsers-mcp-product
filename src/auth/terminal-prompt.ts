import { createInterface, type Interface as ReadlineInterface } from "node:readline";

export interface TerminalLoginResult {
  session_id: string;
  state: string;
}

const LOGIN_URL = "https://bff-api-gw.dsers.com/account-user-bff/v1/users/login";

function ask(rl: ReadlineInterface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stderr.write(prompt);
    const raw = process.stdin.setRawMode?.(true);
    let pw = "";
    const onData = (buf: Buffer) => {
      for (const b of buf) {
        if (b === 0x03) { // Ctrl+C
          process.stderr.write("\n");
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener("data", onData);
          process.exit(130);
        }
        if (b === 0x0d || b === 0x0a) { // Enter
          process.stderr.write("\n");
          process.stdin.setRawMode?.(false);
          process.stdin.removeListener("data", onData);
          process.stdin.pause();
          resolve(pw);
          return;
        }
        if (b === 0x7f || b === 0x08) { // Backspace
          if (pw.length > 0) { pw = pw.slice(0, -1); process.stderr.write("\b \b"); }
        } else if (b >= 0x20) {
          pw += String.fromCharCode(b);
          process.stderr.write("*");
        }
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
    if (!raw) {
      process.stderr.write("\n(password input may be visible — raw mode not available)\n");
      process.stderr.write(prompt);
    }
  });
}

async function callLoginApi(email: string, password: string): Promise<TerminalLoginResult> {
  const resp = await fetch(LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Login failed (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = (await resp.json()) as Record<string, any>;
  const inner = data.data;
  if (!inner?.sessionId) {
    throw new Error(`Login failed: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return {
    session_id: inner.sessionId as string,
    state: (inner.state as string) ?? "",
  };
}

export async function loginViaTerminal(
  log: (msg: string) => void = () => {},
): Promise<TerminalLoginResult | null> {
  if (!process.stdin.isTTY) {
    log("No TTY available — cannot prompt for credentials.");
    return null;
  }

  log("Fallback: enter DSers credentials directly.");
  log("Your password is used ONLY to obtain a session token, then discarded immediately.");
  log("");

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const MAX_ATTEMPTS = 3;

  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const email = await ask(rl, "DSers email: ");
      if (!email.trim()) { log("Email cannot be empty."); continue; }

      rl.pause();
      const password = await askPassword("DSers password: ");
      rl.resume();
      if (!password) { log("Password cannot be empty."); continue; }

      try {
        log("Verifying credentials...");
        const result = await callLoginApi(email.trim(), password);
        log("Login successful!");
        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Login failed: ${msg}`);
        if (attempt < MAX_ATTEMPTS) log(`Retry (${attempt}/${MAX_ATTEMPTS})...`);
      }
    }
  } finally {
    rl.close();
  }

  log("Max login attempts reached.");
  return null;
}
