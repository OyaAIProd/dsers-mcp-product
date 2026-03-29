# Agent Handoff — dsers-mcp-product

## 项目概况

**名称**: `@lofder/dsers-mcp-product`
**仓库**: https://github.com/lofder/dsers-mcp-product
**npm**: https://www.npmjs.com/package/@lofder/dsers-mcp-product
**当前版本**: 1.3.3
**工作区**: `/Users/zhaoyuhang/Desktop/project0130/dsers-mcp-product`

## 这是什么

一个 MCP (Model Context Protocol) server，让 AI agent 通过 JSON-RPC over stdio 操作 DSers 代发货平台：从速卖通/阿里巴巴/Accio 导入商品 → 修改价格/标题/SKU → 推送到 Shopify/Wix 店铺。

用户通过 `npx @lofder/dsers-mcp-product` 启动，在 Claude Desktop / Cursor / 任何 MCP client 中使用。

## 目录结构

```
src/
├── cli.ts              # npx 入口，stdio transport
├── index.ts            # MCP server 初始化，注册 tools
├── instructions.ts     # server-level 提示词（给消费端 agent 看）
├── tools.ts            # 9 个 MCP tool 注册 + schema + handler
├── service.ts          # 核心业务逻辑（ImportFlowService）
├── rules.ts            # 规则引擎（pricing/content/images/variant_overrides/option_edits）
├── push-guard.ts       # 推送前安全检查（价格/库存）
├── push-options.ts     # 推送配置标准化
├── error-map.ts        # 错误 → agent 友好信息映射
├── resolver.ts         # URL 解析（AliExpress/Alibaba/Accio → 统一格式）
├── provider.ts         # DSers API 封装（导入/保存/推送/删除）
├── dsers/              # DSers HTTP client 底层
├── auth/               # 浏览器登录认证（CDP）+ token 热加载
├── oauth/              # 加密/token 相关
├── job-store.ts        # Job 存储接口
└── job-store-memory.ts # 内存 + token 编码实现

test/                   # Vitest 单元测试（195 个，全部通过）
app/                    # Vercel 部署用（仅 git，不进 npm 包）
```

## 9 个 MCP Tools

| 工具名 | 功能 |
|--------|------|
| `dsers_store_discover` | 获取店铺列表、pricing rule 状态、规则能力、MCP 版本 |
| `dsers_rules_validate` | 预校验规则 |
| `dsers_product_import` | 导入商品（单个/批量） |
| `dsers_product_preview` | 查看导入预览（compact/full 两种模式） |
| `dsers_product_update_rules` | 增量更新规则 |
| `dsers_product_visibility` | 切换可见性 |
| `dsers_store_push` | 推送到店铺（单个/批量/多店）— pricing rule 冲突时 block |
| `dsers_job_status` | 查询 job 状态 |
| `dsers_product_delete` | 删除导入列表商品 |

## 关键设计决策

### 规则合并策略
- **pricing / images / variant_overrides**: 家族级替换（传 pricing 只替换 pricing，不影响 content）
- **content**: 字段级合并（设 description 不丢 title_prefix；`""` 或 `null` 清除字段）
- **option_edits**: 始终全量替换（有序操作序列，不可合并）
- 传 `null` 删除整个家族

### Pricing Rule 冲突检测
- `dsers_store_discover` 返回每个店铺的 `pricing_rule` 状态（enabled, type, multiplier 等）
- 支持 3 种 DSers Pricing Rule 类型：basic（乘法/加法）、standard（分段定价）、advanced（公式）
- Push 时若 MCP pricing rules 与 DSers Pricing Rule 同时激活：**block 而非 warning**
- Block 返回两个 fix_options：(1) 接受 DSers 定价 (2) 去 DSers 关闭 Pricing Rule
- API 查询失败时降级为 warning（不 block）
- Pricing rule 数据有 instance-level 缓存，同一 session 只查一次 API

### 响应压缩（Compress, Don't Truncate）
- **compact 模式（默认）**: SKU 表只有 [name, sell, qty] 三列，展示全部变体
- **full 模式**: [name, sell, compare_at, cost, qty, supplier_qty] 六列，默认 3 行
- **price_summary**: 始终包含 {sell min/max, cost min/max, zero_stock_count, low_stock_count}
- **batch summary**: 批量导入默认只返回摘要（~100 token/商品）
- **options 截断**: 默认 10 个值，带 values_count 元数据
- 设计原则：弱模型（Haiku/GPT-3.5）不能可靠分页，所以压缩列而非截断行

### 错误处理
- 所有错误返回 `{Error, Cause, Action}` 三段式
- Push 被拦截时返回结构化 JSON（`_structured`），包含 `blocked[]` + `fix_options[]`
- 批量错误也走 `formatErrorForAgent()`

