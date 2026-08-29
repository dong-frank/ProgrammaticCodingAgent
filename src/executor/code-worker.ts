import vm from "node:vm";
import { parentPort, workerData } from "node:worker_threads";

interface WorkerRequest {
    id: number;
    method: string;
    args: unknown;
}

interface WorkerResponse {
    type: "tool-result";
    id: number;
    ok: boolean;
    value?: unknown;
    error?: string;
}

interface WorkerOutput {
    type: "result";
    status: "success" | "runtime-error" | "timeout";
    error: string | null;
    stdout: string[];
    stderr: string[];
    returnValue: unknown;
}

const port = parentPort;
if (port === null) {
    throw new Error("Code Worker 缺少 parentPort");
}
const workerPort = port;

const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
let nextRequestId = 1;

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        return error.message;
    }
    return String(error);
}

function callTool(method: string, args: unknown): Promise<unknown> {
    const id = nextRequestId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        workerPort.postMessage({ type: "tool-request", id, method, args } satisfies WorkerRequest & { type: "tool-request" });
    });
}

function formatValue(value: unknown): string {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    return JSON.stringify(value, null, 2) ?? String(value);
}

const stdout: string[] = [];
const stderr: string[] = [];
const tools = {
    readFile: (args: unknown) => callTool("readFile", args),
    writeFile: (args: unknown) => callTool("writeFile", args),
    editFile: (args: unknown) => callTool("editFile", args),
    shell: (args: unknown) => callTool("shell", args),
    glob: (args: unknown) => callTool("glob", args),
};

workerPort.on("message", (message: WorkerResponse) => {
    if (message.type !== "tool-result") return;
    const request = pending.get(message.id);
    if (request === undefined) return;
    pending.delete(message.id);
    if (message.ok) {
        request.resolve(message.value);
    } else {
        request.reject(new Error(message.error ?? "工具调用失败"));
    }
});

async function run(): Promise<void> {
    const context = vm.createContext({
        tools,
        console: {
            log: (...parts: unknown[]) => stdout.push(parts.map(formatValue).join(" ")),
            error: (...parts: unknown[]) => stderr.push(parts.map(formatValue).join(" ")),
            warn: (...parts: unknown[]) => stderr.push(parts.map(formatValue).join(" ")),
        },
    });
    const wrapped = `(async () => {\n${String(workerData.code)}\n})()`;
    try {
        const execution = vm.runInContext(wrapped, context, { timeout: Number(workerData.syncTimeoutMs) }) as Promise<unknown>;
        const value = await execution;
        workerPort.postMessage({ type: "result", status: "success", error: null, stdout, stderr, returnValue: value } satisfies WorkerOutput);
    } catch (error) {
        const message = errorMessage(error);
        const status = message.includes("Script execution timed out") ? "timeout" : "runtime-error";
        workerPort.postMessage({ type: "result", status, error: message, stdout, stderr, returnValue: "undefined" } satisfies WorkerOutput);
    }
}

void run();
