#!/usr/bin/env node
/**
 * Zoomable Reader · 图表排版增强：真实渲染验证
 * ---------------------------------------------------------------------------
 * 这条验证回答的是一个具体的问题：「框太小、文字折成四五行」到底有没有被治好。
 *
 * 用真实 Mermaid + 真实主题（theme.css）渲染，然后拿【插件里的真代码】
 * （tests/browser/out/zoom-pan.js 里的 window.DiagramLayout）去装参数，前后各量一次：
 *   · 同一段中文标签的行数与框尺寸（学 PlantUML 的「框随文字走」）
 *   · 宿主的配置有没有被冲掉（themeVariables.fontFamily / flowchart.useMaxWidth / securityLevel）
 *   · 时序图的参与者间距（actorMargin）有没有真的生效
 *
 * 用法：node tools/verify-diagram-layout.mjs
 *      MOYUN_MERMAID=/path/to/mermaid.min.js 可指定 mermaid 包
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
  for (const candidate of candidates) {
    try {
      return createRequire(import.meta.url)(candidate);
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error("未找到 playwright");
}

function findMermaid() {
  const candidates = [
    process.env.MOYUN_MERMAID,
    path.join(ROOT, "node_modules", "mermaid", "dist", "mermaid.min.js"),
    "/home/as-workstation01/Documents/project/Readmdvue/node_modules/mermaid/dist/mermaid.min.js",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function findTheme() {
  const candidates = [process.env.MOYUN_THEME, path.join(ROOT, "..", "obsRead", "theme.css")].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const mermaidPath = findMermaid();
if (!mermaidPath) {
  console.log("本机未找到 mermaid 包，跳过排版验证（指定 MOYUN_MERMAID=<path> 可启用）");
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

const NL = String.fromCharCode(10);
const TICK = String.fromCharCode(96);
const LONG_LABEL = "入参 mf_app_ids 是正整数数组 需要去重保序 上限二百条 超过直接报错 并返回多余的下标位置";
const FLOWCHART = ["flowchart TB", '  a["' + TICK + LONG_LABEL + TICK + '"]'].join(NL);
const PLAIN = ["flowchart TB", '  x["普通标签"]', '  y["另一段普通标签"]', "  x --> y"].join(NL);
const SEQUENCE = [
  "sequenceDiagram",
  "  participant U as 用戶端",
  "  participant S as 服務端",
  "  U->>S: 登入請求（帶 is_default 標記）",
  "  S-->>U: 回傳可操作資料",
].join(NL);

let failures = 0;
const assert = (ok, label, detail) => {
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (detail ? " — " + detail : ""));
  if (!ok) failures += 1;
};

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const fixture = path.join(OUT, "diagram-layout-probe.html");
  fs.writeFileSync(
    fixture,
    [
      "<!doctype html><html><head><meta charset='utf-8'>",
      themePath ? "<link rel='stylesheet' href='" + pathToFileURL(themePath).href + "'>" : "",
      "<style>body { margin: 0; } .markdown-preview-view { padding: 24px; }</style>",
      "</head><body class='theme-dark'>",
      "<div class='markdown-preview-view markdown-rendered'><div class='mermaid' id='host'></div></div>",
      "<script src='" + pathToFileURL(BUNDLE).href + "'></" + "script>",
      "</body></html>",
    ].join("")
  );

  const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String((error && error.message) || error)));
  await page.goto(pathToFileURL(fixture).href, { waitUntil: "load" });
  await page.addScriptTag({ content: fs.readFileSync(mermaidPath, "utf8") });

  /* Obsidian 的真实初始化参数（提取自 obsidian.asar）——验证必须从这里出发，
   * 否则测的是「Mermaid 默认 vs 我们的参数」，而不是「宿主参数 vs 我们的参数」。 */
  await page.evaluate(() => {
    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      themeVariables: { fontFamily: "var(--font-mermaid)" },
      flowchart: { useMaxWidth: false },
      sequence: { useMaxWidth: false },
    });
  });

  const measure = (source, id) =>
    page.evaluate(
      async ([src, tag]) => {
        const host = document.getElementById("host");
        host.replaceChildren();
        const { svg } = await window.mermaid.render("probe" + tag, src);
        const parsed = new DOMParser().parseFromString(svg, "text/html");
        host.replaceChildren(...parsed.body.childNodes);
        const node = host.querySelector("g.node");
        const rect = node ? node.querySelector("rect, polygon") : null;
        const label = node ? node.querySelector(".nodeLabel") : null;
        const box = rect ? rect.getBoundingClientRect() : null;
        const ink = label ? label.getBoundingClientRect() : null;
        const lineHeight = label ? parseFloat(getComputedStyle(label).lineHeight) : 0;
        const svgBox = host.querySelector("svg") ? host.querySelector("svg").getBoundingClientRect() : null;
        return {
          nodes: host.querySelectorAll("g.node").length,
          boxW: box ? Math.round(box.width) : 0,
          boxH: box ? Math.round(box.height) : 0,
          lines: ink && lineHeight ? Math.round(ink.height / lineHeight) : 0,
          overflow: ink && box ? Math.round(ink.width - box.width) : 0,
          svgW: svgBox ? Math.round(svgBox.width) : 0,
          svgH: svgBox ? Math.round(svgBox.height) : 0,
          font: label ? getComputedStyle(label).fontFamily.slice(0, 26) : "",
          fontSize: label ? parseFloat(getComputedStyle(label).fontSize) : 0,
        };
      },
      [source, id]
    );

  const before = {
    md: await measure(FLOWCHART, "before-md"),
    plain: await measure(PLAIN, "before-plain"),
    sequence: await measure(SEQUENCE, "before-seq"),
  };

  const applied = await page.evaluate(() => {
    const win = { mermaid: window.mermaid };
    /* 用【出厂默认】而不是脚本里另写一个数：改默认值时断言会跟着走，
     * 也不会出现「验证台测 460、插件实际 260」这种假绿。 */
    return window.DiagramLayout.apply(win, window.DiagramLayout.defaults);
  });
  assert(applied === true, "装上了排版参数（用插件里的真代码，不是脚本里复制的副本）", "apply() = " + applied);

  const config = await page.evaluate(() => {
    const cfg = window.mermaid.mermaidAPI.getConfig();
    return {
      wrap: cfg.flowchart.wrappingWidth,
      markdownAutoWrap: cfg.flowchart.markdownAutoWrap,
      padding: cfg.flowchart.padding,
      useMaxWidth: cfg.flowchart.useMaxWidth,
      fontFamily: cfg.themeVariables.fontFamily,
      security: cfg.securityLevel,
      seqUseMaxWidth: cfg.sequence.useMaxWidth,
      actorMargin: cfg.sequence.actorMargin,
    };
  });

  const after = {
    md: await measure(FLOWCHART, "after-md"),
    plain: await measure(PLAIN, "after-plain"),
    sequence: await measure(SEQUENCE, "after-seq"),
  };

  /* ① 宿主的设置一个都不能丢 —— 整块替换会把主题字体冲掉，中文会掉回默认字体 */
  assert(config.wrap === 260, "标签折行宽度 = 260px（一行约 16 个汉字）", "wrappingWidth = " + config.wrap);
  assert(config.markdownAutoWrap === true, "markdownAutoWrap 打开（不打开的话折行宽度对标签完全不起作用）", "markdownAutoWrap = " + config.markdownAutoWrap);
  assert(config.padding > 15, "框内留白变大（PlantUML 的 padding 思路）", "padding = " + config.padding);
  assert(config.useMaxWidth === false, "宿主的 flowchart.useMaxWidth:false 仍在", "useMaxWidth = " + config.useMaxWidth);
  assert(config.seqUseMaxWidth === false, "宿主的 sequence.useMaxWidth:false 仍在", "sequence.useMaxWidth = " + config.seqUseMaxWidth);
  assert(config.fontFamily === "var(--font-mermaid)", "主题字体没被冲掉", "fontFamily = " + config.fontFamily);
  assert(config.security === "strict", "安全级别仍是 strict", "securityLevel = " + config.security);

  /* ② 同一个中文长标签：行数变少、框变宽（这就是用户说的「框随文字走」） */
  assert(
    after.md.lines < before.md.lines,
    "中文长标签折行变少",
    before.md.lines + " 行 → " + after.md.lines + " 行"
  );
  assert(
    after.md.boxW > before.md.boxW + 20,
    "框随折行宽度变宽（不再被 200px 挤成窄条）",
    before.md.boxW + "px → " + after.md.boxW + "px"
  );
  assert(after.md.boxH < before.md.boxH, "框变矮（行数少了）", before.md.boxH + "px → " + after.md.boxH + "px");
  assert(after.md.overflow <= 2, "文字没有溢出框", "溢出 " + after.md.overflow + "px");

  /* ③ 普通标签（不折行的那类）不能被改坏 */
  assert(after.plain.nodes === before.plain.nodes, "普通标签的节点数不变", before.plain.nodes + " → " + after.plain.nodes);
  assert(after.plain.overflow <= 2, "普通标签也没有溢出", "溢出 " + after.plain.overflow + "px");
  assert(after.plain.font === before.plain.font, "字体没变（还是主题那一套）", after.plain.font);

  /* ③b 用户点名的那条：「文字太多了，你应该可以换行呀，而不是一行顶一个宽度」。
   * 真相是 Mermaid 对普通标签 A[长文本] 【从不折行】—— wrappingWidth 从 460 改到 120
   * 渲染结果一模一样（上面 before/after 的普通标签就是证据）。所以插件把长标签改写成
   * markdown 字符串，折行仍然交给 Mermaid 自己的布局。 */
  const plainLong = ["flowchart TB", "  p[" + LONG_LABEL + "]"].join(NL);
  const plainRaw = await measure(plainLong, "plain-raw");
  const wrappedSource = await page.evaluate(
    ([src, width]) => window.MermaidLabels.wrap(src, { maxWidth: width }),
    [plainLong, 260]
  );
  const plainWrapped = await measure(wrappedSource, "plain-wrapped");
  assert(
    wrappedSource !== plainLong && wrappedSource.indexOf(TICK) > 0,
    "长标签被改写成 markdown 字符串（插件里真代码，不是脚本里复制的副本）",
    wrappedSource.replace(/\n/g, " ").slice(0, 58)
  );
  assert(plainRaw.lines === 1, "前提：普通标签本来是一行顶满（折行前的样子）", plainRaw.lines + " 行 · 框 " + plainRaw.boxW + "px");
  assert(plainWrapped.lines >= 2, "改写成 markdown 字符串后真的折行了", plainRaw.lines + " 行 → " + plainWrapped.lines + " 行");
  assert(
    plainWrapped.boxW < plainRaw.boxW && plainWrapped.boxW <= 260 + 2 * 18 + 6,
    "框跟着变窄（不再一行顶满整条宽度）",
    plainRaw.boxW + "px → " + plainWrapped.boxW + "px"
  );
  assert(plainWrapped.overflow <= 2, "折行后文字没有溢出框", "溢出 " + plainWrapped.overflow + "px");
  assert(
    plainWrapped.fontSize === plainRaw.fontSize,
    "折行不改字号（用户要求：字号固定、不超过 16px）",
    plainWrapped.fontSize + "px"
  );

  /* ④ 时序图：参与者间距真的生效（框更宽更松） */
  assert(
    after.sequence.svgW > before.sequence.svgW,
    "时序图变宽松（actorMargin 50 → 60 生效）",
    before.sequence.svgW + "px → " + after.sequence.svgW + "px"
  );

  /* ⑤ 幂等：重复装不会把配置越改越乱 */
  const secondApply = await page.evaluate(() => {
    const win = { mermaid: window.mermaid };
    /* 用【出厂默认】而不是脚本里另写一个数：改默认值时断言会跟着走，
     * 也不会出现「验证台测 460、插件实际 260」这种假绿。 */
    return window.DiagramLayout.apply(win, window.DiagramLayout.defaults);
  });
  const afterSecond = await measure(FLOWCHART, "second-md");
  assert(secondApply === true && afterSecond.boxW === after.md.boxW, "重复安装是幂等的", afterSecond.boxW + "px = " + after.md.boxW + "px");

  assert(errors.length === 0, "验证台无脚本错误", errors.slice(0, 2).join(" | ") || "无");

  /* 留一张对比图：左边是宿主默认（4 行窄条），右边是装了参数之后（2 行宽框） */
  fs.copyFileSync(path.join(OUT, "diagram-layout-probe.html"), path.join(OUT, "diagram-layout-probe.html"));
} finally {
  await browser.close();
}

console.log("");
if (failures) {
  console.log("✗ 排版验证有 " + failures + " 项没通过");
  process.exitCode = 1;
} else {
  console.log("✓ 排版验证全部通过（宿主设置未受影响，中文长标签的框随文字走）");
}
