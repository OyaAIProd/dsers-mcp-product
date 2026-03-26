import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { configFromToken } from "../../../src/dsers/config.js";
import { buildProvider } from "../../../src/provider.js";
import { ImportFlowService } from "../../../src/service.js";
import { MemoryJobStore } from "../../../src/job-store-memory.js";
import { registerTools } from "../../../src/tools.js";
import { decryptAccessToken } from "../../../src/oauth/crypto.js";

interface RequestContext {
  sessionId: string;
  dsersState: string;
  baseUrl: string;
}

const requestCtx = new AsyncLocalStorage<RequestContext>();
const jobStore = new MemoryJobStore();

function buildService(): ImportFlowService {
  const ctx = requestCtx.getStore();
  const config = configFromToken(
    ctx?.sessionId ?? "",
    ctx?.dsersState ?? "",
    ctx?.baseUrl ?? "https://bff-api-gw.dsers.com",
  );
  return new ImportFlowService(buildProvider(config), jobStore);
}

const baseHandler = createMcpHandler(
  (server) => {
    registerTools(server, buildService);
  },
  { serverInfo: { name: "dsers-mcp-product", version: "1.1.8" } },
  { basePath: "/api" },
);

async function handler(request: Request): Promise<Response> {
  let ctx: RequestContext = {
    sessionId: "",
    dsersState: "",
    baseUrl: "https://bff-api-gw.dsers.com",
  };

  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const decoded = decryptAccessToken(authHeader.slice(7));
    if (decoded) {
      ctx = {
        sessionId: decoded.session_id,
        dsersState: decoded.dsers_state,
        baseUrl: decoded.base_url,
      };
    }
  }

  return requestCtx.run(ctx, () => baseHandler(request));
}

export { handler as GET, handler as POST, handler as DELETE };
