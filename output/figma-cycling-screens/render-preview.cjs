// Dev-only harness: stubs the Figma plugin API, runs code.js once, and emits an
// SVG preview so the generated layout can be eyeballed without opening Figma.
const fs = require("fs");
const path = require("path");

const here = __dirname;
const raw = fs.readFileSync(path.join(here, "code.js"), "utf8");
// drop the trailing auto-invocation so the harness controls execution once
const source = raw.replace(/^main\(\)\.catch\([\s\S]*$/m, "");

const FONT_LIST = ["PingFang SC", "Noto Sans SC", "Microsoft YaHei", "Inter", "SF Pro Rounded", "SF Pro Display", "Arial"]
  .flatMap((family) => ["Regular", "Medium", "Semibold", "SemiBold", "Bold", "Normal"].map((style) => ({ fontName: { family, style } })));

const STYLE_TO_WEIGHT = { Regular: 400, Normal: 400, Medium: 500, Semibold: 600, SemiBold: 600, Bold: 700 };

const toHex = (paints) => {
  const p = paints && paints[0];
  if (!p || p.type !== "SOLID") return "none";
  const h = (n) => Math.round(n * 255).toString(16).padStart(2, "0");
  return "#" + h(p.color.r) + h(p.color.g) + h(p.color.b);
};
const escapeXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// rough advance widths so auto-width text nodes report a usable .width
function measure(str, fontSize, bold) {
  let em = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c === 32) em += 0.28;
    else if (c >= 0x4e00 && c <= 0x9fff) em += 1.0;
    else if (c >= 0x3000 && c <= 0x303f) em += 1.0;
    else if (c >= 0xff00 && c <= 0xffef) em += 1.0;
    else if (c >= 48 && c <= 57) em += bold ? 0.58 : 0.56;
    else if (/[.,:;!|']/.test(ch)) em += 0.3;
    else if (/[—–]/.test(ch)) em += 1.0;
    else em += 0.56;
  }
  return em * fontSize;
}

class Node {
  constructor(type) {
    this.type = type;
    this.children = [];
    this.x = 0; this.y = 0; this._w = 0; this._h = 0;
    this.name = "";
    this.fills = []; this.strokes = []; this.strokeWeight = 1;
    this.cornerRadius = 0;
    this.parent = null;
    this.id = String(++Node.counter);
  }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  resize(w, h) { this._w = w; this._h = h; }
  setPluginData() {}
  setRangeFontName() {}
  findAll(pred) {
    const out = [];
    const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); });
    walk(this);
    return pred ? out.filter(pred) : out;
  }
  get width() {
    if (this.type === "TEXT" && !this._w && this.characters) {
      const ls = this.letterSpacing && this.letterSpacing.unit === "PERCENT" ? (this.letterSpacing.value / 100) * this.fontSize : 0;
      const lines = String(this.characters).split("\n");
      let widest = 0;
      let len = 0;
      for (const line of lines) {
        const w = measure(line, this.fontSize, (STYLE_TO_WEIGHT[this.fontName?.style] || 400) >= 600);
        if (w > widest) { widest = w; len = [...line].length; }
      }
      return widest + ls * len;
    }
    return this._w;
  }
  set width(v) { this._w = v; }
  get height() {
    if (this.type === "TEXT" && !this._h) {
      const lh = (this.lineHeight && this.lineHeight.value) || this.fontSize * 1.55;
      return String(this.characters || "").split("\n").length * lh;
    }
    return this._h;
  }
  set height(v) { this._h = v; }
}

const created = [];
const make = (type) => { const n = new Node(type); created.push(n); return n; };
Node.counter = 0;
global.figma = {
  createFrame: () => make("FRAME"),
  createRectangle: () => make("RECTANGLE"),
  createEllipse: () => make("ELLIPSE"),
  createText: () => make("TEXT"),
  createNodeFromSvg(svg) {
    const n = make("SVG");
    n.svg = svg;
    const m = /width="([\d.]+)" height="([\d.]+)"/.exec(svg);
    if (m) { n._w = Number(m[1]); n._h = Number(m[2]); }
    return n;
  },
  listAvailableFontsAsync: async () => FONT_LIST,
  loadFontAsync: async () => {},
  notify: (msg) => console.log("NOTIFY:", msg),
  closePlugin: () => {},
  viewport: { scrollAndZoomIntoView() {} },
  currentPage: Object.assign(make("PAGE"), { setPluginData() {} }),
};

