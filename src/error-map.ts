import { DSersAPIError } from "./dsers/client.js";

export interface AgentError {
  summary: string;
  cause: string;
  action: string;
}

const DSERS_REASON_MAP: Record<string, AgentError> = {
  SELLER_NOT_FOUND: {
    summary: "Store authorization expired or disconnected",
    cause:
      "The DSers account's connection to the target store (Shopify/Wix) has expired or been revoked.",
    action:
      "Ask the user to log into DSers, go to Settings > Linked Stores, and re-authorize the store. Then retry the push.",
  },
  TOKEN_EXPIRED: {
    summary: "DSers session expired during request",
    cause:
      "The session token expired while making an API call. Sessions last about 6 hours. " +
      "This is normal and not a user error.",
    action:
      "Tell the user their DSers session has expired and ask them to run " +
      "'npx @lofder/dsers-mcp-product login' to refresh. After re-login, retry the failed operation.",
  },
  TOKEN_NOT_FOUND: {
    summary: "DSers session not found",
    cause:
      "The server has no valid session. The user may not have logged in, or the session was cleared.",
    action:
      "Ask the user to run 'npx @lofder/dsers-mcp-product login' in their terminal. " +
      "This opens the DSers website — they log in there, password never touches this tool.",
  },
  UNAUTHORIZED: {
    summary: "DSers authorization failed",
    cause:
      "The session is invalid or the DSers account has been locked/deactivated.",
    action:
      "Ask the user to run 'npx @lofder/dsers-mcp-product login' to re-authenticate. " +
      "If login keeps failing, the user should check their DSers account status at dsers.com.",
  },
  LOGIN_ERROR_TOO_MANY: {
    summary: "Too many failed login attempts",
    cause: "Incorrect password was submitted multiple times and the account is temporarily locked.",
    action: "Ask the user to verify their DSers password is correct. Wait a few minutes before retrying.",
  },
  IMPORT_LIST_PRODUCT_ALREADY_EXISTS: {
    summary: "Product already in import list",
    cause: "This supplier product was previously imported and still exists in the DSers import list.",
    action:
      "The server will try to locate the existing draft automatically. If it fails, ask the user to check their DSers import list.",
  },
  ALIBABA_NOT_AVAILABLE: {
    summary: "Alibaba product not importable (likely MOQ > 1)",
    cause:
      "The Alibaba product exists but DSers cannot import it. " +
      "The most common reason is the product's Minimum Order Quantity (MOQ) is greater than 1. " +
      "DSers only supports Alibaba products that allow single-piece ordering (MOQ = 1).",
    action:
      "Try a different Alibaba product with MOQ = 1, or find the same product on AliExpress " +
      "where all products support single-piece ordering.",
  },
  PUSH_PRODUCT_WAITING: {
    summary: "Push temporarily blocked — DSers is processing",
    cause:
      "DSers is currently migrating or syncing product data. This is a transient backend state.",
    action:
      "Wait 1-2 minutes and retry the push. This usually resolves on its own. " +
      "If it persists for more than 5 minutes, the user should check the DSers dashboard.",
  },
  PRODUCT_STATUS_NOT_ONSELLING: {
    summary: "Product not importable — off-shelf or delisted",
    cause:
      "DSers reports the product is not on-selling. The product has likely been delisted by the supplier, " +
      "removed from the platform, or is unavailable in the selected country/region.",
    action:
      "Verify the product URL in a browser to check if it's still available. If not, try a different product URL.",
  },
  PERMISSION_DENIED: {
    summary: "Permission denied",
    cause: "The DSers account does not have permission for this operation (plan limitation or role restriction).",
    action: "Ask the user to check their DSers subscription plan or account role.",
  },
  CODEC: {
    summary: "Server data format error",
    cause: "The request payload format was rejected by the DSers API (usually a type mismatch in IDs).",
    action: "This is likely a server-side bug. Report the full error to the MCP server maintainer.",
  },
};

