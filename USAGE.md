# User Guide / 使用指南 — DSers MCP Product

> [English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

### Prerequisites

- **Node.js** >= 18.0.0
- **DSers account** with at least one connected Shopify store
- **MCP-compatible client**: Cursor, Claude Desktop, or any MCP host

### Installation

```bash
git clone https://github.com/lofder/dsers-mcp-product.git
cd dsers-mcp-product
npm install
```

### Configuration

Copy `.env.example` to `.env` and fill in your DSers credentials:

```bash
cp .env.example .env
```

Required variables:

| Variable | Description |
|----------|-------------|
| `DSERS_EMAIL` | Your DSers account email |
| `DSERS_PASSWORD` | Your DSers account password |

### How Credentials Work

All connection methods require your DSers account email and password. The server resolves credentials in this order:

| Priority | Source | When to use |
|----------|--------|-------------|
| 1 | HTTP headers `x-dsers-email` / `x-dsers-password` | Smithery, remote MCP proxy, or direct HTTP calls |
| 2 | Environment variables `DSERS_EMAIL` / `DSERS_PASSWORD` | Local stdio via Cursor, Claude Desktop, or shell |

If credentials are missing, every tool call returns an error listing all available options.

### Smithery Connect

This server is published on [Smithery](https://smithery.ai/server/@dsersx/product-mcp) (Free plan: 25K RPCs/month). Install with one command:

```bash
npx @smithery/cli mcp add @dsersx/product-mcp --client cursor
```

Or for Claude Desktop:

```bash
npx @smithery/cli mcp add @dsersx/product-mcp --client claude
```

You'll be prompted to enter your DSers credentials during setup. Smithery passes them to the server automatically — no local clone needed.

### Connect to Hosted Server (Direct HTTP)

The server is deployed at `https://dsers-mcp-product.vercel.app/api/mcp` (Streamable HTTP transport).

Pass your DSers credentials as HTTP headers on every request:

| Header | Required | Value |
|--------|----------|-------|
| `x-dsers-email` | Yes | Your DSers account email |
| `x-dsers-password` | Yes | Your DSers account password |
| `x-dsers-env` | No | `production` (default) or `test` |

Any MCP client that supports remote Streamable HTTP servers can connect using this URL with the headers above.

### Cursor Configuration (Local)

Add to your Cursor MCP settings (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["@smithery/cli", "dev", "/path/to/dsers-mcp-product/src/index.ts"],
      "env": {
        "DSERS_EMAIL": "your-email@example.com",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

### Claude Desktop Configuration (Local)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["@smithery/cli", "dev", "/path/to/dsers-mcp-product/src/index.ts"],
      "env": {
        "DSERS_EMAIL": "your-email@example.com",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

### OpenClaw Configuration

Add to `~/.openclaw/openclaw.json`:

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["@smithery/cli", "dev", "/path/to/dsers-mcp-product/src/index.ts"],
      "env": {
        "DSERS_EMAIL": "your-email@example.com",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

After saving, restart the OpenClaw gateway:

```bash
openclaw gateway restart
openclaw mcp list
```

### Scenario Examples

#### 1. Simple Import

> "Import this AliExpress product and push it to my Shopify store as a draft"

The agent will:
1. Call `dsers.store.discover` to find your store
2. Call `dsers.product.import` with the URL
3. Show you the preview (title, price, variants)
4. Call `dsers.store.push` with visibility_mode = backend_only

#### 2. Bulk Import with Pricing

> "Import these 5 products and mark them up 3x"

The agent will:
1. Call `dsers.store.discover`
2. Call `dsers.product.import` with `source_urls_json` and `rules_json: {"pricing": {"mode": "multiplier", "multiplier": 3}}`
3. Show previews for all 5 products
4. Call `dsers.store.push` with `job_ids_json`

#### 3. Multi-Store Push

> "Push this product to all my stores"

The agent will:
1. Call `dsers.store.discover` to get the store list
2. Call `dsers.store.push` with `target_stores_json` containing all store names

#### 4. Custom Title + Images

> "Import this product, add 'Premium' before the title, and keep only the first 3 images"

Rules: `{"content": {"title_prefix": "Premium "}, "images": {"keep_first_n": 3}}`

### FAQ

**Q: Can I import from 1688?**
A: 1688 links are recognized, but your DSers account needs to have 1688 source authorization enabled. If you don't have it, the import will fail with an error message.

**Q: What happens if a push fails?**
A: Check the `warnings` array in the response. The most common cause is a missing shipping profile. Call `dsers.store.discover` to check available profiles.

**Q: Can I edit the product after preparing but before pushing?**
A: The rules are applied at prepare time. To change rules, call `dsers.product.import` again with the updated rules.

---

<a id="中文"></a>

## 中文

### 前提条件

- **Node.js** >= 18.0.0
- **DSers 账户**，至少连接了一个 Shopify 店铺
- **MCP 兼容客户端**：Cursor、Claude Desktop 或任何 MCP 宿主

### 安装

```bash
git clone https://github.com/lofder/dsers-mcp-product.git
cd dsers-mcp-product
npm install
```

### 配置

复制 `.env.example` 到 `.env` 并填入你的 DSers 账户信息：

```bash
cp .env.example .env
```

### 凭据说明

所有连接方式都需要 DSers 账户邮箱和密码。服务端按以下优先级读取凭据：

| 优先级 | 来源 | 适用场景 |
|--------|------|----------|
| 1 | HTTP header `x-dsers-email` / `x-dsers-password` | Smithery、远程 MCP 代理、直接 HTTP 调用 |
| 2 | 环境变量 `DSERS_EMAIL` / `DSERS_PASSWORD` | 本地 stdio（Cursor、Claude Desktop、命令行） |

如果凭据缺失，所有工具调用会返回错误提示，列出所有可用的配置方式。

### 通过 Smithery 连接

本项目已发布到 [Smithery](https://smithery.ai/server/@dsersx/product-mcp)（Free 计划：25K RPCs/月）。一行命令安装：

```bash
npx @smithery/cli mcp add @dsersx/product-mcp --client cursor
```

安装时会提示输入 DSers 账户信息，Smithery 会自动将凭据传给服务端 —— 无需本地克隆代码。

### 连接远程托管服务（直接 HTTP）

服务已部署在 `https://dsers-mcp-product.vercel.app/api/mcp`（Streamable HTTP 传输协议）。

每次请求需携带以下 HTTP header：

| Header | 必填 | 值 |
|--------|------|-----|
| `x-dsers-email` | 是 | DSers 账户邮箱 |
| `x-dsers-password` | 是 | DSers 账户密码 |
| `x-dsers-env` | 否 | `production`（默认）或 `test` |

任何支持远程 Streamable HTTP 的 MCP 客户端都可以使用此 URL 加上述 header 连接。

### Cursor 配置（本地）

添加到 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["@smithery/cli", "dev", "/path/to/dsers-mcp-product/src/index.ts"],
      "env": {
        "DSERS_EMAIL": "your-email@example.com",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

### OpenClaw 配置

添加到 `~/.openclaw/openclaw.json`：

```json
{
  "mcpServers": {
    "dsers-mcp-product": {
      "command": "npx",
      "args": ["@smithery/cli", "dev", "/path/to/dsers-mcp-product/src/index.ts"],
      "env": {
        "DSERS_EMAIL": "your-email@example.com",
        "DSERS_PASSWORD": "your-password"
      }
    }
  }
}
```

保存后重启网关：

```bash
openclaw gateway restart
openclaw mcp list
```

### 使用场景

#### 1. 简单导入

> "把这个速卖通商品导入到我的 Shopify 店铺，存为草稿"

#### 2. 批量导入加定价

> "导入这 5 个商品，价格乘以 3"

#### 3. 多店铺推送

> "把这个商品推送到我所有的店铺"

#### 4. 自定义标题和图片

> "导入这个商品，标题前面加 'Premium'，只保留前 3 张图"

### 常见问题

**Q: 可以从 1688 导入吗？**
A: 1688 链接可以识别，但需要你的 DSers 账号开通了 1688 来源权限。没开通的话导入会报错提示。

**Q: 推送失败怎么办？**
A: 检查响应中的 `warnings` 数组。最常见的原因是缺少配送方案。调用 `dsers.store.discover` 查看可用方案。
