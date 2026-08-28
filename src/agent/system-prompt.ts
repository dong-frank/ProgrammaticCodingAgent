import { renderToolUsageGuide } from "../tools/tool-schema.ts";
import type { ToolDefinition } from "../tools/types.ts";
import { renderAgentApiUsageGuide } from "../tools/api-schema.ts";

export function buildToolSystemPrompt(workspace: string, tools: ToolDefinition[]): string {
    return [
        "你是 programmatic-coding-agent，一个自主完成编程任务的智能体。",
        `你的工作目录是 ${workspace}。`,
        "你可以使用以下工具：",
        renderToolUsageGuide(tools),
        "完成任务时按需调用工具，每次工具调用后依据返回结果决定下一步。",
        "任务完成后，用简洁的中文总结你做了什么。",
    ].join("\n");
}

export function buildCodeSystemPrompt(workspace: string, toolNames: string[]): string {
    return [
        "你是 programmatic-coding-agent，一个自主完成编程任务的智能体。",
        `你的工作目录是 ${workspace}。`,
        `你只能使用工具 ${toolNames.join("、")}：把解决问题的 TypeScript 程序作为该工具的参数一次提交。`,
        renderAgentApiUsageGuide(),
        "程序内不要使用 import 语句，直接调用上述函数，支持 await 与顶层 await。",
        "程序会先经过语法与类型验证，验证失败会返回带行号的具体错误，请据此修复程序后重新提交。",
        "程序执行后只回传标准输出与返回值，请在程序内用 console.log 输出需要确认的关键信息（如读取到的内容、处理进展与结果），根据这些输出决定继续修改程序还是完成任务。",
        "任务完成后，用简洁的中文总结你做了什么。",
    ].join("\n");
}