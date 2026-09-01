import type { LlmClient } from "../llm/client.ts";
import { executeTool } from "../tools/registry.ts";
import type { Mode, ModeConfig } from "../modes/types.ts";
import { createToolModeConfig } from "../modes/tool-mode.ts";
import { createCodeModeConfig } from "../modes/code-mode.ts";
import { ContextManager } from "./context-manager.ts";
import { MODEL_CONTEXT_WINDOW } from "../llm/types.ts";

const CONTEXT_ARCHIVE_THRESHOLD = MODEL_CONTEXT_WINDOW * 0.5;
const CONTEXT_SUMMARY_THRESHOLD = MODEL_CONTEXT_WINDOW * 0.7;

export interface AgentObserver {
    onRoundStart?: (round: number, maxRounds: number) => void;
    onContextUsage?: (inputTokens: number, contextWindow: number) => void;
    onReasoningSummary?: (content: string) => void | Promise<void>;
    onModelText?: (content: string) => void | Promise<void>;
    onToolCall?: (name: string, rawArguments: string) => void;
    onToolResult?: (content: string) => void;
}

export interface RunAgentParams {
    task: string;
    mode: Mode;
    maxRounds: number;
    workspace: string;
    sessionId?: string;
    client: LlmClient;
    observer?: AgentObserver;
    context?: ContextManager;
    signal?: AbortSignal;
    restrictToWorkspace?: boolean;
}

export interface AgentMetrics {
    llmCalls: number;
    toolCalls: number;
    errorRecoveryEvents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    apiDurationMs: number;
}

export interface AgentResult {
    finalMessage: string;
    stoppedReason: "completed" | "max-rounds" | "timeout";
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
    const context = params.context ?? new ContextManager();
    context.updateSystemPrompt(config.systemPrompt(params.workspace));
    context.append({ role: "user", content: params.task });

    let llmCalls = 0;
    let toolCalls = 0;
    let errorRecoveryEvents = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let contextCompactionArmed = true;
    const startedAt = Date.now();
    const apiBaseline = params.client.getApiDurationMs();

    for (let round = 1; round <= params.maxRounds; round += 1) {
        if (params.signal?.aborted) {
            throw new Error("智能体任务执行超时");
        }
        params.observer?.onRoundStart?.(round, params.maxRounds);

        const response = await params.client.chat({
            messages: context.getMessages(),
            tools: config.registry.listSchemas(),
            signal: params.signal,
        });
        llmCalls += 1;
        promptTokens += response.usage.promptTokens;
        completionTokens += response.usage.completionTokens;
        totalTokens += response.usage.totalTokens;
        params.observer?.onContextUsage?.(response.usage.promptTokens, MODEL_CONTEXT_WINDOW);

        if (response.usage.promptTokens < CONTEXT_SUMMARY_THRESHOLD) {
            contextCompactionArmed = true;
        }
        if (response.usage.promptTokens >= CONTEXT_ARCHIVE_THRESHOLD) {
            await context.archiveLargeToolResults();
        }
        if (response.usage.promptTokens >= CONTEXT_SUMMARY_THRESHOLD && contextCompactionArmed) {
            const summary = await params.client.summarize(context.getMessages(), params.signal);
            llmCalls += 1;
            promptTokens += summary.usage.promptTokens;
            completionTokens += summary.usage.completionTokens;
            totalTokens += summary.usage.totalTokens;
            context.replaceHistoryWithSummary(summary.content);
            contextCompactionArmed = false;
        }

        context.append(response.message);
        if (response.reasoningSummary !== null && response.reasoningSummary.trim().length > 0) {
            await params.observer?.onReasoningSummary?.(response.reasoningSummary);
        }

        const calls = response.message.tool_calls;
        if (calls === undefined || calls.length === 0) {
            if (response.message.content !== null && response.message.content.length > 0) {
                await params.observer?.onModelText?.(response.message.content);
            }
            return {
                finalMessage: response.message.content ?? "",
                stoppedReason: "completed",
                metrics: {
                    llmCalls,
                    toolCalls,
                    errorRecoveryEvents,
                    promptTokens,
                    completionTokens,
                    totalTokens,
                    durationMs: Date.now() - startedAt,
                    apiDurationMs: params.client.getApiDurationMs() - apiBaseline,
                },
            };
        }

        let roundHadError = false;
        for (const call of calls) {
            params.observer?.onToolCall?.(call.function.name, call.function.arguments);
            const result = await executeTool(config.registry, call.function.name, call.function.arguments, {
                cwd: params.workspace,
                sessionId: params.sessionId,
                restrictToWorkspace: params.restrictToWorkspace,
                signal: params.signal,
            });
            if (result.error === true) {
                roundHadError = true;
            }
            params.observer?.onToolResult?.(result.content);
            context.append({ role: "tool", tool_call_id: call.id, content: result.content });
            toolCalls += 1;
        }
        if (params.signal?.aborted) {
            throw new Error("智能体任务执行超时");
        }
        if (roundHadError) {
            errorRecoveryEvents += 1;
        }
    }

    return {
        finalMessage: "达到最大轮次仍未能完成任务",
        stoppedReason: "max-rounds",
        metrics: {
            llmCalls,
            toolCalls,
            errorRecoveryEvents,
            promptTokens,
            completionTokens,
            totalTokens,
            durationMs: Date.now() - startedAt,
            apiDurationMs: params.client.getApiDurationMs() - apiBaseline,
        },
    };
}
