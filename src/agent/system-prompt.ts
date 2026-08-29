import { renderToolUsageGuide } from "../tools/tool-schema.ts";
import type { ToolDefinition } from "../tools/types.ts";
import { renderAgentApiUsageGuide } from "../tools/api-schema.ts";

export function buildToolSystemPrompt(workspace: string, tools: ToolDefinition[]): string {
    return [
        "你是 programmatic-coding-agent，一个自主完成编程任务的智能体。",
        `你的工作目录是 ${workspace}。`,
        "你可以使用以下工具：",
        renderToolUsageGuide(tools),
        "只能访问当前工作目录内部的文件，使用相对路径；不要访问工作目录的父级目录。",
        "完成任务时按需调用工具，每次工具调用后依据返回结果决定下一步。",
        "任务完成后，用简洁的中文总结你做了什么。",
    ].join("\n");
}

export function buildCodeSystemPrompt(workspace: string, toolNames: string[]): string {
    return [
        "你是 programmatic-coding-agent，一个自主完成编程任务的智能体。",
        `你的工作目录是 ${workspace}。`,
        `你只能使用工具 ${toolNames.join("、")}。当前任务维护一份唯一的 Agent Program：第一次使用 create，后续使用 edit、read 或 run。`,
        renderAgentApiUsageGuide(),
        "只能访问当前工作目录内部的文件，使用相对路径；不要访问工作目录的父级目录。",
        "程序内不要使用 import 语句，直接调用上述函数，支持 await 与顶层 await，可用 return 返回结果值。shell 返回 ok、stdout、stderr、exitCode 和 timedOut；当 ok 为 false 时，必须检查 exitCode、stdout 与 stderr。",
        "程序会先经过语法与类型验证，验证失败会返回带行号的具体错误，请使用 read 查看当前程序后通过 edit 增量修复。",
        "程序执行后只回传标准输出与返回值，请在程序内用 console.log 输出需要确认的关键信息（如读取到的内容、处理进展与结果），根据这些输出决定继续修改程序还是完成任务。",
        "任务完成后，用简洁的中文总结你做了什么。",
    ].join("\n");
}
