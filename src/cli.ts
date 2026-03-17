#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { configFromEnv } from "./dsers/config.js";
import { buildProvider } from "./provider.js";
import { ImportFlowService } from "./service.js";
import { FileJobStore } from "./job-store.js";
import { registerTools } from "./tools.js";
import { resolve } from "node:path";

const missing: string[] = [];
if (!process.env.DSERS_EMAIL) missing.push("DSERS_EMAIL");
if (!process.env.DSERS_PASSWORD) missing.push("DSERS_PASSWORD");
if (missing.length > 0) {
  process.stderr.write(
    `Error: missing required environment variable(s): ${missing.join(", ")}\n` +
    `Set them before running, e.g.:\n` +
    `  DSERS_EMAIL=you@example.com DSERS_PASSWORD=secret npx @lofder/dsers-mcp-product\n`,
  );
  process.exit(1);
}

const STATE_DIR =
  process.env.IMPORT_MCP_STATE_DIR ?? resolve(process.cwd(), ".state");

const dsersConfig = configFromEnv();
const provider = buildProvider(dsersConfig);
const store = new FileJobStore(STATE_DIR);
const service = new ImportFlowService(provider, store);

const server = new McpServer({
  name: "dsers-mcp-product",
  version: "1.0.1",
});

registerTools(server, service);

const transport = new StdioServerTransport();
await server.connect(transport);
