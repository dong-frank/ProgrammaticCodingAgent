import type { ToolDefinition } from "./types.ts";
import { executeAgentProgram } from "../executor/code-executor.ts";

const MAX_TOOL_CALL_RECORDS = 30;

export function execCodeTool(): ToolDefinition {
    return {
        name: "exec_code",
        description:
            "执行一段 TypeScript 程序。程序内可直接使用全局异步函数：readFile(path) 返回文件内容字符串，writeFile(path, content) 写入文件，shell(command) 执行命令并返回 {stdout, stderr, exitCode, timedOut}，glob(pattern, ignore?) 返回匹配路径数组（ignore 为要排除的模式列表，例如排除依赖目录时传 [\"**/node_modules/**\", \"**/.git/**\"]）。无需 import，支持 await 与顶层 await。程序会先经过语法与类型验证，验证失败会返回具体错误。程序完成后返回标准输出、返回值、程序内工具调用记录与错误信息。",
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

            const totalCalls = outcome.toolCalls.length;
            if (totalCalls > 0) {
                const shown = outcome.toolCalls.slice(0, MAX_TOOL_CALL_RECORDS);
                const rows = shown.map((call) => `- ${call.name}：${call.summary}`);
                if (totalCalls > MAX_TOOL_CALL_RECORDS) {
                    rows.push(`- …… 其余 ${totalCalls - MAX_TOOL_CALL_RECORDS} 条省略，共 ${totalCalls} 条`);
                }
                lines.push(`程序内工具调用：\n${rows.join("\n")}`);
            } else {
                lines.push("程序内工具调用：无");
            }
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