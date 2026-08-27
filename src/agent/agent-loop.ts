import type { LlmClient } from "../llm/client.ts";
import { executeTool } from "../tools/registry.ts";
import type { Mode, ModeConfig } from "../modes/types.ts";
import { createToolModeConfig } from "../modes/tool-mode.ts";
import { createCodeModeConfig } from "../modes/code-mode.ts";
import { ContextManager } from "./context-manager.ts";

export interface RunAgentParams {
    task: string;
    mode: Mode;
    maxRounds: number;
    workspace: string;
    client: LlmClient;
}

export interface AgentMetrics {
    llmCalls: number;
    toolCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
}

export interface AgentResult {
    finalMessage: string;
    stoppedReason: "completed" | "max-rounds";
    metrics: AgentMetrics;
}

function createModeConfig(mode: Mode): ModeConfig {
    if (mode === "tool") {
        return createToolModeConfig();
    }
    return createCodeModeConfig();
}

export async function runAgent(params: RunAgentParams): Promise<AgentResult> {
    const config = createModeConfig(params.mode);
    const context = new ContextManager(config.systemPrompt(params.workspace));
    context.append({ role: "user", content: params.task });

    let llmCalls = 0;
    let toolCalls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    const startedAt = Date.now();

    for (let round = 1; round <= params.maxRounds; round += 1) {
        const response = await params.client.chat({
            messages: context.getMessages(),
            tools: config.registry.listSchemas(),
        });
        llmCalls += 1;
        promptTokens += response.usage.promptTokens;
        completionTokens += response.usage.completionTokens;
        totalTokens += response.usage.totalTokens;

        context.append(response.message);

        const calls = response.message.tool_calls;
        if (calls === undefined || calls.length === 0) {
            return {
                finalMessage: response.message.content ?? "",
                stoppedReason: "completed",
                metrics: {
                    llmCalls,
                    toolCalls,
                    promptTokens,
                    completionTokens,
                    totalTokens,
                    durationMs: Date.now() - startedAt,
                },
            };
        }

        for (const call of calls) {
            const result = await executeTool(config.registry, call.function.name, call.function.arguments, {
                cwd: params.workspace,
            });
            context.append({ role: "tool", tool_call_id: call.id, content: result.content });
            toolCalls += 1;
        }
    }

    return {
        finalMessage: "达到最大轮次仍未能完成任务",
        stoppedReason: "max-rounds",
        metrics: {
            llmCalls,
            toolCalls,
            promptTokens,
            completionTokens,
            totalTokens,
            durationMs: Date.now() - startedAt,
        },
    };
}