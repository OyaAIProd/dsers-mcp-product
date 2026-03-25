import { execSync, exec } from "node:child_process";
import { createInterface } from "node:readline";

export interface SafariLoginResult {
  session_id: string;
  state: string;
}

const DSERS_LOGIN_URL = "https://accounts.dsers.com/accounts/login";

export function isMacOS(): boolean {
  return process.platform === "darwin";
}

function openInDefaultBrowser(url: string): void {
  if (!/^https:\/\/[a-z0-9.-]+/.test(url)) return;
  execSync(`open "${url}"`, { stdio: "ignore", timeout: 5000 });
}

function readSafariCookies(): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = `tell application "Safari"
  if (count of windows) > 0 then
    set cookieStr to do JavaScript "document.cookie" in document 1
    return cookieStr
  else
    return ""
  end if
end tell`;
    exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

function waitForEnter(prompt: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    rl.question(prompt, () => { rl.close(); resolve(); });
  });
}

function parseCookieValue(cookieStr: string, name: string): string | null {
  const re = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`);
  const m = cookieStr.match(re);
  return m?.[1]?.trim() ?? null;
}

export async function loginViaSafari(
  log: (msg: string) => void = () => {},
): Promise<SafariLoginResult | null> {
  if (!isMacOS()) return null;

  log("No Chromium browser found. Opening DSers in Safari...");
  openInDefaultBrowser(DSERS_LOGIN_URL);

  log("Please log in to DSers in your browser.");
  await waitForEnter("Press Enter after you have logged in... ");

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const cookies = await readSafariCookies();
      const sid = parseCookieValue(cookies, "session_id");
      if (sid) {
        const state = parseCookieValue(cookies, "state") ?? "";
        log("Login detected from Safari!");
        return { session_id: sid, state };
      }
    } catch { /* AppleScript failed — permission denied or Safari not focused */ }

    if (attempt < MAX_ATTEMPTS) {
      log(`Could not read session cookie (attempt ${attempt}/${MAX_ATTEMPTS}). Make sure Safari is on the DSers page.`);
      await waitForEnter("Press Enter to retry... ");
    }
  }

  log("Could not extract DSers session from Safari. session_id cookie may be HttpOnly.");
  return null;
}