const MESSAGE_PATTERNS: [RegExp, AgentError][] = [
  [
    /credentials not configured/i,
    {
      summary: "DSers credentials not configured",
      cause:
        "No valid DSers session found. The user has never run the login command, or has logged out. " +
        "You (the agent) cannot call any DSers tool until the user authenticates.",
      action:
        "STOP all DSers operations. Tell the user in plain language: " +
        "'I need you to log in to DSers first. Please open your terminal and run: " +
        "npx @lofder/dsers-mcp-product login — this will open the DSers website in your browser. " +
        "You log in there directly, your password never passes through me. Takes about 30 seconds.' " +
        "Wait for the user to confirm login is done, then retry. " +
        "If the user is on a headless server (no browser), suggest setting DSERS_TOKEN env var.",
    },
  ],
  [
    /session expired|session.*(invalid|lost)/i,
    {
      summary: "DSers session expired",
      cause:
        "The saved session token has expired (sessions last about 6 hours). " +
        "This is normal and expected — not a bug or user error.",
      action:
        "Tell the user: 'Your DSers login has expired — this happens every few hours for security. " +
        "Could you run npx @lofder/dsers-mcp-product login again? It only takes a moment.' " +
        "If the user was in the middle of a workflow (e.g., already imported but not pushed), " +
        "reassure them that the import data is still saved and they can continue after re-login.",
    },
  ],
  [
    /Unknown job_id/i,
    {
      summary: "Job session expired (serverless restart)",
      cause:
        "The import job was created on a different server instance that has since been recycled. " +
        "The job state could not be recovered from the job_id token.",
      action:
        "Call dsers.product.import again with the same source_url to re-import. " +
        "The product likely already exists in the import list and will be found automatically.",
    },
  ],
  [
    /No linked stores found/i,
    {
      summary: "No store connected to DSers",
      cause: "The DSers account has no Shopify, Wix, or other stores linked.",
      action:
        "Ask the user to log into DSers and connect a store under Settings > Linked Stores before pushing products.",
    },
  ],
  [
    /Multiple stores are available/i,
    {
      summary: "Multiple stores found — target_store required",
      cause: "The DSers account has more than one linked store and no target was specified.",
      action:
        "Call dsers.store.discover to see available stores, then provide the target_store parameter " +
        "(store_ref or display_name) in dsers.store.push.",
    },
  ],
  [
    /Unknown target_store/i,
    {
      summary: "Store not found",
      cause: "The specified target_store does not match any store linked to this DSers account.",
      action:
        "Call dsers.store.discover to list available stores and use the exact store_ref or display_name from the response.",
    },
  ],
  [
    /source_url is required/i,
    {
      summary: "Missing product URL",
      cause: "No supplier product URL was provided.",
      action:
        "Provide source_url with a valid AliExpress, Alibaba, or Accio product link. " +
        "Example: https://www.aliexpress.com/item/1234567890.html",
    },
  ],
  [
    /job_id is required/i,
    {
      summary: "Missing job_id",
      cause: "The job_id parameter was not provided.",
      action: "Use the job_id returned by dsers.product.import in your previous call.",
    },
  ],
  [
    /Could not extract product info from Accio URL/i,
    {
      summary: "Accio URL could not be parsed",
      cause:
        "The Accio URL does not contain the required productId and ds (data source) parameters.",
      action:
        "Use a product detail link from Accio (click a product → copy URL from browser). " +
        "The URL should look like: accio.com/c/...?productId=NUMBERS&ds=aliexpress.com " +
        "or accio.com/d/NUMBERS?dataSource=Alibaba.com",
    },
  ],
  [
    /Could not resolve the supplier product URL/i,
    {
      summary: "Invalid or unrecognized product URL",
      cause: "The URL does not match a known supplier format or the product page could not be parsed.",
      action:
        "Verify the URL is a valid product page from AliExpress (.com or .us), Alibaba, " +
        "or an Accio product staging link. " +
        "The URL should contain /item/NUMBERS.html for AliExpress.",
    },
  ],
  [
    /Could not locate the imported product draft/i,
    {
      summary: "Import draft not found in DSers",
      cause:
        "The product was sent to DSers for import but could not be found in the import list. " +
        "This can happen if the product URL uses a regional ID format that differs from the global catalog.",
      action:
        "Try using the aliexpress.com version of the URL instead of .us, or manually check the DSers import list.",
    },
  ],
  [
    /Push blocked by safety check/i,
    {
      summary: "Push blocked — pricing or stock safety issue detected",
      cause: "$$RAW$$",
      action:
        "STOP and show the user the EXACT issue above in plain language. " +
        "Then either: (1) fix the pricing rules with dsers.product.import (re-apply mode: pass job_id + rules_json), or " +
        "(2) if the user explicitly confirms they understand the risk, retry with force_push=true. " +
        "NEVER set force_push silently — you must get user confirmation first.",
    },
  ],
  [
    /Could not push the product/i,
    {
      summary: "Push to store failed",
      cause: "DSers rejected the push request. The store connection may be broken or the product data is invalid.",
      action:
        "Check that the target store is still connected in DSers. " +
        "If the error mentions a specific reason code, address that first. Then retry.",
    },
  ],
  [
    /Cannot recover job/i,
    {
      summary: "Job recovery failed",
      cause: "The job state token is corrupted or missing essential data.",
      action: "Call dsers.product.import again with the original source_url to create a new job.",
    },
  ],
  [
    /504|Gateway Time-out/i,
    {
      summary: "DSers API timed out",
      cause:
        "The DSers server took too long to respond. This often happens with very large products " +
        "(100+ variants or images). The operation may still be processing in the background.",
      action:
        "Wait 30-60 seconds and retry the operation. If the product has many variants (>50), " +
        "this is a known DSers API limitation. Try with a simpler product first.",
    },
  ],
  [
    /Login HTTP|login failed/i,
    {
      summary: "DSers login failed",
      cause: "The DSers API rejected the login request (wrong credentials or account issue).",
      action:
        "Ask the user to run 'npx @lofder/dsers-mcp-product login' to re-authenticate via browser. " +
        "If using env vars, verify DSERS_TOKEN is correct and not expired.",
    },
  ],
  [
    /not currently importable|not importable under|PRODUCT_STATUS_NOT_ONSELLING/i,
    {
      summary: "Product not importable via DSers",
      cause:
        "The supplier product is recognized but cannot be imported. The product is likely " +
        "off-shelf, delisted, or unavailable in the selected country/region.",
      action:
        "Verify the product URL in a browser. If the product page is gone or shows 'not available', " +
        "try a different product URL.",
    },
  ],
  [
    /SyntaxError|Unexpected token|Invalid JSON in|malformed json/i,
    {
      summary: "Invalid JSON syntax",
      cause: "A JSON parameter (e.g. rules_json or source_urls_json) contains invalid JSON — likely a missing brace, bracket, or comma.",
      action: "Fix the JSON syntax and retry. Validate with JSON.parse() before sending.",
    },
  ],
  [
    /PUSH_PRODUCT_WAITING|products are being migrated/i,
    {
      summary: "Push temporarily blocked — DSers is processing",
      cause: "DSers is currently migrating or syncing product data. This is a transient backend state.",
      action: "Wait 1-2 minutes and retry the push. This usually resolves on its own.",
    },
  ],
];

