import type { ToolCallRecord } from "../tools/api.ts";

export interface CodeExecutionOutcome {
    timedOut: boolean;
    error: string | null;
    stdout: string;
    returnValue: string;
    toolCalls: ToolCallRecord[];
}

export interface ValidationIssue {
    line: number;
    message: string;
}