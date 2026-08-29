import vm from "node:vm";
import ts from "typescript";
import { createAgentApi } from "../tools/api.ts";
import { validateAgentProgram } from "./validate.ts";
import type { CodeExecutionOutcome } from "./types.ts";

export const EXEC_CODE_TIMEOUT_MS = 120_000;
export const SYNC_TIMEOUT_MS = 10_000;
const MAX_STDOUT_CHARS = 20_000;

class ExecutionTimeoutError extends Error {}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error) {
        const message = error.message;
        if (typeof message === "string") {
            return message;
        }
    }
    return String(error);
}

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

export async function executeAgentProgram(
    code: string,
    cwd: string,
    restrictToWorkspace = true,
): Promise<CodeExecutionOutcome> {
    // 静态验证：语法与类型诊断，在执行前拦截错误代码
    const issues = validateAgentProgram(code);
    if (issues.length > 0) {
        const messages = issues.map((issue) => `第 ${issue.line} 行：${issue.message}`);
        return {
            status: "validation-error",
            error: `程序验证失败：\n${messages.join("\n")}`,
            stdout: "",
            stderr: "",
            returnValue: "undefined",
        };
    }

    let js: string;
    try {
        js = transpileAgentProgram(code);
    } catch (error) {
        return { status: "runtime-error", error: errorMessage(error), stdout: "", stderr: "", returnValue: "undefined" };
    }

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const commandErrors: string[] = [];
    const api = createAgentApi(cwd, (outcome) => {
        if (!outcome.ok) {
            commandErrors.push(`Shell 命令退出码：${outcome.exitCode}`);
        }
    }, restrictToWorkspace);

    const context = vm.createContext({
        readFile: api.readFile,
        writeFile: api.writeFile,
        editFile: api.editFile,
        shell: api.shell,
        glob: api.glob,
        console: {
            log: (...parts: unknown[]) => stdoutLines.push(parts.map(formatValue).join(" ")),
            error: (...parts: unknown[]) => stderrLines.push(parts.map(formatValue).join(" ")),
            warn: (...parts: unknown[]) => stderrLines.push(parts.map(formatValue).join(" ")),
        },
    });

    const wrapped = `(async () => {\n${js}\n})()`;

    let execution: Promise<unknown>;
    try {
        execution = vm.runInContext(wrapped, context, { timeout: SYNC_TIMEOUT_MS }) as Promise<unknown>;
    } catch (error) {
        if (error instanceof Error && error.message.includes("Script execution timed out")) {
            return {
                status: "timeout",
                error: `程序同步执行超时（${SYNC_TIMEOUT_MS} 毫秒）`,
                stdout: stdoutLines.join("\n"),
                stderr: stderrLines.join("\n"),
                returnValue: "undefined",
            };
        }
        const message = errorMessage(error);
        return {
            status: "runtime-error",
            error: message,
            stdout: stdoutLines.join("\n"),
            stderr: stderrLines.join("\n"),
            returnValue: "undefined",
        };
    }

    let status: CodeExecutionOutcome["status"] = "success";
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
            status = "timeout";
            error = caught.message;
        } else {
            status = "runtime-error";
            error = errorMessage(caught);
        }
    }

    let stdout = stdoutLines.join("\n");
    if (stdout.length > MAX_STDOUT_CHARS) {
        stdout = `${stdout.slice(0, MAX_STDOUT_CHARS)}\n[输出已截断]`;
    }

    let stderr = stderrLines.join("\n");
    if (stderr.length > MAX_STDOUT_CHARS) {
        stderr = `${stderr.slice(0, MAX_STDOUT_CHARS)}\n[错误输出已截断]`;
    }
    if (status === "success" && commandErrors.length > 0) {
        status = "command-error";
        error = commandErrors.join("\n");
    }

    return { status, error, stdout, stderr, returnValue };
}
