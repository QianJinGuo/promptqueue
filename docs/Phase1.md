# Phase 1: Tool Loop — Implementation Complete

## Overview

PromptQueue 从一个 pass-through 任务队列升级为 Agent Engine。Worker 现在拥有工具执行所有权，可以拦截、控制和治理 LLM 发起的工具调用。

**Commit:** `ba0b4ee`
**Date:** 2026-06-01
**Stats:** 23 files changed, +1,001 / -39 lines, 135 tests passing, 4/4 packages build clean

---

## Task 1: Core Tool Types

新增类型定义文件，为整个工具系统提供类型基础：

- **`packages/core/src/types/tools.ts`** — 4 个核心类型：
  - `ToolDefinition` — 工具定义（name, description, parameters）
  - `ToolResult` — 工具执行结果（content, isError）
  - `ToolExecutorFn` — 工具执行回调函数类型
  - `ToolConfig` — 工具治理配置（allowed, denied, maxTurns, timeout）
- **`packages/core/src/types/agent.ts`** — 移除内联 ToolDefinition，改为从 tools.ts re-export
- **`packages/core/src/types.ts`** — ProviderAdapter.executeAgent 新增 `toolExecutor?` 参数
- **`packages/core/src/__tests__/tool-types.test.ts`** — 4 个类型验证测试

---

## Task 2: ToolRegistry

工具注册中心，实现白名单/黑名单治理：

- **`packages/server/src/tools/registry.ts`** — ToolRegistry 类：
  - `register()` — 注册工具定义和执行器
  - `getDefinitions()` — 返回允许的工具定义列表
  - `isAllowed()` — 白名单+黑名单前缀匹配
  - `execute()` — 执行工具，含超时控制，永不抛异常
  - `createExecutor()` — 返回绑定的 ToolExecutorFn
- **`packages/server/src/tools/__tests__/registry.test.ts`** — 12 个测试

---

## Task 3: execute_command 工具

Shell 命令执行工具，含安全控制：

- **`packages/server/src/tools/execute-command.ts`**：
  - `executeCommand()` — 通过 `spawn("sh", ["-c", command])` 执行命令
  - 捕获 stdout + stderr
  - `allowedCommands` 白名单过滤（只允许指定二进制）
  - 超时控制（默认 30s）
  - `createExecuteCommandTool()` — 工厂函数
- **6 个测试**：基本执行、非零退出码、stderr 捕获、超时、工厂函数、命令白名单

---

## Task 4: read_file 工具

文件读取工具，含路径安全控制：

- **`packages/server/src/tools/read-file.ts`**：
  - `readFile()` — 读取文件内容
  - `offset` + `limit` 分页读取
  - `allowedPaths` 目录白名单
  - 路径遍历攻击防护（`resolve()` 后检查前缀）
  - `createReadFileTool()` — 工厂函数
- **6 个测试**：基本读取、文件不存在、分页、路径遍历拒绝、目录白名单、工厂函数

---

## Task 5: write_file 工具

文件写入工具，含大小限制和路径保护：

- **`packages/server/src/tools/write-file.ts`**：
  - `writeFile()` — 写入文件内容
  - 自动创建父目录（`mkdirSync recursive`）
  - `allowedPaths` 目录白名单 + 路径遍历防护
  - **1MB 文件大小限制**
  - `createWriteFileTool()` — 工厂函数
- **6 个测试**：基本写入、嵌套目录、路径遍历拒绝、目录白名单、大小限制、工厂函数

---

## Task 6: AnthropicSDKProvider

核心 Provider — 使用 `@anthropic-ai/sdk` 实现多轮工具循环：

- **`packages/server/src/providers/anthropic-sdk.ts`**（249 行）：
  - `execute()` — 单次执行，内部调用 executeAgent
  - `executeAgent()` — 多轮工具循环：
    1. 发送消息到 Anthropic API（streaming）
    2. 收集 text 和 tool_use 内容块
    3. 遇到 tool_use → 调用 `toolExecutor` 回调 → 注入结果 → 继续循环
    4. 最多 `maxTurns` 轮（默认 10）
    5. 支持 AbortSignal 取消
  - `healthCheck()` — 健康检查
  - `buildToolDefinitions()` — 将 ToolDefinition 转换为 Anthropic.Tool 格式
  - `calculateCost()` — 按 Sonnet/Opus 定价计算费用
- **2 个测试**：名称和模型列表、无效 API key 健康检查

