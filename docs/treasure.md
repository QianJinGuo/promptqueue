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

## 升级路径建议

不要急于做 L4。先把 L2 做扎实（streaming、事件溯源、SSE）。然后做 L3 的最小版本：让 Worker 支持多轮 tool loop。L4 的领域 Skill 和 Harness 治理，等 L3 稳了再说。

L3 多轮编排是目前最缺失的，也是最有价值的下一步。
