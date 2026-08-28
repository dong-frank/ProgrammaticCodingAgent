import ts from "typescript";
import { renderAgentApiDeclarations } from "../tools/api-schema.ts";
import type { ValidationIssue } from "./types.ts";

// 声明文本由 API schema 模块生成；程序源码在声明之后、函数体包装之内，诊断行号需减去此前缀行数
const DECLARATIONS = renderAgentApiDeclarations();
const FUNCTION_OPEN = "export async function __agent_main__(): Promise<unknown> {";
const DECLARATION_OFFSET = DECLARATIONS.split("\n").length + 3;

export function validateAgentProgram(code: string): ValidationIssue[] {
    const fileName = "agent-program.ts";
    // 与执行层一致：代码包进 async 函数体检查，因此支持顶层 await 与顶层 return
    const content = `${DECLARATIONS}\n\n${FUNCTION_OPEN}\n${code}\n}`;

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