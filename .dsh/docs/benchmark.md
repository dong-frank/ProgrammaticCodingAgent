# Benchmark 场景设计

## 一、目标

通过一组真实编程任务，在控制变量下对比 Tool Calling 与 Code Mode 两种执行模式的表现，为后续调整 agent 行为提供量化基准。对比结果用于回答：Code Mode 在哪些任务类型上有优势、哪些任务上不如 Tool Calling。

## 二、控制变量

- 模型：同一模型
- 任务：同一任务的初始工作区内容完全一致
- 工具集合：两种模式共用的底层实现一致（Tool 模式暴露四个工具，Code 模式暴露 exec_code，exec_code 内部注入同一套 API）
- 循环上限：同一 max-rounds
- 工作目录：每次运行使用隔离目录，初始内容逐字节相同

自变量：执行模式（tool / code）。

## 三、任务集

任务定义在 `benchmark/tasks/<任务 id>/` 下，每任务两个文件：

- `task.json`：任务 id、描述文本、初始文件内容、验收命令模板、超时、建议轮次上限
- `verify.mjs`：验收脚本，位于 benchmark 侧，接收 workspace 路径参数，import 工作区产物做行为断言，全部断言通过退出码 0

验证脚本独立于 agent 工作区（工作区不包含验收脚本），模型无法通过读文件获知验收细节。任务描述中给出行为规格，模型靠规格与自身判断完成任务。

### 任务清单

| 任务 id | 类型 | 描述 | 场景特征 |
| --- | --- | --- | --- |
| single-func-fix | 单函数修复 | 修复 add 实现的符号错误 | 单点操作，两种模式差异小 |
| queue-impl | 数据结构实现 | 按规格实现先进先出队列 | 状态与边界逻辑 |
| refactor-legacy | 跨文件批量重构 | 替换旧接口调用并删除旧定义 | 批量一致性修改，循环遍历优势区 |
| batch-file-transform | 批量文件转换 | 遍历 8 个数据文件生成派生 JSON | 循环读取与条件判断，单程序聚合，Code Mode 优势显著区 |
| csv-parser | 规格实现 | 按规则实现 CSV 解析 | 复杂循环与条件分支的确定性逻辑 |
| calculator-scaffold | 脚手架生成 | 从空目录生成计算器模块 | 多文件一次性生成 |

### 场景特征与模式优势

Code Mode 的优势机制：循环、条件分支、数据聚合在程序内以确定性代码执行，不消耗模型推理轮次，也不需要模型逐次发起工具往返。据此把任务按场景特征分层：

- 循环遍历与批量操作（refactor-legacy、batch-file-transform）：Code Mode 一个程序完成批量读取、判断与写入；Tool 模式需逐文件发起调用，一次任务产生大量往返
- 确定性逻辑实现（csv-parser、queue-impl）：复杂解析与状态逻辑用代码实现并验证，程序内迭代调试；Tool 模式需要依赖 shell 运行临时脚本辅助验证
- 多文件生成（calculator-scaffold）：一次性程序写入全部文件；Tool 模式逐文件写
- 单点修复（single-func-fix）：两种模式路径接近，作为基线对照

该分层用于观察 Code Mode 的优势是否随"循环/批量/确定性逻辑"占比上升而扩大。

### 任务详细定义

#### single-func-fix

任务描述：修复 src/math.js 中的 add 函数：它应接收两个数字参数并返回它们的和。

初始文件：src/math.js 中含错误实现（返回差值）。

验收断言：add(2, 3) === 5、add(-1, 1) === 0、add(0, 0) === 0。

#### queue-impl

任务描述：src/queue.js 中的队列实现有缺陷。实现先进先出队列：enqueue(value) 入队，dequeue() 出队并返回队首元素（空队列返回 undefined），peek() 查看队首不删除，size 属性返回元素数量。

初始文件：src/queue.js 中含错误实现（出队顺序错乱）。

验收断言：入队出队顺序、空队列行为、peek 与 size 语义。

#### refactor-legacy

任务描述：项目中有三个文件调用旧接口 legacyCalc（定义在 src/legacy.js）。实现 src/calc.js 中的 calc 函数（两数相加），把所有对 legacyCalc 的调用改为 calc，并删除 src/legacy.js。完成后项目不应再引用 legacyCalc。

