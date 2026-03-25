# DSers MCP Product — 技能说明（中文）

> 本文件是 [SKILL.md](SKILL.md) 的中文说明，供人阅读。SKILL.md 本身是给 AI agent 的指令文件。

## 这个 Skill 做什么

让 AI agent 通过 DSers 平台完成商品导入全流程：从速卖通 / Alibaba / Accio.com 链接到 Shopify 或 Wix 店铺上架。

## 认证方式

**推荐方式：浏览器登录（密码完全不经过本工具）**

```bash
npx @lofder/dsers-mcp-product login
```

运行后自动打开浏览器到 DSers 官方登录页 (`accounts.dsers.com`)，用户登录即可。session 加密保存到 `~/.dsers-mcp/credentials`，之后所有工具自动可用。

Session 有效期约 **6 小时**，过期后工具会返回错误提示。

**凭据来源优先级：**
1. HTTP headers `x-dsers-email` / `x-dsers-password` — Smithery 自动设置
2. 环境变量 `DSERS_TOKEN` — 加密 token 字符串
3. 本地凭据文件 `~/.dsers-mcp/credentials` — login 命令生成（推荐）
4. 环境变量 `DSERS_EMAIL` / `DSERS_PASSWORD` — 旧方式，仍支持

### Agent 认证决策树

以下是你（Agent）遇到认证问题时的处理方式：

**场景 1："DSers credentials not configured"**
- 含义：用户没有运行过 login，或者已经 logout。
- 你应该：告诉用户在终端运行 `npx @lofder/dsers-mcp-product login`。解释："这会打开 DSers 官网让你登录，密码不经过本工具，大概 30 秒搞定。"
- 用户确认登录完成后，重试工具调用。

**场景 2："DSers session expired"**
- 含义：Session 过期了（约 6 小时后）。
- 你应该：告诉用户："DSers 登录过期了，安全起见每隔几个小时会过期。麻烦再跑一下 `npx @lofder/dsers-mcp-product login`，很快的。"
- 如果用户正在操作中（比如已经导入了还没推送），告诉他导入的数据还在，认证刷新后可以继续。

**场景 3：用户想换 DSers 账号**
- 你应该：让用户先运行 `npx @lofder/dsers-mcp-product logout`（清除旧 session），再运行 `login`（用新账号登录）。

**场景 4：Login 命令失败**
- 浏览器打不开：工具会自动尝试 Safari（macOS）或终端输入。
- 终端输入失败：密码输错了，最多重试 3 次。
- 全部失败：建议用户设置 `DSERS_EMAIL` + `DSERS_PASSWORD` 环境变量作为备选。

**场景 5：主动检查认证**
- 在任何工作流开始前先调用 `dsers.store.discover`。如果成功说明认证有效，如果报错先处理认证再继续。
- 不要在认证失败的情况下尝试导入或推送。

### 你（Agent）的行为准则

- 绝不要让用户在聊天里贴密码
- 绝不要把明文密码写到配置文件里作为主推方式
- 遇到认证错误不要自动重试，停下来让用户重新认证
- 不要假设用户知道什么是 MCP、CLI、环境变量 — 用简单的话解释
- 给终端命令时一定给出可以直接复制粘贴的完整命令

## 工作流程

1. `dsers.store.discover` — 查询可用店铺、配送方案、支持的规则
2. `dsers.rules.validate` — （可选）先校验规则是否合法
3. `dsers.product.import` — 导入商品 URL，应用规则，获得预览和 job_id
4. `dsers.product.preview` — （可选）重新加载已保存的预览
5. `dsers.product.visibility` — （可选）切换草稿 / 上架模式
6. `dsers.store.push` — 推送到店铺
7. `dsers.job.status` — 验证推送结果

第 1 步是必须的，它返回店铺列表、配送方案和规则约束。

## 关键决策

### Accio.com 链接

