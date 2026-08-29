---
name: add-tool
description: 为编程智能体新增能力时使用。要求新能力同时提供 Tool Calling 工具形式与 Code Mode 注入 API 形式，共用同一底层实现。当需要增加文件读写、命令执行、路径匹配之外的技能，或询问如何添加工具/扩展 agent 能力时，遵循本 skill。
---

# 新增工具指南（Tool + API 双形式）

## 适用范围

为 agent 增加一个新能力时，必须同时提供两种形式的入口，共用同一套底层实现：

- Tool 模式：function calling 工具（模型逐次调用）
- Code Mode：注入到 exec_code 执行环境中的 `tools` 对象（模型在程序内通过 `tools.*` 调用）

本指南描述完整执行链路与改动位置。

## 执行链路总览

```text
src/tools/<name>.ts           底层实现（核心函数 + 工具定义）
  ├── Tool 形式 → src/tools/registry.ts 注册 → Tool 模式提示词（自动）
  └── API 形式  → src/tools/api.ts 的 AgentApi 与元数据
                  → src/tools/api-schema.ts 的 SDK 声明与提示
                  → src/executor/code-executor.ts 注入 tools 对象
                  → Code 模式提示词（自动）
```

提示词与 SDK 声明由 schema 模块自动生成。Code Mode 程序作为异步函数体执行，只进行语法检查和 TypeScript 类型擦除；程序不支持 `import` 或动态 `import`，需要读取工作区文件时调用 `tools.readFile`，需要运行测试时调用 `tools.shell`。

新增 API 时，手动修改实现、Tool 注册和 API 接线；Code 执行器始终注入完整的 `tools` 对象，无需为每个 API 单独增加注入项。

## 第一步：新建底层模块 src/tools/<name>.ts

参考现有 `src/tools/read-file.ts`、`shell.ts` 的结构：

1. 导出核心实现函数。参数校验放在此层，真实操作失败时抛出带上下文信息的错误。
2. 导出描述常量，例如：

```typescript
export const MY_TOOL_DESCRIPTION = "……工具与 API 共用的描述文本";
```

3. 导出工具实例函数 `<name>Tool(): ToolDefinition`：

```typescript
export function myTool(): ToolDefinition {
    return {
        name: "my_tool",
        description: MY_TOOL_DESCRIPTION,
        parameters: {
            type: "object",
            properties: { ... },
            required: [...],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            // 参数校验，非法时直接抛错（fast-fail）
            // 调用核心函数；失败时返回 { content: 错误信息, error: true }
            // 成功时返回 { content: 结果文本 }
        },
    };
}
```

错误处理约定：工具形式把失败转为结果文本回填（不中断 agent 循环），并置 `error: true` 标记（agent-loop 据此统计错误恢复次数）；API 形式直接抛错，由程序内代码决定是否捕获。

## 第二步：注册 Tool 模式

在 `src/tools/registry.ts` 的 `createDefaultRegistry()` 中注册：

```typescript
registry.register(myTool());
```

## 第三步：提供 API 形式

`src/tools/api.ts` 三处改动：

1. `AgentApi` 接口增加方法（TypeScript 类型即契约）。API 使用参数对象，字段与工具参数 schema 对齐命名（两种模式是同一份 schema 的两个投影）：

```typescript
myOp: (args: { path: string }) => Promise<...>;
```

2. `createAgentApi` 中实现该方法，调用底层核心函数，并记录调用摘要：

```typescript
async myOp(args) {
    const result = await coreOperation(args.path, cwd);
    calls.push({ name: "myOp", summary: `……` });
    return result;
}
```

3. `AGENT_API_META` 增加条目，返回类型文本与接口同文件维护：

```typescript
{ name: "myOp", returnType: "Promise<...>" },
```

`src/tools/api-schema.ts` 中把 API 名映射到对应工具模块。该映射用于生成 `tools` SDK 的参数声明、返回类型和提示内容（缺失该映射时渲染直接抛错）：

```typescript
const API_TOOLS: Record<string, ToolDefinition> = {
    ...
    myOp: myTool(),
};
```

## 第四步：确认 Code Mode API

`src/tools/api.ts` 返回的完整对象会由 `src/executor/code-executor.ts` 以 `tools` 全局对象注入：

```typescript
const context = vm.createContext({
    tools: api,
});
```

新增 API 后不需要修改执行器注入代码。Code Mode 程序内使用 `await tools.myOp(args)`。

## 自动跟随（无需手改）

- Code 模式提示词中的函数说明（`renderAgentApiUsageGuide`）
- Code Mode SDK 声明（`renderAgentApiDeclarations`，供提示词和外部检查使用）
- Tool 模式提示词中的工具说明（`renderToolUsageGuide`）

## 验证

1. `npm run typecheck`：`AgentApiMeta.name` 与 `AgentApi` 的类型约束会校验接线一致性
2. 工具形式自测：直接调用 `<name>Tool().execute(...)`，确认成功与失败两条路径
3. API 形式自测：在 `executeAgentProgram` 中调用 `tools.myOp(...)`，确认 API 调用与错误结果符合预期
4. 导入约束自测：确认静态 `import` 和动态 `import` 返回明确诊断；工作区测试通过 `tools.shell` 执行
5. 端到端：以真实任务验证模型能使用新能力

## 设计原则

- 参数化而非默认偏好：工具能力保持通用语义，具体过滤或取向由调用者通过参数决定（此前 glob 忽略依赖目录的教训：个别任务偏好不应固化进默认行为）
- 描述常量与工具/API 共用，保证提示词与验证层使用同一份文本
- 参数 schema 中的数组参数渲染为 `string[]`，必填参数由 `required` 列表决定是否加 `?`
- 新增能力会同时进入两种模式的能力面，实验对比保持可比性
