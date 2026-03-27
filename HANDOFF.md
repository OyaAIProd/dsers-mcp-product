# Agent Handoff — dsers-mcp-product

## 项目概况

**名称**: `@lofder/dsers-mcp-product`
**仓库**: https://github.com/lofder/dsers-mcp-product
**npm**: https://www.npmjs.com/package/@lofder/dsers-mcp-product
**当前版本**: 1.2.8（git + npm 已同步）
**最新 commit**: `2587ec7` on main
**工作区**: `/Users/zhaoyuhang/Desktop/project0130/dsers-mcp-product`
**状态**: working tree clean，无未提交改动

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
├── auth/               # 浏览器登录认证（CDP）
├── oauth/              # 加密/token 相关
├── job-store.ts        # Job 存储接口
└── job-store-memory.ts # 内存 + token 编码实现

test/                   # Vitest 单元测试（181 个，全部通过）
app/                    # Vercel 部署用（仅 git，不进 npm 包）
```

## 9 个 MCP Tools

| 工具名 | 功能 |
|--------|------|
| `dsers_store_discover` | 获取店铺列表和规则能力 |
| `dsers_rules_validate` | 预校验规则 |
| `dsers_product_import` | 导入商品（单个/批量） |
| `dsers_product_preview` | 查看导入预览（compact/full 两种模式） |
| `dsers_product_update_rules` | 增量更新规则 |
| `dsers_product_visibility` | 切换可见性 |
| `dsers_store_push` | 推送到店铺（单个/批量/多店） |
| `dsers_job_status` | 查询 job 状态 |
| `dsers_product_delete` | 删除导入列表商品 |

## 关键设计决策

### 规则合并策略
- **pricing / images / variant_overrides**: 家族级替换（传 pricing 只替换 pricing，不影响 content）
- **content**: 字段级合并（设 description 不丢 title_prefix；`""` 或 `null` 清除字段）
- **option_edits**: 始终全量替换（有序操作序列，不可合并）
- 传 `null` 删除整个家族

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

### 认证
- `npx @lofder/dsers-mcp-product login` 打开浏览器，通过 CDP 抓取 DSers session
- Session 存在 `~/.dsers-mcp/` 下，约 6 小时过期
- DSers 无 OAuth API，只能用浏览器 cookie 方式

### npm vs git
- `"files": ["dist"]` — npm 包只含编译产物
- Vercel 相关代码（`app/`, `vercel.json`, `next.config.mjs`）只在 git 中
- Vercel devDependencies（`@smithery/sdk`, `@types/react`, `mcp-handler`, `next`）留在 devDependencies

## 最近两轮大改动

### v1.2.7 (commit 31359c9) — MCP Issues Fix
基于 `dropclaw/mcp-issues.md` 评测报告的 10 个 bug 修复：
- 增量规则合并（`mergeRuleFamilies`）
- option_edits rename tracking（防弱模型死循环）
- 拆分 `dsers_product_import` + `dsers_product_update_rules`
- 扁平参数（`pricing_mode` 等）
- 结构化 push-block 错误
- push-guard 用 variant_ref 匹配而非数组索引
- round_digits 改为美元级精度
- 批量导入并发化（Promise.allSettled, concurrency=5）

### v1.2.8 (commit d9610e5) — Token Optimization
基于 `MCP-TEST-REPORT-v1.2.7.md` 评测报告的 7 个问题：
- compact/full variant 模式 + price_summary
- batch summary 模式（94% token 减少）
- options values 截断 + show_all_options
- round_digits 默认值对齐（0→2）
- Alibaba 错误信息多因归因
- 批量错误用 formatErrorForAgent
- active_rules 始终返回
- content 家族字段级合并
- option_edits 全部 action 文档化
- instructions.ts 更新

## 测试账号

- DSers session: 用户会提供，格式为长字符串
- 测试时在用户账号中操作，商品会真实出现在 DSers import list
- 之前测试 session: `7709b533332a440faa26e04e51697207d72cqfiuonus738cnugg`（可能已过期）

## 已知问题 / 待办

1. **GitHub Release 缺失**: v1.2.2~v1.2.8 没有发 GitHub Release（只有 npm），需要补发
2. **Alibaba 成功率低**: 18/20 失败，错误信息已改善但根因是 DSers API 侧限制
3. **单变体价格格式不一致**: 单变体返回 scalar `sell_price: 2.01`，多变体返回 `{min, max}`（已记录为 observation，非 bug）
4. **compare_at_price 反转**: pricing rules 提高 sell_price 后 compare_at 可能低于 sell（有 warning，但不自动修复）
5. **流量来源单一**: 96% 来自 github.com 内部，外部引流很弱
6. **测试覆盖**: 181 个单元测试，但无自动化 E2E（之前手动做过真实 API E2E）

## 数据快照 (2026-03-27)

| 指标 | 数值 |
|------|------|
| npm 月下载 | 1,404 |
| npm 周下载 | 1,236（日均 ~400，持续增长） |
| GitHub Stars | 21 |
| GitHub Clones (14d) | 708 / 303 unique |
| GitHub Views (14d) | 328 / 76 unique |
| 代码行数 | src/ 7,725 + test/ 1,865 = 9,590 |
| 总 commit | 68 |
| npm 版本数 | 19 (1.0.0 ~ 1.2.8) |

## 构建 & 测试

```bash
cd /Users/zhaoyuhang/Desktop/project0130/dsers-mcp-product
npm run build        # tsc 编译
npm test             # vitest run (181 tests)
npm publish --access public  # 发布到 npm
```

## 评测报告位置

- 第一轮: `/Users/zhaoyuhang/Desktop/project0130/dropclaw/mcp-issues.md`
- 第二轮: `/Users/zhaoyuhang/Desktop/project2026/dsers-mcp-product/MCP-TEST-REPORT-v1.2.7.md`

## 架构规范

见 `.cursor/rules/sea-freight-architecture.mdc`（workspace rule，自动加载）。核心要求：
- 引擎必须是纯函数，数据通过参数传入
- 前端 Next.js App Router + Tailwind
- 为每个纯函数写单元测试

## 用户偏好

- 不节约算力，不偷懒，不凭空捏造
- 改动后记得完善工具提示和整体提示词
- 测试必须真实（之前因"幻觉测试"被严厉批评过）
- 提交前确认 build + test 通过
- npm 不带不必要的依赖，留在 git 里就好