### 认证 + Token 热加载
- `npx @lofder/dsers-mcp-product login` 打开浏览器，通过 CDP 抓取 DSers session
- Session 存在 `~/.dsers-mcp/` 下，约 6 小时过期
- Token 热加载：每次请求检查 token 文件 mtime，文件变化时自动重新读取，无需重启 MCP server
- DSers 无 OAuth API，只能用浏览器 cookie 方式

### npm vs git
- `"files": ["dist"]` — npm 包只含编译产物
- Vercel 相关代码（`app/`, `vercel.json`, `next.config.mjs`）只在 git 中
- Vercel devDependencies（`@smithery/sdk`, `@types/react`, `mcp-handler`, `next`）留在 devDependencies
- prod dependencies 只有 `@modelcontextprotocol/sdk` + `zod`

## 版本历史

### v1.3.3 — Push 加固 + 自定义域名店铺修复
- `coerceNumericId` nullish 输入返回空字符串，防止 undefined 泄入 push payload
- `buildPushArguments` 入口校验 importItemId/storeRef 非空
- `enrichShopifyProfiles` 去掉 hasShopify 前置检查，有 shipping profile 则补 platform=shopify（修复自定义域名 Shopify 店铺被误判为不可推送）
- `resolveStore` push 路径也走 enrichShopifyProfiles，与 discover 路径一致
- 清理 saveDraft 调试日志

### v1.3.1 — CSV Store Block + Push Payload 清洗
- Block push to CSV/non-ecommerce stores（防止后端死锁）
- `JSON.parse(JSON.stringify(pushArgs))` 防 undefined 值泄入 push 请求

### v1.3.0 — Pricing Rule 全链路 + Token 热加载
基于 R3/R4/R5 三轮测试报告修复：
- **P0**: Pricing rule 冲突检测 — discover 返回 pricing_rule 状态，push 时冲突 block（结构化错误 + fix_options）
- **P0**: Pricing rule API 端点修复（`/pricing-rule` 404 → `/pricing-rule/list?isNewVersion=true`）
- **P1**: Pricing rule 类型覆盖（basic/standard/advanced + 摘要信息）
- **P1**: Flat parameter 空字符串清除 content 字段（`!== undefined` 替代 falsy check）
- **P2**: discover 返回 MCP server version
- **P2**: Alibaba 导入错误消息改进（本地仓/MOQ/下架三因归因）
- **P2**: Token 热加载（mtime check，无需重启 server）

### v1.2.8 — Token Optimization
基于 R2 测试报告：compact/full variant 模式、batch summary、options 截断、content 字段级合并

### v1.2.7 — MCP Issues Fix
基于 R1 测试报告：增量规则合并、option_edits rename tracking、扁平参数、结构化 push-block

## 已知问题 / 待办

1. **Alibaba 成功率低**: 错误信息已改善但根因是 DSers API 侧限制（仅支持目标国本土仓）
2. **compare_at_price 反转**: pricing rules 提高 sell_price 后 compare_at 可能低于 sell（有 warning，但不自动修复）
3. **dsers_login MCP tool**: 当前登录需终端执行 CLI 命令，无 Bash 权限的纯 MCP 环境体验较差（P3）
4. **测试覆盖**: 195 个单元测试，但无自动化 E2E

## 数据快照 (2026-03-29)

| 指标 | 数值 |
|------|------|
| 代码行数 | src/ ~14,000 + test/ ~2,000 |
| 单元测试 | 195 |
| 总 commit | 76+ |

## 构建 & 测试

```bash
cd /Users/zhaoyuhang/Desktop/project0130/dsers-mcp-product
npm run build        # tsc 编译
npm test             # vitest run (193 tests)
npm publish --access public  # 发布到 npm (latest)
npm publish --tag beta       # 发布到 npm (beta)
```

## 评测报告位置

- R1: `/Users/zhaoyuhang/Desktop/project0130/dropclaw/mcp-issues.md`
- R2: `/Users/zhaoyuhang/Desktop/project2026/dsers-mcp-product/MCP-TEST-REPORT-v1.2.7.md`
- R3: `/Users/zhaoyuhang/Desktop/project2026/dsers-mcp-product/MCP-TEST-REPORT-v1.2.8-R3.md`
- R4: `/Users/zhaoyuhang/Desktop/project2026/dsers-mcp-product/MCP-TEST-REPORT-v1.3.0-beta.0-R4.md`
- R5: `/Users/zhaoyuhang/Desktop/project2026/dsers-mcp-product/MCP-TEST-REPORT-v1.3.0-R5.md`
