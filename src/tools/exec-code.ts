import type { ToolDefinition } from "./types.ts";
import { executeAgentProgram } from "../executor/code-executor.ts";

export function execCodeTool(): ToolDefinition {
    return {
        name: "exec_code",
        description:
            "执行一段完整的 TypeScript 异步函数体。每次调用都必须通过 code 传入完整程序，程序内通过全局 tools 对象调用 API（无需 import，支持 await 与顶层 await）：tools.readFile({ path }) 返回文件内容字符串，tools.writeFile({ path, content }) 写入文件，tools.editFile({ path, old_string, new_string, replace_all }) 做原文替换，tools.shell({ command }) 执行命令并返回 { ok, stdout, stderr, exitCode, timedOut }，tools.glob({ pattern, ignore }) 返回匹配路径数组。程序不支持 import 或动态 import；程序会先进行语法检查和类型擦除，验证失败会返回具体错误。程序完成后只回传标准输出、返回值与错误信息。对于 tools.shell 返回的 ok 为 false 的结果，必须结合 exitCode、stdout 和 stderr 判断命令失败原因。",
        parameters: {
            type: "object",
            properties: {
                code: { type: "string", description: "完整 TypeScript 异步函数体" },
            },
            required: ["code"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            try {
                if (typeof args.code !== "string" || args.code.length === 0) {
                    throw new Error("exec_code 参数 code 必须是非空字符串");
                }

                const outcome = await executeAgentProgram(args.code, ctx.cwd, ctx.restrictToWorkspace, ctx.signal);

                const lines: string[] = [];
                const statusText = {
                    success: "正常",
                    "validation-error": "验证失败",
                    "runtime-error": "异常",
                    "command-error": "命令失败",
                    timeout: "超时",
                }[outcome.status];
                lines.push(`程序状态：${statusText}`);
                if (outcome.stdout.length > 0) {
                    lines.push(`标准输出：\n${outcome.stdout}`);
                }
                if (outcome.stderr.length > 0) {
                    lines.push(`标准错误：\n${outcome.stderr}`);
                }
                lines.push(`返回值：${outcome.returnValue}`);
                if (outcome.error !== null) {
                    lines.push(`错误信息：\n${outcome.error}`);
                }
                return {
                    content: lines.join("\n"),
                    error: outcome.status === "success" ? undefined : true,
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: `程序执行失败：${message}`,
                    error: true,
                };
            }
        },
    };
}
