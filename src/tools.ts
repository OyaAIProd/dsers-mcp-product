import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ImportFlowService } from "./service.js";
import { formatErrorForAgent } from "./error-map.js";

const coerceBool = z
  .union([z.boolean(), z.string().transform((v) => v === "true")])
  .optional();

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

export function buildRulesFromFlatParams(args: Record<string, any>): Record<string, any> {
  const rules: Record<string, any> = {};
  if (args.pricing_mode) {
    const pricing: Record<string, any> = { mode: args.pricing_mode };
    if (args.pricing_multiplier != null) pricing.multiplier = args.pricing_multiplier;
    if (args.pricing_fixed_markup != null) pricing.fixed_markup = args.pricing_fixed_markup;
    if (args.pricing_fixed_price != null) pricing.fixed_price = args.pricing_fixed_price;
    rules.pricing = pricing;
  }
  const content: Record<string, any> = {};
  if (args.title_override !== undefined) content.title_override = args.title_override;
  if (args.title_prefix !== undefined) content.title_prefix = args.title_prefix;
  if (args.title_suffix !== undefined) content.title_suffix = args.title_suffix;
  if (args.description_override_html !== undefined) content.description_override_html = args.description_override_html;
  if (args.description_append_html !== undefined) content.description_append_html = args.description_append_html;
  if (Object.keys(content).length) rules.content = content;
  return rules;
}

