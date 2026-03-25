import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import type { ServerContext } from "@smithery/sdk";
import { configFromParams } from "./dsers/config.js";
import { buildProvider } from "./provider.js";
import { ImportFlowService } from "./service.js";
import { FileJobStore } from "./job-store.js";
import { registerTools } from "./tools.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

const STATE_DIR =
  process.env.IMPORT_MCP_STATE_DIR ??
  resolve(process.cwd?.() ?? "/tmp", ".state");

interface DsersConfig {
  dsers_email: string;
  dsers_password: string;
  dsers_env?: string;
}

export const configSchema = z.object({
  dsers_email: z
    .string()
    .describe("DSers account email address used for authentication"),
  dsers_password: z.string().describe("DSers account password"),
  dsers_env: z
    .string()
    .default("production")
    .describe(
      "API environment. Use 'production' for live operations, 'test' for sandbox.",
    ),
});

export default function createServer(context: ServerContext<DsersConfig>) {
  const cfg = context.config;
  const dsersConfig = configFromParams(
    cfg.dsers_email,
    cfg.dsers_password,
    cfg.dsers_env ?? "production",
  );
  const provider = buildProvider(dsersConfig);
  const store = new FileJobStore(STATE_DIR);
  const service = new ImportFlowService(provider, store);

  const server = new McpServer(
    { name: "dsers-mcp-product", version: "1.1.4" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server, service);

  return server;
}

export function createSandboxServer() {
  return createServer({
    config: {
      dsers_email: process.env.DSERS_EMAIL ?? "",
      dsers_password: process.env.DSERS_PASSWORD ?? "",
      dsers_env: process.env.DSERS_ENV ?? "production",
    },
  } as ServerContext<DsersConfig>);
}
