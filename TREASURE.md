# TREASURE: 从队列到引擎的架构洞察

## 定位对比

|          | PromptQueue                             | Roe                           |
|----------|-----------------------------------------|-------------------------------|
| 定位     | 通用 AI Prompt 任务队列                 | 垂直金融风控 Agent 平台       |
| 架构深度 | L1（Provider Adapter）+ L2（队列/路由） | L4→L3→L2→L1→L0 全栈           |
| 核心价值 | 可靠性、多 provider、优先级             | 领域智能、合规、持续学习      |
| 关系     | 可以成为 Roe 的底层基础设施             | 在队列之上构建 Agent 编排     |

PromptQueue 可以作为 Roe 架构中 L1 层（MCP/Provider 路由）的通用实现。在队列之上加 L4 Agent 编排层 + L2 领域 Skill + Harness 治理层，就能从"任务队列"升级为"Agent 引擎"。

## 核心洞察：从队列到引擎的质变点

当前 PromptQueue 是单轮执行模式：

```
Worker → Provider(claude -p "prompt") → 内部黑箱循环 → 最终结果
```

工具调用循环发生在 Claude CLI 内部，PromptQueue 看不到、管不了。Worker 只知道"进去一个 prompt，出来一个结果"。

多轮 Tool Loop 模式：

```
Worker → Claude API → "我要调用 Read"
Worker ← tool_call
Worker 执行 Read（检查权限、审计日志）
Worker → tool_result → Claude API → "我要调用 Grep"
Worker ← tool_call
Worker 执行 Grep
Worker → tool_result → Claude API → "答案是..."
Worker ← text
```

关键区别：

|  | 单轮（当前） | 多轮 Tool Loop |
|---|---|---|
| 工具谁执行 | Claude CLI 内部 | Worker 自己执行 |
| 能看到什么 | 只有最终结果 | 每一轮的 tool_call、tool_result |
| 能控制什么 | 无法控制 | 可以拦截、审批、限流 |
| 最大轮次 | 无法限制 | 可以设 maxTurns=10 |
| 工具范围 | Claude 自带全部 | 你决定暴露哪些工具 |
| 安全性 | 黑箱 | 可以禁止危险操作 |

一旦 Worker 拥有了 tool loop，它就变成了 Agent 运行时：决定哪些工具可用（权限控制）、决定工具的执行结果（可以 mock/缓存/人工审批）、决定什么时候停止（max turns/token 预算）、拥有完整的执行轨迹（审计/复盘/学习）。

**从"帮我转发一个请求"到"帮我完成一个任务"。前者是中间件，后者是引擎。**

## Claude SDK 与 Harness 的关系

Claude SDK 做的是**语言推理** — 给定上下文，决定下一步该做什么。这是 LLM 的核心能力，PromptQueue 不需要也不应该替代这一层。

```
Claude 的职责: "看到 Read 的结果了，我应该回复用户"
PromptQueue 的职责: "Read 工具被调用了，我该不该执行？执行后把结果喂回去"
```

不是"还需要 Claude SDK 干啥"，而是"光有 Claude SDK 不够" — 需要在推理层和执行层之间加一个治理层。

## Harness 的三个核心职责

**1. 执行控制（能不能做）**

```
Claude: "我要调用 rm -rf /tmp/cache"
Harness: ✅ 允许（白名单内）

Claude: "我要调用 rm -rf /"
Harness: ❌ 拒绝（危险操作，策略禁止）
```

**2. 执行策略（怎么做）**

```
Claude: "我要调用 DB.query('SELECT * FROM users')"
Harness: 改写为 → DB.query('SELECT * FROM users WHERE tenant_id = ?', [当前租户])
         自动注入租户隔离
```

**3. 执行后处理（做了之后怎样）**

```
Claude 调用了 send_email(to: "client@example.com", body: "...")
Harness:
  - 记录审计日志
  - 检查是否需要人工审批
  - 计费扣 token 预算
  - 如果是高风险操作，标记待复核
```

## 核心结论

SDK 说"调工具X" → Harness 审批 → Harness 执行 → Harness 后处理 → 喂回 SDK

没有 Harness，SDK 是一条直线跑到底。有了 Harness，SDK 的每一步都被检查、可能被改写、可能被拒绝。

**Harness = 治理层 = 在 SDK 的每次工具调用之间插入治理逻辑。**

只有拥有 Tool Loop，才能在循环里插入 Harness。CLI 模式下循环在 SDK 内部，插不进去。这就是为什么 Tool Loop 是从队列到引擎的质变点。

---

## Roe 五层架构与 PromptQueue 映射

