# DSers MCP Product

## Tagline

AI-powered dropshipping: import products from AliExpress, Alibaba, Accio to Shopify & Wix — zero-password setup

## Description

DSers MCP Product lets AI agents automate the entire DSers dropshipping workflow. Give your AI a product link from AliExpress, Alibaba, or Accio.com — it handles import, title cleanup, pricing rules, variant editing, and multi-store push to Shopify or Wix. One sentence, full automation.

No passwords in config files. Run `npx @lofder/dsers-mcp-product login` once to authenticate via your browser — your credentials never touch this tool.

The server is open-source, hosted on Vercel, and published on Smithery, npm, and the official MCP Registry.

## Setup Requirements

- Run `npx @lofder/dsers-mcp-product login` to authenticate (opens browser, zero password in config)
- `DSERS_ENV` (optional): `production` (default) or `test`.

## Category

Business Tools

## Features

- Zero-password browser login — no credentials in config files, session encrypted locally
- Pre-push safety checks — blocks below-cost pricing, zero price, or zero stock before pushing
- Import products from AliExpress, Alibaba, and Accio.com URLs
- Accio.com integration: search products with AI, copy link, import — zero extra setup
- Batch import: process multiple product URLs in a single call
- Apply pricing rules: multiplier, fixed markup, or provider default
- Edit product titles: add prefix/suffix, override, or clean AliExpress spam
- Override product descriptions with custom HTML
- Push to Shopify and Wix stores (single, batch, or multi-store)
- Toggle product visibility: draft or publish immediately
- Auto-detect Shopify shipping profiles
- Re-apply mode: update rules on existing imports without re-fetching from supplier
- SEO optimization workflow: AI-rewrite titles and descriptions before push
- AliExpress global ID mapping (.us URLs auto-resolved)
- AliExpress authorization status detection with re-auth guidance
- Structured AI-friendly error messages with {Error, Cause, Action}
- Rate-limited API calls to prevent abuse
- Input validation on all URLs (length, protocol, format)

## Getting Started

- "Import this product and push to my store: https://www.aliexpress.com/item/1005009871053792.html"
- "Search for wireless earbuds on Accio, import the best one, price it at 3x, and list it on Shopify"
- "Batch import these 5 products and push them all as drafts"
- Tool: dsers_store_discover — Find connected stores, shipping profiles, and available rules
- Tool: dsers_product_import — Import from supplier URL(s), apply pricing/content rules, get preview
- Tool: dsers_store_push — Push products to Shopify or Wix (single, batch, or multi-store)
- Tool: dsers_rules_validate — Dry-run rule validation before importing
- Tool: dsers_product_preview — Reload a saved import preview
- Tool: dsers_product_visibility — Toggle draft/published visibility
- Tool: dsers_job_status — Check push result and job state

## Tags

dsers, shopify, wix, aliexpress, alibaba, accio, dropshipping, ecommerce, product-import, mcp, ai-agent, bulk-import, pricing-rules, multi-store, seo, typescript, smithery, zero-password, safety-checks

## Documentation URL

https://github.com/lofder/dsers-mcp-product

## Health Check URL

https://dsers-mcp-product.vercel.app/api/mcp
