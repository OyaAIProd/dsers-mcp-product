import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface BrowserMatch {
  name: string;
  path: string;
}

const MACOS_BROWSERS: [string, string][] = [
  ["Google Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  ["Microsoft Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  ["Brave Browser", "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  ["Arc", "/Applications/Arc.app/Contents/MacOS/Arc"],
  ["Chromium", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
  ["Opera", "/Applications/Opera.app/Contents/MacOS/Opera"],
  ["Vivaldi", "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"],
];

const LINUX_COMMANDS: [string, string][] = [
  ["Google Chrome", "google-chrome-stable"],
  ["Google Chrome", "google-chrome"],
  ["Chromium", "chromium-browser"],
  ["Chromium", "chromium"],
  ["Microsoft Edge", "microsoft-edge-stable"],
  ["Microsoft Edge", "microsoft-edge"],
  ["Brave Browser", "brave-browser"],
  ["Brave Browser", "brave-browser-stable"],
  ["Opera", "opera"],
  ["Vivaldi", "vivaldi-stable"],
  ["Vivaldi", "vivaldi"],
];

const WIN_PATHS: [string, string][] = [
  ["Google Chrome", "Google\\Chrome\\Application\\chrome.exe"],
  ["Microsoft Edge", "Microsoft\\Edge\\Application\\msedge.exe"],
  ["Brave Browser", "BraveSoftware\\Brave-Browser\\Application\\brave.exe"],
  ["Opera", "Opera\\opera.exe"],
  ["Vivaldi", "Vivaldi\\Application\\vivaldi.exe"],
  ["Chromium", "Chromium\\Application\\chrome.exe"],
];

function whichSync(cmd: string): string | null {
  if (!/^[a-z0-9._-]+$/i.test(cmd)) return null;
  try {
    return execSync(`which ${cmd} 2>/dev/null`, { encoding: "utf-8", timeout: 3000 }).trim() || null;
  } catch {
    return null;
  }
}

function findOnMacOS(): BrowserMatch | null {
  for (const [name, p] of MACOS_BROWSERS) {
    if (existsSync(p)) return { name, path: p };
  }
  // mdfind fallback for non-standard install locations
  try {
    const result = execSync(
      'mdfind "kMDItemCFBundleIdentifier == com.google.Chrome" 2>/dev/null',
      { encoding: "utf-8", timeout: 3000 },
    ).trim();
    if (result) {
      const appPath = result.split("\n")[0];
      const execPath = join(appPath, "Contents/MacOS/Google Chrome");
      if (existsSync(execPath)) return { name: "Google Chrome", path: execPath };
    }
  } catch { /* mdfind unavailable or timed out */ }
  return null;
}

function findOnLinux(): BrowserMatch | null {
  for (const [name, cmd] of LINUX_COMMANDS) {
    const p = whichSync(cmd);
    if (p) return { name, path: p };
  }
  return null;
}

function findOnWindows(): BrowserMatch | null {
  const roots = [
    process.env.PROGRAMFILES ?? "C:\\Program Files",
    process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
    process.env.LOCALAPPDATA ?? "",
  ].filter(Boolean);

  for (const [name, rel] of WIN_PATHS) {
    for (const root of roots) {
      const full = join(root, rel);
      if (existsSync(full)) return { name, path: full };
    }
  }

  // Edge is pre-installed on Windows 10+ in a special location
  const edgeSys = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  if (existsSync(edgeSys)) return { name: "Microsoft Edge", path: edgeSys };

  return null;
}

export function findChromiumBrowser(): BrowserMatch | null {
  const platform = process.platform;
  if (platform === "darwin") return findOnMacOS();
  if (platform === "linux") return findOnLinux();
  if (platform === "win32") return findOnWindows();
  return null;
}
