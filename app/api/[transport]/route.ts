import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { configFromParams } from "../../../src/dsers/config.js";
import { buildProvider } from "../../../src/provider.js";
import { ImportFlowService } from "../../../src/service.js";
import { MemoryJobStore } from "../../../src/job-store-memory.js";
import { registerTools } from "../../../src/tools.js";
import { decryptAccessToken } from "../../../src/oauth/crypto.js";

interface RequestContext {
  email: string;
  password: string;
  env: string;
}

const requestCtx = new AsyncLocalStorage<RequestContext>();
const jobStore = new MemoryJobStore();

function buildService(): ImportFlowService {
  const ctx = requestCtx.getStore();
  const email = ctx?.email || process.env.DSERS_EMAIL || "";
  const password = ctx?.password || process.env.DSERS_PASSWORD || "";
  const env = ctx?.env || process.env.DSERS_ENV || "production";
  const config = configFromParams(email, password, env);
  return new ImportFlowService(buildProvider(config), jobStore);
}

const baseHandler = createMcpHandler(
  (server) => {
    registerTools(server, buildService);
  },
  { serverInfo: { name: "dsers-mcp-product", version: "1.0.0" } },
  { basePath: "/api" },
);

async function handler(request: Request): Promise<Response> {
  let ctx: RequestContext | null = null;

  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const decoded = decryptAccessToken(authHeader.slice(7));
    if (decoded) {
      ctx = { email: decoded.email, password: decoded.password, env: decoded.env };
    }
  }

  if (!ctx) {
    ctx = {
      email: request.headers.get("x-dsers-email") || "",
      password: request.headers.get("x-dsers-password") || "",
      env: request.headers.get("x-dsers-env") || "production",
    };
  }

  return requestCtx.run(ctx, () => baseHandler(request));
}

export { handler as GET, handler as POST, handler as DELETE };
