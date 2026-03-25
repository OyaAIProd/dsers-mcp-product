/**
 * Pre-push safety validation.
 *
 * Pure functions — no side effects, no I/O.
 * Called before commitCandidate() to catch dangerous pricing / stock issues.
 */

export interface PushSafetyResult {
  blocked: string[];
  warnings: string[];
}

const LOW_STOCK_THRESHOLD = 5;
const LOW_PRICE_CENTS = 100; // $1.00
const LOW_MARGIN_RATIO = 0.10; // 10 %

export function validatePushSafety(
  draft: Record<string, any>,
  originalDraft?: Record<string, any>,
): PushSafetyResult {
  const blocked: string[] = [];
  const warnings: string[] = [];

  const variants: Record<string, any>[] = draft?.variants ?? [];
  if (!variants.length) return { blocked, warnings };

  let totalStock = draft.total_inventory as number | null | undefined;
  let hasAnyStock = false;
  let allStockZero = true;
  let stockDataAvailable = false;

  for (const v of variants) {
    const label = v.title || v.sku || v.variant_ref || "unnamed";
    const offer = toNum(v.offer_price);
    const cost = toNum(v.supplier_price);
    const stock = toNum(v.stock);

    // ── Price checks ──
    if (offer != null && cost != null) {
      if (offer === 0 && cost > 0) {
        blocked.push(
          `Variant "${label}" has zero sell price ($0.00) but costs $${fmt(cost)}. ` +
          `This would give the product away for free. Fix with dsers.product.rules.reapply or set a price manually.`,
        );
      } else if (offer < cost) {
        const loss = cost - offer;
        blocked.push(
          `Variant "${label}" is priced at $${fmt(offer)} but costs $${fmt(cost)} — ` +
          `a loss of $${fmt(loss)} per unit. Adjust pricing rules before pushing.`,
        );
      } else if (cost > 0) {
        const margin = (offer - cost) / cost;
        if (margin < LOW_MARGIN_RATIO) {
          warnings.push(
            `Variant "${label}" has a very thin margin: sell $${fmt(offer)} vs cost $${fmt(cost)} ` +
            `(${(margin * 100).toFixed(1)}%). Consider increasing the price.`,
          );
        }
      }
    }

    if (offer != null && offer > 0 && offer < LOW_PRICE_CENTS) {
      warnings.push(
        `Variant "${label}" has a very low price: $${fmt(offer)}. ` +
        `Make sure this is intentional.`,
      );
    }

    // ── Stock checks ──
    if (stock != null) {
      stockDataAvailable = true;
      if (stock > 0) {
        hasAnyStock = true;
        allStockZero = false;
      }
    }
  }

  // Item-level stock fallback
  if (totalStock == null && stockDataAvailable) {
    totalStock = variants.reduce((sum, v) => {
      const s = toNum(v.stock);
      return sum + (s ?? 0);
    }, 0);
  }

  if (stockDataAvailable && allStockZero && (totalStock == null || totalStock <= 0)) {
    blocked.push(
      "All variants have zero stock. Pushing a product with no inventory " +
      "will create a listing that cannot be fulfilled. Import a different product or wait for restocking.",
    );
  } else if (
    stockDataAvailable &&
    totalStock != null &&
    totalStock > 0 &&
    totalStock < LOW_STOCK_THRESHOLD
  ) {
    warnings.push(
      `Total inventory is very low (${totalStock} units). ` +
      `The product may sell out quickly or cause fulfillment issues.`,
    );
  }

  return { blocked, warnings };
}

function toNum(val: any): number | null {
  if (val == null) return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}
