const ALIEXPRESS_PATTERNS = [
  /https?:\/\/(?:www\.)?aliexpress\.com\/[^\s"'<>]+/gi,
  /https?:\/\/(?:[a-z]+\.)?aliexpress\.us\/[^\s"'<>]+/gi,
];
const ENCODED_ALIEXPRESS_PATTERN =
  /https?%3A%2F%2F(?:www%2E)?aliexpress(?:%2Ecom|%2Eus)%2F[^"'<> ]+/gi;

export interface ResolveResult {
  resolved_url: string;
  source_hint: string;
  resolver_mode: string;
  warnings: string[];
}

export async function resolveSourceUrl(
  url: string,
  sourceHint?: string
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

  if (sourceHint === "aliexpress") {
    return {
      resolved_url: url,
      source_hint: "aliexpress",
      resolver_mode: "forced_direct",
      warnings,
    };
  }

  if (hostname.includes("accio.com") || sourceHint === "accio") {
    try {
      const res = await fetch(url);
      const html = await res.text();
      for (const pattern of ALIEXPRESS_PATTERNS) {
        const match = html.match(pattern);
        if (match?.[0]) {
          return {
            resolved_url: match[0],
            source_hint: "aliexpress",
            resolver_mode: "accio",
            warnings,
          };
        }
      }
      const encodedMatch = html.match(ENCODED_ALIEXPRESS_PATTERN);
      if (encodedMatch?.[0]) {
        const decoded = decodeURIComponent(encodedMatch[0]);
        return {
          resolved_url: decoded,
          source_hint: "aliexpress",
          resolver_mode: "accio",
          warnings,
        };
      }
      warnings.push("No AliExpress URL found in page");
    } catch (err) {
      warnings.push(
        err instanceof Error ? err.message : "Failed to fetch page"
      );
    }
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
