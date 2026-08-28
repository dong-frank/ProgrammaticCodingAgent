#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { isMode, MODES, type Mode } from "../modes/types.ts";
import { createLlmClientFromEnv, type LlmClient } from "../llm/client.ts";
import { runAgent, type AgentObserver, type AgentResult } from "../agent/agent-loop.ts";
import { ContextManager } from "../agent/context-manager.ts";
import { SessionStore, saveSession } from "../session/store.ts";
import type { SessionRecord } from "../session/types.ts";
import { createAgentObserver, errorText } from "./ui.ts";
import { startInteractive } from "./tui/app.tsx";
import { loadTasks } from "../benchmark/task.ts";
import { runTask, prepareWorkspace, defaultWorkspaceRoot, type BenchmarkRunResult } from "../benchmark/runner.ts";
import { summarize, saveResults } from "../benchmark/report.ts";

interface CliOptions {
    mode: string;
    maxRounds: string;
    model?: string;
    workspace: string;
    quiet?: boolean;
    session?: string;
}

function validateOptions(options: CliOptions): void {
    if (!isMode(options.mode)) {
        throw new Error(`无效模式：${options.mode}，有效值为 ${MODES.join(" 或 ")}`);
    }
    parseMaxRounds(options.maxRounds);
}

function parseMaxRounds(raw: string): number {
    const maxRounds = Number(raw);
    if (!Number.isInteger(maxRounds) || maxRounds < 1) {
        throw new Error(`无效轮次上限：${raw}`);
    }
    return maxRounds;
}

function createObserver(options: CliOptions): AgentObserver | undefined {
    if (options.quiet === true) {
        return undefined;
    }
    return createAgentObserver((text) => process.stderr.write(`${text}\n`));
}

async function createClient(options: CliOptions): Promise<LlmClient> {
    return createLlmClientFromEnv(options.model === undefined ? {} : { model: options.model });
}

async function executeTask(
    task: string,
    options: CliOptions,
    context?: ContextManager,
    clientOverride?: LlmClient,
): Promise<AgentResult> {
    const client = clientOverride ?? (await createClient(options));
    return await runAgent({
        task,
        mode: options.mode as Mode,
        maxRounds: parseMaxRounds(options.maxRounds),
        workspace: options.workspace,
        client,
        observer: createObserver(options),
        context,
    });
}

async function runOnce(task: string, options: CliOptions): Promise<void> {
    const store = new SessionStore();
    const client = await createClient(options);
    let context: ContextManager | undefined;
    let mode = options.mode as Mode;
    let workspace = options.workspace;

    let record: SessionRecord | null = null;
    if (options.session !== undefined) {
        record = await store.get(options.session);
        if (record === null) {
            throw new Error(`会话 ${options.session} 不存在`);
        }
        context = new ContextManager(record.messages);
        mode = record.mode;
        workspace = record.workspace;
    }

    const result = await executeTask(task, { ...options, mode, workspace }, context, client);
    console.log(result.finalMessage);
    console.log(JSON.stringify(result.metrics));

    if (record !== null) {
        await saveSession(store, record, context!, { mode, model: client.getModelName(), workspace });
    }
}

async function runInteractive(options: CliOptions): Promise<void> {
    const store = new SessionStore();
    const client = await createClient(options);

    let record: SessionRecord;
    let context: ContextManager;
    if (options.session !== undefined) {
        const loaded = await store.get(options.session);
        if (loaded === null) {
            throw new Error(`会话 ${options.session} 不存在`);
        }
        record = loaded;
        context = new ContextManager(record.messages);
    } else {
        record = store.createRecord({
            workspace: options.workspace,
            mode: options.mode as Mode,
            model: client.getModelName(),
        });
        context = new ContextManager();
    }

    await startInteractive({
        client,
        store,
        record,
        context,
        maxRounds: parseMaxRounds(options.maxRounds),
        model: options.model,
        workspace: options.workspace,
    });
}

const program = new Command();

program
    .name("pca")
    .description("programmatic-coding-agent：从零实现的编程智能体，支持 Tool Calling 与 Code Mode")
    .version("0.1.0")
    .argument("[task]", "要执行的任务；不提供时进入交互模式")
    .option("-m, --mode <mode>", "执行模式：tool 或 code（benchmark 子命令下可为 all）")
    .option("-r, --max-rounds <rounds>", "最大循环轮次", "50")
    .option("--model <model>", "模型名称（覆盖环境变量 PCA_MODEL）")
    .option("-w, --workspace <path>", "工作目录", process.cwd())
    .option("-q, --quiet", "不显示过程日志，只输出结果")
    .option("--session <id>", "恢复指定会话继续执行")
    .action(async (task: string | undefined, options: CliOptions) => {
        try {
            const resolved = { ...options, mode: options.mode ?? "code" };
            validateOptions(resolved);
            if (task === undefined) {
                await runInteractive(resolved);
            } else {
                await runOnce(task, resolved);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(errorText(message));
            process.exit(1);
        }
    });

program
    .command("benchmark")
    .description("运行 Tool Calling 与 Code Mode 对照实验")
    .option("--task <task>", "只运行指定任务 id")
    .option("--max-rounds <rounds>", "覆盖任务定义的轮次上限")
    .option("--model <model>", "模型名称（覆盖环境变量 PCA_MODEL）")
    .option("--reset", "只重建任务初始工作区，不运行实验")
    .action(
        async (options: { task?: string; maxRounds?: string; model?: string; reset?: boolean }) => {
            try {
                const selectedMode = program.opts().mode ?? "all";
                if (selectedMode !== "all" && !isMode(selectedMode)) {
                    throw new Error(`无效模式：${selectedMode}，有效值为 all、tool 或 code`);
                }
                const modes: Mode[] = selectedMode === "all" ? ["tool", "code"] : [selectedMode as Mode];
                const maxRoundsOverride =
                    options.maxRounds === undefined ? undefined : parseMaxRounds(options.maxRounds);
                const client = createLlmClientFromEnv(options.model === undefined ? {} : { model: options.model });

                const tasks = await loadTasks();
                const selected =
                    options.task === undefined ? tasks : tasks.filter((task) => task.id === options.task);
                if (selected.length === 0) {
                    throw new Error(`找不到任务：${options.task}`);
                }

                if (options.reset === true) {
                    for (const task of selected) {
                        for (const mode of modes) {
                            const workspace = await prepareWorkspace(task, defaultWorkspaceRoot(), mode);
                            process.stderr.write(`已恢复初始工作区 ${task.id}（${mode}）：${workspace}\n`);
                        }
                    }
                    return;
                }

                const results: BenchmarkRunResult[] = [];
                for (const task of selected) {
                    for (const mode of modes) {
                        process.stderr.write(`运行任务 ${task.id}（${mode}）...\n`);
                        const result = await runTask(task, mode, { client, maxRoundsOverride });
                        results.push(result);
                        process.stderr.write(`  完成：${result.success ? "成功" : "失败"}\n`);
                    }
                }

                console.log(summarize(results));
                const file = await saveResults(results);
                process.stderr.write(`结果已保存：${file}\n`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error(errorText(message));
                process.exit(1);
            }
        },
    );

await program.parseAsync(process.argv);