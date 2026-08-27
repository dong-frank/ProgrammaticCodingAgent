import fg from "fast-glob";
import type { ToolDefinition } from "./types.ts";

export async function matchGlob(pattern: string, cwd: string): Promise<string[]> {
    let matches: string[];
    try {
        matches = await fg(pattern, { cwd, onlyFiles: true });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`匹配失败：${message}`);
    }
    matches.sort();
    return matches;
}

export function globTool(): ToolDefinition {
    return {
        name: "glob",
        description: "按通配符模式匹配工作目录下的文件路径，返回匹配到的路径列表。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "通配符模式，如 src/**/*.ts" },
            },
            required: ["pattern"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const pattern = args.pattern;
            if (typeof pattern !== "string" || pattern.length === 0) {
                throw new Error("glob 参数 pattern 必须是非空字符串");
            }
            try {
                const matches = await matchGlob(pattern, ctx.cwd);
                if (matches.length === 0) {
                    return { content: "没有匹配到任何文件" };
                }
                return { content: matches.join("\n") };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: message };
            }
        },
    };
}