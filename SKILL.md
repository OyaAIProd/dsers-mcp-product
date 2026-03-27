---
name: dsers-mcp-product
description: Automate DSers product import from AliExpress/Alibaba/Accio to Shopify & Wix. Use when the user wants to import, edit, price, or push dropshipping products to their store via DSers.
---

# DSers MCP Product

## Authentication

### Credential resolution (priority order)

1. **Local credentials file** `~/.dsers-mcp/credentials` — created by `login` command (recommended)
2. **Environment variable** `DSERS_TOKEN` — encrypted token string (headless/CI)
3. **OAuth access token** (Bearer) — automatic on Vercel Remote MCP / Smithery

### Session lifetime

Sessions last approximately **6 hours**. After expiry, any tool call will return a structured error. You (the agent) should detect this and guide the user to re-authenticate — do NOT retry failed calls silently.

### Agent decision tree for authentication

Use this logic every time you encounter an auth-related issue:

**Scenario 1: "DSers credentials not configured"**
- Meaning: No session token exists. The user has never run `login`, or they ran `logout`.
- What you should do:
  1. Tell the user you need them to log in to DSers first.
  2. Ask them to open their terminal and run: `npx @lofder/dsers-mcp-product login`
  3. Reassure them: "This opens the official DSers website in your browser. You log in there directly — your password never passes through this tool. It takes about 30 seconds."
  4. After they confirm login is done, retry your tool call.
- If login reports "No Chromium browser found" and then "No TTY available": the user is on a headless server. Suggest setting `DSERS_TOKEN` environment variable as a fallback.

**Scenario 2: "DSers session expired"**
- Meaning: A session existed but is no longer valid (expired after ~6 hours, or DSers server invalidated it).
- What you should do:
  1. Tell the user: "Your DSers session has expired — this happens every few hours for security. Could you run `npx @lofder/dsers-mcp-product login` again? It'll only take a moment."
  2. After they confirm, retry.
  3. If the user is in the middle of a workflow (e.g., import was done, now pushing), reassure them that the import data is still saved and they can continue after re-authenticating.

**Scenario 3: User wants to switch DSers accounts**
- What you should do:
  1. Tell the user to run: `npx @lofder/dsers-mcp-product logout` (clears the old session)
  2. Then: `npx @lofder/dsers-mcp-product login` (log in with the new account)
  3. After login, all tools will use the new account automatically.

**Scenario 4: Login command fails**
- "Browser launch failed": Chrome/Edge/Brave is not installed or cannot be opened. The tool will automatically fall back to Safari (macOS) or terminal prompt.
- "Could not read session cookie": The browser opened but the session wasn't detected. The user should make sure they completed the DSers login (reached the dashboard, not just the login form).
- "Terminal login failed": Wrong email/password entered in the terminal fallback. The user can retry (up to 3 attempts).
- If all methods fail: suggest `DSERS_TOKEN` env var as the last resort, or ask the user to retry `login` on a machine with a browser.

**Scenario 5: Proactive auth check**
- Call `dsers_store_discover` at the start of any workflow. If it succeeds, auth is valid. If it returns an auth error, handle it BEFORE attempting imports or pushes.
- Do NOT attempt `dsers_product_import` or `dsers_store_push` without confirming auth works first.

### Rules for you (the agent)

- NEVER ask the user to paste their password into the chat or into any file you can see
- NEVER suggest putting plain-text passwords in MCP config as the primary method — always suggest `login` first
- NEVER retry tool calls in a loop when you get an auth error — stop and ask the user to re-authenticate
- NEVER assume the user knows what MCP, CLI, or environment variables are — explain in simple terms
- When suggesting terminal commands, always provide the exact command to copy-paste
- If the user seems confused, simplify: "Just run this one command in your terminal, then come back to me"

## Workflow

Always follow this order:

1. `dsers_store_discover` — discover stores, shipping profiles, pricing rules, supported rules
2. `dsers_rules_validate` — (optional) dry-run rule validation before importing
3. `dsers_product_import` — import from URL(s), apply rules, get preview with job_id
4. `dsers_product_preview` — (optional) reload a saved preview
5. `dsers_product_update_rules` — (optional) incrementally edit pricing, content, images, or variant rules on an imported product
6. `dsers_product_visibility` — (optional) toggle `backend_only` / `sell_immediately`
7. `dsers_store_push` — push to store(s)
8. `dsers_job_status` — verify push result
9. `dsers_product_delete` — delete a product from the import list (irreversible, requires `confirm: true`)