[Accio.com](https://www.accio.com/) 是阿里巴巴的 AI 选品平台。用户在 Accio 上搜索商品后复制浏览器地址栏的链接。

`dsers.product.import` 直接接受 Accio 链接，无需预处理。工具会从 URL 参数中提取 `productId` 和 `ds`（数据来源），自动解析出底层的速卖通或阿里巴巴商品。

支持的 Accio URL 格式：
- `accio.com/c/{cid}?productId=xxx&ds=aliexpress.com` — 对话 / 暂存页
- `accio.com/d/{id}?dataSource=Alibaba.com` — 商品详情页
- 任意包含 `productId` 参数的 Accio 页面 URL

`ds` 包含 `aliexpress` → 走速卖通导入；`ds` 包含 `alibaba` → 走阿里巴巴导入；缺少 `ds` 且 `productId` 为 5+ 位数字 → 默认走速卖通。

### 单条 vs 批量

- 用户给一个链接 → 用 `source_url`
- 用户给多个链接 → 用 `source_urls_json`（JSON 数组字符串），每个 URL 独立处理，失败不影响其他
- 混合来源（速卖通 + Alibaba + Accio）可以在同一次调用中处理

### 推送模式

- **单条推送**：`job_id` + `target_store`
- **批量推送**：`job_ids_json`（JSON 数组字符串）+ `target_store`
- **多店铺推送**：`job_id` + `target_stores_json`（JSON 数组字符串）
- **批量 + 多店铺**：`job_ids_json` + `target_stores_json` → N 个商品 x M 个店铺

`job_ids_json` 优先于 `job_id`。

### Shopify 配送方案

系统自动发现 Shopify 店铺的配送方案，不需要手动填写 GID。

- 默认行为：选择 DSers 中标记为默认的配送方案
- 指定方案：在 push_options 中设置 `shipping_profile_name`（例如 `"DSers Shipping Profile"`）
- `dsers.store.discover` 返回每个 Shopify 店铺的 `shipping_profiles`

### 规则

规则在 `dsers.product.import` 时应用并冻结到任务中。推送时不会再改变。

- **pricing**：`mode`（provider_default / multiplier / fixed_markup）、`multiplier`、`fixed_markup`、`round_digits`
- **content**：`title_prefix`、`title_suffix`、`title_override`、`description_override_html`、`description_append_html`、`tags_add`
- **images**：`keep_first_n`、`drop_indexes`

自然语言映射：
- "价格乘以 3" → `{"pricing": {"mode": "multiplier", "multiplier": 3}}`
- "加 5 美元" → `{"pricing": {"mode": "fixed_markup", "fixed_markup": 5}}`
- "标题前加 HOT" → `{"content": {"title_prefix": "HOT - "}}`
- "只保留前 5 张图" → `{"images": {"keep_first_n": 5}}`

用 `dsers.rules.validate` 可以在导入前检查规则。

### 推送前安全检查

`dsers.store.push` 会在推送前自动校验价格和库存。

**硬拦截（拒绝推送）：**
- 售价 < 成本价 → 亏本销售
- 售价为 $0 但成本 > $0 → 白送商品
- 所有变体库存都为 0 → 无法履约

**软警告（继续推送，但返回警告）：**
- 利润率 < 10% → 利润过低
- 总库存 < 5 → 可能很快售罄
- 最低售价 < $1 → 异常低价

**被拦截时：** 把错误中的具体数字展示给用户（如："变体 Green 成本 $27.18，定价只有 $12.00，每件亏 $15.18"）。然后：
1. 用 `dsers.product.import` 传入同一个 `job_id` + 更新后的 `rules_json` 重新应用规则（不需要 `source_url`），或
2. 如果用户明确确认接受风险，使用 `force_push=true` 重试

**禁止静默设置 `force_push=true`。** 必须先向用户解释风险。

**预览包含库存信息：** 导入后，`stock_total` 和每个变体的 `stock` 会显示在预览中。推送前检查这些数据可以提前发现问题。

### 推送选项

用户意图到 `push_options`（作为 `push_options_json` JSON 字符串传递）的映射：

| 用户说的 | 键名 | 值 |
|---------|------|-----|
| "上架" / "发布" | `publish_to_online_store` | `true` |
| "草稿" | `publish_to_online_store` | `false` |
| "推送所有图片" | `image_strategy` | `"all_available"` |
| "用店铺定价规则" | `pricing_rule_behavior` | `"apply_store_pricing_rule"` |
| "自动同步库存" | `auto_inventory_update` | `true` |
| "自动同步价格" | `auto_price_update` | `true` |
| "指定配送方案" | `shipping_profile_name` | `"方案名称"` |

## 返回字段

### dsers.product.import / dsers.product.preview

- `job_id`：导入任务的唯一标识 — 后续操作都需要它
- `status`：`preview_ready`
- `title_before` / `title_after`：规则应用前后的标题
- `price_range_before` / `price_range_after`：`{min, max}` 价格区间
- `images_before` / `images_after`：图片数量
- `variant_count`：变体总数
- `variant_preview`：前 5 个变体的 `{title, supplier_price, offer_price, stock, sku}`
- `stock_total`：所有变体的总库存（无数据时为 null）
- `stock_low_warning`：布尔值 — 库存 > 0 但 < 5 时为 true
- `warnings`：提示信息数组 — 一定要展示给用户

### dsers.store.push

- `job_id`、`status`：推送后的状态
- `visibility_applied`：实际可见性（backend_only 或 sell_immediately）
- `push_options_applied`：最终使用的推送选项
- `warnings`：提示信息 — 一定要展示给用户

### dsers.job.status

- `status`：`preview_ready` → `push_requested` → `completed` 或 `failed`
- `has_push_result`：布尔值 — 推送执行后为 true

## 错误处理

- **Accio 链接解析失败**：确保 URL 包含 `productId` 参数，例如 `accio.com/c/...?productId=xxx&ds=aliexpress.com`。
- **导入失败**：检查 URL 格式。速卖通捆绑商品链接不支持。Alibaba 需要 DSers 账户启用了对应来源且 MOQ=1。Accio 链接需要包含 productId 参数。商品可能已下架或不可用，请在浏览器中验证链接。
- **"shipping profile not found"**：一般不会出现（自动发现）。如果出现，调用 `dsers.store.discover` 查看可用方案，然后重试时指定 `shipping_profile_name`。
- **推送被安全检查拦截**：展示具体的风险数据给用户；修复定价规则或获得用户明确确认后使用 `force_push=true`。
- **推送返回 `failed`**：检查 `warnings` 数组。常见原因：导入列表中的商品在准备和推送之间被删除。
- **未知 target_store**：错误消息会列出可用店铺。用 `dsers.store.discover` 返回的 store_ref 或 display_name。
- 每个响应的 `warnings` 一定要展示给用户。
- 任务必须是 `preview_ready` 状态才能推送。
- 复杂 JSON 参数（`rules_json`、`push_options_json`、`source_urls_json`、`job_ids_json`、`target_stores_json`）必须是合法的 JSON 字符串。

## 典型流程

**快速导入推送：**
```
dsers.store.discover → dsers.product.import(source_url, rules_json) → dsers.store.push(job_id, target_store)
```

**批量混合来源：**
```
dsers.store.discover → dsers.product.import(source_urls_json: '["ae_url", "alibaba_url"]') → dsers.store.push(job_ids_json: '["job1", "job2"]', target_store)
```

**先预览再推送：**
```
dsers.store.discover → dsers.product.import(...) → 展示草稿给用户 → 用户确认 → dsers.store.push(...)
```
