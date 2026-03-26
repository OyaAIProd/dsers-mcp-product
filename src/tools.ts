import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ImportFlowService } from "./service.js";
import { formatErrorForAgent } from "./error-map.js";

function toJson(data: any): string {
  return JSON.stringify(data);
}

function ok(data: any) {
  return { content: [{ type: "text" as const, text: toJson(data) }] };
}

function fail(err: any) {
  return {
    content: [{ type: "text" as const, text: formatErrorForAgent(err) }],
    isError: true as const,
  };
}

function safeJsonParse(
  raw: string,
  paramName: string,
  hint: string,
): { value: any; error?: string } {
  try {
    return { value: JSON.parse(raw) };
  } catch (_jsonErr: unknown) {
    return { value: null, error: `Invalid JSON in ${paramName}. ${hint}` };
  }
}

export function registerTools(
  server: McpServer,
  getService: (() => ImportFlowService) | ImportFlowService,
): void {
  const svc = typeof getService === "function" ? getService : () => getService;

  server.registerTool(
    "dsers.store.discover",
    {
      title: "DSers Store & Rule Discovery",
      description:
        "Retrieve available stores and supported rules for the connected DSers account. " +
        "Call this first — the response contains store IDs and configuration needed by all subsequent operations. " +
        "Returns: stores (each with id, name, platform, ship[]), rules (pricing modes, content, images). " +
        "ae_expired/plan_issue only appear if there is a problem.",
      inputSchema: {
        target_store: z
          .string()
          .optional()
          .describe(
            "Store ID or name to filter capabilities for a specific store. " +
              "Omit to see all linked stores. Use the id or name from this response in later calls.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ target_store }) => {
      try {
        return ok(await svc().getRuleCapabilities({ target_store: target_store || null }));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers.rules.validate",
    {
      title: "Dropshipping Pricing & Content Rule Validator",
      description:
        "Check and normalize a rules object against the provider's capabilities before importing. " +
        "Use this to verify pricing, content, and image rules are valid and see exactly which ones will be applied. " +
        "Returns: effective_rules_snapshot (what will actually be applied), warnings (adjustments made), errors (blocking issues that must be fixed before calling dsers.product.import).",
      inputSchema: {
        rules: z.string().describe(
          "Rules as a JSON string. Top-level keys: pricing, content, images. " +
            'Example: {"pricing": {"mode": "multiplier", "multiplier": 2.5}, ' +
            '"content": {"title_prefix": "[US] "}, "images": {"keep_first_n": 5}}',
        ),
        target_store: z
          .string()
          .optional()
          .describe(
            "Store ID or display name from dsers.store.discover. Some rule capabilities vary by store.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ rules, target_store }) => {
      try {
        const parsed = safeJsonParse(
          rules, "rules",
          'Expected a JSON object with optional keys: pricing, content, images. ' +
            'Example: {"pricing": {"mode": "multiplier", "multiplier": 2.0}}',
        );
        if (parsed.error) return fail(new Error(parsed.error));
        return ok(await svc().validateRules({ rules: parsed.value, target_store: target_store || null }));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers.product.import",
    {
      title: "AliExpress / Alibaba / Accio Product Import",
      description:
        "Import product(s) from supplier URL(s) into the DSers import list and return a preview. " +
        "Supports AliExpress, Alibaba, and Accio.com URLs. " +
        "THREE MODES: " +
        "(1) New import — provide source_url (single) or source_urls_json (batch). " +
        "(2) Re-apply rules — provide job_id + rules_json to update pricing/content without re-importing. " +
        "(3) Refresh preview — provide job_id alone (no rules_json) to reload current state. " +
        "EXPIRED/LOST JOB_ID: If a job_id returns 'expired' or 'Unknown job_id', call this tool again " +
        "with the original source_url. DSers will locate the existing draft in the import list automatically " +
        "(no duplicate is created). Then apply rules to the new job_id. " +
        "MODIFYING IMPORTED PRODUCTS: To change an already-imported product when you don't have the job_id, " +
        "re-import it with source_url + rules_json. DSers finds the existing draft. " +
        "CONTENT RULES (via rules_json content key): " +
        "title_override replaces the entire title. title_prefix/title_suffix wrap the original title. " +
        "description_override_html replaces the full description (HTML string). " +
        "description_append_html appends HTML after the original. tags_add is a comma-separated tag string. " +
        "Content rules are cumulative with pricing rules — include both in one rules_json if needed. " +
        "PRICE SEMANTICS: sell_price = store listing price (Shopify 'price'). " +
        "cost = supplier purchase price. no_markup=true when sell_price equals cost. " +
        "skus: header [name, sell, compare_at, cost, qty, supplier_qty], then data rows. " +
        "Returns: job_id, status, title, sell_price, compare_at_price, cost, no_markup, variants_count, " +
        "images, skus, stock, supplier_stock, ship_to, ship_from, warnings.",
      inputSchema: {
        job_id: z
          .string()
          .optional()
          .describe(
            "Re-apply mode: provide a job_id from a previous import together with rules_json to update rules " +
              "without re-importing from the supplier. The original draft is preserved and new rules are applied on top. " +
              "If the job has expired (server restart), the draft is auto-recovered from DSers. " +
              "If recovery fails, re-import with source_url instead.",
          ),
        source_url: z
          .string()
          .optional()
          .describe(
            "Single supplier product URL. Supports AliExpress (aliexpress.com/item/xxx.html), " +
              "Alibaba (alibaba.com/product-detail/xxx.html), " +
              "and Accio.com product links (accio.com/c/...?productId=xxx&ds=aliexpress.com).",
          ),
        source_urls_json: z
          .string()
          .optional()
          .describe(
            "Batch import: JSON array of URL strings or objects with {url, rules?, source_hint?, country?, target_store?, visibility_mode?}. " +
              'Example: ["https://aliexpress.com/item/123.html", ' +
              '{"url": "https://aliexpress.com/item/456.html", "rules": {"pricing": {"mode": "multiplier", "multiplier": 3}}}]',
          ),
        source_hint: z
          .string()
          .default("auto")
          .describe(
            "Supplier platform hint. Valid values: auto, aliexpress, alibaba, accio. Default: auto (detected from URL).",
          ),
        country: z
          .string()
          .default("US")
          .describe(
            "Target country code for shipping and pricing lookup. Examples: US, GB, DE, FR, AU.",
          ),
        target_store: z
          .string()
          .optional()
          .describe(
            "Store ID or display name from dsers.store.discover. Required when the account has multiple stores.",
          ),
        visibility_mode: z
          .string()
          .optional()
          .describe(
            "Product visibility after push. " +
              "backend_only (default): saved as draft, not visible to shoppers. " +
              "sell_immediately: published and visible on the storefront.",
          ),
        rules_json: z
          .string()
          .optional()
          .describe(
            "Optional rules as JSON string applied to all items. " +
              "Keys: pricing ({mode, multiplier, fixed_markup, round_digits}), " +
              "content ({title_override, title_prefix, title_suffix, description_override_html, description_append_html, tags_add}), " +
              "images ({keep_first_n, drop_indexes}), " +
              "variant_overrides (array of per-variant patches). " +
              "fixed_markup is in dollars (e.g. 5.00 = add $5 to cost). multiplier is a ratio (e.g. 2.0 = 2x cost). " +
              "VARIANT_OVERRIDES: Each entry has 'match' (substring to match variant title or SKU) and optional " +
              "sell_price (dollars), compare_at_price (dollars), stock (integer), title (string). " +
              "Applied AFTER global pricing, so overrides take priority. " +
              'Example: {"pricing":{"mode":"multiplier","multiplier":2.5},' +
              '"variant_overrides":[{"match":"Green","sell_price":12.99,"compare_at_price":19.99}]}',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        if (args.job_id && !args.source_url && !args.source_urls_json) {
          const rulesPayload: Record<string, any> = { job_id: args.job_id };
          if (args.rules_json) {
            const parsed = safeJsonParse(
              args.rules_json, "rules_json",
              'Expected a JSON object with optional keys: pricing, content, images. ' +
                'Example: {"pricing": {"mode": "multiplier", "multiplier": 2.0}}',
            );
            if (parsed.error) return fail(new Error(parsed.error));
            rulesPayload.rules = parsed.value;
          } else {
            rulesPayload._keep_existing_rules = true;
          }
          if (args.target_store) rulesPayload.target_store = args.target_store;
          if (args.visibility_mode) rulesPayload.visibility_mode = args.visibility_mode;
          return ok(await svc().reapplyRules(rulesPayload));
        }

        const payload: Record<string, any> = {};

        if (args.source_urls_json) {
          const parsed = safeJsonParse(
            args.source_urls_json, "source_urls_json",
            'Expected a JSON array of URL strings or objects. Example: ["https://aliexpress.com/item/123.html"]',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          if (!Array.isArray(parsed.value)) {
            return fail(new Error(
              "source_urls_json must be a JSON array, not " + typeof parsed.value + ". " +
              'Example: ["https://aliexpress.com/item/123.html"]',
            ));
          }
          payload.source_urls = parsed.value;
        } else if (args.source_url) {
          payload.source_url = args.source_url;
        }

        if (args.source_hint) payload.source_hint = args.source_hint;
        if (args.country) payload.country = args.country;
        if (args.target_store) payload.target_store = args.target_store;
        payload.visibility_mode = args.visibility_mode || "backend_only";

        if (args.rules_json) {
          const parsed = safeJsonParse(
            args.rules_json, "rules_json",
            'Expected a JSON object with optional keys: pricing, content, images. ' +
              'Example: {"pricing": {"mode": "multiplier", "multiplier": 2.0}}',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          payload.rules = parsed.value;
        }

        return ok(await svc().prepareImportCandidate(payload));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers.product.preview",
    {
      title: "Import Draft Preview",
      description:
        "Reload preview for an import job. Same response shape as dsers.product.import. " +
        "sell_price = store listing price, compare_at_price = strikethrough/original price, cost = supplier price. " +
        "ship_to = destination country, ship_from = origin country. " +
        "stock = store inventory, supplier_stock = actual supplier inventory (may differ).",
      inputSchema: {
        job_id: z
          .string()
          .describe("Job ID returned by dsers.product.import."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id }) => {
      try {
        return ok(await svc().getImportPreview({ job_id }));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers.product.visibility",
    {
      title: "Shopify / Wix Product Visibility Toggle",
      description:
        "Change the visibility mode of a prepared job before pushing it to the store. " +
        "Call this between dsers.product.import and dsers.store.push to switch between draft and published. " +
        "Returns: job_id, status, visibility_mode.",
      inputSchema: {
        job_id: z
          .string()
          .describe("Job ID returned by dsers.product.import."),
        visibility_mode: z.string().describe(
          "New visibility mode. " +
            "backend_only: save as draft, not visible to shoppers. " +
            "sell_immediately: publish to storefront.",
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id, visibility_mode }) => {
      try {
        return ok(await svc().setProductVisibility({ job_id, visibility_mode }));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers.store.push",
    {
      title: "Push Product to Shopify / Wix Store",
      description:
        "Push one or more prepared import drafts to the connected Shopify or Wix store(s). " +
        "SAFETY: Automatic pre-push validation checks pricing (blocks if sell price < cost or $0) and stock (blocks if all variants have zero inventory). " +
        "Warnings are raised for low margin (<10%), low stock (<5 units), or very low price (<$1). " +
        "If blocked, fix pricing rules or use force_push=true ONLY after explaining the risk to the user. " +
        "Three modes: (1) Single push — provide job_id + target_store. " +
        "(2) Batch push — provide job_ids_json with an array of job IDs or objects; takes priority over job_id. " +
        "(3) Multi-store push — provide job_id + target_stores_json to push one product to multiple stores. " +
        "Returns per-job results: job_id, status, target_store, visibility_applied, push_options_applied, job_summary, warnings.",
      inputSchema: {
        job_id: z
          .string()
          .optional()
          .describe(
            "Single job ID from dsers.product.import. Used for single-push or multi-store mode.",
          ),
        job_ids_json: z
          .string()
          .optional()
          .describe(
            "Batch push: JSON array of job ID strings or objects " +
              '{job_id, target_store?, target_stores?, push_options?, visibility_mode?}. ' +
              'Example: ["job-abc123", {"job_id": "job-def456", "target_store": "My Store"}]. ' +
              "When provided, this takes priority over job_id.",
          ),
        target_store: z
          .string()
          .optional()
          .describe(
            "Target store ID or display name from dsers.store.discover. Required when the account has multiple stores.",
          ),
        target_stores_json: z
          .string()
          .optional()
          .describe(
            "Multi-store: JSON array of store IDs or display names. Pushes the same job_id to each listed store. " +
              'Example: ["Store A", "Store B"]',
          ),
        visibility_mode: z
          .string()
          .optional()
          .describe(
            "Override the visibility mode set during prepare. " +
              "backend_only: draft. sell_immediately: published.",
          ),
        push_options_json: z
          .string()
          .optional()
          .describe(
            "Push configuration as JSON string. Keys: " +
              "publish_to_online_store (bool), " +
              "image_strategy ('selected_only' or 'all_available'), " +
              "pricing_rule_behavior ('keep_manual' or 'apply_store_pricing_rule'), " +
              "shipping_profile_name (string — Shopify delivery profile name), " +
              "auto_inventory_update (bool), auto_price_update (bool), " +
              "sales_channels (string[]), only_push_specifications (bool). " +
              'Example: {"image_strategy": "all_available", "shipping_profile_name": "DSers Shipping Profile"}',
          ),
        force_push: z
          .boolean()
          .optional()
          .describe(
            "Override pre-push safety checks. ONLY set true after you have shown the user the specific risk " +
              "(e.g., 'This product is priced below cost — you will lose $X per sale') and they explicitly confirmed. " +
              "Never set this silently.",
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const payload: Record<string, any> = {};

        if (args.job_ids_json) {
          const parsed = safeJsonParse(
            args.job_ids_json, "job_ids_json",
            'Expected a JSON array of job ID strings or objects. Example: ["job-abc123"]',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          payload.job_ids = parsed.value;
        } else if (args.job_id) {
          payload.job_id = args.job_id;
        }

        if (args.target_store) payload.target_store = args.target_store;

        if (args.target_stores_json) {
          const parsed = safeJsonParse(
            args.target_stores_json, "target_stores_json",
            'Expected a JSON array of store names or IDs. Example: ["My Store", "Store B"]',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          payload.target_stores = parsed.value;
        }

        if (args.visibility_mode) payload.visibility_mode = args.visibility_mode;
        if (args.force_push) payload.force_push = true;

        if (args.push_options_json) {
          const parsed = safeJsonParse(
            args.push_options_json, "push_options_json",
            'Expected a JSON object. Example: {"image_strategy": "all_available", "auto_inventory_update": true}',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          payload.push_options = parsed.value;
        }

        return ok(await svc().confirmPushToStore(payload));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers.job.status",
    {
      title: "Import / Push Job Status Tracker",
      description:
        "Check the current status of an import or push job. " +
        "Status lifecycle: preview_ready → push_requested → completed or failed. " +
        "Returns: job_id, status, target_store, push_status (if pushed), warnings.",
      inputSchema: {
        job_id: z
          .string()
          .describe(
            "Job ID from dsers.product.import or dsers.store.push.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id }) => {
      try {
        return ok(await svc().getJobStatus({ job_id }));
      } catch (err) { return fail(err); }
    },
  );

  // ── Prompts ──

  server.prompt(
    "dsers.workflow.quick-import",
    "Quick product import workflow — import a single AliExpress, Alibaba, or Accio.com product and push it to your Shopify or Wix store as a draft.",
    {
      product_url: z
        .string()
        .describe("Supplier product URL (AliExpress, Alibaba, or Accio.com product link)."),
      store_name: z
        .string()
        .optional()
        .describe("Target store display name. Omit if only one store is linked."),
    },
    async ({ product_url, store_name }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Import this product and push it to ${store_name || "my store"} as a draft:\n${product_url}\n\n` +
              "Steps: 1) Call dsers.store.discover to find the store. " +
              "2) Call dsers.product.import with the URL. " +
              "3) Show me the preview (title, price, variants). " +
              "4) Call dsers.store.push with visibility_mode=backend_only.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "dsers.workflow.bulk-import",
    "Bulk import multiple products with a pricing multiplier — import several supplier URLs at once and apply a price markup before pushing to your store.",
    {
      product_urls: z
        .string()
        .describe("Comma-separated list of supplier product URLs."),
      price_multiplier: z
        .string()
        .default("2.0")
        .describe("Price multiplier to apply (e.g. 2.0 for 2x markup)."),
      store_name: z
        .string()
        .optional()
        .describe("Target store display name."),
    },
    async ({ product_urls, price_multiplier, store_name }) => {
      const urls = product_urls.split(",").map((u) => u.trim()).filter(Boolean);
      const urlsJson = JSON.stringify(urls);
      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text:
                `Bulk import these ${urls.length} products with a ${price_multiplier}x price markup and push them to ${store_name || "my store"}:\n\n` +
                urls.map((u, i) => `${i + 1}. ${u}`).join("\n") +
                "\n\nSteps: 1) dsers.store.discover. " +
                `2) dsers.product.import with source_urls_json='${urlsJson}' and rules_json='{"pricing":{"mode":"multiplier","multiplier":${price_multiplier}}}'. ` +
                "3) Show previews. 4) dsers.store.push for each job.",
            },
          },
        ],
      };
    },
  );

  server.prompt(
    "dsers.workflow.multi-push",
    "Push one product to all connected Shopify and Wix stores at once — useful for sellers managing multiple storefronts.",
    {
      product_url: z
        .string()
        .describe("Supplier product URL to import."),
    },
    async ({ product_url }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Import this product and push it to ALL my stores:\n${product_url}\n\n` +
              "Steps: 1) dsers.store.discover — list all stores. " +
              "2) dsers.product.import with the URL. " +
              "3) dsers.store.push with target_stores_json containing all store names from step 1.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "dsers.workflow.seo-optimize",
    "Import a product, use your LLM capabilities to rewrite the title and description for SEO, then push the optimized listing to the store.",
    {
      product_url: z
        .string()
        .describe("Supplier product URL (AliExpress, Alibaba, or Accio.com product link)."),
      store_name: z
        .string()
        .optional()
        .describe("Target store display name. Omit if only one store is linked."),
      target_audience: z
        .string()
        .optional()
        .describe("Target audience or niche for SEO optimization. E.g. 'US women aged 25-40 interested in home decor'."),
    },
    async ({ product_url, store_name, target_audience }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              `Import this product and optimize it for SEO before pushing to ${store_name || "my store"}:\n${product_url}\n` +
              (target_audience ? `Target audience: ${target_audience}\n` : "") +
              "\nWorkflow:\n" +
              "1) dsers.store.discover — find the target store.\n" +
              "2) dsers.product.import with the URL (no content rules yet) — get the raw preview.\n" +
              "3) Review the title_after and description_html_snippet from the preview.\n" +
              "4) [YOU DO THIS] Rewrite the title: remove supplier noise like [HOT], brand spam, ALL-CAPS. " +
              "Make it clean, keyword-rich, and appealing to shoppers" +
              (target_audience ? ` (audience: ${target_audience})` : "") + ".\n" +
              "5) [YOU DO THIS] Rewrite the description: turn the raw supplier HTML into a professional, " +
              "conversion-focused product description with benefits, features, and a clear CTA. " +
              "Keep it concise (150-300 words).\n" +
              "6) dsers.product.import with the SAME job_id + rules_json containing title_override and description_override_html " +
              "with your rewritten content. This re-applies rules without re-importing.\n" +
              "7) Show me the updated preview for approval.\n" +
              "8) After I confirm, dsers.store.push to the target store.",
          },
        },
      ],
    }),
  );
}
