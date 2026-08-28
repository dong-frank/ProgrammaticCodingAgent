import fg from "fast-glob";
import type { ToolDefinition } from "./types.ts";

export async function matchGlob(pattern: string, cwd: string, ignore?: string[]): Promise<string[]> {
    let matches: string[];
    try {
        matches = await fg(pattern, { cwd, onlyFiles: true, ignore });
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
        description:
            "按通配符模式匹配工作目录下的文件路径，返回匹配到的路径列表。如需排除某些目录（如 node_modules、.git），通过 ignore 参数传入要排除的模式列表。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "通配符模式，如 src/**/*.ts" },
                ignore: {
                    type: "array",
                    items: { type: "string" },
                    description: "要排除的模式列表，例如 [\"**/node_modules/**\", \"**/.git/**\"]；不传则不排除",
                },
            },
            required: ["pattern"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const pattern = args.pattern;
            if (typeof pattern !== "string" || pattern.length === 0) {
                throw new Error("glob 参数 pattern 必须是非空字符串");
            }
            let ignore: string[] | undefined;
            if (args.ignore !== undefined) {
                if (!Array.isArray(args.ignore) || args.ignore.some((entry) => typeof entry !== "string")) {
                    throw new Error("glob 参数 ignore 必须是由字符串组成的数组");
                }
                ignore = args.ignore as string[];
            }
            try {
                const matches = await matchGlob(pattern, ctx.cwd, ignore);
                if (matches.length === 0) {
                    return { content: "没有匹配到任何文件" };
                }
                return { content: matches.join("\n") };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: message, error: true };
            }
        },
    };
}