import type { ToolDefinition } from "./types.ts";
import { executeAgentProgram } from "../executor/code-executor.ts";
import { CodeProgramSession, type ProgramEdit } from "../executor/code-session.ts";

export function execCodeTool(session: CodeProgramSession): ToolDefinition {
    return {
        name: "exec_code",
        description:
            "执行一段 TypeScript 异步函数体。程序内通过全局 tools 对象调用 API（无需 import，支持 await 与顶层 await）：tools.readFile({ path }) 返回文件内容字符串，tools.writeFile({ path, content }) 写入文件，tools.editFile({ path, old_string, new_string, replace_all }) 做原文替换，tools.shell({ command }) 执行命令并返回 { ok, stdout, stderr, exitCode, timedOut }，tools.glob({ pattern, ignore }) 返回匹配路径数组。程序不支持 import 或动态 import；程序会先进行语法检查和类型擦除，验证失败会返回具体错误。程序完成后只回传标准输出、返回值与错误信息。对于 tools.shell 返回的 ok 为 false 的结果，必须结合 exitCode、stdout 和 stderr 判断命令失败原因。",
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
            try {
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
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    content: `程序操作失败（当前版本：${session.getRevision()}）：${message}\n请使用 read 查看当前 Agent Program 后再使用 edit。`,
                    error: true,
                };
            }
        },
    };
}
