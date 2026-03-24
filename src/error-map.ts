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
    summary: "Session expired during request",
    cause: "The DSers authentication token expired mid-session and automatic refresh failed.",
    action: "Retry the same operation. If it fails again, ask the user to verify their DSers credentials.",
  },
  TOKEN_NOT_FOUND: {
    summary: "Authentication session lost",
    cause: "The server could not establish a valid session with DSers.",
    action: "Retry the operation. If it persists, ask the user to check their DSers email and password.",
  },
  UNAUTHORIZED: {
    summary: "Not authorized",
    cause: "The DSers account credentials are invalid or the session has been invalidated.",
    action: "Ask the user to verify their DSers email and password, then retry.",
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
      "The Alibaba/1688 product exists but DSers cannot import it. " +
      "The most common reason is the product's Minimum Order Quantity (MOQ) is greater than 1. " +
      "DSers only supports Alibaba products that allow single-piece ordering (MOQ = 1).",
    action:
      "Try a different Alibaba product with MOQ = 1, or find the same product on AliExpress " +
      "where all products support single-piece ordering.",
  },
  PRODUCT_STATUS_NOT_ONSELLING: {
    summary: "Product not importable — possible AliExpress auth issue",
    cause:
      "DSers reports the product is not on-selling. Most common root cause: the AliExpress authorization " +
      "has expired, so DSers cannot verify product availability. Less commonly, the product is genuinely " +
      "off-shelf or delisted.",
    action:
      "First check AliExpress authorization: call dsers.store.discover and inspect account_info.aliexpress_auth. " +
      "If expired, the user must re-authorize at DSers > Settings > Supplier > AliExpress > Reauthorize. " +
      "If auth is valid, the product itself may be unavailable — try a different product URL.",
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
    /credentials not found/i,
    {
      summary: "DSers credentials not configured",
      cause: "No DSers email/password was provided for authentication.",
      action:
        "The user needs to configure DSers credentials. Methods: " +
        "(1) Smithery config form, (2) HTTP headers x-dsers-email + x-dsers-password, " +
        "(3) Environment variables DSERS_EMAIL + DSERS_PASSWORD, " +
        "(4) MCP client config env block.",
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
        "Provide source_url with a valid AliExpress, Alibaba, or 1688 product link. " +
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
        "Verify the URL is a valid product page from AliExpress (.com or .us), Alibaba, 1688, " +
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
    /Login HTTP/i,
    {
      summary: "DSers login failed",
      cause: "The DSers API rejected the login request (wrong email/password or account issue).",
      action: "Ask the user to verify their DSers email and password are correct.",
    },
  ],
  [
    /All AliExpress authorizations expired/i,
    {
      summary: "AliExpress authorization expired — cannot import new products",
      cause:
        "All AliExpress supplier accounts linked to this DSers account have expired. " +
        "DSers cannot fetch product data from AliExpress without a valid authorization.",
      action:
        "The DSers account owner must re-authorize their AliExpress account: " +
        "Go to DSers > Settings > Supplier > AliExpress > Reauthorize. " +
        "Once done, retry the import.",
    },
  ],
  [
    /not currently importable|not importable under|PRODUCT_STATUS_NOT_ONSELLING/i,
    {
      summary: "Product not importable via DSers",
      cause:
        "The supplier product is recognized but cannot be imported. Most likely causes: " +
        "(1) AliExpress authorization expired, (2) the product is off-shelf or delisted, " +
        "or (3) the product is region-restricted.",
      action:
        "First check AliExpress authorization via dsers.store.discover (look at account_info.aliexpress_auth). " +
        "If expired, re-authorize at DSers > Settings > Supplier > AliExpress > Reauthorize. " +
        "If auth is valid, try a different product URL.",
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
    const parts = [
      `Error: ${mapped.summary}`,
      `Cause: ${mapped.cause}`,
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
