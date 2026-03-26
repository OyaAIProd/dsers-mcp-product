#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configFromEnv, configFromToken } from "./dsers/config.js";
import { buildProvider } from "./provider.js";
import { ImportFlowService } from "./service.js";
import { FileJobStore } from "./job-store.js";
import { registerTools } from "./tools.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { resolve } from "node:path";
import {
  findChromiumBrowser,
  loginViaCDP,
  isMacOS,
  loginViaSafari,
  loginViaTerminal,
  saveToken,
  loadToken,
  clearToken,
  tokenFilePath,
} from "./auth/index.js";

const log = (msg: string) => process.stderr.write(`${msg}\n`);

/* ------------------------------------------------------------------ */
/*  login subcommand                                                  */
/* ------------------------------------------------------------------ */

async function handleLogin() {
  log("DSers MCP — Login");
  log("Your password never passes through this tool when using browser login.\n");

  let session: { session_id: string; state: string } | null = null;

  // Strategy 1: Chromium CDP
  const browser = findChromiumBrowser();
  if (browser) {
    log(`Found: ${browser.name}`);
    try {
      session = await loginViaCDP(browser.path, log);
    } catch (err: unknown) {
      log(`Browser login failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    log("No Chromium browser (Chrome, Edge, Brave, etc.) found.");
  }

  // Strategy 2: macOS Safari
  if (!session && isMacOS()) {
    try {
      session = await loginViaSafari(log);
    } catch (err: unknown) {
      log(`Safari login failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Strategy 3: Terminal prompt
  if (!session) {
    try {
      session = await loginViaTerminal(log);
    } catch (err: unknown) {
      log(`Terminal login failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!session) {
    log("\nLogin was not completed. Please try again.");
    process.exit(1);
  }

  // Validate session against DSers API
  log("Validating session...");
  try {
    const resp = await fetch(
      "https://bff-api-gw.dsers.com/account-user-bff/v1/users/info",
      {
        headers: {
          Authorization: `Bearer ${session.session_id}`,
          Cookie: `session_id=${session.session_id}; state=${session.state}`,
        },
      },
    );
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as Record<string, any>;
    const email = data?.data?.email ?? "unknown";
    log(`Authenticated as: ${email}`);
  } catch (err: unknown) {
    log(`Warning: could not verify session (${err instanceof Error ? err.message : String(err)}). Saving anyway.`);
  }

  // Save encrypted token
  saveToken({
    session_id: session.session_id,
    state: session.state,
    base_url: "https://bff-api-gw.dsers.com",
    ts: Date.now(),
  });

  log(`\nSession saved to: ${tokenFilePath()}`);
  log("Encrypted with machine-specific key. Cannot be used on other machines.\n");
  log("You can now use the MCP server without any credentials in your config:");
  log("");
  log('  {');
  log('    "mcpServers": {');
  log('      "dsers-mcp-product": {');
  log('        "command": "npx",');
  log('        "args": ["-y", "@lofder/dsers-mcp-product"]');
  log("      }");
  log("    }");
  log("  }");
  log("");
}

/* ------------------------------------------------------------------ */
/*  logout subcommand                                                 */
/* ------------------------------------------------------------------ */

function handleLogout() {
  if (clearToken()) {
    log("DSers session cleared.");
  } else {
    log("No saved session found.");
  }
}

/* ------------------------------------------------------------------ */
/*  MCP server (default)                                              */
/* ------------------------------------------------------------------ */

async function startServer() {
  // Credential resolution priority: token file > env vars
  // (HTTP headers always override at runtime, handled by DSersClient)
  let dsersConfig;

  const token = loadToken();
  if (token) {
    dsersConfig = configFromToken(token.session_id, token.state, token.base_url);
  } else {
    dsersConfig = configFromEnv();
  }

  if (!dsersConfig.email && !dsersConfig.password && !dsersConfig.sessionId) {
    process.stderr.write(
      "Warning: No DSers credentials found.\n" +
      "Run 'npx @lofder/dsers-mcp-product login' to authenticate.\n" +
      "Or set DSERS_TOKEN environment variable for headless environments.\n\n",
    );
  }

  const STATE_DIR =
    process.env.IMPORT_MCP_STATE_DIR ?? resolve(process.cwd(), ".state");

  const provider = buildProvider(dsersConfig);
  const store = new FileJobStore(STATE_DIR);
  const service = new ImportFlowService(provider, store);

  const server = new McpServer(
    { name: "dsers-mcp-product", version: "1.1.6" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server, service);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/* ------------------------------------------------------------------ */
/*  Entrypoint                                                        */
/* ------------------------------------------------------------------ */

function printHelp() {
  log("dsers-mcp-product — MCP server for DSers dropshipping product management\n");
  log("Usage:");
  log("  npx @lofder/dsers-mcp-product              Start the MCP server (stdio)");
  log("  npx @lofder/dsers-mcp-product login         Authenticate with DSers via browser");
  log("  npx @lofder/dsers-mcp-product logout        Clear saved session");
  log("  npx @lofder/dsers-mcp-product --help        Show this help message\n");
  log("For more info: https://github.com/lofder/dsers-mcp-product");
}

const cmd = process.argv[2]?.toLowerCase();

if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  printHelp();
} else if (cmd === "login") {
  handleLogin().catch((e) => { log(`Error: ${e.message ?? e}`); process.exit(1); });
} else if (cmd === "logout") {
  handleLogout();
} else {
  startServer().catch((e) => { process.stderr.write(`Fatal: ${e.message ?? e}\n`); process.exit(1); });
}
