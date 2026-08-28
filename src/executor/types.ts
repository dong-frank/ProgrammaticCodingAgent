export interface CodeExecutionOutcome {
    timedOut: boolean;
    error: string | null;
    stdout: string;
    returnValue: string;
}

export interface ValidationIssue {
    line: number;
    message: string;
}