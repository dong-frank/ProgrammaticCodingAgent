import type { ToolDefinition } from "./types.ts";
import { readFileText } from "./read-file.ts";
import { writeFileText } from "./write-file.ts";

export const EDIT_DESCRIPTION =
    "在指定文件中用字面文本 old_string 替换为 new_string，支持局部或多行修改。默认 old_string 必须恰好出现一次；出现多次时需设置 replace_all 为 true，或提供更精确的 old_string。";

function countOccurrences(content: string, needle: string): number {
    if (needle.length === 0) {
        return 0;
    }
    return content.split(needle).length - 1;
}

export async function editFileText(
    filePath: string,
    oldString: string,
    newString: string,
    cwd: string,
    replaceAll = false,
    restrictToWorkspace = true,
): Promise<void> {
    if (oldString.length === 0) {
        throw new Error("old_string 必须是非空字符串");
    }
    const content = await readFileText(filePath, cwd, restrictToWorkspace);
    const occurrences = countOccurrences(content, oldString);
    if (occurrences === 0) {
        throw new Error(`在 ${filePath} 中未找到要替换的内容`);
    }
    if (!replaceAll && occurrences > 1) {
        throw new Error(`在 ${filePath} 中找到 ${occurrences} 处匹配，请提供更精确的 old_string 或设置 replace_all`);
    }
    const updated = replaceAll ? content.split(oldString).join(newString) : content.replace(oldString, newString);
    await writeFileText(filePath, updated, cwd, restrictToWorkspace);
}

export function editTool(): ToolDefinition {
    return {
        name: "editFile",
        description: EDIT_DESCRIPTION,
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "要编辑的文件路径" },
                old_string: { type: "string", description: "要替换的原文，必须与原文件内容精确匹配" },
                new_string: { type: "string", description: "替换后的新文本" },
                replace_all: { type: "boolean", description: "替换所有出现；默认 false（要求 old_string 恰好出现一次）" },
            },
            required: ["path", "old_string", "new_string"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const filePath = args.path;
            const oldString = args.old_string;
            const newString = args.new_string;
            if (typeof filePath !== "string" || filePath.length === 0) {
                throw new Error("edit 参数 path 必须是非空字符串");
            }
            if (typeof oldString !== "string" || typeof newString !== "string") {
                throw new Error("edit 参数 old_string 与 new_string 必须是字符串");
            }
            const replaceAll = args.replace_all === undefined ? false : args.replace_all;
            if (typeof replaceAll !== "boolean") {
                throw new Error("edit 参数 replace_all 必须是布尔值");
            }
            try {
                await editFileText(filePath, oldString, newString, ctx.cwd, replaceAll, ctx.restrictToWorkspace);
                return { content: `文件已更新：${filePath}` };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { content: message, error: true };
            }
        },
    };
}