export function registerTools(
  server: McpServer,
  getService: (() => ImportFlowService) | ImportFlowService,
): void {
  const svc = typeof getService === "function" ? getService : () => getService;

  server.registerTool(
    "dsers_store_discover",
    {
      title: "DSers Store & Rule Discovery",
      description:
        "Retrieve available stores and supported rules for the connected DSers account. " +
        "Call this first — the response contains store IDs and configuration needed by all subsequent operations. " +
        "Returns: stores (each with id, name, platform, ship[]), rules (pricing modes, content, images). " +
        "ae_expired means AliExpress re-authorization is needed but does NOT block imports — proceed normally. " +
        "plan_issue only appears if the DSers subscription has a real problem (expired, suspended). " +
        "After calling this tool, proceed to the next step (import, preview, etc.) — do NOT retry discover.",
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
    "dsers_rules_validate",
    {
      title: "Dropshipping Pricing & Content Rule Validator",
      description:
        "Check and normalize a rules object against the provider's capabilities before importing. " +
        "Use this to verify pricing, content, and image rules are valid and see exactly which ones will be applied. " +
        "Returns: effective_rules_snapshot (what will actually be applied), warnings (adjustments made), errors (blocking issues that must be fixed before calling dsers_product_import).",
      inputSchema: {
        rules: z.string().describe(
          "Rules as a JSON string. Top-level keys: pricing, content, images, variant_overrides, option_edits. " +
            "Pricing modes: fixed_price (exact dollar amount for all), multiplier (cost × ratio), fixed_markup (cost + dollars). " +
            'Example: {"pricing": {"mode": "fixed_price", "fixed_price": 9.99}, ' +
            '"content": {"title_prefix": "[US] "}, "images": {"keep_first_n": 5}}',
        ),
        target_store: z
          .string()
          .optional()
          .describe(
            "Store ID or display name from dsers_store_discover. Some rule capabilities vary by store.",
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
    "dsers_product_import",
    {
      title: "AliExpress / Alibaba / Accio Product Import",
      description:
        "Import product(s) from supplier URL(s) into the DSers import list and return a preview. " +
        "Supports AliExpress, Alibaba, and Accio.com URLs. " +
        "Provide source_url (single) or source_urls_json (batch). " +
        "Optionally apply rules at import time via rules_json or flat params. " +
        "EXPIRED/LOST JOB_ID: Re-import with source_url — DSers finds the existing draft (no duplicate). " +
        "To UPDATE rules on an existing import, use dsers_product_update_rules instead. " +
        "SINGLE RESPONSE: compact preview with all variants [name, sell, qty], price_summary, active_rules. " +
        "BATCH RESPONSE: summary mode (default) returns job_id + key metadata per product (~100 tokens each). " +
        "Use batch_detail='full' for complete previews. Use dsers_product_preview for individual details.",
      inputSchema: {
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
            "Store ID or display name from dsers_store_discover. Required when the account has multiple stores.",
          ),
        visibility_mode: z
          .string()
          .optional()
          .describe(
            "Product visibility after push. " +
              "backend_only (default): saved as draft, not visible to shoppers — SAFE, no financial risk. " +
              "sell_immediately: published and LIVE on the storefront — RISK: verify pricing and inventory first.",
          ),
        job_id: z
          .string()
          .optional()
          .describe(
            "(DEPRECATED — use dsers_product_update_rules) " +
              "When provided without source_url, forwards to dsers_product_update_rules internally.",
          ),
        rules_json: z
          .string()
          .optional()
          .describe(
            "Rules as JSON string. Keys: pricing, content, images, variant_overrides, option_edits. " +
              "PRICING: {mode:'fixed_price',fixed_price:9.99} | {mode:'multiplier',multiplier:2} | {mode:'fixed_markup',fixed_markup:5}. " +
              "VARIANT_OVERRIDES: [{match:'Red',sell_price:9.99,compare_at_price:19.99}]. " +
              "CONTENT: {title_override, title_prefix, title_suffix, description_override_html, tags_add:['tag']}. " +
              "IMAGES: {drop_indexes, reorder, add_urls, keep_first_n}. " +
              "OPTION_EDITS: [{action:'rename_option',option_name:'Color',new_name:'Style'}].",
          ),
        pricing_mode: z.enum(["multiplier", "fixed_markup", "fixed_price"]).optional()
          .describe("Flat param: pricing mode. Use instead of rules_json for simple pricing."),
        pricing_multiplier: z.number().optional()
          .describe("Flat param: multiplier value when pricing_mode='multiplier'."),
        pricing_fixed_markup: z.number().optional()
          .describe("Flat param: markup in dollars when pricing_mode='fixed_markup'."),
        pricing_fixed_price: z.number().optional()
          .describe("Flat param: exact price in dollars when pricing_mode='fixed_price'."),
        title_override: z.string().optional()
          .describe("Flat param: replace entire product title."),
        title_prefix: z.string().optional()
          .describe("Flat param: prepend to product title."),
        title_suffix: z.string().optional()
          .describe("Flat param: append to product title."),
        batch_detail: z.enum(["summary", "full"]).optional()
          .describe(
            "Batch response detail level. summary (default): job_id + title + sell_price + cost + variants_count + stock per product (~100 tokens each). " +
              "full: complete preview per product (can be very large for 10+ products). Single imports always return full preview.",
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
          const depFlatRules = buildRulesFromFlatParams(args);
          if (args.rules_json) {
            const parsed = safeJsonParse(
              args.rules_json, "rules_json",
              'Expected a JSON object with optional keys: pricing, content, images. ' +
                'Example: {"pricing": {"mode": "multiplier", "multiplier": 2.0}}',
            );
            if (parsed.error) return fail(new Error(parsed.error));
            rulesPayload.rules = { ...depFlatRules, ...parsed.value };
          } else if (Object.keys(depFlatRules).length) {
            rulesPayload.rules = depFlatRules;
          } else {
            rulesPayload._keep_existing_rules = true;
          }
          if (args.target_store) rulesPayload.target_store = args.target_store;
          if (args.visibility_mode) rulesPayload.visibility_mode = args.visibility_mode;
          const result = await svc().reapplyRules(rulesPayload);
          result._deprecated = "Use dsers_product_update_rules instead of dsers_product_import with job_id.";
          return ok(result);
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
        if (args.batch_detail) payload.batch_detail = args.batch_detail;

        const flatRules = buildRulesFromFlatParams(args);
        if (args.rules_json) {
          const parsed = safeJsonParse(
            args.rules_json, "rules_json",
            'Expected a JSON object with optional keys: pricing, content, images. ' +
              'Example: {"pricing": {"mode": "multiplier", "multiplier": 2.0}}',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          payload.rules = { ...flatRules, ...parsed.value };
        } else if (Object.keys(flatRules).length) {
          payload.rules = flatRules;
        }

        return ok(await svc().prepareImportCandidate(payload));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers_product_preview",
    {
      title: "Import Draft Preview",
      description:
        "Reload preview for an import job. " +
        "Two modes: compact (default) returns [name, sell, qty] for ALL variants — lightweight. " +
        "full returns [name, sell, compare_at, cost, qty, supplier_qty] for 3 variants by default. " +
        "Always includes price_summary: {sell:{min,max}, cost:{min,max}, zero_stock_count, low_stock_count, variants_count}. " +
        "Key fields: sell_price (store listing price, $), cost (supplier price, $), compare_at_price (strikethrough, $). " +
        "options: array of {name, values[], values_count} — values truncated to 10 by default, set show_all_options=true for full list. " +
        "active_rules: currently applied rules (always present, {} if none). " +
        "Use variant_detail='full' when agent needs compare_at or cost columns.",
      inputSchema: {
        job_id: z
          .string()
          .describe("Job ID returned by dsers_product_import."),
        variant_detail: z
          .enum(["compact", "full"])
          .optional()
          .describe(
            "compact (default): columns [name, sell, qty], shows ALL variants. " +
              "full: columns [name, sell, compare_at, cost, qty, supplier_qty], shows 3 by default.",
          ),
        variant_offset: z
          .number()
          .optional()
          .describe("Start index for variant/SKU listing (0-based). Default: 0."),
        variant_limit: z
          .number()
          .optional()
          .describe(
            "Max variants in skus table. Compact default: all. Full default: 3. Hard cap: 200.",
          ),
        show_all_options: coerceBool
          .describe("Show all option values instead of truncating to 10. Use before applying option_edits."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ job_id, variant_detail, variant_offset, variant_limit, show_all_options }) => {
      try {
        return ok(await svc().getImportPreview({
          job_id,
          variant_detail: variant_detail ?? "compact",
          variant_offset: variant_offset ?? 0,
          variant_limit: variant_limit ?? 0,
          show_all_options: show_all_options ?? false,
        }));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers_product_update_rules",
    {
      title: "Update Rules on Imported Product",
      description:
        "Update pricing, content, images, or variant rules on an already-imported product. " +
        "Rules are merged incrementally: pricing/images/variant_overrides replace by family; " +
        "content merges by field (set title_prefix without losing description). " +
        "To clear a content field, send it as empty string or null (e.g. title_prefix:''). " +
        "To remove an entire family, pass null (e.g. rules_json='{\"pricing\":null}'). " +
        "option_edits are always fully replaced (ordered operations, not mergeable). " +
        "OPTION_EDITS actions: " +
        "rename_option {action,option_name,new_name} — rename e.g. Color→Style. " +
        "rename_value {action,option_name,value_name,new_name} — rename a value within an option. " +
        "remove_value {action,option_name,value_name} — remove value and DELETE all variants with that value. " +
        "remove_option {action,option_name} — remove entire option dimension. " +
        "RESPONSE: compact preview with active_rules showing all currently applied rules.",
      inputSchema: {
        job_id: z
          .string()
          .describe("Job ID from a previous dsers_product_import call."),
        rules_json: z
          .string()
          .optional()
          .describe(
            "Rules as JSON string. Keys: pricing, content, images, variant_overrides, option_edits. " +
              "PRICING: {mode:'fixed_price',fixed_price:9.99} | {mode:'multiplier',multiplier:2} | {mode:'fixed_markup',fixed_markup:5}. " +
              "VARIANT_OVERRIDES: [{match:'Red',sell_price:9.99,compare_at_price:19.99}]. " +
              "CONTENT: {title_override, title_prefix, title_suffix, description_override_html, tags_add:['tag']}. " +
              "Content fields merge individually — set title_prefix without losing description. Clear with '' or null. " +
              "IMAGES: {drop_indexes, reorder, add_urls, keep_first_n}. " +
              "OPTION_EDITS (always full replacement): " +
              "[{action:'rename_option',option_name:'Color',new_name:'Style'}," +
              "{action:'rename_value',option_name:'Color',value_name:'Red',new_name:'Crimson'}," +
              "{action:'remove_value',option_name:'Color',value_name:'Gray'}," +
              "{action:'remove_option',option_name:'Size'}]. " +
              "Only include families you want to change. Others are preserved automatically.",
          ),
        pricing_mode: z.enum(["multiplier", "fixed_markup", "fixed_price"]).optional()
          .describe("Flat param: pricing mode. Use instead of rules_json for simple pricing."),
        pricing_multiplier: z.number().optional()
          .describe("Flat param: multiplier value when pricing_mode='multiplier'."),
        pricing_fixed_markup: z.number().optional()
          .describe("Flat param: markup in dollars when pricing_mode='fixed_markup'."),
        pricing_fixed_price: z.number().optional()
          .describe("Flat param: exact price in dollars when pricing_mode='fixed_price'."),
        title_override: z.string().optional()
          .describe("Flat param: replace entire product title."),
        title_prefix: z.string().optional()
          .describe("Flat param: prepend to product title."),
        title_suffix: z.string().optional()
          .describe("Flat param: append to product title."),
        description_override_html: z.string().optional()
          .describe("Flat param: replace full description (HTML)."),
        description_append_html: z.string().optional()
          .describe("Flat param: append HTML to description."),
        target_store: z.string().optional()
          .describe("Store ID or name from dsers_store_discover."),
        visibility_mode: z.string().optional()
          .describe("backend_only (default, safe) or sell_immediately (live — confirm with user)."),
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
        const rulesPayload: Record<string, any> = { job_id: args.job_id };
        const flatRules = buildRulesFromFlatParams(args);
        if (args.rules_json) {
          const parsed = safeJsonParse(
            args.rules_json, "rules_json",
            'Expected a JSON object. Example: {"pricing": {"mode": "multiplier", "multiplier": 2.0}}',
          );
          if (parsed.error) return fail(new Error(parsed.error));
          rulesPayload.rules = { ...flatRules, ...parsed.value };
        } else if (Object.keys(flatRules).length) {
          rulesPayload.rules = flatRules;
        } else {
          rulesPayload._keep_existing_rules = true;
        }
        if (args.target_store) rulesPayload.target_store = args.target_store;
        if (args.visibility_mode) rulesPayload.visibility_mode = args.visibility_mode;
        return ok(await svc().reapplyRules(rulesPayload));
      } catch (err) { return fail(err); }
    },
  );

  server.registerTool(
    "dsers_product_visibility",
    {
      title: "Shopify / Wix Product Visibility Toggle",
      description:
        "Change the visibility mode of a prepared job before pushing it to the store. " +
        "Call this between dsers_product_import and dsers_store_push to switch between draft and published. " +
        "Returns: job_id, status, visibility_mode.",
      inputSchema: {
        job_id: z
          .string()
          .describe("Job ID returned by dsers_product_import."),
        visibility_mode: z.string().describe(
          "New visibility mode. " +
            "backend_only: save as draft, not visible to shoppers — SAFE. " +
            "sell_immediately: publish and LIVE on storefront — RISK: product becomes purchasable immediately. Confirm with user first.",
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
    "dsers_store_push",
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
        "SAFETY RESPONSE: If checks fail, response includes 'blocked' (array of reasons push was rejected — must fix before retrying) " +
        "and/or 'warnings' (array of risk alerts — push proceeds but user should be informed). " +
        "blocked = hard stop (e.g. sell below cost), warnings = soft alert (e.g. low margin). " +
        "On success, returns per-job: job_id, status, target_store, visibility_applied, push_options_applied, job_summary, warnings.",
      inputSchema: {
        job_id: z
          .string()
          .optional()
          .describe(
            "Single job ID from dsers_product_import. Used for single-push or multi-store mode.",
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
            "Target store ID or display name from dsers_store_discover. Required when the account has multiple stores.",
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
              "backend_only: draft — SAFE. sell_immediately: published and LIVE — RISK: confirm pricing/inventory with user first.",
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
        force_push: coerceBool.describe(
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
    "dsers_job_status",
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
            "Job ID from dsers_product_import or dsers_store_push.",
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

  server.registerTool(
    "dsers_product_delete",
    {
      title: "Delete Product from Import List",
      description:
        "Permanently delete a product from the DSers import list. " +
        "IRREVERSIBLE — the product cannot be recovered after deletion. " +
        "Requires explicit confirmation (confirm=true) to execute. " +
        "If called without confirm=true, returns a confirmation prompt — show this to the user. " +
        "SCOPE: Only removes the product from DSers import list (pre-push staging area). " +
        "Products already pushed to Shopify/Wix stores are NOT affected — " +
        "to remove a store listing, use the Shopify/Wix admin directly. " +
        "BUSINESS CONTEXT: Deleting from import list means losing the supplier mapping " +
        "(link between the store product and the AliExpress/Alibaba supplier). " +
        "If the user wants to re-import later, they will need the original supplier URL. " +
        "AGENT PROTOCOL: Before calling with confirm=true, always: " +
        "1) Show the user the product title and supplier URL. " +
        "2) Warn that this cannot be undone. " +
        "3) Get explicit user consent (e.g. 'yes, delete it'). " +
        "Never set confirm=true without the user's explicit approval.",
      inputSchema: {
        import_item_id: z
          .string()
          .describe(
            "The import list item ID to delete. " +
            "Obtain from dsers_product_preview (provider_state.import_item_id) " +
            "or from searchImportList results.",
          ),
        confirm: coerceBool.describe(
          "Set to true to confirm deletion. " +
            "First call without this to get a confirmation prompt, " +
            "then call again with confirm=true after user approves.",
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ import_item_id, confirm }) => {
      try {
        return ok(await svc().deleteImportItem({ import_item_id, confirm }));
      } catch (err) { return fail(err); }
    },
  );

  // ── Prompts ──

  server.prompt(
    "dsers_workflow_quick-import",
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
              "Steps: 1) Call dsers_store_discover to find the store. " +
              "2) Call dsers_product_import with the URL. " +
              "3) Show me the preview (title, price, variants). " +
              "4) Call dsers_store_push with visibility_mode=backend_only.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "dsers_workflow_bulk-import",
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
                "\n\nSteps: 1) dsers_store_discover. " +
                `2) dsers_product_import with source_urls_json='${urlsJson}' and rules_json='{"pricing":{"mode":"multiplier","multiplier":${price_multiplier}}}'. ` +
                "3) Show previews. 4) dsers_store_push for each job.",
            },
          },
        ],
      };
    },
  );

  server.prompt(
    "dsers_workflow_multi-push",
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
              "Steps: 1) dsers_store_discover — list all stores. " +
              "2) dsers_product_import with the URL. " +
              "3) dsers_store_push with target_stores_json containing all store names from step 1.",
          },
        },
      ],
    }),
  );

  server.prompt(
    "dsers_workflow_seo-optimize",
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
              "1) dsers_store_discover — find the target store.\n" +
              "2) dsers_product_import with the URL (no content rules yet) — get the raw preview.\n" +
              "3) Review the 'title' from the preview (first import has no title_after since no rules applied yet).\n" +
              "4) [YOU DO THIS] Rewrite the title: remove supplier noise like [HOT], brand spam, ALL-CAPS. " +
              "Make it clean, keyword-rich, and appealing to shoppers" +
              (target_audience ? ` (audience: ${target_audience})` : "") + ".\n" +
              "5) [YOU DO THIS] Rewrite the description: turn the raw supplier HTML into a professional, " +
              "conversion-focused product description with benefits, features, and a clear CTA. " +
              "Keep it concise (150-300 words).\n" +
              "6) dsers_product_import with the SAME job_id + rules_json containing title_override and description_override_html " +
              "with your rewritten content. This re-applies rules without re-importing.\n" +
              "7) Show me the updated preview for approval.\n" +
              "8) After I confirm, dsers_store_push to the target store.",
          },
        },
      ],
    }),
  );
}
