# Technical Architecture / 技术架构文档 — DSers MCP Product

> [English](#english) | [中文](#中文)

---

<a id="english"></a>

## English

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│  MCP Protocol Layer (index.ts)                          │
│  - 7 tool registrations with Zod schemas                │
│  - JSON parameter parsing & validation                  │
│  - Error wrapping with isError: true                    │
├─────────────────────────────────────────────────────────┤
│  Service Layer (service.ts)                             │
│  - Import flow orchestration (single/batch)             │
│  - Rule validation & application (rules.ts)             │
│  - Push option normalization (push-options.ts)          │
│  - URL resolution (resolver.ts)                         │
│  - Job persistence (job-store.ts)                       │
├─────────────────────────────────────────────────────────┤
│  Provider Layer (provider.ts)                           │
│  - ImportProvider interface                              │
│  - PrivateDsersProvider implementation                  │
│  - DSers API wrappers (dsers/*.ts)                      │
│  - Draft normalization / de-normalization               │
│  - Store resolution & shipping profile attachment       │
└─────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── index.ts              # Entry point — MCP server factory, 7 tool registrations
├── service.ts            # ImportFlowService — orchestrates the full lifecycle
├── provider.ts           # ImportProvider interface + PrivateDsersProvider
├── rules.ts              # normalizeRules() + applyRules() — pricing, content, images
├── push-options.ts       # normalizePushOptions() — push config validation
├── resolver.ts           # resolveSourceUrl() — URL normalization
├── job-store.ts          # FileJobStore — JSON file-based persistence
└── dsers/
    ├── config.ts         # DSersConfig, configFromEnv(), configFromParams()
    ├── auth.ts           # DSersAuth — login, session cache, auto-refresh
    ├── client.ts         # DSersClient — authenticated HTTP client, auto-retry
    ├── account.ts        # Store & user management API wrappers
    ├── product.ts        # Import list, push, product detail API wrappers
    └── settings.ts       # Shipping, pricing, billing API wrappers
```

### Tool Execution Flow

1. AI calls a tool → `index.ts` parses JSON params, delegates to `ImportFlowService`
2. Service validates input, calls provider methods, applies rules
3. Provider talks to DSers BFF APIs via `DSersClient`
4. Results flow back through service → index → MCP response

### Key Design Decisions

- **Pure function rules engine**: `rules.ts` and `push-options.ts` are stateless — all inputs through parameters, all outputs through return values.
- **Provider abstraction**: `ImportProvider` interface decouples the service layer from any specific dropshipping platform. Swap `PrivateDsersProvider` for another provider without touching service or protocol code.
- **JSON string parameters**: Complex objects (rules, push_options, source_urls, job_ids, target_stores) are passed as JSON strings rather than nested objects. This avoids MCP schema limitations with arbitrary nested types.
- **safeCall wrapper**: Provider API calls use `safeCall()` to convert `DSersAPIError` exceptions into structured error objects, preventing unhandled exceptions from crashing the MCP server.
- **File-based job store**: Jobs are persisted as JSON files in `.state/` directory. Each job gets a UUID-based filename.

---

<a id="中文"></a>

## 中文

### 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  MCP 协议层 (index.ts)                                   │
│  - 7 个工具注册（Zod 参数 Schema）                         │
│  - JSON 参数解析与校验                                     │
│  - 错误包装（isError: true）                               │
├─────────────────────────────────────────────────────────┤
│  服务层 (service.ts)                                      │
│  - 导入流程编排（单条/批量）                                 │
│  - 规则校验与应用 (rules.ts)                               │
│  - 推送选项标准化 (push-options.ts)                        │
│  - URL 解析 (resolver.ts)                                 │
│  - 任务持久化 (job-store.ts)                               │
├─────────────────────────────────────────────────────────┤
│  提供者层 (provider.ts)                                    │
│  - ImportProvider 接口                                     │
│  - PrivateDsersProvider 实现                               │
│  - DSers API 封装 (dsers/*.ts)                            │
│  - 草稿标准化 / 反标准化                                    │
│  - 店铺解析与配送方案附加                                    │
└─────────────────────────────────────────────────────────┘
```

### 关键设计决策

- **纯函数规则引擎**：`rules.ts` 和 `push-options.ts` 无状态 — 所有输入通过参数，所有输出通过返回值。
- **提供者抽象**：`ImportProvider` 接口将服务层与具体代发货平台解耦。替换 `PrivateDsersProvider` 不需要修改服务或协议代码。
- **JSON 字符串参数**：复杂对象（rules、push_options 等）以 JSON 字符串传递，避免 MCP Schema 对任意嵌套类型的限制。
- **safeCall 包装器**：提供者的 API 调用使用 `safeCall()` 将 `DSersAPIError` 异常转换为结构化错误对象。
- **文件 Job 存储**：任务以 JSON 文件形式持久化在 `.state/` 目录中。
