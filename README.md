# DSers MCP Product — Automate Dropshipping AI tools/AliExpress to Shopify & Wix Import

[![Smithery](https://smithery.ai/badge/@dsersx/product-mcp)](https://smithery.ai/server/@dsersx/product-mcp)
[![npm](https://img.shields.io/npm/v/@lofder/dsers-mcp-product)](https://www.npmjs.com/package/@lofder/dsers-mcp-product)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-blue)](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product)
[![Glama](https://glama.ai/mcp/servers/lofder/dsers-mcp-product/badges/score.svg)](https://glama.ai/mcp/servers/lofder/dsers-mcp-product)

> An open-source MCP server to automate DSers product import, bulk edit variants, and push to Shopify or Wix using AI.

> [English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

**DSers MCP Product** is an open-source [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that lets AI Agents automate the entire DSers import workflow — from AliExpress / Alibaba / [Accio.com](https://www.accio.com/) product URL to Shopify or Wix store listing. Bulk import, batch edit variants, clean AliExpress titles, apply pricing rules, and push to multiple stores — all with a single sentence to your AI agent.

The server is hosted on [Vercel](https://dsers-mcp-product.vercel.app/api/mcp) and published across multiple platforms:

### Available On

| Platform | Link |
|----------|------|
| npm | [npmjs.com/package/@lofder/dsers-mcp-product](https://www.npmjs.com/package/@lofder/dsers-mcp-product) |
| MCP Registry (Official) | [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product) |
| Smithery | [smithery.ai/server/@dsersx/product-mcp](https://smithery.ai/server/@dsersx/product-mcp) |
| Glama.ai | [glama.ai/mcp/servers/lofder/dsers-mcp-product](https://glama.ai/mcp/servers/lofder/dsers-mcp-product) |
| mcp.so | [mcp.so/server/dsers-mcp-product](https://mcp.so/server/dsers-mcp-product) |
| mcpservers.org | [mcpservers.org](https://mcpservers.org) |
| MCP Marketplace | [mcp-marketplace.io](https://mcp-marketplace.io/server/io-github-lofder-dsers-mcp-product) |
| awesome-mcp-servers | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) |
| Dev.to | [Article: I Built an MCP Server to Automate Dropshipping](https://dev.to/_95a3e57463e6442feacd0/i-built-an-mcp-server-to-automate-dropshipping-product-imports-3m5b) |

### Supported product sources

Works with product links from **AliExpress**, **Alibaba.com**, and **[Accio.com](https://www.accio.com/)**. Just give your AI agent a product link from any of these platforms, and it will import the product into DSers and push it to your store. (1688.com links are also recognized but require your DSers account to have 1688 source authorization enabled.)

### Accio.com — AI-powered product sourcing

[Accio.com](https://www.accio.com/) is Alibaba's AI sourcing assistant. You describe what you're looking for (e.g. "wireless earbuds under $5"), and it searches AliExpress & Alibaba for you.

**How to use it with DSers MCP:**

1. Go to [accio.com](https://www.accio.com/) and search for products in natural language.
2. Browse the results. When you find a product you like, **click on it** to open the product detail panel.
3. **Copy the URL** from your browser address bar — it will look something like:
   `https://www.accio.com/c/xxx?productId=1005009871053792&ds=aliexpress.com`
4. Give that link to your AI agent, e.g.: *"Import this product and push to my store: [paste URL]"*
5. The agent handles the rest — no extra setup needed.

This works for both AliExpress and Alibaba products found on Accio.

### Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Three-layer architecture, directory structure, data flow |
| [USAGE.md](USAGE.md) | Installation, client config (Cursor, Claude Desktop), scenario examples |
| [SKILL.md](SKILL.md) | AI agent instruction file — workflow, rules, push options, error handling |
| [SKILL-CN.md](SKILL-CN.md) | Chinese human-readable guide for SKILL.md |

### Quick Start

**Step 1: Log in (one time — opens your browser)**

```bash
npx @lofder/dsers-mcp-product login
```

A browser window opens to the official DSers login page. You log in on DSers's own website — your password **never** passes through this tool. After login, the session is encrypted and saved locally.

**Step 2: Add to your MCP client (no credentials needed)**

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["-y", "@lofder/dsers-mcp-product"]
    }
  }
}
```

That's it. No passwords in config files.

**Alternative: environment variables (legacy)**

If you prefer, you can still use environment variables:

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

### Authentication — Zero-Password Login

Your DSers password **never touches this tool**. Here's how login works:

1. You run `npx @lofder/dsers-mcp-product login`
2. Your browser opens the official DSers login page
3. You log in on DSers's own website, as usual
4. The tool picks up your login session and encrypts it locally
5. Done — from now on, the MCP server just works. No passwords in any config file.

Works with Chrome, Edge, Brave, and other Chromium browsers. On Mac, Safari works too.

**Sessions last about 6 hours.** When it expires, your AI agent will ask you to run `login` again — takes 10 seconds.

**Switching accounts?**

```bash
npx @lofder/dsers-mcp-product logout
npx @lofder/dsers-mcp-product login
```

> **For developers:** The server also accepts credentials via HTTP headers (Smithery auto-injects these), a `DSERS_TOKEN` env var, or the legacy `DSERS_EMAIL` + `DSERS_PASSWORD` env vars. For most users, just use `login`.

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
│   ├── resolver.ts           # URL normalization (AliExpress/Alibaba/Accio)
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
| 3 | `dsers.product.import` | AliExpress / Alibaba / Accio Import | Import from URL(s), apply rules, get preview; re-apply mode via job_id |
| 4 | `dsers.product.preview` | Import Draft Preview | Reload a saved preview |
| 5 | `dsers.product.visibility` | Shopify / Wix Visibility Toggle | Toggle draft / published |
| 6 | `dsers.store.push` | Push to Shopify / Wix Store | Push single/batch/multi-store |
| 7 | `dsers.job.status` | Job Status Tracker | Check push result |

All tools return clear, structured error messages so your AI agent knows what went wrong and what to do next.

### Four Prompts

Ready-made workflows your AI client can use directly:

| Prompt | Description |
|--------|-------------|
| `dsers.workflow.quick-import` | Import a single product and push to store as draft |
| `dsers.workflow.bulk-import` | Batch import with pricing multiplier |
| `dsers.workflow.multi-push` | Push one product to all connected stores |
| `dsers.workflow.seo-optimize` | Import, AI-rewrite title & description for SEO, then push |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DSERS_EMAIL` | No* | DSers account email (*not needed if using `login` command) |
| `DSERS_PASSWORD` | No* | DSers account password (*not needed if using `login` command) |
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

**DSers MCP Product** 是一个开源的 [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) 服务器，让 AI Agent 自动完成 DSers 的整个商品导入流程 —— 从速卖通 / Alibaba / [Accio.com](https://www.accio.com/) 商品链接到 Shopify 或 Wix 店铺上架。批量导入、批量编辑变体、清理速卖通标题、应用定价规则、推送到多个店铺 —— 只需一句话给你的 AI agent。

服务已托管在 [Vercel](https://dsers-mcp-product.vercel.app/api/mcp)，并发布到多个平台：

### 发布平台

| 平台 | 链接 |
|------|------|
| npm | [npmjs.com/package/@lofder/dsers-mcp-product](https://www.npmjs.com/package/@lofder/dsers-mcp-product) |
| MCP Registry（官方） | [registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/servers/io.github.lofder/dsers-mcp-product) |
| Smithery | [smithery.ai/server/@dsersx/product-mcp](https://smithery.ai/server/@dsersx/product-mcp) |
| Glama.ai | [glama.ai/mcp/servers/lofder/dsers-mcp-product](https://glama.ai/mcp/servers/lofder/dsers-mcp-product) |
| mcp.so | [mcp.so/server/dsers-mcp-product](https://mcp.so/server/dsers-mcp-product) |
| mcpservers.org | [mcpservers.org](https://mcpservers.org) |
| MCP Marketplace | [mcp-marketplace.io](https://mcp-marketplace.io/server/io-github-lofder-dsers-mcp-product) |
| awesome-mcp-servers | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) |
| Dev.to | [技术文章：I Built an MCP Server to Automate Dropshipping](https://dev.to/_95a3e57463e6442feacd0/i-built-an-mcp-server-to-automate-dropshipping-product-imports-3m5b) |

### 支持的商品来源

支持 **速卖通（AliExpress）**、**Alibaba.com** 和 **[Accio.com](https://www.accio.com/)** 的商品链接。把任意平台的商品链接丢给你的 AI 助手，它就能自动导入 DSers 并上架到你的店铺。（1688 链接也能识别，但需要你的 DSers 账号开通了 1688 来源权限。）

### Accio.com — AI 智能找商

[Accio.com](https://www.accio.com/) 是阿里巴巴的 AI 选品助手。你用自然语言描述想找的商品（比如"5 美金以下的蓝牙耳机"），它会帮你在速卖通和阿里巴巴上搜索。

**怎么配合 DSers MCP 用：**

1. 打开 [accio.com](https://www.accio.com/)，用自然语言搜索你想要的商品。
2. 在搜索结果里浏览，看到感兴趣的商品**点击进去**看详情。
3. **复制浏览器地址栏的链接**，大概长这样：
   `https://www.accio.com/c/xxx?productId=1005009871053792&ds=aliexpress.com`
4. 把链接丢给你的 AI 助手，比如说：*"帮我导入这个商品并上架：[粘贴链接]"*
5. 剩下的 AI 助手会自动搞定，不需要任何额外设置。

Accio 上搜出来的速卖通和阿里巴巴商品都能用。

### 文档

| 文档 | 说明 |
|------|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | 三层架构、目录结构、数据流 |
| [USAGE.md](USAGE.md) | 安装、客户端配置（Cursor、Claude Desktop）、使用场景 |
| [SKILL.md](SKILL.md) | AI agent 指令文件 — 工作流、规则、推送选项、错误处理 |
| [SKILL-CN.md](SKILL-CN.md) | SKILL.md 的中文说明 |

### 快速开始

**第 1 步：登录（一次性操作，会打开浏览器）**

```bash
npx @lofder/dsers-mcp-product login
```

浏览器会自动打开 DSers 官方登录页。你在 DSers 自己的网站上登录 —— 密码**完全不经过**本工具。登录后 session 加密保存到本地。

**第 2 步：添加到你的 MCP 客户端（不需要密码）**

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["-y", "@lofder/dsers-mcp-product"]
    }
  }
}
```

搞定。配置文件里不需要任何密码。

**备选方式：环境变量（旧方式）**

也可以用环境变量：

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

### 授权认证 — 零密码登录

你的 DSers 密码**完全不经过本工具**。登录过程是这样的：

1. 运行 `npx @lofder/dsers-mcp-product login`
2. 浏览器自动打开 DSers 官方登录页
3. 你在 DSers 网站上正常登录
4. 工具拿到登录状态，加密存到本地
5. 搞定 — 之后 MCP 直接能用，配置文件里不需要写任何密码

支持 Chrome、Edge、Brave 等主流浏览器。Mac 上 Safari 也行。

**登录大约 6 小时有效。** 过期了 AI 助手会提醒你重新跑一下 `login`，10 秒的事。

**换账号？**

```bash
npx @lofder/dsers-mcp-product logout
npx @lofder/dsers-mcp-product login
```

> **开发者注：** 也支持通过 HTTP headers（Smithery 自动注入）、`DSERS_TOKEN` 环境变量、或旧的 `DSERS_EMAIL` + `DSERS_PASSWORD` 环境变量传入凭据。普通用户直接用 `login` 就行。

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
| 3 | `dsers.product.import` | 速卖通/Alibaba/Accio 导入 | 从 URL 导入、应用规则、获取预览；支持 re-apply 模式 |
| 4 | `dsers.product.preview` | 导入草稿预览 | 重新加载已保存的预览 |
| 5 | `dsers.product.visibility` | Shopify/Wix 可见性切换 | 切换草稿 / 上架 |
| 6 | `dsers.store.push` | 推送到 Shopify/Wix | 单条/批量/多店铺推送 |
| 7 | `dsers.job.status` | 任务状态跟踪 | 查看推送结果 |

所有工具报错时会返回清晰的结构化消息，AI 助手能看懂出了什么问题、该怎么处理。

### 四个预设提示

MCP 客户端可直接展示给用户的工作流模板：

| 提示 | 说明 |
|------|------|
| `dsers.workflow.quick-import` | 一键导入单个商品并推送为草稿 |
| `dsers.workflow.bulk-import` | 批量导入 + 统一定价倍率 |
| `dsers.workflow.multi-push` | 一个商品推送到所有店铺 |
| `dsers.workflow.seo-optimize` | 导入后 AI 重写标题和描述做 SEO 优化，再推送 |

### 其他版本

也提供 [Python 版本](https://github.com/lofder/dsers-mcp-product-py)，适用于本地 stdio 部署。

### 许可证

MIT
