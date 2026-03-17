const KNOWN_PUSH_OPTION_KEYS = new Set([
  "publish_to_online_store",
  "only_push_specifications",
  "image_strategy",
  "pricing_rule_behavior",
  "auto_inventory_update",
  "auto_price_update",
  "sales_channels",
  "store_shipping_profile",
  "shipping_profile_name",
]);
const DEFAULT_IMAGE_STRATEGIES = new Set(["selected_only", "all_available"]);
const DEFAULT_PRICING_RULE_BEHAVIORS = new Set(["keep_manual", "apply_store_pricing_rule"]);

function _allowedPushOptionKeys(capability: Record<string, any> | undefined): Set<string> {
  const cap = capability ?? {};
  const supported = cap.supported;
  const unsupported = new Set((cap.unsupported ?? []).map((x: any) => String(x)));
  let allowed: Set<string>;
  if (Array.isArray(supported)) {
    allowed = new Set(supported.map(String));
  } else if (supported === false) {
    allowed = new Set();
  } else {
    allowed = new Set(KNOWN_PUSH_OPTION_KEYS);
  }
  for (const u of unsupported) allowed.delete(String(u));
  return allowed;
}

export function normalizePushOptions(
  pushOptions: Record<string, any> | null | undefined,
  visibilityMode: string,
  capability?: Record<string, any>,
): {
  requested_push_options: Record<string, any>;
  effective_push_options: Record<string, any>;
  warnings: string[];
  errors: string[];
} {
  const requested = structuredClone(pushOptions ?? {});
  const warnings: string[] = [];
  const errors: string[] = [];

  if (requested != null && (typeof requested !== "object" || Array.isArray(requested))) {
    return {
      requested_push_options: requested,
      effective_push_options: {},
      warnings: [],
      errors: ["push_options must be an object"],
    };
  }
  const req = typeof requested === "object" && !Array.isArray(requested) ? requested : {};
  const cap = capability ?? {};
  const allowedKeys = _allowedPushOptionKeys(cap);

  const publishToOnlineStore = visibilityMode === "sell_immediately";
  const effective: Record<string, any> = {
    publish_to_online_store: publishToOnlineStore,
    only_push_specifications: false,
    image_strategy: "selected_only",
    pricing_rule_behavior: "keep_manual",
    auto_inventory_update: false,
    auto_price_update: false,
    sales_channels: publishToOnlineStore ? ["online_store"] : [],
  };

  for (const key of Object.keys(req).sort()) {
    if (!KNOWN_PUSH_OPTION_KEYS.has(key)) {
      warnings.push(`Unknown push option '${key}' was ignored.`);
      continue;
    }
    if (!allowedKeys.has(key)) {
      warnings.push(`Push option '${key}' is not supported by the current provider and was ignored.`);
      continue;
    }
    const value = req[key];

    if (key === "publish_to_online_store") {
      if (Boolean(value) !== publishToOnlineStore) {
        warnings.push(
          "push_options.publish_to_online_store was overridden to stay consistent with visibility_mode.",
        );
      }
      effective[key] = publishToOnlineStore;
      continue;
    }

    if (["only_push_specifications", "auto_inventory_update", "auto_price_update"].includes(key)) {
      effective[key] = Boolean(value);
      continue;
    }

    if (key === "image_strategy") {
      const strategy = String(value ?? "").trim() || effective.image_strategy;
      const allowedStrategies = new Set(cap.image_strategy_modes ?? DEFAULT_IMAGE_STRATEGIES);
      if (!DEFAULT_IMAGE_STRATEGIES.has(strategy)) {
        errors.push(`Unsupported push_options.image_strategy '${strategy}'. Valid values: ${[...DEFAULT_IMAGE_STRATEGIES].join(", ")}.`);
        continue;
      }
      if (!allowedStrategies.has(strategy)) {
        warnings.push(`image_strategy '${strategy}' is not supported by the current provider and was ignored.`);
        continue;
      }
      effective[key] = strategy;
      continue;
    }

    if (key === "pricing_rule_behavior") {
      const behavior = String(value ?? "").trim() || effective.pricing_rule_behavior;
      const allowedBehaviors = new Set(cap.pricing_rule_behavior_modes ?? DEFAULT_PRICING_RULE_BEHAVIORS);
      if (!DEFAULT_PRICING_RULE_BEHAVIORS.has(behavior)) {
        errors.push(`Unsupported push_options.pricing_rule_behavior '${behavior}'. Valid values: ${[...DEFAULT_PRICING_RULE_BEHAVIORS].join(", ")}.`);
        continue;
      }
      if (!allowedBehaviors.has(behavior)) {
        warnings.push(
          `pricing_rule_behavior '${behavior}' is not supported by the current provider and was ignored.`,
        );
        continue;
      }
      effective[key] = behavior;
      continue;
    }

    if (key === "shipping_profile_name") {
      if (value != null && value !== "") effective[key] = String(value).trim();
      continue;
    }

    if (key === "store_shipping_profile") {
      if (Array.isArray(value) || value == null) {
        effective[key] = value;
      } else {
        warnings.push(
          "push_options.store_shipping_profile must be an array of {storeId, locationId, profileId} objects or null. The provided value was ignored.",
        );
      }
      continue;
    }

    if (key === "sales_channels") {
      if (value == null || (Array.isArray(value) && value.length === 0)) {
        effective[key] = [];
        continue;
      }
      if (!Array.isArray(value)) {
        errors.push("push_options.sales_channels must be an array of strings when provided.");
        continue;
      }
      const allowedChannels = new Set(cap.sales_channels ?? []);
      const channels: string[] = [];
      for (const raw of value) {
        const ch = String(raw).trim();
        if (!ch) continue;
        if (allowedChannels.size > 0 && !allowedChannels.has(ch)) {
          warnings.push(`Sales channel '${ch}' is not supported by the current provider and was ignored.`);
          continue;
        }
        if (!channels.includes(ch)) channels.push(ch);
      }
      effective[key] = channels;
    }
  }

  if (!effective.publish_to_online_store) {
    effective.sales_channels = [];
  } else if (!effective.sales_channels.includes("online_store")) {
    effective.sales_channels = ["online_store", ...effective.sales_channels];
  }

  return {
    requested_push_options: req,
    effective_push_options: effective,
    warnings,
    errors,
  };
}
