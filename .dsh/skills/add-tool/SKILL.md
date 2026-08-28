---
name: add-tool
description: 为编程智能体新增能力时使用。要求新能力同时提供 Tool Calling 工具形式与 Code Mode 注入 API 形式，共用同一底层实现。当需要增加文件读写、命令执行、路径匹配之外的技能，或询问如何添加工具/扩展 agent 能力时，遵循本 skill。
---

# 新增工具指南（Tool + API 双形式）

## 适用范围

为 agent 增加一个新能力时，必须同时提供两种形式的入口，共用同一套底层实现：

- Tool 模式：function calling 工具（模型逐次调用）
- Code Mode：注入到 exec_code 执行环境中的全局函数（模型在程序内直接调用）

本指南描述完整执行链路与改动位置。

## 执行链路总览

```text
src/tools/<name>.ts           底层实现（核心函数 + 工具定义）
  ├── Tool 形式 → src/tools/registry.ts 注册 → Tool 模式提示词（自动）
  └── API 形式  → src/tools/api.ts 的 AgentApi 与元数据
                  → src/tools/api-schema.ts 的映射
                  → src/executor/code-executor.ts 的 vm 注入
                  → Code 模式提示词与验证层声明（自动）
```

提示词与验证层的渲染均由 schema 模块自动生成，无需手改；手动改动共四处：实现、Tool 注册、API 接线、Code 执行器注入。

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

1. `AgentApi` 接口增加方法（TypeScript 类型即契约）：

```typescript
myOp: (path: string) => Promise<...>;
```

2. `createAgentApi` 中实现该方法，调用底层核心函数，并记录调用摘要：

```typescript
async myOp(arg) {
    const result = await coreOperation(arg, cwd);
    calls.push({ name: "myOp", summary: `……` });
    return result;
}
```

3. `AGENT_API_META` 增加条目，返回类型文本与接口同文件维护：

```typescript
{ name: "myOp", returnType: "Promise<...>" },
```

`src/tools/api-schema.ts` 中把 API 名映射到对应工具模块（缺失该映射时渲染直接抛错）：

```typescript
const API_TOOLS: Record<string, ToolDefinition> = {
    ...
    myOp: myTool(),
};
```

## 第四步：注入 Code 执行器

`src/executor/code-executor.ts` 的 `vm.createContext` 注入列表中增加新函数（遗漏会导致程序内调用报 `xxx is not defined`）：

```typescript
const context = vm.createContext({
    readFile: api.readFile,
    writeFile: api.writeFile,
    editFile: api.editFile,
    shell: api.shell,
    glob: api.glob,
    ...,
});
```

## 自动跟随（无需手改）

- Code 模式提示词中的函数说明（`renderAgentApiUsageGuide`）
- 验证层类型声明（`renderAgentApiDeclarations`，验证失败时模型会收到带行号的签名错误）
- Tool 模式提示词中的工具说明（`renderToolUsageGuide`）

## 验证

1. `npm run typecheck`：`AgentApiMeta.name` 与 `AgentApi` 的类型约束会校验接线一致性
2. 工具形式自测：直接调用 `<name>Tool().execute(...)`，确认成功与失败两条路径
3. API 形式自测：在 `executeAgentProgram` 中调用新全局函数，确认正确程序通过验证、类型错误被拦截
4. 端到端：以真实任务验证模型能使用新能力

## 设计原则

- 参数化而非默认偏好：工具能力保持通用语义，具体过滤或取向由调用者通过参数决定（此前 glob 忽略依赖目录的教训：个别任务偏好不应固化进默认行为）
- 描述常量与工具/API 共用，保证提示词与验证层使用同一份文本
- 参数 schema 中的数组参数渲染为 `string[]`，必填参数由 `required` 列表决定是否加 `?`
- 新增能力会同时进入两种模式的能力面，实验对比保持可比性