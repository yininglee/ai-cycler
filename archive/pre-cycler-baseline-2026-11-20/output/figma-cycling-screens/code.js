// Native Figma reconstruction from the two supplied 402 x 814 screenshots.
// Measurements and icon paths follow app/globals.css and app/components/.
const WIDTH = 402;
const HEIGHT = 814;
const COLORS = {
  bg: "#f4f4f2", paper: "#ffffff", ink: "#111111", muted: "#70706d",
  border: "#e2e2de", nav: "#8a8a87", summary: "#20211d",
  onSummary: "#f8f8f2", summaryMuted: "#b6b7ad",
  heat: ["#e7e7e1", "#c9cac0", "#9d9f92", "#62655a", "#292b24"],
};
const ICONS = {
  bike: '<svg viewBox="0 0 32 32"><circle cx="8" cy="23" r="5" fill="none" stroke="COLOR" stroke-width="2"/><circle cx="24" cy="23" r="5" fill="none" stroke="COLOR" stroke-width="2"/><path d="m8 23 6-10 5 10H8Zm6-10h7m-9-4h5m2 4 5 10" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 2c.7 5.2 2.8 7.3 8 8-5.2.7-7.3 2.8-8 8-.7-5.2-2.8-7.3-8-8 5.2-.7 7.3-2.8 8-8Zm7 14c.3 2.1 1.1 2.9 3 3.2-1.9.3-2.7 1.1-3 3.2-.3-2.1-1.1-2.9-3-3.2 1.9-.3 2.7-1.1 3-3.2Z" fill="COLOR"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="COLOR" stroke-width="2"/><path d="M12 7v1.5M12 11.5V17" fill="none" stroke="COLOR" stroke-width="2" stroke-linecap="round"/></svg>',
};
let fonts;
let selectedFonts;

function rgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return { r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 };
}
function paint(hex, opacity = 1) { return [{ type: "SOLID", color: rgb(hex), opacity }]; }
function bounds(node, parent, name, x, y, width, height) {
  node.name = name;
  parent.appendChild(node);
  node.resize(width, height);
  node.x = x;
  node.y = y;
  return node;
}
function container(parent, name, x, y, width, height, fill, radius = 0, stroke, opacity = 1) {
  const node = bounds(figma.createFrame(), parent, name, x, y, width, height);
  node.fills = fill ? paint(fill, opacity) : [];
  node.strokes = stroke ? paint(stroke) : [];
  node.strokeWeight = 1;
  node.strokeAlign = "INSIDE";
  node.cornerRadius = radius;
  node.clipsContent = false;
  return node;
}
function rect(parent, name, x, y, width, height, fill, radius = 0, stroke, opacity = 1) {
  const node = bounds(figma.createRectangle(), parent, name, x, y, width, height);
  node.fills = fill ? paint(fill, opacity) : [];
  node.strokes = stroke ? paint(stroke) : [];
  node.strokeWeight = 1;
  node.strokeAlign = "INSIDE";
  node.cornerRadius = radius;
  return node;
}
function circle(parent, name, x, y, size, fill, stroke) {
  const node = bounds(figma.createEllipse(), parent, name, x, y, size, size);
  node.fills = fill ? paint(fill) : [];
  node.strokes = stroke ? paint(stroke) : [];
  node.strokeWeight = 1;
  return node;
}
function shadow(node, x, y, radius, alpha) {
  node.effects = [{ type: "DROP_SHADOW", color: { r: 0.067, g: 0.067, b: 0.067, a: alpha }, offset: { x, y }, radius, spread: 0, visible: true, blendMode: "NORMAL" }];
}
function icon(parent, key, x, y, size, color) {
  const markup = ICONS[key].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" ').replace(/COLOR/g, color);
  const node = figma.createNodeFromSvg(markup);
  bounds(node, parent, key + " / vector", x, y, size, size);
  return node;
}
function fontFor(kind, bold) {
  const families = kind === "cjk" ? ["PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Inter"] : ["SF Pro Rounded", "SF Pro Display", "Inter", "Arial"];
  const styles = bold ? ["Semibold", "SemiBold", "Bold", "Medium", "Regular"] : ["Regular", "Normal", "Medium"];
  for (const family of families) for (const style of styles) {
    const match = fonts.find(f => f.fontName.family === family && f.fontName.style === style);
    if (match) return match.fontName;
  }
  // never hard-fail on a missing family: fall back to whatever exists
  const fallback = fonts.find(f => f.fontName.style === (bold ? "Semibold" : "Regular")) || fonts[0];
  return fallback.fontName;
}
function text(parent, name, value, x, y, size = 14, bold = false, color = COLORS.ink, width, lineHeight, align = "LEFT") {
  const node = figma.createText();
  parent.appendChild(node);
  node.name = name;
  node.fontName = selectedFonts[bold ? "cjkBold" : "cjk"];
  node.fontSize = size;
  node.lineHeight = { unit: "PIXELS", value: lineHeight || size * 1.55 };
  node.fills = paint(color);
  node.characters = value;
  const latinFont = selectedFonts[bold ? "latinBold" : "latin"];
  const latinRuns = /[\x20-\x7e]+/g;
  let match;
  while ((match = latinRuns.exec(value))) node.setRangeFontName(match.index, match.index + match[0].length, latinFont);
  node.textAlignHorizontal = align;
  if (width) {
    node.resize(width, node.height);
    node.textAutoResize = "HEIGHT";
  } else {
    node.textAutoResize = "WIDTH_AND_HEIGHT";
  }
  node.x = x;
  node.y = y;
  return node;
}
function pill(parent, name, label, x, y, width, height, options = {}) {
  const node = container(parent, name, x, y, width, height, options.fill || COLORS.paper, height / 2, options.stroke || COLORS.border, options.opacity || 1);
  text(node, "Label", label, 0, (height - (options.size || 11) * 1.55) / 2, options.size || 11, options.bold !== false, options.color || "#4f4f4b", width, undefined, "CENTER");
  return node;
}
function bottomNav(parent, active) {
  const nav = container(parent, "Bottom Navigation / " + active, 12, 734, 378, 70, COLORS.paper, 35, COLORS.border, 0.9);
  nav.constraints = { horizontal: "CENTER", vertical: "MAX" };
  shadow(nav, 0, 12, 35, 0.11);
  const colorToday = COLORS.nav;
  const colorRides = active === "Rides" ? COLORS.ink : COLORS.nav;
  const colorPartner = active === "Partner" ? COLORS.ink : COLORS.nav;
  const dot = rect(nav, "Today / indicator", 57, 15, 18, 18, colorToday, 9);
  dot.bottomLeftRadius = 2;
  text(nav, "Today / label", "今日", 40, 35, 12, true, colorToday, 52, 18.6, "CENTER");
  icon(nav, "bike", 149.5, 13, 21, colorRides);
  text(nav, "Rides / label", "骑行", 134, 35, 12, true, colorRides, 52, 18.6, "CENTER");
  circle(nav, "AI / round button", 206, 9, 52, COLORS.ink);
  icon(nav, "spark", 220, 23, 24, COLORS.paper);
  icon(nav, "spark", 301.5, 13, 21, colorPartner);
  text(nav, "Partner / label", "伙伴", 286, 35, 12, true, colorPartner, 52, 18.6, "CENTER");
  return nav;
}
function chatScreen(page, x, y) {
  const frame = container(page, "01 · AI 骑行伙伴 · Chat / 402 × 814", x, y, WIDTH, HEIGHT, COLORS.bg);
  frame.clipsContent = true;
  const header = container(frame, "Header", 20, 22, 362, 52);
  circle(header, "Brand / black circle", 0, 7, 38, COLORS.ink);
  icon(header, "bike", 7.5, 14.5, 23, COLORS.paper);
  text(header, "Brand / 骑行伙伴", "骑行伙伴", 48, 13.6, 16, true);
  pill(header, "New Conversation", "＋ 新对话", 219, 10, 69, 32, { opacity: 0.7 });
  pill(header, "Conversation History", "对话记录", 296, 10, 66, 32, { opacity: 0.7 });

  const summary = container(frame, "Ride Summary / 3 columns", 20, 86, 362, 73.75, COLORS.paper, 20, COLORS.border, 0.94);
  [["累计骑行", "4 次"], ["总里程", "279.3 km"], ["本周", "0 次 · 0 km"]].forEach((entry, i) => {
    const cell = container(summary, "Metric / " + entry[0], 17 + i * 113.33, 16, 101.33, 40.75);
    text(cell, "Label", entry[0], 0, 0, 11, true, COLORS.muted, undefined, 17.05);
    text(cell, "Value", entry[1], 0, 20.05, 14, true, COLORS.ink, undefined, 21.7);
  });
  const message = container(frame, "AI Welcome Message", 22, 177.75, 244, 138.05);
  text(message, "Speaker", "AI 伙伴", 0, 0, 11, true, COLORS.muted, undefined, 17.05);
  const bubble = container(message, "Message Bubble", 0, 22.05, 241, 115.6, COLORS.paper, 18, COLORS.border);
  text(bubble, "Message / editable", "你好，我是你的 AI 骑行伙伴。\n累计骑行 4 次 · 总里程 279.3 km\n本周骑行 0 次 · 累计 0 km\n有什么想问的?", 15, 13, 14, false, COLORS.ink, 211, 22.4);

  const composer = container(frame, "Composer / fixed to bottom", 20, 614, 362, 104);
  composer.constraints = { horizontal: "CENTER", vertical: "MAX" };
  const quick = container(composer, "Quick Questions / horizontal scroll", 0, 0, 362, 40);
  quick.clipsContent = true;
  const questions = [
    { label: "当前可以分析哪些数据?", width: 169 },
    { label: "骑行解读", width: 78 },
    { label: "水平评估", width: 78 },
    { label: "累计骑行", width: 78 },
  ];
  let offset = 0;
  for (const item of questions) {
    const button = pill(quick, item.label, item.label, offset, 0, item.width, 36, { size: 13, stroke: "#d5d5cf", color: "#42423f", opacity: 0.94 });
    shadow(button, 0, 5, 16, 0.06);
    offset += item.width + 8;
  }
  const input = container(composer, "Input Field", 0, 48, 362, 56, COLORS.paper, 18, COLORS.border, 0.95);
  shadow(input, 0, 10, 30, 0.1);
  text(input, "Placeholder", "问问你的骑行伙伴", 15, 15.6, 16, false, "#a3a39e", undefined, 24.8);
  icon(input, "info", 257, 17, 22, COLORS.muted);
  const send = container(input, "Send / disabled", 297, 7, 58, 42, "#9b9b9b", 13);
  text(send, "Label", "发送", 0, 10.9, 13, true, COLORS.paper, 58, 20.15, "CENTER");
  bottomNav(frame, "Partner");
  return frame;
}
function calendarScreen(page, x, y) {
  const frame = container(page, "02 · 骑行日历 · Rides / 402 × 814", x, y, WIDTH, HEIGHT, COLORS.bg);
  frame.clipsContent = true;
  const header = container(frame, "Header", 20, 30, 362, 67.2);
  const eyebrow = text(header, "Eyebrow", "每一次出发，都有迹可循", 0, 0, 12, false, COLORS.muted, undefined, 18.6);
  eyebrow.letterSpacing = { unit: "PERCENT", value: 4 };
  const title = text(header, "Title", "骑行日历.", 0, 28.6, 32.16, true, COLORS.ink, undefined, 38.592);
  title.letterSpacing = { unit: "PERCENT", value: -6 };
  const upload = container(header, "Import Button", 277, 11.6, 85, 44, COLORS.ink, 30);
  icon(upload, "upload", 16, 13, 18, COLORS.paper);
  text(upload, "Label", "导入", 41, 11.15, 14, true, COLORS.paper, undefined, 21.7);

  const calendar = container(frame, "Calendar / October 2026", 20, 127.2, 362, 290.3);
  const year = text(calendar, "Year", "2026 年", 0, 0, 12, false, COLORS.muted, undefined, 13.2);
  year.letterSpacing = { unit: "PERCENT", value: 2 };
  const month = text(calendar, "Month", "10 月", 0, 20.2, 30, true, COLORS.ink, undefined, 33);
  month.letterSpacing = { unit: "PERCENT", value: -4 };
  pill(calendar, "Go to Today", "今天", 206, 4.6, 56, 44, { fill: COLORS.bg, stroke: "#ddddd7", size: 13, bold: false, color: COLORS.ink });
  const previous = container(calendar, "Previous Month", 268, 4.6, 44, 44, "#e9e9e4", 22);
  icon(previous, "back", 13, 13, 18, COLORS.ink);
  const next = container(calendar, "Next Month", 318, 4.6, 44, 44, "#e9e9e4", 22);
  icon(next, "next", 13, 13, 18, COLORS.ink);

  const heatmap = container(calendar, "Heatmap / scrollable months", -1, 75.2, 364, 124);
  heatmap.clipsContent = true;
  [31, 30, 31].forEach((days, index) => {
    const grid = container(heatmap, (10 + index) + " 月", 1 + index * 140, 0, 122, 112);
    text(grid, "Month Label", (10 + index) + " 月", 2, 0, 11, true, COLORS.muted, undefined, 13.2);
    for (let day = 1; day <= days; day++) {
      const col = (day - 1) % 7;
      const row = Math.floor((day - 1) / 7);
      const px = col * 18;
      const py = 22.2 + row * 18;
      const active = index === 0 && day === 5;
      rect(grid, "2026-" + (10 + index) + "-" + String(day).padStart(2, "0"), px, py, 14, 14, COLORS.heat[active ? 2 : 0], 4);
      if (index === 0 && day === 22) {
        const selection = rect(grid, "Today / selection ring", px - 2, py - 2, 18, 18, null, 5, COLORS.summary);
        selection.strokeWeight = 1.5;
        circle(grid, "Today / white dot", px + 4, py + 4, 6, COLORS.paper, "#777774");
      }
    }
  });
  const footer = container(calendar, "Calendar Legend", 0, 207.2, 362, 17.05);
  circle(footer, "Today Key / dot", 0, 6, 5, "#282b23");
  text(footer, "Today Key / label", "今天", 12, 0, 11, false, COLORS.muted, undefined, 17.05);
  const legend = container(footer, "Distance Legend", 231, 0, 131, 17.05);
  text(legend, "Distance", "距离", 0, 0, 11, false, COLORS.muted, undefined, 17.05);
  text(legend, "Low", "少", 30, 0, 11, false, COLORS.muted, undefined, 17.05);
  COLORS.heat.forEach((color, i) => rect(legend, "Heat / " + i, 45 + 15 * i, 3, 11, 11, color, 3));
  text(legend, "High", "多", 120, 0, 11, false, COLORS.muted, undefined, 17.05);
  const hint = container(calendar, "Calendar Hint", 0, 232.2, 362, 44);
  text(hint, "Hint", "点击方格，查看当天骑行。", 0, 13.475, 11, false, COLORS.muted, undefined, 17.05);
  text(hint, "Latest Ride / label", "最近骑行", 299, 13.475, 11, true, "#363830", undefined, 17.05);
  icon(hint, "arrow", 348, 15, 14, "#363830");

  const summary = container(frame, "Monthly Ride Summary", 20, 417.5, 362, 259.4, COLORS.summary, 28);
  text(summary, "Heading", "本月骑行", 24, 24, 16, true, COLORS.onSummary, undefined, 24.8);
  text(summary, "Date Range", "10 月 1 日 — 31 日", 211, 27.875, 11, false, COLORS.summaryMuted, undefined, 17.05);
  const stats = [
    { label: "累计距离", value: "30.4", unit: "km", x: 24, y: 72.8, size: 34, line: 42.5 },
    { label: "骑行次数", value: "1", unit: "次", x: 189, y: 72.8, size: 26, line: 32.5 },
    { label: "骑行时长", value: "1 小时 1 分钟", unit: "", x: 24, y: 171.1, size: 18, line: 32.4 },
    { label: "累计爬升", value: "14", unit: "m", x: 189, y: 171.1, size: 26, line: 32.5 },
  ];
  for (const stat of stats) {
    const block = container(summary, stat.label, stat.x, stat.y, 149, 74.3);
    text(block, "Label", stat.label, 0, 6, 11, false, COLORS.summaryMuted, undefined, 17.05);
    const value = text(block, "Value", stat.value, 0, 31.8, stat.size, true, COLORS.onSummary, undefined, stat.line);
    if (stat.unit) text(block, "Unit", stat.unit, value.width + 5, 31.8 + stat.line - 18.75, 12, false, COLORS.summaryMuted, undefined, 18.75);
  }
  const daily = container(frame, "Daily Rides / below fold", 20, 708.9, 362, 242);
  text(daily, "Date", "10 月 22 日", 0, 0, 11, false, COLORS.muted, undefined, 17.05);
  text(daily, "Heading", "今日骑行", 0, 24.05, 23, true, COLORS.ink, undefined, 35.65);
  text(daily, "Record Count", "0 条记录", 314, 43.2, 11, false, COLORS.muted, undefined, 17.05);
  const empty = container(daily, "Empty Day State", 0, 77.7, 362, 208, COLORS.bg, 28, "#e3e3dc");
  const emptyIcon = container(empty, "Bike Badge", 153, 28, 56, 56, "#e9e9e4", 28);
  icon(emptyIcon, "bike", 13, 13, 30, "#77796e");
  text(empty, "Empty Message", "今天还没有骑行记录", 0, 100, 16, true, COLORS.ink, 362, 24.8, "CENTER");
  text(empty, "Empty Hint", "每一段骑行，都值得被记下。", 0, 132.8, 12, false, COLORS.muted, 362, 18.6, "CENTER");
  bottomNav(frame, "Rides");
  return frame;
}
const SCREEN_NAME = /^0[12] · (AI 骑行伙伴|骑行日历)/;

