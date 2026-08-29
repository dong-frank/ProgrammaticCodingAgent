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
        "create 的 code 是完整 Agent Program；edit 的 old_string 和 new_string 必须匹配并修改 Agent Program 本身，不要填写任务文件内容。edit 必须携带上次返回的 baseRevision。",
        "Code Mode 程序是异步函数体，只能通过 tools 对象调用 API：tools.readFile、tools.writeFile、tools.editFile、tools.shell、tools.glob。程序不支持 import 或动态 import；需要加载工作区源码时，请使用 tools.readFile，需要运行测试时，请使用 tools.shell。",
        "使用 tools.writeFile 写入源码时，content 会按原样写入。若目标源码包含 \\n、\\r、\\t 等反斜杠转义，请使用 String.raw`...` 构造 content；写入后请使用 tools.readFile 读取关键片段，确认文件中的反斜杠仍然存在。",
        "只能访问当前工作目录内部的文件，使用相对路径；不要访问工作目录的父级目录。",
        "程序内不要使用 import 或动态 import，支持 await 与顶层 await，可用 return 返回结果值。tools.shell 返回 ok、stdout、stderr、exitCode 和 timedOut；当 ok 为 false 时，必须检查 exitCode、stdout 和 stderr。",
        "程序会先经过语法与类型验证，验证失败会返回带行号的具体错误，请使用 read 查看当前程序后通过 edit 增量修复。",
        "程序执行后只回传标准输出与返回值，请在程序内用 console.log 输出需要确认的关键信息（如读取到的内容、处理进展与结果），根据这些输出决定继续修改程序还是完成任务。",
        "任务完成后，用简洁的中文总结你做了什么。",
    ].join("\n");
}
