import type { ChatResult } from "../llm/types.ts";
import type { ContextManager } from "../agent/context-manager.ts";
import { executeTool, type ToolRegistry } from "../tools/registry.ts";
import type { ToolContext } from "../tools/types.ts";

export interface ToolModeOutcome {
    toolCalls: number;
}

export async function runToolModeStep(params: {
    response: ChatResult;
    context: ContextManager;
    registry: ToolRegistry;
    toolCtx: ToolContext;
}): Promise<ToolModeOutcome> {
    const calls = params.response.message.tool_calls ?? [];
    let toolCalls = 0;
    for (const call of calls) {
        const result = await executeTool(params.registry, call.function.name, call.function.arguments, params.toolCtx);
        params.context.append({ role: "tool", tool_call_id: call.id, content: result.content });
        toolCalls += 1;
    }
    return { toolCalls };
}