import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmClient } from "../llm/client.ts";
import type { Mode } from "../modes/types.ts";
import type { ChatMessage } from "../llm/types.ts";
import { runAgent, type AgentObserver, type AgentResult } from "../agent/agent-loop.ts";
import { ContextManager } from "../agent/context-manager.ts";
import { runShellCommand } from "../tools/shell.ts";
import type { BenchmarkTask } from "./task.ts";

export function defaultWorkspaceRoot(): string {
    const configured = process.env.PCA_BENCHMARK_DIR;
    if (configured !== undefined && configured.length > 0) {
        return configured;
    }
    return path.join(process.cwd(), ".workspace", "benchmark");
}

export async function prepareWorkspace(
    task: BenchmarkTask,
    workspaceRoot: string,
    mode: Mode,
): Promise<string> {
    const ws = path.join(workspaceRoot, task.id, mode);
    await rm(ws, { recursive: true, force: true });
    await mkdir(ws, { recursive: true });
    for (const [file, content] of Object.entries(task.files)) {
        const target = path.join(ws, file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
    }
    return ws;
}

export interface BenchmarkRunResult {
    taskId: string;
    taskName: string;
    mode: Mode;
    workspace: string;
    success: boolean;
    verifyOutput: string;
    finalMessage: string;
    stoppedReason: AgentResult["stoppedReason"];
    trace: ChatMessage[];
    llmCalls: number;
    toolCalls: number;
    errorRecoveryEvents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
    apiDurationMs: number;
}

export interface RunTaskOptions {
    client: LlmClient;
    maxRoundsOverride?: number;
    observer?: AgentObserver;
    workspaceRoot?: string;
}

export async function runTask(task: BenchmarkTask, mode: Mode, options: RunTaskOptions): Promise<BenchmarkRunResult> {
    const workspaceRoot = options.workspaceRoot ?? defaultWorkspaceRoot();
    const workspace = await prepareWorkspace(task, workspaceRoot, mode);
    const maxRounds = options.maxRoundsOverride ?? task.maxRounds;

    const context = new ContextManager();
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), task.timeoutMs);
    let agentResult: AgentResult;
    try {
        agentResult = await runAgent({
            task: task.description,
            mode,
            maxRounds,
            workspace,
            client: options.client,
            observer: options.observer,
            context,
            signal: controller.signal,
            restrictToWorkspace: true,
        });
    } catch (error) {
        if (!controller.signal.aborted) {
            throw error;
        }
        agentResult = {
            finalMessage: `任务执行超时（${task.timeoutMs} 毫秒）`,
            stoppedReason: "timeout",
            metrics: {
                llmCalls: 0,
                toolCalls: 0,
                errorRecoveryEvents: 0,
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                durationMs: Date.now() - startedAt,
                apiDurationMs: 0,
            },
        };
    } finally {
        clearTimeout(timeout);
    }
    const durationMs = Date.now() - startedAt;

    const remainingTimeoutMs = task.timeoutMs - (Date.now() - startedAt);
    const verifyCommand = task.verifyCommand
        .replaceAll("{{verify}}", task.verifyPath)
        .replaceAll("{{workspace}}", workspace);
    const verifyOutcome =
        remainingTimeoutMs <= 0
            ? {
                  ok: false,
                  stdout: "",
                  stderr: `任务执行超时（${task.timeoutMs} 毫秒）`,
                  exitCode: 124,
                  timedOut: true,
              }
            : await runShellCommand(verifyCommand, process.cwd(), remainingTimeoutMs);
    const success = verifyOutcome.exitCode === 0;
    const verifyOutput = [verifyOutcome.stdout, verifyOutcome.stderr].filter((part) => part.length > 0).join("\n");

    return {
        taskId: task.id,
        taskName: task.name,
        mode,
        workspace,
        success,
        verifyOutput,
        finalMessage: agentResult.finalMessage,
        stoppedReason: agentResult.stoppedReason,
        trace: context.getTranscript(),
        llmCalls: agentResult.metrics.llmCalls,
        toolCalls: agentResult.metrics.toolCalls,
        errorRecoveryEvents: agentResult.metrics.errorRecoveryEvents,
        promptTokens: agentResult.metrics.promptTokens,
        completionTokens: agentResult.metrics.completionTokens,
        totalTokens: agentResult.metrics.totalTokens,
        durationMs,
        apiDurationMs: agentResult.metrics.apiDurationMs,
    };
}
