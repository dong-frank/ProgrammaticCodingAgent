#!/usr/bin/env node

import { Command } from "commander";
import { isMode, MODES } from "../modes/types.ts";

const program = new Command();

program
    .name("programmatic-coding-agent")
    .description("从零实现的编程智能体，支持 Tool Calling 与 Code Mode 两种执行模式")
    .version("0.1.0");

program
    .command("run")
    .description("运行一个编码任务")
    .argument("<task>", "任务描述")
    .option("--mode <mode>", `执行模式：${MODES.join(" 或 ")}`, "code")
    .option("--max-rounds <rounds>", "最大循环轮次", "50")
    .option("--model <model>", "模型名称")
    .option("--workspace <path>", "工作目录", process.cwd())
    .action(
        (task: string, options: { mode: string; maxRounds: string; model?: string; workspace: string }) => {
            if (!isMode(options.mode)) {
                console.error(`无效模式：${options.mode}，有效值为 ${MODES.join(" 或 ")}`);
                process.exit(1);
            }
            console.error("Agent 执行尚未实现");
            process.exit(1);
        },
    );

program
    .command("benchmark")
    .description("运行 Tool Calling 与 Code Mode 对照实验")
    .option("--mode <mode>", "只运行指定模式", "tool")
    .option("--task <task>", "指定任务")
    .action(() => {
        console.error("对照实验尚未实现");
        process.exit(1);
    });

await program.parseAsync(process.argv);