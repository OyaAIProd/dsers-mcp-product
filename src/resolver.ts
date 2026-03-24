export interface ResolveResult {
  resolved_url: string;
  source_hint: string;
  resolver_mode: string;
  warnings: string[];
}

/**
 * Extract product info from an Accio URL by parsing query params / path.
 *
 * Supported formats (all under accio.com):
 *   /c/{cid}?productId=...&ds=aliexpress.com   (conversation / staging)
 *   /d/{id}?dataSource=Alibaba.com              (product detail)
 *   any path with productId + ds|dataSource      (mylist, search, etc.)
 */
function resolveAccioUrl(
  parsed: URL,
): { resolved_url: string; source_hint: string } | null {
  const productId =
    parsed.searchParams.get("productId") ??
    parsed.searchParams.get("productid");

  const ds = (
    parsed.searchParams.get("ds") ??
    parsed.searchParams.get("dataSource") ??
    parsed.searchParams.get("datasource") ??
    ""
  ).toLowerCase();

  if (!productId) {
    const pathMatch = parsed.pathname.match(/\/d\/(\d+)/);
    if (pathMatch) {
      const id = pathMatch[1];
      if (ds.includes("alibaba") || ds.includes("1688")) {
        return {
          resolved_url: `https://www.alibaba.com/product-detail/p_${id}.html`,
          source_hint: "alibaba",
        };
      }
      return {
        resolved_url: `https://www.aliexpress.com/item/${id}.html`,
        source_hint: "aliexpress",
      };
    }
    return null;
  }

  if (ds.includes("aliexpress")) {
    return {
      resolved_url: `https://www.aliexpress.com/item/${productId}.html`,
      source_hint: "aliexpress",
    };
  }

  if (ds.includes("alibaba") || ds.includes("1688")) {
    return {
      resolved_url: `https://www.alibaba.com/product-detail/p_${productId}.html`,
      source_hint: "alibaba",
    };
  }

  if (/^\d{5,}$/.test(productId)) {
    return {
      resolved_url: `https://www.aliexpress.com/item/${productId}.html`,
      source_hint: "aliexpress",
    };
  }

  return {
    resolved_url: `https://www.aliexpress.com/item/${productId}.html`,
    source_hint: "aliexpress",
  };
}

export async function resolveSourceUrl(
  url: string,
  sourceHint?: string,
): Promise<ResolveResult> {
  const warnings: string[] = [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      resolved_url: url,
      source_hint: sourceHint ?? "",
      resolver_mode: "passthrough",
      warnings: ["Invalid URL"],
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname.includes("aliexpress.")) {
    return {
      resolved_url: url,
      source_hint: "aliexpress",
      resolver_mode: "direct",
      warnings,
    };
  }

  if (hostname.includes("alibaba.com") || hostname.includes("1688.com")) {
    return {
      resolved_url: url,
      source_hint: hostname.includes("1688") ? "1688" : "alibaba",
      resolver_mode: "direct",
      warnings,
    };
  }

  if (sourceHint === "aliexpress") {
    return {
      resolved_url: url,
      source_hint: "aliexpress",
      resolver_mode: "forced_direct",
      warnings,
    };
  }

  if (hostname.includes("accio.com") || sourceHint === "accio") {
    const accio = resolveAccioUrl(parsed);
    if (accio) {
      return {
        resolved_url: accio.resolved_url,
        source_hint: accio.source_hint,
        resolver_mode: "accio",
        warnings,
      };
    }
    warnings.push(
      "Could not extract product info from Accio URL. " +
        "Supported formats: /c/{id}?productId=...&ds=aliexpress.com, " +
        "/d/{id}?dataSource=Alibaba.com, or any Accio page with productId parameter.",
    );
    return {
      resolved_url: url,
      source_hint: sourceHint ?? "",
      resolver_mode: "accio",
      warnings,
    };
  }

  return {
    resolved_url: url,
    source_hint: sourceHint ?? "",
    resolver_mode: "passthrough",
    warnings,
  };
}
