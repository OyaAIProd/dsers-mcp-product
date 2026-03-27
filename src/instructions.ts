export const SERVER_INSTRUCTIONS = [
  "DSers dropshipping automation server. Workflow: discover → import → preview → (update rules) → push.",
  "",
  "FIRST CALL: Always start with dsers_store_discover to get store IDs, shipping profiles, and capabilities.",
  "",
  "AUTH: If any tool returns an auth error, stop all operations and tell the user:",
  '"Please run this in your terminal: npx @lofder/dsers-mcp-product login"',
  "This opens the official DSers website in the user's browser. Their password never passes through this tool. Sessions last ~6 hours; on expiry, ask the user to re-login. NEVER retry auth errors silently.",
  "",
  "RESPONSES: Default responses are compact — all variants shown with [name, sell, qty] columns, plus price_summary for quick stats. " +
    "Use variant_detail='full' on dsers_product_preview when you need compare_at/cost columns. " +
    "Batch imports return summary mode by default (~100 tokens/product); use dsers_product_preview on individual jobs for full details. " +
    "Option values are truncated to 10 per option; set show_all_options=true before option_edits.",
  "",
  "RULES: Use dsers_product_update_rules to modify rules incrementally. " +
    "Pricing/images/variant_overrides replace by family. Content fields merge individually (title_prefix preserved when setting description). " +
    "option_edits always fully replaced. Clear a content field with '' or null.",
  "",
  "SAFETY: Push operations auto-check pricing and stock before sending to the store. Hard blocks (sell price < cost, zero price, all variants out of stock) prevent the push. Show the user the exact issue. Only use force_push=true after the user explicitly confirms they accept the risk.",
  "",
  "ERRORS: All errors return {Error, Cause, Action}. Follow the Action field.",
  "",
  "RATE LIMIT: 20 req/s. Excess requests queue automatically — no action needed.",
].join("\n");
