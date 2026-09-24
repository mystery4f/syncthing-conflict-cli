# stc — Syncthing Conflict CLI

一个 Node.js/TypeScript CLI 工具，用于扫描、交互式解决和自动处理 [Syncthing](https://syncthing.net/) 同步冲突文件。

## 安装

```bash
npm install -g syncthing-conflict-cli
```

或直接使用：

```bash
npx syncthing-conflict-cli <command>
```

或从本地源码全局安装（链接方式，改代码后 `npm run build` 即时生效，无需重装）：

```bash
git clone https://github.com/<you>/syncthing-conflict-cli.git
cd syncthing-conflict-cli
pnpm install
pnpm build
npm install -g .

# 之后全局可用 stc 命令
stc --version
```

卸载：`npm uninstall -g syncthing-conflict-cli`

## 快速开始

```bash
# 扫描当前目录下的冲突文件
stc scan

# 交互式逐个解决冲突
stc resolve ~/sync

# 预览自动解决结果（dry-run 模式）
stc auto ~/sync --strategy newest

# 执行自动解决
stc auto ~/sync --strategy newest --execute
```

## 命令

### `stc scan [dir]`

递归扫描目录，查找 `*.sync-conflict-*` 文件并按目录分组展示。

```bash
$ stc scan ~/notes

Found 3 conflicts in 2 directories

notes/
  ├── readme.md (2 conflicts)
  │   ├── readme.md.sync-conflict-20240115-093000-ABCDEF.md  1.5KB  2024-01-15
  │   └── readme.md.sync-conflict-20240115-110000-GHIJKL.md  1.8KB  2024-01-15
  └── config.yaml (1 conflict)
      └── config.yaml.sync-conflict-20240320-120000-LMNOP.yaml  0.3KB  2024-03-20

Use "stc resolve" to resolve interactively
```

**选项：**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--sort <field>` | 排序字段：`time`、`size`、`name` | `time` |
| `--no-group` | 不按目录分组 | — |
| `--exclude <patterns>` | 排除的目录/文件模式（逗号分隔） | — |
| `--depth <n>` | 递归深度限制 | 无限制 |
| `--json` | 以 JSON 格式输出 | — |

### `stc resolve [dir]`

交互式逐步解决冲突。同一文件有多个冲突版本时会分组展示，让你从中选择保留哪个版本。

```bash
$ stc resolve ~/notes

Found 3 conflict files in 2 groups. Starting interactive resolution...

════════════════════════════════════════════════════════════
Conflict group 1/2: readme.md
  2 conflict versions
  [O] Original   1.2KB  modified 2024-01-15 08:00:00
  [1] ABCDEF     1.5KB  modified 2024-01-15 09:30:00
  [2] GHIJKL     1.8KB  modified 2024-01-15 11:00:00
════════════════════════════════════════════════════════════
❯ ○ Diff: original vs conflict #1 (ABCDEF)
  ○ Diff: original vs conflict #2 (GHIJKL)
  ○ Diff: conflict #1 vs conflict #2
  ○ Keep original
  ○ Keep conflict #1 (ABCDEF)
  ○ Keep conflict #2 (GHIJKL)
  ○ Skip
  ○ Quit
```

**选项：**

| 选项 | 说明 |
|------|------|
| `--sort <field>` | 排序字段：`time`、`size`、`name` |
| `--exclude <patterns>` | 排除模式（逗号分隔） |
| `--depth <n>` | 递归深度限制 |
| `--diff-tool <command>` | 外部 diff 工具（如 `code --diff`）；`idea` 为简写，自动探测 IDEA 安装路径 |

最简单的方式：`--diff-tool idea`，自动探测 IDEA 安装路径：

```bash
stc resolve ~/sync --diff-tool idea
```

探测不到时手动传全路径（阻塞到窗口关闭，看完关窗后继续选版本，详见 [docs/idea-cli-diff.md](docs/idea-cli-diff.md)）：

```bash
stc resolve ~/sync --diff-tool '"C:\Program Files\JetBrains\IntelliJ IDEA 2026.1\bin\idea64.exe" diff'
```
检测到 IDEA 后「Merge in IDEA」自动出现在菜单：中间结果栏初始为原始内容，把右侧冲突改动挪进去后点「应用」，结果写回原始文件、冲突副本删除（先备份）；结果未变则冲突保留。

### `stc auto [dir]`

按策略自动解决冲突。

```bash
# 预览（默认 dry-run）
$ stc auto ~/sync --strategy newest

DRY RUN: Auto-resolve 3 groups (5 total conflicts) using "newest" strategy

  [dry-run] readme.md (2 conflicts) → ok
  [dry-run] config.yaml (1 conflicts) → ok
  [dry-run] photo.jpg (2 conflicts) → ok

This was a dry run. Use --execute to apply changes.
```

**策略：**

| 策略 | 说明 |
|------|------|
| `newest` | 保留修改时间最新的版本（**默认**） |
| `oldest` | 保留最旧的版本 |
| `largest` | 保留文件最大的版本 |
| `smallest` | 保留文件最小的版本 |
| `conflict` | 始终保留冲突文件版本 |
| `original` | 始终保留原始文件版本 |

**选项：**

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--strategy <s>` | 解决策略 | `newest` |
| `--dry-run` | 只预览不执行 | 默认开启 |
| `--execute` | 真正执行操作 | — |
| `--exclude <patterns>` | 排除模式 | — |
| `--depth <n>` | 递归深度限制 | — |

## 多冲突版本处理

当一个文件存在多个冲突版本（例如从 4 台不同设备同步产生）时：

- **`scan`** — 正确显示所有冲突版本，按目录和原始文件分组
- **`resolve`** — 分组展示所有版本（原始 + N 个冲突），让你选择保留哪一个，未选版本全部删除
- **`auto`** — 将所有版本（原始 + 所有冲突）纳入策略比较，选出唯一胜者

操作是**原子性的**：先备份所有文件，再执行删除/重命名，确保不会出现半完成状态。

## 安全机制

- `auto` 命令**默认 dry-run**，必须加 `--execute` 才会真正操作
- 执行操作前自动备份到 `.stc-backup/` 目录
- 中断操作（Ctrl+C）时文件系统状态一致
- 孤立冲突（原始文件已不存在）会被标记提示

## 技术栈

- **TypeScript** (strict 模式) + **Node.js** >= 18
- [commander](https://github.com/tj/commander.js) — CLI 框架
- [inquirer](https://github.com/SBoudrias/Inquirer.js) — 交互提示
- [diff](https://github.com/kpdecker/jsdiff) — 文本差异计算
- [chalk](https://github.com/chalk/chalk) — 终端颜色
- [fast-glob](https://github.com/mrmlnc/fast-glob) — 文件扫描
- [cli-table3](https://github.com/cli-table/cli-table3) — 表格输出

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm dev scan ~/sync

# 运行测试
pnpm test

# 构建
pnpm build

# 代码检查
pnpm lint
```

## License

MIT
