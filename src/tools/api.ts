import { readFileText } from "./read-file.ts";
import { writeFileText } from "./write-file.ts";
import { runShellCommand, type ShellOutcome } from "./shell.ts";
import { matchGlob } from "./glob.ts";

export interface ToolCallRecord {
    name: string;
    summary: string;
}

export interface AgentApi {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    shell: (command: string) => Promise<ShellOutcome>;
    glob: (pattern: string, ignore?: string[]) => Promise<string[]>;
    calls: ToolCallRecord[];
}

export function createAgentApi(cwd: string): AgentApi {
    const calls: ToolCallRecord[] = [];
    return {
        calls,
        async readFile(filePath) {
            const content = await readFileText(filePath, cwd);
            calls.push({ name: "readFile", summary: `读取 ${filePath}，共 ${content.length} 字符` });
            return content;
        },
        async writeFile(filePath, content) {
            await writeFileText(filePath, content, cwd);
            calls.push({ name: "writeFile", summary: `写入 ${filePath}，共 ${content.length} 字符` });
        },
        async shell(command) {
            const outcome = await runShellCommand(command, cwd);
            calls.push({ name: "shell", summary: `执行命令，退出码 ${outcome.exitCode}` });
            return outcome;
        },
        async glob(pattern, ignore) {
            const matches = await matchGlob(pattern, cwd, ignore);
            calls.push({ name: "glob", summary: `匹配 ${pattern}，共 ${matches.length} 个路径` });
            return matches;
        },
    };
}