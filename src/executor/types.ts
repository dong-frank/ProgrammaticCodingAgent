export type ExecutionStatus = "success" | "validation-error" | "runtime-error" | "command-error" | "timeout";

export interface CodeExecutionOutcome {
    status: ExecutionStatus;
    error: string | null;
    stdout: string;
    stderr: string;
    returnValue: string;
}

export interface ValidationIssue {
    line: number;
    message: string;
}
