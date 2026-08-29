import type { ToolDefinition } from "./types.ts";
import { executeAgentProgram } from "../executor/code-executor.ts";
import { CodeProgramSession, type ProgramEdit } from "../executor/code-session.ts";

export function execCodeTool(session: CodeProgramSession): ToolDefinition {
    return {
        name: "exec_code",
        description:
            "执行一段 TypeScript 程序。程序内可直接使用全局异步函数（无需 import，支持 await 与顶层 await），所有函数的参数都是参数对象，字段与工具参数一致：readFile({ path }) 返回文件内容字符串，writeFile({ path, content }) 写入文件，editFile({ path, old_string, new_string, replace_all }) 做原文替换，shell({ command }) 执行命令并返回 { ok, stdout, stderr, exitCode, timedOut }，glob({ pattern, ignore }) 返回匹配路径数组（ignore 为要排除的模式列表）。程序会先经过语法与类型验证，验证失败会返回具体错误。程序完成后只回传标准输出、返回值与错误信息——用 console.log 输出需要确认的关键信息（如读取到的内容、处理进展与结果），也可以用 return 返回结果值，靠这些输出来判断执行是否正确。对于 shell 返回的 ok 为 false 的结果，必须结合 exitCode、stdout 和 stderr 判断命令失败原因。",
        parameters: {
            type: "object",
            properties: {
                action: { type: "string", enum: ["create", "edit", "read", "run"], description: "程序操作" },
                code: { type: "string", description: "create 操作使用的完整 TypeScript 程序源码" },
                baseRevision: { type: "number", description: "edit 操作基于的程序版本" },
                edits: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            old_string: { type: "string" },
                            new_string: { type: "string" },
                            replace_all: { type: "boolean" },
                        },
                        required: ["old_string", "new_string"],
                        additionalProperties: false,
                    },
                    description: "edit 操作使用的增量文本修改列表",
                },
                startLine: { type: "number", description: "read 操作的起始行号" },
                endLine: { type: "number", description: "read 操作的结束行号" },
            },
            required: [],
            additionalProperties: false,
        },
        async execute(args, ctx) {
            const action = args.action === undefined ? (typeof args.code === "string" ? "create" : "run") : args.action;
            if (typeof action !== "string" || !["create", "edit", "read", "run"].includes(action)) {
                throw new Error("exec_code 参数 action 必须是 create、edit、read 或 run");
            }
            let revision = session.getRevision();
            if (action === "create") {
                if (typeof args.code !== "string" || args.code.length === 0) {
                    throw new Error("create 操作需要非空 code");
                }
                revision = session.create(args.code);
            } else if (action === "edit") {
                if (!Number.isInteger(args.baseRevision) || !Array.isArray(args.edits) || args.edits.length === 0) {
                    throw new Error("edit 操作需要整数 baseRevision 和非空 edits");
                }
                revision = session.edit(args.edits as ProgramEdit[], args.baseRevision as number);
            } else if (action === "read") {
                const source = session.getSource();
                const lines = source.split("\n");
                const start = args.startLine === undefined ? 1 : args.startLine;
                const end = args.endLine === undefined ? lines.length : args.endLine;
                if (
                    typeof start !== "number" ||
                    typeof end !== "number" ||
                    !Number.isInteger(start) ||
                    !Number.isInteger(end) ||
                    start < 1 ||
                    end < start
                ) {
                    throw new Error("read 操作的 startLine 与 endLine 必须是有效行号");
                }
                return { content: `程序版本：${revision}\n${lines.slice(start - 1, end).join("\n")}` };
            }

            const outcome = await executeAgentProgram(session.getSource(), ctx.cwd, ctx.restrictToWorkspace);

            const lines: string[] = [];
            const statusText = {
                success: "正常",
                "validation-error": "验证失败",
                "runtime-error": "异常",
                "command-error": "命令失败",
                timeout: "超时",
            }[outcome.status];
            lines.push(`程序版本：${revision}`);
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
        },
    };
}