function extractDsersReason(err: any): string | null {
  if (err instanceof DSersAPIError) {
    try {
      const body = JSON.parse(err.body);
      return body.reason ?? null;
    } catch (_parseErr: unknown) {
      return null;
    }
  }
  const msg = String(err.message ?? err);
  const m = /\"reason\"\s*:\s*\"([A-Z_]+)\"/i.exec(msg);
  return m ? m[1] : null;
}

export function formatErrorForAgent(err: any): string {
  const rawMessage = String(err.message ?? err);
  const reason = extractDsersReason(err);

  let mapped: AgentError | undefined;
  if (reason && DSERS_REASON_MAP[reason]) {
    mapped = DSERS_REASON_MAP[reason];
  }
  if (!mapped) {
    for (const [pattern, entry] of MESSAGE_PATTERNS) {
      if (pattern.test(rawMessage)) {
        mapped = entry;
        break;
      }
    }
  }

  if (mapped) {
    const cause = mapped.cause === "$$RAW$$" ? rawMessage : mapped.cause;
    const parts = [
      `Error: ${mapped.summary}`,
      `Cause: ${cause}`,
      `Action: ${mapped.action}`,
    ];
    if (reason) parts.push(`DSers reason code: ${reason}`);
    return parts.join("\n");
  }

  if (err instanceof DSersAPIError) {
    return (
      `Error: DSers API returned status ${err.status}\n` +
      `Cause: The DSers backend rejected the request.\n` +
      `Action: Check that the DSers account is active and the operation parameters are valid.\n` +
      `Detail: ${err.body.slice(0, 300)}`
    );
  }

  return (
    `Error: ${rawMessage}\n` +
    `Action: If this is unexpected, retry the operation. If it persists, check DSers account status and credentials.`
  );
}