初始文件：src/calc.js（错误实现）、src/legacy.js（旧接口定义）、src/use-a.js、src/use-b.js、src/use-c.js（均 import 并调用 legacyCalc）。

验收断言：三个使用文件不再引用 legacyCalc，且调用结果语义正确（require/import 全部指向 calc.js）。

#### csv-parser

任务描述：实现 src/csv.js 中的 parseCsv(text)：解析 CSV 文本为二维字符串数组。规则：普通字段用逗号分隔；双引号包裹的字段内可包含逗号、换行与双引号，字段内双引号用两个连续双引号表示转义。

初始文件：src/csv.js 中实现抛出"尚未实现"。

验收断言：基本逗号分隔、引号内含逗号、引号内含换行、转义双引号、空字段。

#### batch-file-transform

任务描述：src/data/ 下有 8 个文本文件，每行一个条目，格式为 名称,分数。为每个文件生成同名 .meta.json，内容为 {name, score, passed}，passed 为分数大于等于 60 时 true。读取全部文件后批量生成，不要修改原文件。

初始文件：src/data/a.txt 至 h.txt，含不同分数（部分低于 60）。

验收断言：8 个同名 .meta.json 均存在且内容与预期严格一致；原文本文件未被修改。

#### calculator-scaffold

任务描述：在项目根目录搭建计算器模块：新建 src/calculator.js，导出 add、subtract、multiply、divide 四个函数，divide 除数为 0 时抛出错误；新建 package.json 声明 type 为 module。不要创建测试文件。

初始文件：空工作区。

验收断言：四个函数行为、除零抛错、src/calculator.js 存在且可正常 import（ESM）。

### 扩展方式

新增任务时在 `benchmark/tasks/` 下新建目录，按上述结构提供 task.json 与 verify.mjs。任务应满足三点：初始工作区内容完全确定、验收依赖行为断言（不依赖运行次数或随机性）、难度与现有任务可区分。

## 四、指标口径

每次运行（一个任务、一种模式）记录以下指标：

| 指标 | 口径 |
| --- | --- |
| success | 验收命令退出码为 0 |
| llmCalls | 调用模型接口的次数 |
| toolCalls | 工具执行次数（Code 模式即 exec_code 次数） |
| errorRecoveryEvents | 出现错误结果后模型继续尝试的轮次数。错误结果指执行器级失败：程序运行异常或超时、文件读写失败；命令退出码非零不属于错误结果 |
| promptTokens | 累计输入 token |
| completionTokens | 累计输出 token |
| totalTokens | 累计总 token |
| durationMs | 端到端耗时（任务开始到结束） |
| apiDurationMs | 模型 API 耗时累计（不含工具执行与等待） |

错误恢复指标的实现依赖工具结果携带错误标记：工具返回结构增加 `error` 布尔字段，执行器失败时置为真；shell 退出码非零不置位。

## 五、运行流程

1. 为任务创建隔离工作目录（`.workspace/benchmark/<任务 id>/<模式>/`），写入初始文件
2. 按指定模式运行 agent，携带最大轮次与超时
3. 运行验收命令：`node <任务目录>/verify.mjs <工作目录>`，退出码 0 判定成功
4. 汇总指标写入结果文件

结果文件为 JSON，格式：

```json
{
  "taskId": "single-func-fix",
  "mode": "code",
  "success": true,
  "llmCalls": 3,
  "toolCalls": 2,
  "errorRecoveryEvents": 0,
  "promptTokens": 2580,
  "completionTokens": 359,
  "totalTokens": 2939,
  "durationMs": 7370,
  "apiDurationMs": 5120
}
```

汇总报告按任务对比两种模式，输出成功与否、调用次数、token、耗时，并标记每种任务上更优的模式。

## 六、与架构文档的关系

本设计是架构文档第八节对照实验设计的落地细化：控制变量与自变量定义一致，任务集与指标口径在此具体化。实现位置对应 `src/benchmark/`（task、runner、metrics、report）与 `benchmark/tasks/`（任务定义）。