import type { ModeConfig } from "./types.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { execCodeTool } from "../tools/exec-code.ts";
import { buildCodeSystemPrompt } from "../agent/system-prompt.ts";
import { CodeProgramSession } from "../executor/code-session.ts";

export function createCodeModeConfig(): ModeConfig {
    const registry = new ToolRegistry();
    registry.register(execCodeTool(new CodeProgramSession()));
    return {
        registry,
        systemPrompt: (workspace) => buildCodeSystemPrompt(workspace, registry.listNames()),
    };
}
