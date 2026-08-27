import vm from "node:vm";
import ts from "typescript";
import type { ToolDefinition } from "./types.ts";
import { createAgentApi, type ToolCallRecord } from "./api.ts";

export const EXEC_CODE_TIMEOUT_MS = 120_000;
export const SYNC_TIMEOUT_MS = 10_000;
const MAX_STDOUT_CHARS = 20_000;
const MAX_TOOL_CALL_RECORDS = 30;

class ExecutionTimeoutError extends Error {}

async function waitWithTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout: Promise<never> = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new ExecutionTimeoutError(timeoutMessage)), ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
    }
}

export function transpileAgentProgram(code: string): string {
    const result = ts.transpileModule(code, {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES2023,
            strict: true,
        },
        reportDiagnostics: true,
    });
    if (result.diagnostics !== undefined && result.diagnostics.length > 0) {
        const messages = result.diagnostics.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );
        throw new Error(`程序语法错误：${messages.join("；")}`);
    }
    return result.outputText;
}

export function formatValue(value: unknown): string {
    if (value === undefined) {
        return "undefined";
    }
    if (value === null) {
        return "null";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    try {
        const text = JSON.stringify(value, null, 2);
        return text === undefined ? String(value) : text;
    } catch {
        return String(value);
    }
}

export interface CodeExecutionOutcome {
    timedOut: boolean;
    error: string | null;
    stdout: string;
    returnValue: string;
    toolCalls: ToolCallRecord[];
}

export async function executeAgentProgram(code: string, cwd: string): Promise<CodeExecutionOutcome> {
    let js: string;
    try {
        js = transpileAgentProgram(code);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { timedOut: false, error: message, stdout: "", returnValue: "undefined", toolCalls: [] };
    }

    const api = createAgentApi(cwd);
    const stdoutLines: string[] = [];

    const context = vm.createContext({
        readFile: api.readFile,
        writeFile: api.writeFile,
        shell: api.shell,
        glob: api.glob,
        console: {
            log: (...parts: unknown[]) => stdoutLines.push(parts.map(formatValue).join(" ")),
            error: (...parts: unknown[]) => stdoutLines.push(`[console.error] ${parts.map(formatValue).join(" ")}`),
            warn: (...parts: unknown[]) => stdoutLines.push(`[console.warn] ${parts.map(formatValue).join(" ")}`),
        },
    });

    const wrapped = `(async () => {\n${js}\n})()`;

    let execution: Promise<unknown>;
    try {
        execution = vm.runInContext(wrapped, context, { timeout: SYNC_TIMEOUT_MS }) as Promise<unknown>;
    } catch (error) {
        if (error instanceof Error && error.message.includes("Script execution timed out")) {
            return {
                timedOut: true,
                error: `程序同步执行超时（${SYNC_TIMEOUT_MS} 毫秒）`,
                stdout: stdoutLines.join("\n"),
                returnValue: "undefined",
                toolCalls: api.calls,
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return {
            timedOut: false,
            error: message,
            stdout: stdoutLines.join("\n"),
            returnValue: "undefined",
            toolCalls: api.calls,
        };
    }

    let timedOut = false;
    let error: string | null = null;
    let returnValue = "undefined";
    try {
        const value = await waitWithTimeout(
            execution,
            EXEC_CODE_TIMEOUT_MS,
            `程序执行超时（${EXEC_CODE_TIMEOUT_MS} 毫秒）`,
        );
        returnValue = formatValue(value);
    } catch (caught) {
        if (caught instanceof ExecutionTimeoutError) {
            timedOut = true;
            error = caught.message;
        } else {
            error = caught instanceof Error ? caught.message : String(caught);
        }
    }

    let stdout = stdoutLines.join("\n");
    if (stdout.length > MAX_STDOUT_CHARS) {
        stdout = `${stdout.slice(0, MAX_STDOUT_CHARS)}\n[输出已截断]`;
    }

    return { timedOut, error, stdout, returnValue, toolCalls: api.calls };
}

export function execCodeTool(): ToolDefinition {
    return {
        name: "exec_code",
        description:
            "执行一段 TypeScript 程序。程序内可直接使用全局异步函数：readFile(path) 返回文件内容字符串，writeFile(path, content) 写入文件，shell(command) 执行命令并返回 {stdout, stderr, exitCode, timedOut}，glob(pattern, ignore?) 返回匹配路径数组（默认忽略 node_modules、.git、dist、build 等依赖目录，传空数组可包含）。无需 import，支持 await 与顶层 await。程序完成后返回标准输出、返回值、程序内工具调用记录与错误信息。",
        parameters: {
            type: "object",
            properties: {
                code: { type: "string", description: "要执行的 TypeScript 程序源码，不要包含 import 语句" },
            },
            required: ["code"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const code = args.code;
            if (typeof code !== "string" || code.length === 0) {
                throw new Error("exec_code 参数 code 必须是非空字符串");
            }
            const outcome = await executeAgentProgram(code, ctx.cwd);

            const lines: string[] = [];
            if (outcome.timedOut) {
                lines.push("程序状态：超时");
            } else if (outcome.error !== null) {
                lines.push("程序状态：异常");
            } else {
                lines.push("程序状态：正常");
            }
            if (outcome.stdout.length > 0) {
                lines.push(`标准输出：\n${outcome.stdout}`);
            }
            lines.push(`返回值：${outcome.returnValue}`);

            const totalCalls = outcome.toolCalls.length;
            if (totalCalls > 0) {
                const shown = outcome.toolCalls.slice(0, MAX_TOOL_CALL_RECORDS);
                const rows = shown.map((call) => `- ${call.name}：${call.summary}`);
                if (totalCalls > MAX_TOOL_CALL_RECORDS) {
                    rows.push(`- …… 其余 ${totalCalls - MAX_TOOL_CALL_RECORDS} 条省略，共 ${totalCalls} 条`);
                }
                lines.push(`程序内工具调用：\n${rows.join("\n")}`);
            } else {
                lines.push("程序内工具调用：无");
            }
            if (outcome.error !== null) {
                lines.push(`错误信息：\n${outcome.error}`);
            }
            return { content: lines.join("\n") };
        },
    };
}