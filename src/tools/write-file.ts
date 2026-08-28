import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "./types.ts";

export async function writeFileText(filePath: string, content: string, cwd: string): Promise<void> {
    const absolutePath = path.resolve(cwd, filePath);
    try {
        await mkdir(path.dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, "utf8");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`写入失败：${message}`);
    }
}

export function writeFileTool(): ToolDefinition {
    return {
        name: "write_file",
        description: "创建或覆盖写入指定文件，自动创建不存在的父目录。",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "要写入的文件路径" },
                content: { type: "string", description: "完整的文件内容" },
            },
            required: ["path", "content"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const filePath = args.path;
            const content = args.content;
            if (typeof filePath !== "string" || filePath.length === 0) {
                throw new Error("write_file 参数 path 必须是非空字符串");
            }
            if (typeof content !== "string") {
                throw new Error("write_file 参数 content 必须是字符串");
            }
            try {
                await writeFileText(filePath, content, ctx.cwd);
                return { content: `文件写入完成：${filePath}` };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: message, error: true };
            }
        },
    };
}