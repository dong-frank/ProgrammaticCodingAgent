import fg from "fast-glob";
import type { ToolDefinition } from "./types.ts";

export const DEFAULT_GLOB_IGNORES = [
    "**/node_modules/**",
    "**/.git/**",
    "**/dist/**",
    "**/build/**",
    "**/.venv/**",
    "**/.dsh/**",
];

export async function matchGlob(pattern: string, cwd: string, ignore?: string[]): Promise<string[]> {
    const ignoreList = ignore ?? DEFAULT_GLOB_IGNORES;
    let matches: string[];
    try {
        matches = await fg(pattern, { cwd, onlyFiles: true, ignore: ignoreList });
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
            "按通配符模式匹配工作目录下的文件路径，返回匹配到的路径列表。默认忽略 node_modules、.git、dist、build、.venv、.dsh 等目录下的文件；如需包含这些目录，请传入空数组作为 ignore。",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "通配符模式，如 src/**/*.ts" },
                ignore: {
                    type: "array",
                    items: { type: "string" },
                    description: "额外排除的模式列表；传空数组表示不排除（包含依赖目录）",
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
                const custom = args.ignore as string[];
                ignore = custom.length === 0 ? [] : [...custom, ...DEFAULT_GLOB_IGNORES];
            }
            try {
                const matches = await matchGlob(pattern, ctx.cwd, ignore);
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