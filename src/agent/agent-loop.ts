import type { LlmClient } from "../llm/client.ts";
import { createDefaultRegistry, type ToolRegistry } from "../tools/registry.ts";
import type { Mode } from "../modes/types.ts";
import { runToolModeStep } from "../modes/tool-mode.ts";
import { runCodeModeStep } from "../modes/code-mode.ts";
import { ContextManager } from "./context-manager.ts";
import { buildSystemPrompt } from "./system-prompt.ts";

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

export async function runAgent(params: RunAgentParams): Promise<AgentResult> {
    const registry: ToolRegistry = createDefaultRegistry();
    const context = new ContextManager(buildSystemPrompt(params.workspace, registry.listNames()));
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
            tools: registry.listSchemas(),
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

        if (params.mode === "tool") {
            const outcome = await runToolModeStep({
                response,
                context,
                registry,
                toolCtx: { cwd: params.workspace },
            });
            toolCalls += outcome.toolCalls;
        } else {
            runCodeModeStep();
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