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
const LOW_PRICE_THRESHOLD = 100; // 100 cents = $1.00
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
  let allStockZero = true;
  let stockDataAvailable = false;

  const origVariants: Record<string, any>[] = originalDraft?.variants ?? [];

  for (let idx = 0; idx < variants.length; idx++) {
    const v = variants[idx];
    const label = v.title || v.sku || v.variant_ref || "unnamed";
    const offer = toNum(v.offer_price);
    const cost = toNum(v.supplier_price);
    const stock = toNum(v.stock);

    // ── Price checks ──

    if (offer === 0 || (offer != null && offer <= 0)) {
      blocked.push(
        `Variant "${label}" has zero or negative sell price ($${fmtDollars(offer ?? 0)}). ` +
        `This would give the product away for free. ` +
        `Fix with dsers.product.import (re-apply mode: pass job_id + rules_json) or adjust pricing rules.`,
      );
    } else if (offer != null && cost != null) {
      if (offer < cost) {
        const loss = cost - offer;
        blocked.push(
          `Variant "${label}" is priced at $${fmtDollars(offer)} but costs $${fmtDollars(cost)} — ` +
          `a loss of $${fmtDollars(loss)} per unit. Adjust pricing rules before pushing.`,
        );
      } else if (cost > 0) {
        const margin = (offer - cost) / cost;
        if (margin < LOW_MARGIN_RATIO) {
          warnings.push(
            `Variant "${label}" has a very thin margin: sell $${fmtDollars(offer)} vs cost $${fmtDollars(cost)} ` +
            `(${(margin * 100).toFixed(1)}%). Consider increasing the price.`,
          );
        }
      }
    }

    if (offer != null && offer > 0 && offer < LOW_PRICE_THRESHOLD) {
      warnings.push(
        `Variant "${label}" has a very low price: $${fmtDollars(offer)}. ` +
        `Make sure this is intentional.`,
      );
    }

    // Detect large price drops compared to original
    if (originalDraft && offer != null && idx < origVariants.length) {
      const origOffer = toNum(origVariants[idx]?.offer_price);
      if (origOffer != null && origOffer > 0 && offer < origOffer * 0.2) {
        warnings.push(
          `Variant "${label}" price dropped >80%: $${fmtDollars(origOffer)} → $${fmtDollars(offer)}. Verify pricing rules are correct.`,
        );
      }
    }

    // ── Stock checks ──
    if (stock != null) {
      stockDataAvailable = true;
      if (stock > 0) {
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
  } else if (!stockDataAvailable) {
    warnings.push(
      "No stock/inventory data available for any variant. " +
      "Cannot verify inventory levels — the product may have zero stock. " +
      "Confirm stock availability with the user before pushing.",
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
  if (val == null || val === "") return null;
  const n = Number(val);
  if (!Number.isFinite(n)) return null;
  return n;
}

function fmtDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}
