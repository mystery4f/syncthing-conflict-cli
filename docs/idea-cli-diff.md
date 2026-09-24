# IDEA 命令行 diff 调研（用于 stc 冲突处理集成）

实测环境：IntelliJ IDEA 2026.1（Windows），`idea64.exe` 位于
`C:\Program Files\JetBrains\IntelliJ IDEA 2026.1\bin\idea64.exe`。

官方文档：<https://www.jetbrains.com/help/idea/command-line-differences-viewer.html>

## 语法与文件数上限

```bash
idea64.exe diff <path1> <path2> [<path3>]
```

| 参数个数 | 行为 | 实测结果 |
|----------|------|----------|
| 2 | 双栏对比 | 打开 diff 窗口 |
| 3 | 三方合并视图（第 3 个是 base） | 打开合并视图 |
| 4+ | 不支持 | 打印用法错误 `用法: idea 差异 <left file> <right file> [<base file>]`，不打开窗口 |

## 为什么最多是 3 个

diff 本质是二元关系（A vs B），第 3 个文件不是"第四栏"，而是三方合并的
**公共祖先 base**——经典 merge 三角：`base + left + right`。git、kdiff3
等同理。任何一次合并都可归约为这个三元组；4 个及以上没有对应的 UI 范式
（N 个文件两两对比是 N(N-1)/2 组合），IDE 内要用多选 + Compare Files 手动操作。

对 stc 的含义：`stc resolve` 逐组交互（看 diff → 选保留 → 下一组），
2 文件模式天然够用；3 文件模式可留给"原始 + 冲突 + 合并预览"类场景。

## 阻塞行为

launcher 会**阻塞**直到 diff 窗口关闭（实测 2 文件时被 `timeout 15` 杀掉，
exit=124）。在 `stc resolve` 交互流程里这是合理行为：用户看完 diff 关窗口，
CLI 再继续问"保留哪个版本"。

## 与 stc 的接入点

`src/ui/diff-viewer.ts` 的 `viewDiffExternal` 用 execSync 拼
`${tool} "${original}" "${conflict}"`，经 shell 执行，因此 `--diff-tool`
的值可以带子命令和引号：

```bash
stc resolve ~/sync --diff-tool '"C:\Program Files\JetBrains\IntelliJ IDEA 2026.1\bin\idea64.exe" diff'
```

`--diff-tool idea` 简写自动探测安装路径（探测顺序：Program Files / Toolbox → PATH，
失败提示手动传全路径），实现位置：`src/ui/diff-viewer.ts` 的 `resolveIdeaCommand()`。

已实现：IDEA 合并处理冲突——检测到 IDEA 时「Merge in IDEA」自动出现在菜单（无需任何 flag）：
调起 `idea64.exe merge <原始> <冲突> <临时文件>`（阻塞到窗口关闭）。官方语义：不传 base 时
输出文件当前内容即合并基线，故临时文件预填原始文件内容——中间结果栏初始为「你的版本」，
把右侧冲突改动挪进中间栏后点「应用」即写盘；结果与原始一致或未生成 → 视为跳过，冲突保留；
有变更 → 合并结果写回原始文件，冲突副本先备份再删除。同一文件的其余冲突不动，逐个处理。
实现：`mergeWithIdea()`（diff-viewer.ts）+ `applyMergedPair()`（resolver.ts）。

仍未做：3 文件合并预览——Syncthing 冲突没有 base 文件，三方视图映射不干净，
且 stc 的决策模型是「选保留版本」而非手动合并
