//! stc-merge — IDEA 风格的三栏合并对话框（stc 专用）。
//!
//! 用法：stc-merge <left> <right> <base> <out>
//! - 三栏：left(您的版本) / center(合并结果，初始=base) / right(服务器更改)
//! - 每个更改区域提供 «(保留左) »(拉入右) 按钮；中间栏任意行可编辑
//! - F7 / Shift+F7 在更改区域间跳转；Ctrl+Enter 或「应用」= 写出 out 并退出
//! - 「中止」或直接关窗 = 不写 out 退出；stc 通过「out 是否被改写」判定结果

use eframe::egui;
use similar::TextDiff;
use std::fs;

#[derive(PartialEq, Clone, Copy)]
enum RegionState {
    Pending,
    Left,
    Right,
}

struct Region {
    state: RegionState,
}

struct Row {
    left: String,
    left_num: Option<usize>,
    right: String,
    right_num: Option<usize>,
    center: String,
    center_num: Option<usize>,
    /// 所属更改区域索引；None = 等同段
    region: Option<usize>,
    /// 区域首行：显示 «» 按钮
    btn: bool,
    /// 该行相对另一侧是否有内容（右侧新增/修改时用于高亮）
    changed: bool,
}

struct MergeApp {
    rows: Vec<Row>,
    regions: Vec<Region>,
    active: Option<usize>,
    out_path: String,
    orig_path: String,
    conf_path: String,
    scroll_sync: f32,
}

fn read_lines(p: &str) -> Vec<String> {
    fs::read_to_string(p)
        .unwrap_or_default()
        .lines()
        .map(|s| s.to_string())
        .collect()
}

impl MergeApp {
    fn new(left: &str, right: &str, base: &str, out_path: String) -> Self {
        let left_lines = read_lines(left);
        let right_lines = read_lines(right);
        let base_lines = read_lines(base);

        // 与 IDEA 集成一致：base 即「您的版本」一侧的公共祖先（stc 传入 original）
        let diff = TextDiff::from_lines(&base_lines, &right_lines);

        let mut rows: Vec<Row> = Vec::new();
        let mut regions: Vec<Region> = Vec::new();
        let mut left_num = 1usize;
        let mut right_num = 1usize;

        for op in diff.ops() {
            match op.tag() {
                similar::DiffTag::Equal => {
                    let (o, n, len) = (op.old_index(), op.new_index(), op.old_len());
                    for k in 0..len {
                        let text = base_lines[o + k].clone();
                        rows.push(Row {
                            left: format!("{:>6}  {}", left_num, text),
                            left_num: None,
                            right: format!("{:>6}  {}", right_num, text),
                            right_num: None,
                            center: text.clone(),
                            center_num: Some(left_num),
                            region: None,
                            btn: false,
                            changed: false,
                        });
                        left_num += 1;
                        right_num += 1;
                    }
                }
                similar::DiffTag::Delete => {
                    let (o, len) = (op.old_index(), op.old_len());
                    let idx = regions.len();
                    regions.push(Region { state: RegionState::Pending });
                    for k in 0..len {
                        let text = base_lines[o + k].clone();
                        rows.push(Row {
                            left: format!("{:>6}  {}", left_num, text),
                            left_num: None,
                            right: String::new(),
                            right_num: None,
                            center: text.clone(),
                            center_num: Some(left_num),
                            region: Some(idx),
                            btn: k == 0,
                            changed: true,
                        });
                        left_num += 1;
                    }
                }
                similar::DiffTag::Insert => {
                    let (n_idx, n_len) = (op.new_index(), op.new_len());
                    let idx = regions.len();
                    regions.push(Region { state: RegionState::Pending });
                    for k in 0..n_len {
                        let text = right_lines[n_idx + k].clone();
                        rows.push(Row {
                            left: String::new(),
                            left_num: None,
                            right: format!("{:>6}  {}", right_num, text),
                            right_num: None,
                            center: String::new(),
                            center_num: None,
                            region: Some(idx),
                            btn: k == 0,
                            changed: true,
                        });
                        right_num += 1;
                    }
                }
                similar::DiffTag::Replace => {
                    let (o, o_len, n_idx, n_len) =
                        (op.old_index(), op.old_len(), op.new_index(), op.new_len());
                    let idx = regions.len();
                    regions.push(Region { state: RegionState::Pending });
                    let total = o_len.max(n_len);
                    for k in 0..total {
                        let l_txt = base_lines.get(o + k).cloned().unwrap_or_default();
                        let r_txt = right_lines.get(n_idx + k).cloned().unwrap_or_default();
                        let ln = if k < o_len { Some(left_num + k) } else { None };
                        let rn = if k < n_len { Some(right_num + k) } else { None };
                        rows.push(Row {
                            left: ln.map(|n| format!("{:>6}  {}", n, l_txt)).unwrap_or_default(),
                            left_num: None,
                            right: rn.map(|n| format!("{:>6}  {}", n, r_txt)).unwrap_or_default(),
                            right_num: None,
                            center: l_txt.clone(),
                            center_num: if k < o_len { Some(left_num + k) } else { None },
                            region: Some(idx),
                            btn: k == 0,
                            changed: true,
                        });
                    }
                    left_num += o_len;
                    right_num += n_len;
                }
            }
        }

        Self {
            rows,
            regions,
            active: None,
            out_path: out_path,
            orig_path: left.to_string(),
            conf_path: right.to_string(),
            scroll_sync: 0.0,
        }
    }

