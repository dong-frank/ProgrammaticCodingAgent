import { Worker } from "node:worker_threads";
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
    signal?: AbortSignal,
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
    const executionController = new AbortController();
    const abortExecution = (): void => executionController.abort();
    if (signal?.aborted) {
        executionController.abort();
    } else {
        signal?.addEventListener("abort", abortExecution, { once: true });
    }
    const api = createAgentApi(cwd, (outcome) => {
        if (!outcome.ok) {
            commandErrors.push(`Shell 命令退出码：${outcome.exitCode}`);
        }
    }, restrictToWorkspace, executionController.signal);

    const worker = new Worker(new URL("./code-worker.ts", import.meta.url), {
        workerData: { code: js, syncTimeoutMs: SYNC_TIMEOUT_MS },
        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
        env: {},
        execArgv: [],
    });
    let status: CodeExecutionOutcome["status"] = "runtime-error";
    let error: string | null = null;
    let returnValue = "undefined";
    let settled = false;
    const shellApi = api;
    const result = await new Promise<{ stdout: string[]; stderr: string[] }>((resolve) => {
        const finish = (value: { stdout: string[]; stderr: string[] }): void => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const timer = setTimeout(() => {
            status = "timeout";
            error = `程序执行超时（${EXEC_CODE_TIMEOUT_MS} 毫秒）`;
            executionController.abort();
            void worker.terminate().then(() => finish({ stdout: stdoutLines, stderr: stderrLines }));
        }, EXEC_CODE_TIMEOUT_MS);
        const abort = (): void => {
            status = "timeout";
            error = "程序执行已中止";
            executionController.abort();
            void worker.terminate().then(() => finish({ stdout: stdoutLines, stderr: stderrLines }));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
        worker.on("message", async (message: { type: string; id?: number; method?: string; args?: unknown; status?: CodeExecutionOutcome["status"]; error?: string | null; stdout?: string[]; stderr?: string[]; returnValue?: unknown }) => {
            if (message.type === "tool-request" && message.id !== undefined && message.method !== undefined) {
                try {
                    const tool = shellApi[message.method as keyof typeof shellApi] as (args: unknown) => Promise<unknown>;
                    const value = await tool(message.args);
                    worker.postMessage({ type: "tool-result", id: message.id, ok: true, value });
                } catch (caught) {
                    worker.postMessage({ type: "tool-result", id: message.id, ok: false, error: errorMessage(caught) });
                }
                return;
            }
            if (message.type === "result") {
                clearTimeout(timer);
                if (signal !== undefined) signal.removeEventListener("abort", abort);
                status = message.status ?? "runtime-error";
                error = message.error ?? null;
                returnValue = formatValue(message.returnValue);
                finish({ stdout: message.stdout ?? [], stderr: message.stderr ?? [] });
                await worker.terminate();
            }
        });
        worker.on("error", (caught) => {
            clearTimeout(timer);
            executionController.abort();
            status = "runtime-error";
            error = errorMessage(caught);
            void worker.terminate().then(() => finish({ stdout: stdoutLines, stderr: stderrLines }));
        });
        worker.on("exit", (exitCode) => {
            if (!settled && exitCode !== 0) {
                clearTimeout(timer);
                executionController.abort();
                status = "runtime-error";
                error = `Code Worker 异常退出，退出码：${exitCode}`;
                finish({ stdout: stdoutLines, stderr: stderrLines });
            }
        });
    });
    stdoutLines.push(...result.stdout);
    stderrLines.push(...result.stderr);
    if (signal !== undefined) signal.removeEventListener("abort", abortExecution);

    let stdout = stdoutLines.join("\n");
    if (stdout.length > MAX_STDOUT_CHARS) {
        stdout = `${stdout.slice(0, MAX_STDOUT_CHARS)}\n[输出已截断]`;
    }

    let stderr = stderrLines.join("\n");
    if (stderr.length > MAX_STDOUT_CHARS) {
        stderr = `${stderr.slice(0, MAX_STDOUT_CHARS)}\n[错误输出已截断]`;
    }
    if ((status as CodeExecutionOutcome["status"]) === "success" && commandErrors.length > 0) {
        status = "command-error";
        error = commandErrors.join("\n");
    }

    return { status, error, stdout, stderr, returnValue };
}
