import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "../paths.ts";
import type { ToolDefinition } from "./types.ts";

export const WRITE_FILE_DESCRIPTION =
    "创建或覆盖写入指定文件，自动创建不存在的父目录；content 会按原样写入。生成包含反斜杠转义的源码时，请在 Agent Program 中使用 String.raw 模板字符串，避免外层模板字符串解释目标源码中的 \\n、\\r 等转义。";

export async function writeFileText(
    filePath: string,
    content: string,
    cwd: string,
    restrictToWorkspace = true,
): Promise<void> {
    const absolutePath = resolveWorkspacePath(filePath, cwd, restrictToWorkspace);
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
        name: "writeFile",
        description: WRITE_FILE_DESCRIPTION,
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
                throw new Error("writeFile 参数 path 必须是非空字符串");
            }
            if (typeof content !== "string") {
                throw new Error("writeFile 参数 content 必须是字符串");
            }
            try {
                await writeFileText(filePath, content, ctx.cwd, ctx.restrictToWorkspace);
                return { content: `文件写入完成：${filePath}` };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: message, error: true };
            }
        },
    };
}
