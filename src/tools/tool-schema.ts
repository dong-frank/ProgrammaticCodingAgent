import type { ToolDefinition } from "./types.ts";

interface ParameterSchema {
    type?: string;
    items?: { type?: string };
}

function formatToolSignature(tool: ToolDefinition): string {
    const schema = tool.parameters as
        | { properties?: Record<string, ParameterSchema>; required?: string[] }
        | undefined;
    const required = new Set(schema?.required ?? []);
    const args = Object.entries(schema?.properties ?? {}).map(([name, prop]) => {
        const optional = required.has(name) ? "" : "?";
        const type = prop.type === "array" ? "string[]" : (prop.type ?? "unknown");
        return `${name}${optional}: ${type}`;
    });
    return `${tool.name}(${args.join(", ")})`;
}

export function renderToolUsageGuide(tools: ToolDefinition[]): string {
    return tools.map((tool) => `- ${formatToolSignature(tool)}：${tool.description}`).join("\n");
}