async function main() {
  fonts = await figma.listAvailableFontsAsync();
  selectedFonts = { cjk: fontFor("cjk", false), cjkBold: fontFor("cjk", true), latin: fontFor("latin", false), latinBold: fontFor("latin", true) };
  const unique = new Map(Object.values(selectedFonts).map(font => [font.family + "/" + font.style, font]));
  await Promise.all(Array.from(unique.values()).map(font => figma.loadFontAsync(font)));
  const page = figma.currentPage;

  // A previous failed run can leave empty frames behind; clear only those.
  let cleaned = 0;
  for (const node of [...page.children]) {
    if (node.type === "FRAME" && node.children.length === 0 && SCREEN_NAME.test(node.name)) {
      node.remove();
      cleaned++;
    }
  }

  const existing = page.children;
  const x = existing.length ? Math.max(...existing.map(node => node.x + node.width)) + 100 : 0;
  const y = existing.length ? Math.min(...existing.map(node => node.y)) : 0;

  const before = new Set([...page.children].map(node => node.id));
  try {
    const screens = [chatScreen(page, x, y), calendarScreen(page, x + WIDTH + 80, y)];
    const allNodes = screens.flatMap(screen => [screen].concat(screen.findAll()));
    const editableText = allNodes.filter(node => node.type === "TEXT");
    if (editableText.length < 45) throw new Error("文字图层校验未通过，只生成 " + editableText.length + " 个");
    const result = { created: screens.map(node => ({ id: node.id, name: node.name, width: node.width, height: node.height })), textLayers: editableText.length, totalNodes: allNodes.length, fonts: selectedFonts, cleanedEmptyFrames: cleaned };
    page.selection = screens;
    figma.viewport.scrollAndZoomIntoView(screens);
    console.log("CYCLING_BUDDY_IMPORT", JSON.stringify(result));
    figma.notify("已导入 2 个 402 × 814 界面，" + editableText.length + " 个文字图层可编辑" + (cleaned ? "；顺手清理了 " + cleaned + " 个上次失败留下的空 Frame" : ""), { timeout: 8000 });
    figma.closePlugin();
  } catch (error) {
    // roll back partial output so the next run starts from a clean page
    for (const node of [...page.children]) if (!before.has(node.id)) node.remove();
    throw error;
  }
}
main().catch(error => { console.error(error); figma.closePlugin("导入失败: " + error.message); });
