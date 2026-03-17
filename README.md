# DSers MCP Product — Automate Dropshipping AI tools/AliExpress to Shopify & Wix Import

[![Smithery](https://smithery.ai/badge/@dsersx/product-mcp)](https://smithery.ai/server/@dsersx/product-mcp)
[![npm](https://img.shields.io/npm/v/@lofder/dsers-mcp-product)](https://www.npmjs.com/package/@lofder/dsers-mcp-product)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-blue)](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product)

> An open-source MCP server to automate DSers product import, bulk edit variants, and push to Shopify or Wix using AI.

> [English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

**DSers MCP Product** is an open-source [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that lets AI Agents automate the entire DSers import workflow — from AliExpress / Alibaba / 1688 product URL to Shopify or Wix store listing. Bulk import, batch edit variants, clean AliExpress titles, apply pricing rules, and push to multiple stores — all with a single sentence to your AI agent.

The server is hosted on [Vercel](https://dsers-mcp-product.vercel.app/api/mcp), published on [Smithery](https://smithery.ai/server/@dsersx/product-mcp), [npm](https://www.npmjs.com/package/@lofder/dsers-mcp-product), and the official [MCP Registry](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product).

### Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Three-layer architecture, directory structure, data flow |
| [USAGE.md](USAGE.md) | Installation, client config (Cursor, Claude Desktop), scenario examples |
| [SKILL.md](SKILL.md) | AI agent instruction file — workflow, rules, push options, error handling |
| [SKILL-CN.md](SKILL-CN.md) | Chinese human-readable guide for SKILL.md |

### Install via npm

```bash
npx @lofder/dsers-mcp-product
```

Set environment variables `DSERS_EMAIL` and `DSERS_PASSWORD` before running, or add to your MCP client config:

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["-y", "@lofder/dsers-mcp-product"],
      "env": {
        "DSERS_EMAIL": "your-email",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

Also listed on the official [MCP Registry](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product).

### Install via Smithery

```bash
npx @smithery/cli mcp add @dsersx/product-mcp --client cursor
```

Or browse at [smithery.ai/server/@dsersx/product-mcp](https://smithery.ai/server/@dsersx/product-mcp).

### Install from Source

```bash
# Clone
git clone https://github.com/lofder/dsers-mcp-product.git
cd dsers-mcp-product

# Install
npm install

# Configure (copy and fill in your DSers credentials)
cp .env.example .env

# Type check
npx tsc --noEmit

# Run with Smithery dev
npx @smithery/cli dev ./src/index.ts
```

### Project Structure

```
dsers-mcp-product/
├── src/
│   ├── index.ts              # MCP server entry — tool registration
│   ├── service.ts            # Import flow orchestration (7 operations)
│   ├── provider.ts           # DSers API adapter
│   ├── rules.ts              # Rule validation & application engine
│   ├── push-options.ts       # Push option normalization
│   ├── resolver.ts           # URL normalization (AliExpress/Alibaba/1688)
│   ├── job-store.ts          # File-based job persistence
│   └── dsers/                # Low-level DSers API wrappers
│       ├── config.ts         # Configuration & environment
│       ├── auth.ts           # Login, session cache, auto-refresh
│       ├── client.ts         # Authenticated HTTP client
│       ├── account.ts        # Store & user management APIs
│       ├── product.ts        # Import list & push APIs
│       └── settings.ts       # Shipping, pricing, billing APIs
├── test/                     # Smoke tests
├── smithery.yaml             # Smithery runtime config
├── package.json
├── tsconfig.json
└── .env.example
```

### Seven Tools

| # | Tool | Title | Description |
|---|------|-------|-------------|
| 1 | `dsers.store.discover` | DSers Store & Rule Discovery | Discover stores, shipping profiles, supported rules |
| 2 | `dsers.rules.validate` | Pricing & Content Rule Validator | Dry-run rule validation |
| 3 | `dsers.product.import` | AliExpress / Alibaba / 1688 Import | Import from URL(s), apply rules, get preview |
| 4 | `dsers.product.preview` | Import Draft Preview | Reload a saved preview |
| 5 | `dsers.product.visibility` | Shopify / Wix Visibility Toggle | Toggle draft / published |
| 6 | `dsers.store.push` | Push to Shopify / Wix Store | Push single/batch/multi-store |
| 7 | `dsers.job.status` | Job Status Tracker | Check push result |

All tools include MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and return structured error messages with `{Error, Cause, Action}` for AI agent consumption.

### Three Prompts

Pre-built workflow templates that MCP clients can present to users:

| Prompt | Description |
|--------|-------------|
| `dsers.workflow.quick-import` | Import a single product and push to store as draft |
| `dsers.workflow.bulk-import` | Batch import with pricing multiplier |
| `dsers.workflow.multi-push` | Push one product to all connected stores |

### Credentials

The server supports two credential sources (checked in order):

1. **HTTP headers** `x-dsers-email` / `x-dsers-password` — used by Smithery and direct HTTP connections
2. **Environment variables** `DSERS_EMAIL` / `DSERS_PASSWORD` — used by local stdio (Cursor, Claude Desktop)

See [USAGE.md](USAGE.md) for setup details per connection method.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DSERS_EMAIL` | Yes* | DSers account email (*or provide via HTTP header) |
| `DSERS_PASSWORD` | Yes* | DSers account password (*or provide via HTTP header) |
| `DSERS_ENV` | No | `production` (default) or `test` |
| `DSERS_BASE_URL` | No | Override API base URL |
| `IMPORT_MCP_STATE_DIR` | No | Job state directory (default: `.state`) |

### Also Available

A [Python version](https://github.com/lofder/dsers-mcp-product-py) is available for local stdio deployments.

### License

MIT

---

<a id="中文"></a>

## 中文

**DSers MCP Product** 是一个开源的 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 服务器，让 AI Agent 自动完成 DSers 的整个商品导入流程 —— 从速卖通 / Alibaba / 1688 商品链接到 Shopify 或 Wix 店铺上架。批量导入、批量编辑变体、清理速卖通标题、应用定价规则、推送到多个店铺 —— 只需一句话给你的 AI agent。

服务已托管在 [Vercel](https://dsers-mcp-product.vercel.app/api/mcp)，并发布到 [Smithery](https://smithery.ai/server/@dsersx/product-mcp)、[npm](https://www.npmjs.com/package/@lofder/dsers-mcp-product) 和官方 [MCP Registry](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product)。

### 文档

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 三层架构、目录结构、数据流 |
| [USAGE.md](USAGE.md) | 安装、客户端配置（Cursor、Claude Desktop）、使用场景 |
| [SKILL.md](SKILL.md) | AI agent 指令文件 — 工作流、规则、推送选项、错误处理 |
| [SKILL-CN.md](SKILL-CN.md) | SKILL.md 的中文说明 |

### 通过 npm 安装

```bash
npx @lofder/dsers-mcp-product
```

运行前设置环境变量 `DSERS_EMAIL` 和 `DSERS_PASSWORD`，或在 MCP 客户端配置中添加：

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["-y", "@lofder/dsers-mcp-product"],
      "env": {
        "DSERS_EMAIL": "your-email",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

同时已收录到官方 [MCP Registry](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product)。

### 通过 Smithery 安装

```bash
npx @smithery/cli mcp add @dsersx/product-mcp --client cursor
```

或在 [smithery.ai/server/@dsersx/product-mcp](https://smithery.ai/server/@dsersx/product-mcp) 浏览和安装。

### 从源码安装

```bash
# 克隆
git clone https://github.com/lofder/dsers-mcp-product.git
cd dsers-mcp-product

# 安装
npm install

# 配置（复制并填写你的 DSers 账户信息）
cp .env.example .env

# 类型检查
npx tsc --noEmit

# 开发运行
npx @smithery/cli dev ./src/index.ts
```

### 七个工具

| # | 工具 | 标题 | 说明 |
|---|------|------|------|
| 1 | `dsers.store.discover` | 店铺与规则发现 | 查询店铺、配送方案、支持的规则 |
| 2 | `dsers.rules.validate` | 定价与内容规则校验 | 规则校验试运行 |
| 3 | `dsers.product.import` | 速卖通/Alibaba/1688 导入 | 从 URL 导入、应用规则、获取预览 |
| 4 | `dsers.product.preview` | 导入草稿预览 | 重新加载已保存的预览 |
| 5 | `dsers.product.visibility` | Shopify/Wix 可见性切换 | 切换草稿 / 上架 |
| 6 | `dsers.store.push` | 推送到 Shopify/Wix | 单条/批量/多店铺推送 |
| 7 | `dsers.job.status` | 任务状态跟踪 | 查看推送结果 |

所有工具均包含 MCP 注解（`readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint`），错误返回结构化格式 `{Error, Cause, Action}`，方便 AI agent 理解和处理。

### 三个预设提示

MCP 客户端可直接展示给用户的工作流模板：

| 提示 | 说明 |
|------|------|
| `dsers.workflow.quick-import` | 一键导入单个商品并推送为草稿 |
| `dsers.workflow.bulk-import` | 批量导入 + 统一定价倍率 |
| `dsers.workflow.multi-push` | 一个商品推送到所有店铺 |

### 其他版本

也提供 [Python 版本](https://github.com/lofder/dsers-mcp-product-py)，适用于本地 stdio 部署。

### 许可证

MIT
