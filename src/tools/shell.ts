import { exec } from "node:child_process";
import type { ToolDefinition } from "./types.ts";

export const SHELL_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_CHARS = 20_000;

export interface ShellOutcome {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
}

export function runShellCommand(command: string, cwd: string): Promise<ShellOutcome> {
    return new Promise((resolve) => {
        exec(
            command,
            {
                cwd,
                timeout: SHELL_TIMEOUT_MS,
                maxBuffer: MAX_OUTPUT_CHARS * 2,
                env: { ...process.env, LANG: "en_US.UTF-8" },
            },
            (error, stdout, stderr) => {
                if (error === null) {
                    resolve({ stdout, stderr, exitCode: 0, timedOut: false });
                    return;
                }
                const err = error as Error & { code?: string | number; killed?: boolean };
                const timedOut = err.killed === true || err.code === "ETIMEDOUT" || err.code === "SIGTERM";
                let exitCode: number;
                if (timedOut) {
                    exitCode = 124;
                } else if (typeof err.code === "number") {
                    exitCode = err.code;
                } else {
                    exitCode = 1;
                }
                resolve({ stdout, stderr, exitCode, timedOut });
            },
        );
    });
}

export function shellTool(): ToolDefinition {
    return {
        name: "shell",
        description: "在 shell 中执行命令并返回标准输出、标准错误与退出码。命令在指定工作目录中运行。",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "要执行的 shell 命令" },
            },
            required: ["command"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const command = args.command;
            if (typeof command !== "string" || command.length === 0) {
                throw new Error("shell 参数 command 必须是非空字符串");
            }
            const outcome = await runShellCommand(command, ctx.cwd);

            let stdout = outcome.stdout;
            let stderr = outcome.stderr;
            if (stdout.length > MAX_OUTPUT_CHARS) {
                stdout = `${stdout.slice(0, MAX_OUTPUT_CHARS)}\n[标准输出已截断]`;
            }
            if (stderr.length > MAX_OUTPUT_CHARS) {
                stderr = `${stderr.slice(0, MAX_OUTPUT_CHARS)}\n[标准错误已截断]`;
            }

            const lines: string[] = [];
            lines.push(`退出码：${outcome.exitCode}`);
            if (outcome.timedOut) {
                lines.push("命令执行超时");
            }
            if (stdout.length > 0) {
                lines.push(`标准输出：\n${stdout}`);
            }
            if (stderr.length > 0) {
                lines.push(`标准错误：\n${stderr}`);
            }
            return { content: lines.join("\n") };
        },
    };
}