#!/usr/bin/env node
/**
 * Zoomable Reader · 图表放大后「标签不许走形」验证
 * ---------------------------------------------------------------------------
 * 为什么单独有这一条：这个 bug 用户是用截图报的 —— 放大后标签撑破外框、文字互相覆盖
 * （「怎么编成这个鬼样子」）。根因不是渲染，而是【CSS 作用域被搬丢了】：
 * 主题里图表的字号/行高/颜色全部挂在 `.mermaid svg …` 下，而查看器只搬 <svg>，
 * 搬完标签就掉回 Mermaid 的内联字号，foreignObject 的高度是按搬之前算的，
 * 于是文字溢出、叠在一起。
 *
 * 这个脚本用【真实 Mermaid 渲染 + 真实主题】复现并守死它：
 *   ① 先在笔记里量每个 foreignObject（外框宽 / 内容宽 / 字号）；
 *   ② 打开查看器（走真实的 openNode 搬移路径）；
 *   ③ 再量一次：数量、字号、溢出必须与搬运前一致。
 *
 * 用法：npm run verify:labels
 * 环境变量：MOYUN_THEME=主题 css 路径（默认读本机主题仓库）；MOYUN_MERMAID=mermaid.min.js 路径。
 * 退出码：0 通过；1 失败；本机缺少 mermaid 时明确跳过（不假装通过）。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tests", "browser", "out");
fs.mkdirSync(OUT, { recursive: true });

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, "node_modules", "playwright"),
    "/home/as-workstation01/Documents/project/Chrome/node_modules/playwright",
    "playwright",
  ];
  for (const c of candidates) {
    try { return createRequire(import.meta.url)(c); } catch { /* 试下一个 */ }
  }
  throw new Error("未找到 playwright");
}