// --- SVG emission ---------------------------------------------------------
function emitText(n) {
  const lh = (n.lineHeight && n.lineHeight.value) || n.fontSize * 1.55;
  const weight = STYLE_TO_WEIGHT[n.fontName?.style] || 400;
  const ls = n.letterSpacing && n.letterSpacing.unit === "PERCENT" ? ` letter-spacing="${((n.letterSpacing.value / 100) * n.fontSize).toFixed(2)}"` : "";
  const anchor = n.textAlignHorizontal === "CENTER" ? "middle" : n.textAlignHorizontal === "RIGHT" ? "end" : "start";
  const tx = anchor === "middle" ? n.width / 2 : anchor === "end" ? n.width : 0;
  return `<g transform="translate(${n.x} ${n.y})">\n` + String(n.characters || "").split("\n").map((line, i) =>
    `<text x="${tx}" y="${i * lh + lh / 2 + n.fontSize * 0.34}" font-family="PingFang SC, Noto Sans SC, sans-serif" font-size="${n.fontSize}" font-weight="${weight}" fill="${toHex(n.fills)}" text-anchor="${anchor}"${ls}>${escapeXml(line)}</text>`
  ).join("\n") + "\n</g>";
}

function emit(n) {
  if (n.type === "PAGE") return n.children.map(emit).join("\n");
  if (n.type === "TEXT") return emitText(n);
  if (n.type === "SVG") {
    const vb = /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/.exec(n.svg);
    const s = vb ? n._w / Number(vb[3]) : 1;
    const inner = n.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    return `<g transform="translate(${n.x} ${n.y}) scale(${s.toFixed(4)})">${inner}</g>`;
  }
  const fill = toHex(n.fills);
  const stroke = toHex(n.strokes);
  let shape;
  if (n.type === "ELLIPSE") {
    shape = `<ellipse cx="${n.width / 2}" cy="${n.height / 2}" rx="${n.width / 2}" ry="${n.height / 2}"`;
  } else if (n.bottomLeftRadius !== undefined && n.bottomLeftRadius !== n.cornerRadius) {
    const r = n.cornerRadius, w = n.width, h = n.height, bl = n.bottomLeftRadius;
    shape = `<path d="M${r},0 H${w - r} A${r},${r} 0 0 1 ${w},${r} V${h - r} A${r},${r} 0 0 1 ${w - r},${h} H${bl} V${h - bl} A${bl},${bl} 0 0 0 0,${h - bl} V${r} A${r},${r} 0 0 1 ${r},0 Z"`;
  } else {
    shape = `<rect x="0" y="0" width="${n.width}" height="${n.height}" rx="${n.cornerRadius || 0}"`;
  }
  let attrs = shape + ` fill="${fill}"`;
  if (stroke !== "none") attrs += ` stroke="${stroke}" stroke-width="${n.strokeWeight || 1}"`;
  attrs += " />";
  const kids = n.children.map(emit).join("\n");
  return `<g transform="translate(${n.x} ${n.y})">\n${attrs}\n${kids}\n</g>`;
}

(async () => {
  const mod = new Function("module", "exports", "require", source + "\n;global.__main = main;");
  mod({ exports: {} }, {}, require);

  if (process.env.SEED_LEFTOVERS) {
    // reproduce the empty frames a failed run leaves behind
    for (let i = 0; i < 2; i++) {
      const f = figma.createFrame();
      f.name = "01 · AI 骑行伙伴 · Chat / 402 × 814";
      f.resize(402, 814);
      figma.currentPage.appendChild(f);
    }
    console.log("seeded 2 leftover empty frames");
  }

  await global.__main();

  const frames = global.figma.currentPage.children;
  const maxX = Math.max(...frames.map((f) => f.x + f.width));
  const maxY = Math.max(...frames.map((f) => f.y + f.height));

  for (const frame of frames) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">\n` +
      `<rect width="${frame.width}" height="${frame.height}" fill="${toHex(frame.fills)}"/>\n` +
      frame.children.map(emit).join("\n") + "\n</svg>";
    const name = frame.name.includes("骑行日历") ? "calendar-screen.svg" : "chat-screen.svg";
    fs.writeFileSync(path.join(here, name), svg);
    console.log("wrote", name, frame.width + "x" + frame.height);
  }

  fs.writeFileSync(path.join(here, "preview.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX}" height="${maxY}" viewBox="0 0 ${maxX} ${maxY}">\n` +
    `<rect width="100%" height="100%" fill="#dfe3e8"/>\n` + frames.map(emit).join("\n") + "\n</svg>");

  console.log("TEXT nodes:", created.filter((n) => n.type === "TEXT").length, "| all nodes:", created.length);
})();
