import type { ToolDefinition, ToolResult, ToolContext } from "./types.ts";
import type { ToolSchema } from "../llm/types.ts";
import { readFileTool } from "./read-file.ts";
import { writeFileTool } from "./write-file.ts";
import { shellTool } from "./shell.ts";
import { globTool } from "./glob.ts";

export class ToolRegistry {
    private readonly tools = new Map<string, ToolDefinition>();

    register(tool: ToolDefinition): void {
        if (this.tools.has(tool.name)) {
            throw new Error(`工具 ${tool.name} 已注册`);
        }
        this.tools.set(tool.name, tool);
    }

    get(name: string): ToolDefinition {
        const tool = this.tools.get(name);
        if (tool === undefined) {
            throw new Error(`未知工具：${name}`);
        }
        return tool;
    }

    list(): ToolDefinition[] {
        return [...this.tools.values()];
    }

    listSchemas(): ToolSchema[] {
        return this.list().map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }

    listNames(): string[] {
        return this.list().map((tool) => tool.name);
    }
}

export function createDefaultRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.register(readFileTool());
    registry.register(writeFileTool());
    registry.register(shellTool());
    registry.register(globTool());
    return registry;
}

export async function executeTool(
    registry: ToolRegistry,
    name: string,
    rawArguments: string,
    ctx: ToolContext,
): Promise<ToolResult> {
    const tool = registry.get(name);
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`工具 ${name} 的参数不是合法 JSON：${message}`);
    }
    return await tool.execute(parsed, ctx);
}