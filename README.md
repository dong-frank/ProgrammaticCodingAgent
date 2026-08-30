# programmatic-coding-agent

从零实现的编程智能体。它通过与大语言模型交互，自主读写文件、执行命令，完成编程任务，并提供两种执行模式：Tool Calling 与 Code Mode。Code Mode 下模型不再逐次发起工具调用，而是生成 TypeScript 程序，由本地执行器运行，程序内通过注入的 API 完成文件与命令操作。

## 环境要求

- Node.js 22.18 及以上（原生类型剥离直接运行 TypeScript，无需编译步骤）
- npm

## 安装

```bash
npm install
```

全局安装（可选）：在任意目录直接使用 `pca` 命令，不需要进入本项目目录：

```bash
npm link
```

全局安装后命令入口为 `src/cli/bin.mjs`（注册 tsx 加载器以运行交互界面的 JSX 组件），`--task`、`--workspace` 等参数相对当前工作目录生效；benchmark 任务定义与结果文件始终定位到本项目目录。

## 配置

配置按优先级读取：已导出的环境变量、当前目录 `.env`、用户级 `~/.config/pca/.env`。项目目录开发时复制 `.env.example` 为 `.env`；任意目录全局运行时，把配置写入 `~/.config/pca/.env`：

```bash
cp .env.example .env
mkdir -p ~/.config/pca && cp .env.example ~/.config/pca/.env
```

| 环境变量 | 说明 |
| --- | --- |
| `PCA_BASE_URL` | OpenAI 兼容接口地址，需包含 API 版本前缀，例如 `https://opencode.ai/zen/go/v1` |
| `PCA_MODEL` | 模型名称 |
| `PCA_API_KEY` | API key |
| `PCA_SESSION_DIR` | 可选，会话存储目录，默认 `~/.pca/sessions` |

`.env` 已加入 `.gitignore`，凭据不会进入仓库。

## 运行

命令名 `pca` 在项目内通过 `package.json` 的 `bin` 字段声明。未全局安装时，实际运行入口是 `npm start`（等价于 `node src/cli/index.ts`），`npm start -- <参数>` 把参数传给程序。若执行 `npm link` 或 `npm install -g .` 全局安装后，则可以直接使用 `pca <参数>`。

### 一次性执行

```bash
npm start -- "修复 demo.js 中的 add 函数，使它通过 check.js 的测试" --mode tool --workspace .workspace/demo
```

### 交互模式（TUI）

```bash
npm start
```

启动后进入基于 ink 的终端界面：顶部状态栏（模式、会话、模型、工作目录），中部为对话与过程消息流（任务、轮次、工具调用、结果、模型回复），底部为输入行。执行长篇任务时，运行中输入的任务会排队，完成后依次执行。执行 `/quit` 或 `/exit` 时保存会话并退出；Ctrl+C 直接退出（不保存，普通退出请用 `/quit`）。交互模式需要 TTY 终端。

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

模型可见的唯一工具是 `exec_code`：每次把完整的 TypeScript 异步函数体作为 `code` 参数提交。本地执行器对代码做类型剥离与语法检查后，在受限执行环境中注入 `tools.readFile`、`tools.writeFile`、`tools.editFile`、`tools.shell`、`tools.glob`（无需 import，支持 await），程序完成后返回标准输出、返回值、程序内工具调用记录与错误信息，模型据此迭代。

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

```bash
npm start -- benchmark                          # 全部任务 × 两种模式
npm start -- benchmark --task single-func-fix   # 只运行指定任务
npm start -- benchmark --mode tool              # 只运行指定模式（tool / code / all）
npm start -- benchmark --reset                  # 只重建任务初始工作区，不运行实验
```

任务定义位于 `benchmark/tasks/<任务 id>/`：`task.json` 提供任务描述与初始文件，`verify.py` 是独立验收脚本。每次运行自动重建隔离工作区（`.workspace/benchmark/`），保证两种模式从同一初始状态开始；运行后按任务对比两种模式的模型调用、工具调用、错误恢复次数、Token、端到端与模型 API 耗时，结果保存到 `benchmark/results/`。

## 架构文档

设计文档位于 `.dsh/docs/architecture.md`。
