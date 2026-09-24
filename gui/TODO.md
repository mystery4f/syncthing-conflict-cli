# stc-merge 待修复问题

> 首次实测反馈（2026-09-24）。验收标准：IDEA 合并对话框的观感与交互。

## 已知问题

### 乱码（中文字与 «» 按钮全是豆腐块）

**根因**：egui/eframe 内嵌字体不含中文字形，也不含 `«` `»`（U+00AB/BB）字形。

**修法**：`gui/src/main.rs` 的 AppCreator 里加载系统字体：

```rust
cc.font_definitions.font_data.insert(
    "msyh".into(),
    egui::FontData::from_owned(std::fs::read("C:/Windows/Fonts/msyh.ttc").unwrap()).into(),
);
cc.font_definitions.families
    .get_mut(&egui::FontFamily::Proportional)
    .unwrap()
    .push("msyh".into());
```

（或改用 ASCII `<` `>` 做按钮文案，绕开字形问题。）

### 点 «» 箭头没反应（真 bug）

**根因**：`region.state` 被 `set_region()` 修改后，只有 footer 计数会变——
中间栏文本渲染读的是构造时写死的 `Row.center`，`apply()` 落盘拼接的也是
`row.center`，`state` 完全没参与内容推导。点箭头等于没点。

**修法**（两处，`gui/src/main.rs`）：

- 渲染：中间栏文本按 `regions[rid].state` 推导——`Right` 取右侧行，否则取左侧行
- `apply()`：同样按 state 重新拼接，而不是直接 join `row.center`

### 整体 UI 粗糙

行间 `ui.separator()` 边框太重、无行号列对齐、无 diff 概览条——
前两个修完后再统一打磨。

## 修复入口

| 问题 | 文件 | 位置 |
|------|------|------|
| 字体 | `gui/src/main.rs` | `main()` / AppCreator `cc` |
| 箭头失效 | `gui/src/main.rs` | `MergeApp::update()` 中间栏、`MergeApp::apply()` |

改完：`cargo build --release` → 复制到 `%USERPROFILE%\.stc\bin\`。