function findMermaid() {
  const candidates = [
    process.env.MOYUN_MERMAID,
    "/home/as-workstation01/Documents/project/Readmdvue/node_modules/mermaid/dist/mermaid.min.js",
    path.join(ROOT, "node_modules", "mermaid", "dist", "mermaid.min.js"),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

/* 主题路径只从「显式环境变量」或「同级 checkout」里找：
 * 不假设用户的 Obsidian 配置目录叫 .obsidian（它可以被改名，插件里应当用 Vault#configDir），
 * 也不把本机绝对路径写死进开源仓库。 */
function findTheme() {
  const candidates = [
    process.env.MOYUN_THEME,
    path.join(ROOT, "..", "obsRead", "theme.css"),
  ].filter(Boolean);
  return candidates.find((c) => fs.existsSync(c)) || null;
}

const mermaidPath = findMermaid();
if (!mermaidPath) {
  console.log("本机未找到 mermaid 包，跳过标签走形验证（指定 MOYUN_MERMAID=<path> 可启用）");
  process.exit(0);
}
const themePath = findTheme();
const { chromium } = loadPlaywright();
const CHROME = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
const BUNDLE = path.join(OUT, "zoom-pan.js");
if (!fs.existsSync(BUNDLE)) {
  console.error("缺少 " + BUNDLE + "，请先执行 npm run build:tests");
  process.exit(1);
}

/* 用用户报障那种图：长中文标签、<br/> 换行、子图、跨列节点 —— 最容易撑破外框的形状 */
const DIAGRAM = [
  "flowchart TB",
  '  A["接口 I-01 校验查询 Check（对外唯一 HTTP · 只读）"] --> B["POST<br/>/api/mf/reserve/check"]',
  "  subgraph UI[UI-01 位置功能：建议书添加个案 与 提交建议书 两个时点的逐条核验]",
  '    C["操作项：添加核验 | 提交核验"] --> D["入参 mf_app_ids: [1001, 1002]（正整数数组 去重保序 上限 200）"]',
  '    D --> E["出参 summary: total, available, unavailable_no,<br/>只读：只查 reserve_queue；<br/>reserve_submitted 仅决定文案分流"]',
  '    E --> F["结果区（逐条）：有钱发 与 没钱发 与 原因"]',
  '    E --> G["汇总区：整批是否全部可用"]',
  '    H["输入区：待核验个案清单"] --> E',
  "  end",
].join("\n");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const findings = [];
const assert = (ok, label, detail) => {
  findings.push({ ok: !!ok, label: label });
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (detail ? " — " + detail : ""));
};

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  /* 夹具页必须写进磁盘并用 file:// 打开：about:blank 页面加载不了 file:// 的样式表，
   * 主题就等于没生效 —— 那样测出来的是「Mermaid 默认 vs Mermaid 默认」，一个假绿。
   * （这条是本脚本自己踩过的坑。） */
  const fixture = path.join(OUT, "label-probe.html");
  fs.writeFileSync(
    fixture,
    [
      "<!doctype html><html><head><meta charset='utf-8'>",
      themePath ? "<link rel='stylesheet' href='" + pathToFileURL(themePath).href + "'>" : "",
      "<link rel='stylesheet' href='" + pathToFileURL(path.join(ROOT, "styles.css")).href + "'>",
      "<style>body { margin: 0; } .markdown-preview-view { padding: 24px; }</style>",
      "</head><body class='theme-dark theme-light'>",
      "<div class='markdown-preview-view markdown-rendered'><div class='mermaid' id='host'></div></div>",
      "<script src='" + pathToFileURL(BUNDLE).href + "'></" + "script>",
      "</body></html>",
    ].join("")
  );
  await page.goto(pathToFileURL(fixture).href, { waitUntil: "load" });
  await page.addScriptTag({ content: fs.readFileSync(mermaidPath, "utf8") });

  await page.evaluate(async (source) => {
    /* 与 Obsidian 的真实初始化参数保持一致（不切主题、useMaxWidth:false） */
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      themeVariables: { fontFamily: "var(--font-mermaid)" },
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
    const { svg } = await window.mermaid.render("label-probe", source);
    /* 不用 innerHTML：用 DOMParser 显式解析 Mermaid 产出的 SVG 再挂进夹具。
     * （HTML 解析器认识 <svg> 与 foreignObject 的集成点，结构不会走样。） */
    const parsed = new DOMParser().parseFromString(svg, "text/html");
    const host = document.getElementById("host");
    host.replaceChildren(...parsed.body.childNodes);
    window.labelLightbox = new window.ImageLightbox(document, { fitOnOpen: true, maxScale: 64 });
  }, DIAGRAM);
  await page.waitForTimeout(150);

  /* 只量 foreignObject（HTML 标签）：SVG <text> 不会被重排，出问题的就是这些 HTML 标签 */
  /* 量的全部换算到【用户坐标系】（除以 svg 当前的显示缩放）：
   * getBoundingClientRect() 会把「笔记里把图压到版心内」与「查看器的缩放」都算进去，
   * 拿它直接比对，得到的差值里混着两种缩放，分不清是布局变了还是显示变了（这条路我走过，是假的）。
   * 用户坐标是变换无关的，布局有没有变一目了然。 */
  const measure = () => page.evaluate(() => {
    const svg = document.querySelector("svg");
    const viewBox = svg ? (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number) : [];
    const vbWidth = viewBox.length === 4 && viewBox[2] ? viewBox[2] : (svg ? svg.getBoundingClientRect().width : 1);
    const svgWidth = svg ? svg.getBoundingClientRect().width : 1;
    const scale = svgWidth / vbWidth;
    const toUser = (value) => (scale > 0 ? value / scale : value);
    return {
      scale: Math.round(scale * 1000) / 1000,
      svgWidth: Math.round(svgWidth),
      labels: Array.from(document.querySelectorAll("svg foreignObject")).map((fo) => {
        const inner = fo.firstElementChild;
        const foRect = fo.getBoundingClientRect();
        const innerRect = inner ? inner.getBoundingClientRect() : { width: 0, height: 0 };
        return {
          foWidth: Math.round(toUser(foRect.width)),
          foHeight: Math.round(toUser(foRect.height)),
          innerWidth: Math.round(toUser(innerRect.width)),
          innerHeight: Math.round(toUser(innerRect.height)),
          fontSize: inner ? getComputedStyle(inner).fontSize : "",
          text: inner ? String(inner.textContent || "").slice(0, 18) : "",
        };
      }),
    };
  });

  const beforeAll = await measure();
  const before = beforeAll.labels;
  assert(before.length > 0, "笔记里有可测的 HTML 标签（foreignObject）", before.length + " 个");
  const beforeFont = before.length ? before[0].fontSize : "";

  /* 对照组：不搬移、只等同样长的时间再量一次。
   * 为什么需要它：字体加载/合成时机也会让标签宽度有 1~2px 抖动，没有对照组就分不清
   * 「搬移导致的走形」与「时间导致的抖动」，容易改出假红或假绿。 */
  await page.waitForTimeout(250);
  const beforeAgain = (await measure()).labels;
  const maxDelta = (a, b) =>
    a.reduce((acc, item, i) => {
      const other = b[i] || { foWidth: 0, foHeight: 0, innerWidth: 0, innerHeight: 0 };
      return Math.max(acc, Math.abs(other.foWidth - item.foWidth), Math.abs(other.innerWidth - item.innerWidth),
        Math.abs(other.innerHeight - item.innerHeight));
    }, 0);
  const noise = maxDelta(before, beforeAgain);
  /* 主题生效证明：主题把图内文字设成 calc(var(--my-font-size-base) * 0.875)（16×0.875=14px）。
   * 若这里读出 16px，说明主题样式压根没加载，后面的对比全是假绿。 */
  assert(parseFloat(beforeFont) < 16, "主题的图表文字样式确实生效（字号 < 16px 默认值）",
    "fontSize=" + beforeFont + "，主题=" + (themePath ? path.basename(themePath) : "(未找到，未加载)"));

  await page.evaluate(() => {
    const svg = document.querySelector("#host svg");
    window.labelLightbox.openNode(svg, { title: "Mermaid diagram" });
  });
  await page.waitForTimeout(200);
  const moved = await page.evaluate(() => !!document.querySelector(".zr-lightbox-node svg"));
  assert(moved, "图表已搬进查看器（走真实搬移路径）", "moved=" + moved);

  /* 量之前把查看器的缩放归零：查看器打开时会「适配窗口」（scale≈0.94），
   * 那会让 getBoundingClientRect() 整体缩一圈，看起来像标签走形 —— 其实是假的。
   * 这里要验的是「搬移有没有改变标签自身的排版」，所以先把变换拿掉再量。 */
  await page.evaluate(() => {
    const canvas = document.querySelector(".zr-lightbox-canvas");
    if (canvas) canvas.style.transform = "none";
  });
  await page.waitForTimeout(120);

  const afterAll = await measure();
  const after = afterAll.labels;
  assert(after.length === before.length, "搬运后标签数量不变（图没有被重新渲染成两份）",
    before.length + " → " + after.length);
  const afterFont = after.length ? after[0].fontSize : "";
  assert(afterFont === beforeFont, "搬运后标签字号不变（.mermaid 的样式作用域没丢）",
    beforeFont + " → " + afterFont);

  /* 逐标签比几何：不看绝对值（Mermaid 自己给外框留的余量各有不同），只看
   * 「搬运前后有没有变化」——变化了就是样式作用域丢了，文字会叠、会溢出。 */
  const deltas = before.map((b, i) => {
    const a = after[i] || { foWidth: -999, foHeight: -999, innerWidth: -999, innerHeight: -999, fontSize: "", text: b.text };
    return {
      text: b.text,
      dFont: a.fontSize === b.fontSize ? 0 : 1,
      dFoW: Math.abs(a.foWidth - b.foWidth),
      dFoH: Math.abs(a.foHeight - b.foHeight),
      dInW: Math.abs(a.innerWidth - b.innerWidth),
      dInH: Math.abs(a.innerHeight - b.innerHeight),
    };
  });
  const fontChanged = deltas.filter((d) => d.dFont !== 0);
  assert(fontChanged.length === 0, "每个标签的字号都与搬运前逐个相同",
    fontChanged.length ? fontChanged.map((d) => d.text).join(" | ") : deltas.length + " 个标签字号一致");

  /* 溢出容差：设备空间取整会让同一标签在不同显示比例下差百分之几，
   * 因此「溢出」也按相对量判：超过外框 8% 才算破相（历史 bug 是 21%，照样会被抓到）。 */
  const overflowing = after.filter((m) => {
    const overW = m.innerWidth - m.foWidth;
    const overH = m.innerHeight - m.foHeight;
    const tolW = Math.max(2, m.foWidth * 0.08);
    const tolH = Math.max(2, m.foHeight * 0.08);
    return overW > tolW || overH > tolH;
  });
  assert(overflowing.length === 0, "搬移后没有标签明显溢出外框（放大后文字不压到别人身上）",
    overflowing.length
      ? overflowing.slice(0, 3).map((m) => m.text + " 内容" + m.innerWidth + ">外框" + m.foWidth).join(" | ")
      : after.length + " 个标签都在容差内");
  const movedMax = deltas.reduce((acc, d) => Math.max(acc, d.dFoW, d.dFoH, d.dInW, d.dInH), 0);
  const worstRel = deltas.reduce((acc, d, i) => {
    const base = before[i] ? Math.max(before[i].foWidth, before[i].innerWidth, 1) : 1;
    return Math.max(acc, Math.max(d.dFoW, d.dInW) / base);
  }, 0);
  assert(worstRel <= 0.08, "形变幅度在 8% 容差内（布局没有被重排）",
    "最大形变 " + movedMax + "px / 相对 " + Math.round(worstRel * 1000) / 10 + "%，对照组抖动 " + noise + "px");

  /* 刻意【不】断言「查看器里的显示比例与笔记相同」：查看器要做的正是把图放大，
   * 比例不同是功能而不是缺陷。这里只守「布局不许变」——布局变了的表征就是
   * 标签在用户坐标系里的尺寸变了（上面那条断言）。 */
  assert(errors.length === 0, "验证台无脚本错误", errors.slice(0, 2).join(" | ") || "无");
} finally {
  await browser.close();
}

const failed = findings.filter((f) => !f.ok);
console.log("\n断言 " + (findings.length - failed.length) + "/" + findings.length + " 通过");
console.log("截图：tests/browser/out/lightbox-label-check.png");
if (failed.length) {
  console.log("\n未通过：");
  for (const f of failed) console.log("  ✗ " + f.label);
  process.exit(1);
}