    fn set_region(&mut self, idx: usize, state: RegionState) {
        if let Some(r) = self.regions.get_mut(idx) {
            r.state = state;
        }
    }

    fn apply(&self) {
        let text: String = self
            .rows
            .iter()
            .map(|r| r.center.clone())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let _ = fs::write(&self.out_path, text);
        std::process::exit(0);
    }

    fn jump(&mut self, dir: i32) {
        if self.regions.is_empty() {
            return;
        }
        let n = self.regions.len();
        let cur = self.active.unwrap_or(0);
        let next = if dir > 0 { (cur + 1) % n } else { (cur + n - 1) % n };
        self.active = Some(next);
    }
}

impl eframe::App for MergeApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        // 键盘：F7/Shift+F7 跳转，Ctrl+Enter 应用
        let (f7, shift, ctrl_enter) = ctx.input(|i| {
            (
                i.key_pressed(egui::Key::F7),
                i.modifiers.shift,
                i.key_pressed(egui::Key::Enter) && i.modifiers.ctrl,
            )
        });
        if f7 {
            self.jump(if shift { -1 } else { 1 });
        }
        if ctrl_enter {
            self.apply();
        }

        egui::TopBottomPanel::top("header").show(ctx, |ui| {
            ui.horizontal(|ui| {
                ui.colored_label(egui::Color32::from_rgb(0xf4, 0x87, 0x71), "您的版本");
                ui.label(egui::RichText::new(&self.orig_path).small().weak());
                ui.colored_label(egui::Color32::from_rgb(0x56, 0x9c, 0xd6), "│ 合并结果（可编辑）");
                ui.colored_label(egui::Color32::from_rgb(0x4e, 0xc9, 0xb0), "│ 服务器更改");
                ui.label(egui::RichText::new(&self.conf_path).small().weak());
            });
        });

        egui::TopBottomPanel::bottom("footer").show(ctx, |ui| {
            ui.add_space(6.0);
            ui.horizontal(|ui| {
                let pending = self.regions.iter().filter(|r| r.state == RegionState::Pending).count();
                ui.colored_label(
                    egui::Color32::from_rgb(0xe5, 0xa3, 0x4c),
                    format!("更改区域 {}/{}", self.regions.len() - pending, self.regions.len()),
                );
                if ui.button("‹ Prev (Shift+F7)").clicked() {
                    self.jump(-1);
                }
                if ui.button("Next (F7) ›").clicked() {
                    self.jump(1);
                }
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui
                        .add(egui::Button::new("应用并下一个 (Ctrl+Enter)").fill(egui::Color32::from_rgb(0x0e, 0x63, 0x9c)))
                        .clicked()
                    {
                        self.apply();
                    }
                    if ui.button("中止").clicked() {
                        std::process::exit(2);
                    }
                });
            });
            ui.add_space(4.0);
        });

        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(egui::Color32::from_rgb(0x1e, 0x1e, 0x1e)))
            .show(ctx, |ui| {
                let avail = ui.available_width();
                let col = (avail - 24.0) / 3.0;
                let row_h = 22.0;
                egui::ScrollArea::vertical()
                    .id_source("merge")
                    .auto_shrink([false, false])
                    .show_rows(ui, row_h, self.rows.len(), |ui, range| {
                        for ri in range {
                            let row = &self.rows[ri];
                            let region_idx = row.region;
                            let state = region_idx.and_then(|i| self.regions.get(i)).map(|r| r.state);
                            ui.horizontal(|ui| {
                                // 左栏
                                ui.allocate_ui(egui::vec2(col, row_h), |ui| {
                                    ui.set_width(col);
                                    ui.add(
                                        egui::Label::new(egui::RichText::new(&row.left).monospace().size(13.0).color(
                                            if row.changed { egui::Color32::from_rgb(0xf4, 0x87, 0x71) } else { egui::Color32::from_rgb(0xd4, 0xd4, 0xd4) },
                                        ))
                                        .truncate(),
                                    );
                                });
                                // 中栏：等同段直接显示文本；更改段显示按钮 + 可编辑单行
                                ui.allocate_ui(egui::vec2(col, row_h), |ui| {
                                    ui.set_width(col);
                                    ui.horizontal(|ui| {
                                        if let (Some(rid), true) = (region_idx, row.btn) {
                                            if ui.add_sized([18.0, 18.0], egui::Button::new("\u{ab}"))
                                                .on_hover_text("保留左侧 (1)")
                                                .clicked()
                                            {
                                                self.set_region(rid, RegionState::Left);
                                            }
                                            if ui.add_sized([18.0, 18.0], egui::Button::new("\u{bb}"))
                                                .on_hover_text("拉入右侧 (2)")
                                                .clicked()
                                            {
                                                self.set_region(rid, RegionState::Right);
                                            }
                                        } else if let (Some(rid), false) = (region_idx, row.btn) {
                                            if self.regions.get(rid).map(|r| r.state) == Some(RegionState::Pending) && row.changed {
                                                ui.label(egui::RichText::new("·").small().weak());
                                            }
                                        }
                                        if region_idx.is_none() {
                                            ui.add(
                                                egui::Label::new(
                                                    egui::RichText::new(&row.center).monospace().size(13.0),
                                                )
                                                .truncate(),
                                            );
                                        } else if row.btn {
                                            ui.add(
                                                egui::TextEdit::singleline(&mut self.rows[ri].center)
                                                    .desired_width(f32::INFINITY)
                                                    .font(egui::TextStyle::Monospace),
                                            );
                                        }
                                    });
                                });
                                // 右栏
                                ui.allocate_ui(egui::vec2(col, row_h), |ui| {
                                    ui.set_width(col);
                                    ui.add(
                                        egui::Label::new(egui::RichText::new(&row.right).monospace().size(13.0).color(
                                            if row.changed { egui::Color32::from_rgb(0x4e, 0xc9, 0xb0) } else { egui::Color32::from_rgb(0xd4, 0xd4, 0xd4) },
                                        ))
                                        .truncate(),
                                    );
                                });
                            });
                            ui.separator();
                        }
                    });
            });
    }
}

fn main() -> eframe::Result {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        eprintln!("用法: stc-merge <left> <right> <base> <out>");
        std::process::exit(2);
    }
    let app = MergeApp::new(&args[1], &args[2], &args[3], args[4].clone());
    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1500.0, 850.0])
            .with_title(format!("合并冲突 — {}", app.orig_path)),
        ..Default::default()
    };
    eframe::run_native("stc-merge", options, Box::new(move |_cc| Box::new(app)))
}
