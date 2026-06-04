# CLI Provider 不支持 HITL（Human-in-the-Loop）

## 问题描述

`pnpm submit --tools` 对 CLI provider（`ClaudeCodeProvider`）无效。即使传了 `--tools`，任务仍然直接 `completed`，不会暂停等待用户输入。

## 根因

CLI provider 和 SDK provider 是两种完全不同的 agent 执行模型：

| | SDK provider | CLI provider |
|---|---|---|
| 工具循环谁控制 | promptqueue 的 `ToolRegistry` | Claude Code 内部 |
| `toolExecutor` 回调 | 有效，每次工具调用都走回调 | 无效，子进程内部处理了 |
| `ask_user` / HITL | 支持 | 不支持 |

`ClaudeCodeProvider.executeAgent()` 只是 spawn `claude` 子进程并透传 JSON 输出回来。Claude Code 有自己的工具系统（Skill、Bash、Read、Agent…），这些工具在子进程内部执行，promptqueue 注册的 `ask_user` 工具从来没被调用过。

`executeAgent()` 签名虽然接收了 `toolExecutor` 作为第三个参数，但 `ClaudeCodeProvider` 没使用它：

```typescript
// worker.ts — 传了 toolExecutor
for await (const event of provider.executeAgent!(agentRequest, abortController.signal, toolExecutor)) {

// claude-code.ts — 没接收第三个参数
async *executeAgent(request: AgentRequest, signal?: AbortSignal): AsyncIterable<AgentEvent> {
```

## 影响

- `deepseek-v4-flash` 模型走 CLI provider，HITL 不可用
- 用户期望的交互流程（Claude 提问 → 用户回答 → Claude 继续）无法实现
- 任务直接 complete，Claude 的提问只是普通文本输出

## 可能的解决方案

1. **短期** — 给 `deepseek-v4-flash` 配 `anthropic-sdk` 类型 provider（如果有兼容 OpenAI API 的端点），走 SDK 工具循环
2. **中期** — 改造 CLI provider：拦截 Claude 子进程的 `tool_use` 事件，通过 `toolExecutor` 执行，结果写回子进程 stdin
3. **长期** — `claude` 子进程支持 `--output-format stream-json` 且带工具调用，promptqueue 做代理层

## 相关文件

- `packages/server/src/providers/claude-code.ts` — CLI provider，executeAgent 不接收 toolExecutor
- `packages/server/src/worker/worker.ts` — executeTaskStreaming，传了 toolExecutor 但只对 SDK provider 有效
- `packages/server/src/tools/ask-user.ts` — ask_user 工具实现（未被 CLI provider 调用）
