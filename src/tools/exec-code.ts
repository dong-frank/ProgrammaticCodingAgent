import type { ToolDefinition } from "./types.ts";
import { executeAgentProgram } from "../executor/code-executor.ts";

export function execCodeTool(): ToolDefinition {
    return {
        name: "exec_code",
        description:
            "执行一段 TypeScript 程序。程序内可直接使用全局异步函数（无需 import，支持 await 与顶层 await），所有函数的参数都是参数对象，字段与工具参数一致：readFile({ path }) 返回文件内容字符串，writeFile({ path, content }) 写入文件，editFile({ path, old_string, new_string, replace_all }) 做原文替换，shell({ command }) 执行命令并返回 { stdout, stderr, exitCode, timedOut }，glob({ pattern, ignore }) 返回匹配路径数组（ignore 为要排除的模式列表）。程序会先经过语法与类型验证，验证失败会返回具体错误。程序完成后只回传标准输出、返回值与错误信息——请在程序内用 console.log 输出需要确认的关键信息（如读取到的内容、处理进展与结果），靠这些输出来判断执行是否正确。",
        parameters: {
            type: "object",
            properties: {
                code: { type: "string", description: "要执行的 TypeScript 程序源码，不要包含 import 语句" },
            },
            required: ["code"],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const code = args.code;
            if (typeof code !== "string" || code.length === 0) {
                throw new Error("exec_code 参数 code 必须是非空字符串");
            }
            const outcome = await executeAgentProgram(code, ctx.cwd);

            const lines: string[] = [];
            if (outcome.timedOut) {
                lines.push("程序状态：超时");
            } else if (outcome.error !== null) {
                lines.push("程序状态：异常");
            } else {
                lines.push("程序状态：正常");
            }
            if (outcome.stdout.length > 0) {
                lines.push(`标准输出：\n${outcome.stdout}`);
            }
            lines.push(`返回值：${outcome.returnValue}`);
            if (outcome.error !== null) {
                lines.push(`错误信息：\n${outcome.error}`);
            }
            return {
                content: lines.join("\n"),
                error: outcome.timedOut || outcome.error !== null ? true : undefined,
            };
        },
    };
}