Step 1 is required before any import — it returns the store list, available shipping profiles, and rule constraints.

## Key Decisions

### Accio.com URLs

[Accio.com](https://www.accio.com/) is Alibaba's AI sourcing platform. Users browse products there and copy the URL from their browser.

`dsers_product_import` accepts Accio URLs directly — no pre-processing needed. The tool extracts `productId` and `ds` (data source) from the URL query parameters and resolves the underlying AliExpress or Alibaba product automatically.

Supported Accio URL patterns:
- `accio.com/c/{cid}?productId=xxx&ds=aliexpress.com` — conversation / staging page
- `accio.com/d/{id}?dataSource=Alibaba.com` — product detail page
- Any Accio page URL with a `productId` query parameter

When `ds` contains `aliexpress` → AliExpress import. When `ds` contains `alibaba` → Alibaba import. If `ds` is missing and `productId` is numeric (5+ digits), defaults to AliExpress.

### Single vs Batch

- User gives **one URL** → use `source_url` in `dsers_product_import`
- User gives **multiple URLs** → use `source_urls_json` (JSON array string). Each URL is processed independently; failures don't block others.
- Mixed sources (AliExpress + Alibaba + Accio) work in the same batch call.

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
- `dsers_store_discover` returns `shipping_profiles` per Shopify store — show these to the user if they ask

Non-Shopify stores skip shipping profile entirely.

### Rules

Rules are applied at `dsers_product_import` time and frozen into the job. Use `dsers_product_update_rules` to incrementally edit rules after import — pricing/images/variant_overrides replace by family, content fields merge individually. Rules do NOT change at push time.

- **pricing**: `mode` (provider_default, multiplier, fixed_markup), `multiplier`, `fixed_markup`, `round_digits`
- **content**: `title_prefix`, `title_suffix`, `title_override`, `description_override_html`, `description_append_html`, `tags_add`
- **images**: `keep_first_n`, `drop_indexes`

Map natural language to rules:
- "3x the price" → `{"pricing": {"mode": "multiplier", "multiplier": 3}}`
- "add $5" → `{"pricing": {"mode": "fixed_markup", "fixed_markup": 5}}`
- "add HOT before title" → `{"content": {"title_prefix": "HOT - "}}`
- "keep first 5 images" → `{"images": {"keep_first_n": 5}}`

Use `dsers_rules_validate` to check rules before importing — it returns `effective_rules_snapshot` (what will be applied) and `errors` (blocking issues).

### Pre-Push Safety Checks

`dsers_store_push` automatically validates pricing and stock before sending to the store.

**Hard blocks (push is refused):**
- Sell price < supplier cost → selling at a loss
- Sell price = $0 while cost > $0 → giving product away for free
- All variants have zero stock → nothing to fulfill

**Soft warnings (push proceeds, warnings in response):**
- Margin < 10% → low profit
- Total inventory < 5 → may sell out fast
- Min sell price < $1 → suspiciously low

**When blocked:** Show the user the EXACT figures from the error (e.g., "Variant Green costs $27.18 but is priced at $12.00 — a $15.18 loss per unit"). Then either:
1. Fix pricing by calling `dsers_product_update_rules` with the `job_id` + updated pricing rules (incremental merge, no re-import needed), or
2. If the user explicitly confirms they accept the risk, retry with `force_push=true`

### Pricing Rule Conflict Detection

DSers stores may have their own **Pricing Rule** enabled (basic/standard/advanced). Check the `pricing_rule` field in `dsers_store_discover` response.

If a store Pricing Rule is enabled AND you set MCP pricing rules, push will be **BLOCKED** — not warned. The block returns two `fix_options`:
1. Set `pricing_rule_behavior='apply_store_pricing_rule'` in push options to accept the store's pricing
2. Disable the DSers Pricing Rule in store settings to use MCP pricing

If the pricing rule API is unreachable, push proceeds with a warning instead of blocking.

**NEVER set `force_push=true` silently.** Always explain the risk first.

**Preview includes stock data:** After import, `stock_total` and per-variant `stock` are shown in the preview. Check these BEFORE pushing to avoid surprises.

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

### dsers_store_discover

- `stores`: array of `{store_ref, display_name, platform, domain, shipping_profiles}`
- `rule_families`: `{pricing, content, images, visibility}` with supported keys per family
- `push_options`: supported keys, valid values for enums, available sales channels
- `source_support`: array of supported platforms (aliexpress, alibaba, accio)

### dsers_product_import / dsers_product_preview

- `job_id`: unique identifier for this import job — needed for all subsequent operations
- `status`: `preview_ready`
- `title_before` / `title_after`: product title before and after rule application
- `price_range_before` / `price_range_after`: `{min, max}` price ranges
- `images_before` / `images_after`: image count before and after
- `variant_count`: total number of variants
- `variant_preview`: first 5 variants with `{title, supplier_price, offer_price, stock, sku}`
- `stock_total`: total inventory across all variants (null if unavailable)
- `stock_low_warning`: boolean — true when stock_total > 0 but < 5 units
- `total_variants`: shown only when variant count exceeds 5
- `requested_rules` / `effective_rules_snapshot`: rules as requested vs actually applied
- `warnings`: array of messages — always surface these to the user

### dsers_product_update_rules

- Returns the same preview structure as `dsers_product_import` / `dsers_product_preview`
- Pricing/images/variant_overrides replace by family; content fields merge individually (e.g. setting `description` preserves `title_prefix`)
- `option_edits` always fully replaced
- Clear a content field with `''` or `null`

### dsers_store_push

- `job_id`, `status`: job state after push
- `target_store`: resolved store name
- `visibility_applied`: actual visibility (backend_only or sell_immediately)
- `push_options_applied`: final push options used
- `job_summary`: `{title, image_count, variant_count}`
- `warnings`: array — always surface to user

### dsers_job_status

- `status`: `preview_ready` → `push_requested` → `completed` or `failed`
- `has_push_result`: boolean — true after push has been attempted

### dsers_product_delete

- `deleted`: boolean — true if successfully deleted
- Requires `confirm: true` parameter. Without it, returns a warning asking the agent to confirm with the user first.
- This action is **irreversible** — the product is permanently removed from the DSers import list.

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
| Product not importable | Product may be delisted or off-shelf — verify URL in browser or try a different product |
| DSers API timed out | Wait 30-60s and retry; products with 100+ variants may time out |
| Job session expired | Re-call dsers_product_import with the same URL |
| Store not found | Call dsers_store_discover to list valid store names |
| Accio URL could not be parsed | Accio URL must contain productId param — e.g. accio.com/c/...?productId=xxx&ds=aliexpress.com |
| Invalid product URL | URL must be aliexpress.com/item/NUMBERS.html, alibaba.com/product-detail/xxx.html, or a valid Accio product link |
| Push blocked by safety check | Show user the exact risk; fix pricing rules or get explicit user confirmation before using force_push=true |

Never expose raw API error bodies to the user. Summarize using the structured error fields above.

- **Import fails**: check URL format. AliExpress bundle URLs are not supported. Alibaba requires the DSers account to have that source enabled. 1688 URLs are recognized but require DSers account authorization for this source.
- **"shipping profile not found"**: should not happen (auto-discovered). If it does, call `dsers_store_discover` to check available profiles, then retry with explicit `shipping_profile_name` in push_options.
- **Push returns `failed`**: check `warnings` array for details. Common cause: product was deleted from import list between prepare and push.
- **Unknown target_store**: the error message lists available stores. Use store_ref or display_name from dsers_store_discover.
- Always surface `warnings` from every response to the user.
- A job must be `preview_ready` before it can be pushed.
- Complex JSON parameters (`rules_json`, `push_options_json`, `source_urls_json`, `job_ids_json`, `target_stores_json`) must be valid JSON strings.

## Typical Patterns

**Quick import + push:**
```
dsers_store_discover → dsers_product_import(source_url, rules_json) → dsers_store_push(job_id, target_store)
```

**Batch with mixed sources:**
```
dsers_store_discover → dsers_product_import(source_urls_json: '["ae_url", "alibaba_url"]') → dsers_store_push(job_ids_json: '["job1", "job2"]', target_store)
```

**Preview before push:**
```
dsers_store_discover → dsers_product_import(...) → show draft to user → user confirms → dsers_store_push(...)
```

**Validate rules first:**
```
dsers_store_discover → dsers_rules_validate(rules: '{"pricing": {"mode": "multiplier", "multiplier": 2.5}}') → check errors → dsers_product_import(source_url, rules_json: same rules)
```
