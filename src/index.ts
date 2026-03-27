import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolve } from "node:path";
import { homedir } from "node:os";
import { configFromToken, configFromParams } from "./dsers/config.js";
import { buildProvider } from "./provider.js";
import { ImportFlowService } from "./service.js";
import { FileJobStore } from "./job-store.js";
import { registerTools } from "./tools.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";

const STATE_DIR =
  process.env.IMPORT_MCP_STATE_DIR ??
  resolve(homedir(), ".dsers-mcp", "state");

export const configSchema = z.object({
  dsers_session_id: z.string().optional().describe("DSers session ID. Run 'npx @lofder/dsers-mcp-product login' to get it."),
  dsers_state: z.string().optional().describe("DSers state token (obtained together with session ID)"),
  dsers_email: z.string().optional().describe("(Legacy) DSers email — prefer session mode"),
  dsers_password: z.string().optional().describe("(Legacy) DSers password — prefer session mode"),
  dsers_env: z.string().optional().describe("API environment: production or test"),
});

type DsersConfig = z.infer<typeof configSchema>;

export default function createServer(context: { config: DsersConfig }) {
  const cfg = context.config;

  const dsersConfig =
    cfg.dsers_session_id && cfg.dsers_state
      ? configFromToken(cfg.dsers_session_id, cfg.dsers_state)
      : configFromParams(
          cfg.dsers_email ?? "",
          cfg.dsers_password ?? "",
          cfg.dsers_env ?? "production",
        );

  const provider = buildProvider(dsersConfig);
  const store = new FileJobStore(STATE_DIR);
  const service = new ImportFlowService(provider, store);

  const server = new McpServer(
    { name: "dsers-mcp-product", version: "1.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerTools(server, service);

  return server;
}

export function createSandboxServer() {
  return createServer({
    config: {
      dsers_session_id: process.env.DSERS_SESSION_ID,
      dsers_state: process.env.DSERS_STATE,
      dsers_email: process.env.DSERS_EMAIL,
      dsers_password: process.env.DSERS_PASSWORD,
      dsers_env: process.env.DSERS_ENV ?? "production",
    },
  });
}
