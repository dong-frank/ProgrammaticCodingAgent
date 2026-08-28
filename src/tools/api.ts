import { readFileText } from "./read-file.ts";
import { writeFileText } from "./write-file.ts";
import { editFileText } from "./edit.ts";
import { runShellCommand, type ShellOutcome } from "./shell.ts";
import { matchGlob } from "./glob.ts";

export interface ToolCallRecord {
    name: string;
    summary: string;
}

export interface AgentApi {
    readFile: (args: { path: string }) => Promise<string>;
    writeFile: (args: { path: string; content: string }) => Promise<void>;
    editFile: (args: {
        path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
    }) => Promise<void>;
    shell: (args: { command: string }) => Promise<ShellOutcome>;
    glob: (args: { pattern: string; ignore?: string[] }) => Promise<string[]>;
    calls: ToolCallRecord[];
}

export interface AgentApiMeta {
    name: keyof Omit<AgentApi, "calls">;
    returnType: string;
}

// 与 AgentApi 接口同文件维护：返回类型文本与类型定义相邻，新增 API 时同步补充
export const AGENT_API_META: readonly AgentApiMeta[] = [
    { name: "readFile", returnType: "Promise<string>" },
    { name: "writeFile", returnType: "Promise<void>" },
    { name: "editFile", returnType: "Promise<void>" },
    { name: "shell", returnType: "Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>" },
    { name: "glob", returnType: "Promise<string[]>" },
];

export function createAgentApi(cwd: string): AgentApi {
    const calls: ToolCallRecord[] = [];
    return {
        calls,
        async readFile(args) {
            const content = await readFileText(args.path, cwd);
            calls.push({ name: "readFile", summary: `读取 ${args.path}，共 ${content.length} 字符` });
            return content;
        },
        async writeFile(args) {
            await writeFileText(args.path, args.content, cwd);
            calls.push({ name: "writeFile", summary: `写入 ${args.path}，共 ${args.content.length} 字符` });
        },
        async editFile(args) {
            await editFileText(args.path, args.old_string, args.new_string, cwd, args.replace_all);
            calls.push({ name: "editFile", summary: `编辑 ${args.path}` });
        },
        async shell(args) {
            const outcome = await runShellCommand(args.command, cwd);
            calls.push({ name: "shell", summary: `执行命令，退出码 ${outcome.exitCode}` });
            return outcome;
        },
        async glob(args) {
            const matches = await matchGlob(args.pattern, cwd, args.ignore);
            calls.push({ name: "glob", summary: `匹配 ${args.pattern}，共 ${matches.length} 个路径` });
            return matches;
        },
    };
}