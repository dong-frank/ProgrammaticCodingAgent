import { AGENT_API_META } from "./api.ts";
import { readFileTool } from "./read-file.ts";
import { writeFileTool } from "./write-file.ts";
import { editTool } from "./edit.ts";
import { shellTool } from "./shell.ts";
import { globTool } from "./glob.ts";
import { renderParametersObjectType } from "./tool-schema.ts";
import type { ToolDefinition } from "./types.ts";

// API 与底层工具模块的对应关系：schema 的每个部分都取自定义链路上
// 名称与返回类型来自 api.ts 的 AGENT_API_META，参数与描述来自工具模块（与 Tool 模式共用）
const API_TOOLS: Record<string, ToolDefinition> = {
    readFile: readFileTool(),
    writeFile: writeFileTool(),
    editFile: editTool(),
    shell: shellTool(),
    glob: globTool(),
};

export const CONSOLE_DECLARATION =
    "declare const console: {\n    log(...args: unknown[]): void;\n    error(...args: unknown[]): void;\n    warn(...args: unknown[]): void;\n};";

function entries(): Array<{ name: string; returnType: string; tool: ToolDefinition }> {
    return AGENT_API_META.map((meta) => ({
        name: meta.name,
        returnType: meta.returnType,
        tool: API_TOOLS[meta.name] ?? (() => {
            throw new Error(`缺少 API ${meta.name} 对应的工具模块定义`);
        })(),
    }));
}

export function renderAgentApiDeclarations(): string {
    const functions = entries()
        .map(
            (entry) =>
                `declare function ${entry.name}(args: ${renderParametersObjectType(entry.tool.parameters)}): ${entry.returnType};`,
        )
        .join("\n");
    return `${functions}\n${CONSOLE_DECLARATION}`;
}

export function renderAgentApiUsageGuide(): string {
    const lines = entries().map(
        (entry) =>
            `- ${entry.name}(args: ${renderParametersObjectType(entry.tool.parameters)}): ${entry.returnType} —— ${entry.tool.description}`,
    );
    return ["程序内可直接使用以下全局函数（无需 import，支持 await），args 为参数对象，字段与工具参数一致：", ...lines].join(
        "\n",
    );
}