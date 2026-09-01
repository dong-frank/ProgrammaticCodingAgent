declare module "marked-terminal" {
    import type { Renderer as MarkedRenderer } from "marked";

    interface TerminalRendererOptions {
        width?: number;
    }

    class TerminalRenderer extends MarkedRenderer {
        constructor(options?: TerminalRendererOptions);
    }

    export function markedTerminal(options?: TerminalRendererOptions): TerminalRenderer;
    export default TerminalRenderer;
}