```
Roe 层级          PromptQueue 现状              差距
─────────────────────────────────────────────────────────────
L4 Agent 编排     ❌ 无                        整层缺失：State→Plan→Execute→Verify→Reflect
L3 LLM 认知      ⚠️ 半有                      CLI 模式下 LLM 自循环，无法拆分"决策"和"执行"
L2 领域 Skill     ❌ 无                        整层缺失：交易聚类、异常检测、SAR 叙事
L1 MCP 连接       ⚠️ 有 Provider 路由          只有 LLM Provider，没有数据源连接器
L0 External       ❌ 无                        无外部系统对接
─────────────────────────────────────────────────────────────
Harness: Scheduler      ✅ Worker + 优先级队列    并发、重试、优先级已有
Harness: Observability  ✅ EventStore + SSE       事件溯源、实时流已有
Harness: Governance     ❌ 完全缺失               权限、加密、审批、策略
Harness: Eval           ❌ 完全缺失               QA 反馈、模型评估
```

### L4: Agent（应用与编排层）

```
├── Fraud Trend Agent（聚类检测）
├── Fraud Investigation Agent
├── Merchant Risk Agent
├── AML L1 Agent
├── Fraud Support Agent
└── Data Standardization Agent
   └── 每个都有 State → Planner → Executor → Verifier → Reflector 闭环
```

Agent 的 State→Plan→Execute→Verify→Reflect 本质上就是一个多轮工具调用循环，每一轮的决策来自 L3 的 LLM：

```
State: "有 5 笔可疑交易待查"
  ↓
Planner (L3 LLM): "下一步调用 TransactionLookup 查交易详情"
  ↓
Execute (L2 Skill): 调用 MCP → Snowflake
  ↓
Verify (L3 LLM): "3 笔关联同一商户，需要调 LexisNexis 查商户背景"
  ↓
Execute (L2 Skill): 调用 MCP → LexisNexis
  ↓
Reflector (L3 LLM): "风险评分 0.87，建议生成 SAR"
  ↓
Executor: 调用 SAR Narrative Skill
```

### L3: LLM（认知引擎）

LLM 只做决策："下一步做什么"，不直接操作数据。

### L2: Skill（能力SDK）

```
├── 交易聚类、异常检测、SAR叙事生成
└── 每个 Agent = 一个垂直 Skill
```

### L1: MCP（连接与协议层）

```
├── 连接 Snowflake、Databricks、Salesforce
├── 连接 LexisNexis、TransUnion、Dow Jones
├── 连接 Verafin、NICE Actimize
└── Browser Agent：对无 API 的 legacy 系统走浏览器自动化
```

MCP 连接器本质上是另一种 Provider — 只不过调的不是模型，而是数据源。架构上可以复用 ProviderAdapter 模式：

```typescript
// 现有: LLM Provider
interface ProviderAdapter {
  execute(request): Promise<ProviderResponse>
}

// 新增: MCP Connector (同一接口不同实现)
interface MCPConnector extends ProviderAdapter {
  listTools(): Promise<ToolDefinition[]>
  callTool(name: string, args: unknown): Promise<unknown>
}
```

### L0: External World

卡组织、BNPL 平台、加密合规团队的数据源。

### Harness Runtime 对照

```
- Scheduler    → 多 Agent 并发调度
- Observability → 审计追踪（合规要求）
- Governance   → 权限控制、数据加密
- Eval         → QA 审核反馈反哺模型
```

### Governance 为什么依赖 Tool Loop

Governance 的每一项能力都需要"在工具调用之间插入逻辑"：

| Harness 能力 | 需要 Tool Loop 的原因 |
|---|---|
| 权限控制 | 要在 tool_call 之后、执行之前拦截 |
| 数据加密 | 要在 tool_result 返回 LLM 之前脱敏 |
| 人工审批 | 要暂停循环等人工确认后继续 |
| 审计追踪 | 要记录每次 tool_call + tool_result |
| 策略执行 | 要改写 tool_call 的参数 |

## 实施路径

```
Phase 1: Tool Loop（解锁 L3）
━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Worker 从 CLI 模式切到 API 模式
- Worker 拥有工具执行权
- 支持 maxTurns、tokenBudget
- 基础 governance：工具白名单/黑名单

Phase 2: MCP Connectors（解锁 L1）
━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 通用 MCP 客户端
- 连接 Snowflake、Salesforce 等
- 工具发现 + 工具调用统一接口

Phase 3: Agent State Machine（解锁 L4）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- State → Plan → Execute → Verify → Reflect
- 多 Agent 并发 + 协作
- 上下文累积和截断策略

Phase 4: Governance + Eval（加固 Harness）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 人工审批流
- 数据脱敏/加密
- QA 反馈环
- 模型评估
```

**Phase 1 是一切的前提。** 没有 Tool Loop，L1/L2/L4 都无法接入，Governance 也无处插入。

## 终极结论

Roe = Harness Runtime + 垂直领域 Agent，而 Harness Runtime 的根基是 Tool Loop 所有权。PromptQueue 已经有 Scheduler 和 Observability，缺的是执行控制权。拿到控制权，才能从"转发请求"变成"运行 Agent"。
