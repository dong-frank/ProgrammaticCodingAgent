import { readFileText } from "./read-file.ts";
import { writeFileText } from "./write-file.ts";
import { editFileText } from "./edit.ts";
import { runShellCommand, type ShellOutcome } from "./shell.ts";
import { matchGlob } from "./glob.ts";

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
}

export interface AgentApiMeta {
    name: keyof AgentApi;
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
    return {
        async readFile(args) {
            return await readFileText(args.path, cwd);
        },
        async writeFile(args) {
            await writeFileText(args.path, args.content, cwd);
        },
        async editFile(args) {
            await editFileText(args.path, args.old_string, args.new_string, cwd, args.replace_all);
        },
        async shell(args) {
            return await runShellCommand(args.command, cwd);
        },
        async glob(args) {
            return await matchGlob(args.pattern, cwd, args.ignore);
        },
    };
}