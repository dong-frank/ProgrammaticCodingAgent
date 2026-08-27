import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "./types.ts";

export const MAX_READ_BYTES = 200_000;

export function readFileTool(): ToolDefinition {
    return {
        name: "read_file",
        description: "读取指定文件的文本内容。路径相对工作目录或为绝对路径。",
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
                throw new Error("read_file 参数 path 必须是非空字符串");
            }
            const absolutePath = path.resolve(ctx.cwd, filePath);
            let content: string;
            try {
                content = await readFile(absolutePath, "utf8");
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: `读取失败：${message}` };
            }
            if (content.length > MAX_READ_BYTES) {
                content = `${content.slice(0, MAX_READ_BYTES)}\n[内容已截断]`;
            }
            const result: ToolResult = {
                content,
            };
            return result;
        },
    };
}