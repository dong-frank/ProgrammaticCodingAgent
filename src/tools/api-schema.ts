export interface AgentApiSchema {
    name: string;
    signature: string;
    description: string;
}

export const AGENT_API_SCHEMAS: readonly AgentApiSchema[] = [
    {
        name: "readFile",
        signature: "readFile(path: string): Promise<string>",
        description: "读取文本文件内容，路径相对工作目录或为绝对路径",
    },
    {
        name: "writeFile",
        signature: "writeFile(path: string, content: string): Promise<void>",
        description: "创建或覆盖写入文件，自动创建不存在的父目录",
    },
    {
        name: "shell",
        signature:
            "shell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>",
        description: "执行 shell 命令，返回标准输出、标准错误、退出码与是否超时",
    },
    {
        name: "glob",
        signature: "glob(pattern: string, ignore?: string[]): Promise<string[]>",
        description: "按通配符模式匹配路径，ignore 为要排除的模式列表，例如 [\"**/node_modules/**\", \"**/.git/**\"]",
    },
];

export const CONSOLE_DECLARATION =
    "declare const console: {\n    log(...args: unknown[]): void;\n    error(...args: unknown[]): void;\n    warn(...args: unknown[]): void;\n};";

export function renderAgentApiDeclarations(): string {
    const functions = AGENT_API_SCHEMAS.map((schema) => `declare function ${schema.signature};`).join("\n");
    return `${functions}\n${CONSOLE_DECLARATION}`;
}

export function renderAgentApiUsageGuide(): string {
    const lines = AGENT_API_SCHEMAS.map(
        (schema) => `- ${schema.signature} —— ${schema.description}`,
    );
    return ["程序内可直接使用以下全局函数（无需 import，支持 await）：", ...lines].join("\n");
}