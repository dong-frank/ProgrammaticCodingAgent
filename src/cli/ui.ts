import pc from "picocolors";
import type { AgentObserver } from "../agent/agent-loop.ts";
import type { AgentMetrics } from "../agent/agent-loop.ts";

const MAX_ARG_VALUE_CHARS = 60;
const MAX_RESULT_CHARS = 1_000;

export function formatArgs(rawArguments: string): string {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    } catch {
        return rawArguments.length > MAX_ARG_VALUE_CHARS ? `${rawArguments.slice(0, MAX_ARG_VALUE_CHARS)}…` : rawArguments;
    }
    const parts = Object.entries(parsed).map(([key, value]) => {
        let text: string;
        if (typeof value === "string") {
            text = `"${value}"`;
        } else {
            try {
                text = JSON.stringify(value);
            } catch {
                text = String(value);
            }
        }
        if (text.length > MAX_ARG_VALUE_CHARS) {
            text = `${text.slice(0, MAX_ARG_VALUE_CHARS)}…`;
        }
        return `${key}: ${text}`;
    });
    return parts.join(", ");
}

export function banner(params: { mode: string; model: string; workspace: string }): string {
    const lines = [
        pc.bold("programmatic-coding-agent") + pc.dim(` v0.1.0`),
        `${pc.dim("模式")} ${params.mode}  ${pc.dim("模型")} ${params.model}`,
        `${pc.dim("工作目录")} ${params.workspace}`,
        pc.dim("输入任务开始执行，/help 查看命令，Ctrl+C 退出"),
    ];
    return lines.join("\n");
}

export function roundHeader(round: number, maxRounds: number): string {
    return pc.bold(pc.cyan(`[轮次 ${round}/${maxRounds}]`));
}

export function modelText(content: string): string {
    return `${pc.dim("模型")} ${content}`;
}

export function toolCall(name: string, rawArguments: string): string {
    return `${pc.cyan("→ 工具")} ${pc.bold(name)}(${formatArgs(rawArguments)})`;
}

export function toolResult(content: string): string {
    let text = content;
    if (text.length > MAX_RESULT_CHARS) {
        text = `${text.slice(0, MAX_RESULT_CHARS)}\n[结果已截断]`;
    }
    return `${pc.dim("← 结果")}\n${pc.dim(text)}`;
}

export function taskDone(finalMessage: string, metrics: AgentMetrics, durationText: string): string {
    const lines = [
        pc.green(pc.bold("任务完成")),
        finalMessage,
        pc.dim(
            `模型调用 ${metrics.llmCalls} 次 · 工具调用 ${metrics.toolCalls} 次 · token ${metrics.totalTokens} · 耗时 ${durationText}`,
        ),
    ];
    return lines.join("\n");
}

export function maxRoundsReached(metrics: AgentMetrics, durationText: string): string {
    return pc.yellow(
        `达到最大轮次未能完成 · 模型调用 ${metrics.llmCalls} 次 · 工具调用 ${metrics.toolCalls} 次 · token ${metrics.totalTokens} · 耗时 ${durationText}`,
    );
}

export function errorText(message: string): string {
    return pc.red(pc.bold(`运行失败：${message}`));
}

export function helpText(currentMode: string): string {
    return [
        pc.bold("可用命令"),
        pc.cyan("/help") + pc.dim("          显示本帮助"),
        pc.cyan("/mode") + pc.dim("          显示当前模式"),
        pc.cyan("/mode tool") + pc.dim("    切换为 Tool Calling 模式"),
        pc.cyan("/mode code") + pc.dim("    切换为 Code Mode"),
        pc.cyan("/quit") + pc.dim("         退出（等价 /exit）"),
        "",
        pc.dim(`当前模式：${currentMode}`),
    ].join("\n");
}

export function createAgentObserver(log: (text: string) => void): AgentObserver {
    return {
        onRoundStart(round, maxRounds) {
            log(roundHeader(round, maxRounds));
        },
        onModelText(content) {
            log(modelText(content));
        },
        onToolCall(name, rawArguments) {
            log(toolCall(name, rawArguments));
        },
        onToolResult(content) {
            log(toolResult(content));
        },
    };
}