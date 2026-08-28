import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LlmClient } from "../llm/client.ts";
import type { Mode } from "../modes/types.ts";
import { runAgent, type AgentObserver } from "../agent/agent-loop.ts";
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
    success: boolean;
    verifyOutput: string;
    finalMessage: string;
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

    const startedAt = Date.now();
    const agentResult = await runAgent({
        task: task.description,
        mode,
        maxRounds,
        workspace,
        client: options.client,
        observer: options.observer,
    });
    const durationMs = Date.now() - startedAt;

    const verifyCommand = task.verifyCommand
        .replaceAll("{{verify}}", task.verifyPath)
        .replaceAll("{{workspace}}", workspace);
    const verifyOutcome = await runShellCommand(verifyCommand, process.cwd());
    const success = verifyOutcome.exitCode === 0;
    const verifyOutput = [verifyOutcome.stdout, verifyOutcome.stderr].filter((part) => part.length > 0).join("\n");

    return {
        taskId: task.id,
        taskName: task.name,
        mode,
        success,
        verifyOutput,
        finalMessage: agentResult.finalMessage,
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