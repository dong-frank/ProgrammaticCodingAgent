import ts from "typescript";
import type { ValidationIssue } from "./types.ts";

const DECLARATIONS = [
    "declare function readFile(path: string): Promise<string>;",
    "declare function writeFile(path: string, content: string): Promise<void>;",
    "declare function shell(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }>;",
    "declare function glob(pattern: string, ignore?: string[]): Promise<string[]>;",
    "declare const console: {",
    "    log(...args: unknown[]): void;",
    "    error(...args: unknown[]): void;",
    "    warn(...args: unknown[]): void;",
    "};",
].join("\n");

// 程序源码紧跟在声明块与空行之后，诊断行号需减去此前缀行数
const DECLARATION_OFFSET = DECLARATIONS.split("\n").length + 2;

export function validateAgentProgram(code: string): ValidationIssue[] {
    const fileName = "agent-program.ts";
    // export {} 使文件成为模块，允许程序使用顶层 await（与运行时行为一致）
    const content = `${DECLARATIONS}\n\n${code}\n\nexport {};`;

    const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.ESNext,
        lib: ["lib.es2023.d.ts"],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
    };

    const host = ts.createCompilerHost(options);
    const virtualSource = ts.createSourceFile(fileName, content, ts.ScriptTarget.ES2023, true);

    const originalGetSourceFile = host.getSourceFile.bind(host);
    const originalFileExists = host.fileExists.bind(host);
    const originalReadFile = host.readFile.bind(host);

    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) => {
        if (name === fileName) {
            return virtualSource;
        }
        return originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    };
    host.fileExists = (name) => (name === fileName ? true : originalFileExists(name));
    host.readFile = (name) => (name === fileName ? content : originalReadFile(name));

    const program = ts.createProgram([fileName], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    const issues: ValidationIssue[] = [];
    for (const diagnostic of diagnostics) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) {
            continue;
        }
        let line = 1;
        if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
            const offsetLine = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1;
            line = Math.max(1, offsetLine - DECLARATION_OFFSET);
        }
        issues.push({
            line,
            message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        });
    }
    return issues;
}