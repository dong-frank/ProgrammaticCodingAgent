import ts from "typescript";
import type { ValidationIssue } from "./types.ts";

export function validateAgentProgram(code: string): ValidationIssue[] {
    const source = ts.createSourceFile("agent-program.ts", code, ts.ScriptTarget.ES2023, true);
    const issues: ValidationIssue[] = [];

    const visit = (node: ts.Node): void => {
        if (node.kind === ts.SyntaxKind.ImportDeclaration || node.kind === ts.SyntaxKind.ImportEqualsDeclaration) {
            issues.push({
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                message: "Code Mode 程序不支持 import，请使用 tools.readFile 读取文件或使用 tools.shell 执行测试",
            });
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            issues.push({
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                message: "Code Mode 程序不支持动态 import，请使用 tools.readFile 读取文件或使用 tools.shell 执行测试",
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);

    const functionOpen = "async function __agent_main__() {";
    const wrapped = `${functionOpen}\n${code}\n}`;
    const result = ts.transpileModule(wrapped, {
        compilerOptions: {
            module: ts.ModuleKind.None,
            target: ts.ScriptTarget.ES2023,
        },
        reportDiagnostics: true,
    });
    for (const diagnostic of result.diagnostics ?? []) {
        if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
        const line = diagnostic.start === undefined
            ? 1
            : Math.max(1, source.getLineAndCharacterOfPosition(Math.max(0, diagnostic.start - functionOpen.length - 1)).line + 1);
        issues.push({ line, message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n") });
    }
    return issues;
}
