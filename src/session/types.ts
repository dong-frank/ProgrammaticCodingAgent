import type { ChatMessage } from "../llm/types.ts";
import type { Mode } from "../modes/types.ts";

export interface SessionRecord {
    id: string;
    createdAt: string;
    updatedAt: string;
    workspace: string;
    mode: Mode;
    model: string;
    messages: ChatMessage[];
}