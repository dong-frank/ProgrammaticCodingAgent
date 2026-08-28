import vm from "node:vm";
import ts from "typescript";
import { createAgentApi } from "../tools/api.ts";
import { validateAgentProgram } from "./validate.ts";
import type { CodeExecutionOutcome } from "./types.ts";

export const EXEC_CODE_TIMEOUT_MS = 120_000;
export const SYNC_TIMEOUT_MS = 10_000;
const MAX_STDOUT_CHARS = 20_000;

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

export async function executeAgentProgram(code: string, cwd: string): Promise<CodeExecutionOutcome> {
    // 静态验证：语法与类型诊断，在执行前拦截错误代码
    const issues = validateAgentProgram(code);
    if (issues.length > 0) {
        const messages = issues.map((issue) => `第 ${issue.line} 行：${issue.message}`);
        return {
            timedOut: false,
            error: `程序验证失败：\n${messages.join("\n")}`,
            stdout: "",
            returnValue: "undefined",
            toolCalls: [],
        };
    }

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
        editFile: api.editFile,
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