---
name: dsers-mcp-product
description: Automate DSers product import from AliExpress/Alibaba/1688/Accio to Shopify & Wix. Use when the user wants to import, edit, price, or push dropshipping products to their store via DSers.
---

# DSers MCP Product

## Authentication

This server requires DSers account credentials to call any tool. Credentials are resolved in priority order:

1. **HTTP headers** `x-dsers-email` + `x-dsers-password` — set automatically when connected through Smithery or an MCP proxy
2. **Environment variables** `DSERS_EMAIL` + `DSERS_PASSWORD` — set in the MCP client config (`env` block in `.cursor/mcp.json` or Claude Desktop config)

If a tool returns an error containing "DSers credentials not found", the user has not configured their credentials yet. Guide them to the appropriate setup method — do NOT ask them to paste credentials into the chat.

## Workflow

Always follow this order:

1. `dsers.store.discover` — discover stores, shipping profiles, supported rules
2. `dsers.rules.validate` — (optional) dry-run rule validation before importing
3. `dsers.product.import` — import from URL(s), apply rules, get preview with job_id
4. `dsers.product.preview` — (optional) reload a saved preview
5. `dsers.product.visibility` — (optional) toggle `backend_only` / `sell_immediately`
6. `dsers.store.push` — push to store(s)
7. `dsers.job.status` — verify push result

Step 1 is required before any import — it returns the store list, available shipping profiles, and rule constraints.

## Key Decisions

### Accio.com URLs

