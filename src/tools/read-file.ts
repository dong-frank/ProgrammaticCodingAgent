import { readFile } from "node:fs/promises";
import { resolveWorkspacePath } from "../paths.ts";
import type { ToolDefinition } from "./types.ts";

export const MAX_READ_CHARS = 200_000;

export const READ_FILE_DESCRIPTION = "读取指定文件的文本内容。路径相对工作目录或为绝对路径。";

export async function readFileText(filePath: string, cwd: string, restrictToWorkspace = true): Promise<string> {
    const absolutePath = resolveWorkspacePath(filePath, cwd, restrictToWorkspace);
    let content: string;
    try {
        content = await readFile(absolutePath, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`读取失败：${message}`);
    }
    if (content.length > MAX_READ_CHARS) {
        content = `${content.slice(0, MAX_READ_CHARS)}\n[内容已截断]`;
    }
    return content;
}

export function readFileTool(): ToolDefinition {
    return {
        name: "readFile",
        description: READ_FILE_DESCRIPTION,
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "要读取的文件路径" },
            },
            required: ["path"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const filePath = args.path;
            if (typeof filePath !== "string" || filePath.length === 0) {
                throw new Error("readFile 参数 path 必须是非空字符串");
            }
            try {
                const content = await readFileText(filePath, ctx.cwd, ctx.restrictToWorkspace);
                return { content };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: message, error: true };
            }
        },
    };
}
