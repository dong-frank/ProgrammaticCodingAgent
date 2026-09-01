# programmatic-coding-agent

Git 仓库：https://github.com/dong-frank/ProgrammaticCodingAgent

## 运行

```bash
npm install
cp .env.example .env
npm start
```

在 `.env` 中配置 `PCA_BASE_URL`、`PCA_MODEL` 和 `PCA_API_KEY`。启动后进入 TUI，在输入框中输入任务；`/mode` 切换模式，`/exit` 保存并退出。

运行 benchmark：

```bash
pca benchmark
```


## Code Mode 与 PTC

项目重点实践 Programmatic Tool Calling（PTC）。Code Mode 下，模型只调用 `exec_code`，将文件操作、批量处理和测试验证组织成 TypeScript 异步程序。程序由本地 Worker 执行，运行前进行语法检查和类型擦除，再通过注入的 `tools.*` API 操作工作区，结果返回模型继续处理。

Tool Calling 模式逐次调用同一套底层工具，作为对照基线。两种模式都限制在指定工作目录内，并支持会话保存、上下文压缩和流式显示。

## Benchmark 结果

结果文件：[benchmark-2026-09-01T09-19-17.783Z.json](benchmark/results/benchmark-2026-09-01T09-19-17.783Z.json)。

| 任务 | Tool Calling | Code Mode | 验收 |
| --- | ---: | ---: | --- |
| `batch-file-transform` | 3 次模型调用 · 4,712 Token | 4 次模型调用 · 8,700 Token | 通过 |
| `calculator-scaffold` | 4 次模型调用 · 6,373 Token | 2 次模型调用 · 3,419 Token | 通过 |
| `csv-parser` | 6 次模型调用 · 13,981 Token | 4 次模型调用 · 9,955 Token | 通过 |
| `queue-impl` | 4 次模型调用 · 6,778 Token | 3 次模型调用 · 5,374 Token | 通过 |
| `refactor-legacy` | 5 次模型调用 · 9,057 Token | 4 次模型调用 · 7,745 Token | 通过 |
| `single-func-fix` | 4 次模型调用 · 5,433 Token | 3 次模型调用 · 4,493 Token | 通过 |
| **合计** | **26 次 · 46,334 Token** | **20 次 · 39,686 Token** | **12/12 通过** |

## 参考链接

1. [Programmatic tool calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
2. [Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
