# Syncthing Conflict CLI - 设计文档

**日期：** 2026-05-26
**状态：** 已确认

## 概述

一个 Node.js/TypeScript CLI 工具，用于扫描、交互式解决和自动处理 Syncthing 同步冲突文件。

CLI 命令名：`stc`（syncthing-conflict 缩写）。

## 技术栈

- **语言：** TypeScript (strict 模式)
- **运行时：** Node.js >= 18
- **包管理：** pnpm

### 依赖

| 用途 | 库 | 说明 |
|------|-----|------|
| CLI 框架 | `commander` | 成熟稳定，轻量 |
| 交互提示 | `inquirer` | 丰富的交互组件 |
| Diff 计算 | `diff` | 终端友好的文本 diff |
| 终端颜色 | `chalk` | 日志和 diff 高亮 |
| 文件遍历 | `fast-glob` | 快速递归扫描 |
| 终端表格 | `cli-table3` | scan 结果表格展示 |
| 开发 | `tsx`, `vitest`, `biome` | 开发、测试、格式化 |

## 项目结构

```
syncthing-conflict-cli/
├── src/
│   ├── cli/              # CLI 入口和命令定义
│   │   ├── index.ts      # 主入口，注册子命令
│   │   ├── scan.ts       # scan 命令
│   │   ├── resolve.ts    # resolve 命令
│   │   └── auto.ts       # auto 命令
│   ├── core/
│   │   ├── scanner.ts    # 冲突文件扫描逻辑
│   │   ├── resolver.ts   # 冲突解决逻辑
│   │   └── differ.ts     # Diff 生成逻辑
│   ├── ui/
│   │   ├── prompts.ts    # Inquirer 交互提示
│   │   └── diff-viewer.ts # 终端内 diff 显示
│   └── utils/
│       └── parser.ts     # 解析 .sync-conflict 文件名，提取元信息
└── package.json
```

## 核心功能

### 1. 冲突文件名解析

Syncthing 冲突文件格式：
```
<filename>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<device-id>.<ext>
```

解析后提取：
- `originalPath` — 原始文件路径
- `conflictDate` — 冲突时间
- `deviceId` — 产生冲突的设备 ID
- `conflictPath` — 冲突文件自身路径

### 2. `stc scan [dir]`

递归扫描指定目录，查找 `*.sync-conflict-*` 文件，与原始文件配对，按目录分组展示。

**输出示例：**
```
Found 5 conflicts in 3 directories

notes/
  ├── readme.md (2 conflicts)
  │   ├── readme.md                                    1.2KB  2024-01-15
  │   └── readme.md.sync-conflict-20240115-093000-ABC  1.5KB  2024-01-15
  └── config.yaml (1 conflict)
      ...

Use "stc resolve" to resolve interactively
```

**选项：**
- `--sort <field>` — 按时间/大小/文件名排序
- `--group` — 按目录分组（默认开启）

### 3. `stc resolve [dir]`

交互式逐步解决冲突：
1. 扫描获取冲突对列表
2. 逐对展示，提供操作选项：

```
═══════════════════════════════════════════
Conflict: notes/readme.md (1/5)
Original:  1.2KB  modified 2024-01-15 08:00
Conflict:  1.5KB  modified 2024-01-15 09:30
═══════════════════════════════════════════

[D] View diff  [K] Keep original  [C] Keep conflict  [M] Keep both  [S] Skip  [Q] Quit
```

3. 选择保留后：删除被放弃的文件，保留的文件重命名为原始文件名（如果需要）

### 4. `stc auto [dir]`

按规则自动解决冲突。

**策略（`--strategy`）：**
- `newest` — 保留修改时间最新的（默认）
- `oldest` — 保留最旧的
- `largest` — 保留文件最大的
- `smallest` — 保留最小的
- `conflict` — 始终保留冲突文件版本
- `original` — 始终保留原始文件

**安全机制：**
- 默认 `--dry-run` 模式，只显示会做什么操作
- 需要加 `--execute` 才真正执行
- 操作前自动创建备份到 `.stc-backup/` 目录

### 5. Diff 显示

- **内置模式：** 使用 `diff` 库计算差异，终端内颜色高亮显示（类似 `git diff` 风格）
- **外部工具：** 通过 `--diff-tool <command>` 指定（如 `code --diff`）
- 文本文件显示内容 diff，非文本文件只显示元信息对比

### 6. 全局选项

- `--exclude <patterns>` — 排除的目录/文件模式（如 `node_modules,.git`）
- `--depth <n>` — 递归深度限制
- `--json` — 以 JSON 格式输出（方便脚本集成）

## 错误处理

- 找不到原始文件的冲突对标记为 "orphan"，提示手动处理
- 文件权限不足时给出明确错误信息
- 中断操作（Ctrl+C）时确保不留半完成状态

## 测试策略

- 单元测试：`parser.ts`、`scanner.ts`、`differ.ts`
- 集成测试：临时目录创建模拟冲突文件，测试完整流程
- 工具：`vitest` + 临时目录 fixtures

## 分发

- 先以 npm 包形式发布（`npm install -g syncthing-conflict-cli`）
- 后续考虑单文件可执行打包

## TODO（后续版本）

- **定时监控模式：** `stc watch [dir]`，监听文件变化，发现新冲突时发送通知