[Accio.com](https://www.accio.com/) is Alibaba's AI sourcing platform. Users browse products there and copy the URL from their browser.

`dsers.product.import` accepts Accio URLs directly — no pre-processing needed. The tool extracts `productId` and `ds` (data source) from the URL query parameters and resolves the underlying AliExpress or Alibaba product automatically.

Supported Accio URL patterns:
- `accio.com/c/{cid}?productId=xxx&ds=aliexpress.com` — conversation / staging page
- `accio.com/d/{id}?dataSource=Alibaba.com` — product detail page
- Any Accio page URL with a `productId` query parameter

When `ds` contains `aliexpress` → AliExpress import. When `ds` contains `alibaba` or `1688` → Alibaba import. If `ds` is missing and `productId` is numeric (5+ digits), defaults to AliExpress.

### Single vs Batch

- User gives **one URL** → use `source_url` in `dsers.product.import`
- User gives **multiple URLs** → use `source_urls_json` (JSON array string). Each URL is processed independently; failures don't block others.
- Mixed sources (AliExpress + 1688 + Alibaba + Accio) work in the same batch call.

### Push Modes

- **Single**: `job_id` + `target_store`
- **Batch**: `job_ids_json` (JSON array string) + `target_store`
- **Multi-store**: `job_id` + `target_stores_json` (JSON array string)
- **Batch + multi-store**: `job_ids_json` + `target_stores_json` → N jobs x M stores

When `job_ids_json` is provided, it takes priority over `job_id`.

### Shopify Shipping Profile

The system auto-discovers delivery profiles for Shopify stores. No manual GIDs needed.

- Default behavior: picks the profile marked as default in DSers
- To use a specific profile: set `push_options.shipping_profile_name` (e.g. `"DSers Shipping Profile"`)
- `dsers.store.discover` returns `shipping_profiles` per Shopify store — show these to the user if they ask

Non-Shopify stores skip shipping profile entirely.

### Rules

Rules are applied at `dsers.product.import` time and frozen into the job. They do NOT change at push time.

- **pricing**: `mode` (provider_default, multiplier, fixed_markup), `multiplier`, `fixed_markup`, `round_digits`
- **content**: `title_prefix`, `title_suffix`, `title_override`, `description_override_html`, `description_append_html`, `tags_add`
- **images**: `keep_first_n`, `drop_indexes`

Map natural language to rules:
- "3x the price" → `{"pricing": {"mode": "multiplier", "multiplier": 3}}`
- "add $5" → `{"pricing": {"mode": "fixed_markup", "fixed_markup": 5}}`
- "add HOT before title" → `{"content": {"title_prefix": "HOT - "}}`
- "keep first 5 images" → `{"images": {"keep_first_n": 5}}`

Use `dsers.rules.validate` to check rules before importing — it returns `effective_rules_snapshot` (what will be applied) and `errors` (blocking issues).

### Push Options

Map user intent to `push_options` (passed as `push_options_json` — a JSON string):

| User says | Key | Value |
|-----------|-----|-------|
| "publish" / "list it" | `publish_to_online_store` | `true` |
| "draft" / "backend only" | `publish_to_online_store` | `false` |
| "push all images" | `image_strategy` | `"all_available"` |
| "use store pricing rule" | `pricing_rule_behavior` | `"apply_store_pricing_rule"` |
| "auto sync inventory" | `auto_inventory_update` | `true` |
| "auto sync price" | `auto_price_update` | `true` |
| "use specific shipping profile" | `shipping_profile_name` | `"Profile Name"` |

## Return Fields

### dsers.store.discover

- `stores`: array of `{store_ref, display_name, platform, domain, shipping_profiles}`
- `rule_families`: `{pricing, content, images, visibility}` with supported keys per family
- `push_options`: supported keys, valid values for enums, available sales channels
- `source_support`: array of supported platforms (aliexpress, alibaba, 1688, accio)

### dsers.product.import / dsers.product.preview

- `job_id`: unique identifier for this import job — needed for all subsequent operations
- `status`: `preview_ready`
- `title_before` / `title_after`: product title before and after rule application
- `price_range_before` / `price_range_after`: `{min, max}` price ranges
- `images_before` / `images_after`: image count before and after
- `variant_count`: total number of variants
- `variant_preview`: first 5 variants with `{title, supplier_price, offer_price, sku}`
- `total_variants`: shown only when variant count exceeds 5
- `requested_rules` / `effective_rules_snapshot`: rules as requested vs actually applied
- `warnings`: array of messages — always surface these to the user

### dsers.store.push

- `job_id`, `status`: job state after push
- `target_store`: resolved store name
- `visibility_applied`: actual visibility (backend_only or sell_immediately)
- `push_options_applied`: final push options used
- `job_summary`: `{title, image_count, variant_count}`
- `warnings`: array — always surface to user

### dsers.job.status

- `status`: `preview_ready` → `push_requested` → `completed` or `failed`
- `has_push_result`: boolean — true after push has been attempted

## Error Handling

All errors follow a structured format with three fields:
- **Error**: One-line summary of what went wrong
- **Cause**: Why it happened
- **Action**: What to do next

Common error patterns and recommended actions:

| Error summary | Recommended action |
|--------------|-------------------|
| DSers credentials not configured | Guide user to set credentials (see Authentication section) |
| Store authorization expired | User must re-authorize the store in DSers Settings |
| Product not importable | Try a different product or check DSers AliExpress authorization |
| DSers API timed out | Wait 30-60s and retry; products with 100+ variants may time out |
| Job session expired | Re-call dsers.product.import with the same URL |
| Store not found | Call dsers.store.discover to list valid store names |
| Accio URL could not be parsed | Accio URL must contain productId param — e.g. accio.com/c/...?productId=xxx&ds=aliexpress.com |
| Invalid product URL | URL must be aliexpress.com/item/NUMBERS.html, alibaba.com/product-detail/xxx.html, or a valid Accio product link |

Never expose raw API error bodies to the user. Summarize using the structured error fields above.

- **Import fails**: check URL format. AliExpress bundle URLs are not supported. 1688/Alibaba require the DSers account to have that source enabled.
- **"shipping profile not found"**: should not happen (auto-discovered). If it does, call `dsers.store.discover` to check available profiles, then retry with explicit `shipping_profile_name` in push_options.
- **Push returns `failed`**: check `warnings` array for details. Common cause: product was deleted from import list between prepare and push.
- **Unknown target_store**: the error message lists available stores. Use store_ref or display_name from dsers.store.discover.
- Always surface `warnings` from every response to the user.
- A job must be `preview_ready` before it can be pushed.
- Complex JSON parameters (`rules_json`, `push_options_json`, `source_urls_json`, `job_ids_json`, `target_stores_json`) must be valid JSON strings.

## Typical Patterns

**Quick import + push:**
```
dsers.store.discover → dsers.product.import(source_url, rules_json) → dsers.store.push(job_id, target_store)
```

**Batch with mixed sources:**
```
dsers.store.discover → dsers.product.import(source_urls_json: '["ae_url", "1688_url"]') → dsers.store.push(job_ids_json: '["job1", "job2"]', target_store)
```

**Preview before push:**
```
dsers.store.discover → dsers.product.import(...) → show draft to user → user confirms → dsers.store.push(...)
```

**Validate rules first:**
```
dsers.store.discover → dsers.rules.validate(rules: '{"pricing": {"mode": "multiplier", "multiplier": 2.5}}') → check errors → dsers.product.import(source_url, rules_json: same rules)
```
