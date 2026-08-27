import type { ModeConfig } from "./types.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { execCodeTool } from "../tools/exec-code.ts";
import { buildCodeSystemPrompt } from "../agent/system-prompt.ts";

export function createCodeModeConfig(): ModeConfig {
    const registry = new ToolRegistry();
    registry.register(execCodeTool());
    return {
        registry,
        systemPrompt: (workspace) => buildCodeSystemPrompt(workspace, registry.listNames()),
    };
}