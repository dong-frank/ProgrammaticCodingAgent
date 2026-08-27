#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { isMode, MODES, type Mode } from "../modes/types.ts";
import { createLlmClientFromEnv, type LlmClient } from "../llm/client.ts";
import { runAgent, type AgentObserver, type AgentResult } from "../agent/agent-loop.ts";
import {
    banner,
    helpText,
    createAgentObserver,
    taskDone,
    maxRoundsReached,
    errorText,
} from "./ui.ts";

interface CliOptions {
    mode: string;
    maxRounds: string;
    model?: string;
    workspace: string;
    quiet?: boolean;
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

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms} 毫秒`;
    }
    return `${(ms / 1000).toFixed(1)} 秒`;
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

async function executeTask(task: string, options: CliOptions, clientOverride?: LlmClient): Promise<AgentResult> {
    const client = clientOverride ?? (await createClient(options));
    return await runAgent({
        task,
        mode: options.mode as Mode,
        maxRounds: parseMaxRounds(options.maxRounds),
        workspace: options.workspace,
        client,
        observer: createObserver(options),
    });
}

function renderResult(result: AgentResult, options: CliOptions): void {
    const duration = formatDuration(result.metrics.durationMs);
    if (result.stoppedReason === "completed") {
        console.log(taskDone(result.finalMessage, result.metrics, duration));
    } else {
        console.log(maxRoundsReached(result.metrics, duration));
    }
    if (options.quiet !== true) {
        process.stderr.write("\n");
    }
}

async function runOnce(task: string, options: CliOptions): Promise<void> {
    const result = await executeTask(task, options);
    console.log(result.finalMessage);
    console.log(JSON.stringify(result.metrics));
}

async function runInteractive(options: CliOptions): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.on("SIGINT", () => {
        process.exit(0);
    });

    let mode = options.mode as Mode;
    const client = await createClient(options);
    console.log(banner({ mode, model: client.getModelName(), workspace: options.workspace }));
    console.log("");

    rl.setPrompt(`${mode}> `);
    rl.prompt();
    for await (const raw of rl) {
        const line = raw.trim();
        if (line.length > 0) {
            if (line.startsWith("/")) {
                const [command, ...rest] = line.split(/\s+/);
                const arg = rest.join(" ");
                switch (command) {
                    case "/help":
                        console.log(helpText(mode));
                        break;
                    case "/mode":
                        if (arg.length === 0) {
                            console.log(`当前模式：${mode}`);
                        } else if (isMode(arg)) {
                            mode = arg;
                            console.log(`模式已切换为 ${mode}`);
                        } else {
                            console.error(errorText(`无效模式：${arg}，有效值为 ${MODES.join(" 或 ")}`));
                        }
                        break;
                    case "/quit":
                    case "/exit":
                        rl.close();
                        return;
                    default:
                        console.error(errorText(`未知命令 ${command}，输入 /help 查看可用命令`));
                        break;
                }
            } else {
                try {
                    const result = await executeTask(line, { ...options, mode }, client);
                    renderResult(result, { ...options, mode });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(errorText(message));
                }
            }
        }
        rl.setPrompt(`${mode}> `);
        rl.prompt();
    }
}

const program = new Command();

program
    .name("pca")
    .description("programmatic-coding-agent：从零实现的编程智能体，支持 Tool Calling 与 Code Mode")
    .version("0.1.0")
    .argument("[task]", "要执行的任务；不提供时进入交互模式")
    .option("-m, --mode <mode>", `执行模式：${MODES.join(" 或 ")}`, "code")
    .option("-r, --max-rounds <rounds>", "最大循环轮次", "50")
    .option("--model <model>", "模型名称（覆盖环境变量 PCA_MODEL）")
    .option("-w, --workspace <path>", "工作目录", process.cwd())
    .option("-q, --quiet", "不显示过程日志，只输出结果")
    .action(async (task: string | undefined, options: CliOptions) => {
        try {
            validateOptions(options);
            if (task === undefined) {
                await runInteractive(options);
            } else {
                await runOnce(task, options);
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
    .option("--mode <mode>", "只运行指定模式", "tool")
    .option("--task <task>", "指定任务")
    .action(() => {
        console.error(errorText("对照实验尚未实现"));
        process.exit(1);
    });

await program.parseAsync(process.argv);