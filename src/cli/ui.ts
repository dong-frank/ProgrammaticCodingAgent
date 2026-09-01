import pc from "picocolors";
import type { AgentObserver } from "../agent/agent-loop.ts";

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

export function roundHeader(round: number, maxRounds: number): string {
    return pc.bold(pc.cyan(`[轮次 ${round}/${maxRounds}]`));
}

export function modelText(content: string): string {
    return `${pc.dim("模型")} ${content}`;
}

export function reasoningSummary(content: string): string {
    return `${pc.magenta("思考摘要")} ${content}`;
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

export function errorText(message: string): string {
    return pc.red(pc.bold(`运行失败：${message}`));
}

export function createAgentObserver(log: (text: string) => void): AgentObserver {
    return {
        onRoundStart(round, maxRounds) {
            log(roundHeader(round, maxRounds));
        },
        onReasoningSummary(content) {
            log(reasoningSummary(content));
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
