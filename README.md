# programmatic-coding-agent

从零实现的编程智能体。它通过与大语言模型交互，自主读写文件、执行命令，完成编程任务，并提供两种执行模式：Tool Calling 与 Code Mode。Code Mode 下模型不再逐次发起工具调用，而是生成 TypeScript 程序，由本地执行器运行，程序内通过注入的 API 完成文件与命令操作。

## 环境要求

- Node.js 22.18 及以上（原生类型剥离直接运行 TypeScript，无需编译步骤）
- npm

## 安装

```bash
npm install
```

## 配置

复制 `.env.example` 为 `.env`，填入接口地址、模型名称与 API key：

```bash
cp .env.example .env
```

| 环境变量 | 说明 |
| --- | --- |
| `PCA_BASE_URL` | OpenAI 兼容接口地址，需包含 API 版本前缀，例如 `https://opencode.ai/zen/go/v1` |
| `PCA_MODEL` | 模型名称 |
| `PCA_API_KEY` | API key |
| `PCA_SESSION_DIR` | 可选，会话存储目录，默认 `~/.pca/sessions` |

`.env` 已加入 `.gitignore`，凭据不会进入仓库。

## 运行

### 一次性执行

```bash
npm start -- "修复 demo.js 中的 add 函数，使它通过 check.js 的测试" --mode tool --workspace .workspace/demo
```

### 交互模式

```bash
npm start
```

启动后输入任务逐轮对话，输入流关闭或执行 `/quit` 时自动保存会话。过程中默认实时显示轮次、工具调用与结果，`-q` 关闭过程日志。

### 交互命令

| 命令 | 说明 |
| --- | --- |
| `/help` | 显示帮助 |
| `/sessions` | 列出已保存的会话 |
| `/session <id>` | 切换并恢复指定会话 |
| `/new` | 保存当前会话并开始新会话 |
| `/mode` | 显示当前模式 |
| `/mode tool` 或 `/mode code` | 切换执行模式 |
| `/quit` 或 `/exit` | 退出 |

### 参数

| 参数 | 说明 |
| --- | --- |
| `-m, --mode <mode>` | 执行模式：`tool` 或 `code`，默认 `code` |
| `-r, --max-rounds <rounds>` | 最大循环轮次，默认 50 |
| `--model <model>` | 模型名称，覆盖 `PCA_MODEL` |
| `-w, --workspace <path>` | 工作目录，默认当前目录 |
| `-q, --quiet` | 只输出结果，不显示过程日志 |
| `--session <id>` | 恢复指定会话继续执行 |

## 执行模式

两种模式共用同一套工具底层实现与 Agent 主循环，差异只在动作表达方式。

### Tool Calling 模式（`--mode tool`）

模型按需逐次发起工具调用，工具集为 `read_file`、`write_file`、`shell`、`glob`，每次调用结果回填对话后模型决定下一步。

### Code Mode（`--mode code`）

模型可见的唯一工具是 `exec_code`：把解决问题的 TypeScript 程序作为参数整体提交。本地执行器对代码做类型剥离与语法检查后，在受限执行环境中注入全局异步函数 `readFile`、`writeFile`、`shell`、`glob`（无需 import，支持 await），程序完成后返回标准输出、返回值、程序内工具调用记录与错误信息，模型据此迭代。

## 会话

每次交互运行归属一个会话。会话记录工作目录、模式、模型与完整消息历史，退出时保存，可用 `--session <id>` 或 `/session <id>` 恢复，恢复后上下文延续（模型能记住此前轮次的对话）。

## 目录结构

```text
src/
├── cli/        命令行入口、交互循环、渲染
├── agent/      Agent 主循环、上下文管理、系统提示词
├── modes/      两种模式的配置工厂（工具注册表与提示词）
├── tools/      工具实现、注入 API、exec_code 执行器
├── llm/        OpenAI 兼容客户端
└── session/    会话持久化与存储
```

## 对照实验

`pca benchmark` 用于运行 Tool Calling 与 Code Mode 的对照实验（测量模型调用次数、工具调用次数、token、耗时、成功率），当前处于开发中。

## 架构文档

设计文档位于 `.dsh/docs/architecture.md`。