---

## Task 7: Wire ToolRegistry into Worker

将工具系统接入 Worker 执行流：

- **`packages/server/src/worker/worker.ts`**：
  - Worker 构造函数新增 `toolRegistry: ToolRegistry | null` 参数
  - `executeTaskStreaming()` 中：
    - 创建 `toolExecutor` 回调
    - 注入 `agentRequest.tools`（工具定义列表）
    - 设置 `agentRequest.maxTurns`
    - 将 `toolExecutor` 传递给 `provider.executeAgent()`
- **`packages/server/src/index.ts`**：
  - 注册 AnthropicSDK Provider（`type: "anthropic-sdk"`）
  - 创建 ToolRegistry 实例并注册内置工具
  - Worker 构造注入 toolRegistry
- **`packages/server/src/__tests__/worker.test.ts`** — 3 处 Worker 构造函数更新（null 参数）

---

## Task 8: Config Schema + CLI --tools

配置和 CLI 支持工具功能：

- **`packages/core/src/schemas.ts`**：
  - `createTaskSchema` 新增 `tools: { enabled: boolean }` 可选字段
  - `configSchema` 新增 `tools` 区块（allowed, denied, maxTurns, timeout）
  - Provider type enum 新增 `"anthropic-sdk"` 选项
- **`packages/core/src/constants.ts`**：
  - 新增 `DEFAULT_TOOL_CONFIG` 常量
- **`packages/core/src/types.ts`**：
  - `AppConfig` 新增 `tools?: ToolConfig`
  - `ProviderConfig.type` 新增 `"anthropic-sdk"`
- **`packages/cli/src/index.ts`** — submit 命令新增 `--tools` 选项
- **`packages/cli/src/commands/submit.ts`** — `SubmitOptions` 新增 `tools?: boolean`，POST body 包含 tools 字段

---

## Task 9: Dashboard Turn Grouping

Dashboard 事件按"轮次"分组展示：

- **`packages/dashboard/src/app/tasks/[id]/page.tsx`**：
  - 新增 `groupEventsIntoTurns()` 函数：
    - 生命周期事件单独成组
    - Agent 事件按 `tool_result → 新 text` 边界切分为轮次
  - UI 渲染改为轮次卡片：
    - 每个 Agent 轮次有独立边框和 "Turn N" 标签
    - 工具调用和结果在同一轮次内展示
    - 生命周期事件保持原有时间线样式

---

## Task 10: E2E Integration + Build Verification

- 全量构建通过（4/4 packages）
- 全量测试通过（135 tests: core 25 + server 110）
- 类型检查通过（`tsc` 无错误）
- 提交 `ba0b4ee`

---

## Architecture

```
Worker (executeTaskStreaming)
  │
  ├─ AnthropicSDKProvider.executeAgent()
  │   │
  │   ├─ LLM 返回 tool_use → Worker 拦截
  │   │   │
  │   │   └─ toolExecutor(name, args)  ← ToolRegistry.createExecutor()
  │   │       │
  │   │       ├─ isAllowed() 白名单/黑名单检查
  │   │       ├─ execute() 调用注册的 executor
  │   │       └─ 返回 ToolResult → 注入回 LLM 对话
  │   │
  │   └─ 循环直到 maxTurns 或无 tool_use
  │
  └─ EventBus.emit() + EventStore.appendAgentEvent()
      │
      └─ SSE → Dashboard (turn-grouped rendering)
```

## Key Design Decisions

1. **Worker 拥有工具执行权** — Provider 负责 LLM 对话，Worker 负责工具执行和治理
2. **ToolExecutor 回调模式** — Provider 通过回调获取工具结果，不直接执行
3. **白名单+黑名单双重治理** — 先检查黑名单（前缀匹配），再检查白名单
4. **工具永不抛异常** — 所有错误通过 `ToolResult.isError` 返回
5. **CLI 和 SDK Provider 共存** — 按模型名路由，`--tools` 标志启用工具循环
6. **1MB 写入限制** — 防止 LLM 写入过大文件
7. **路径遍历防护** — 所有文件工具使用 `resolve()` + 前缀匹配

## Statistics

| 指标 | 数值 |
|------|------|
| 新增文件 | 12 |
| 修改文件 | 11 |
| 新增代码行 | 1,001 |
| 删除代码行 | 39 |
| 测试数量 | 135 (全通过) |
| 构建包 | 4/4 成功 |
