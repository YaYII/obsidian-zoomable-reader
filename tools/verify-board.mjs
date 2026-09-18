#!/usr/bin/env node
/**
 * Zoomable Reader · 白板模式验证台（真实浏览器 + 真实事件）
 * ---------------------------------------------------------------------------
 * 为什么要有它：白板模式的三件关键事情，**读代码都看不出来** ——
 *   ① 排版好不好（卡片会不会叠在一起、连线对不对得上卡片边缘）；
 *   ② 高度对不对（先估算、渲染完再按真实高度重排，这条两遍的路子成不成立）；
 *   ③ 手势通不通（手机上单指平移、双指捏合、点卡片聚焦）。
 * 所以这里在真实 Chromium 里渲染一块真白板，用真鼠标 / CDP 合成触摸驱动它，
 * 断言「DOM 实测」而不是断言「我以为」。
 *
 * 用法：npm run verify:board
 * 退出码：0 全部通过；1 有断言失败。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "tests", "browser", "out");
const DOCS = path.join(ROOT, "docs", "images");
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DOCS, { recursive: true });

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
  throw new Error("未找到 playwright，请先安装：npm i -D playwright");
}

const { chromium } = loadPlaywright();
const CHROME = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
const HARNESS = pathToFileURL(path.join(ROOT, "tests", "browser", "board.html")).href;
const BUNDLE = path.join(OUT, "zoom-pan.js");
if (!fs.existsSync(BUNDLE)) {
  console.error("缺少验证台打包产物 " + BUNDLE + "，请先执行 npm run build:tests");
  process.exit(1);
}

const findings = [];
function assert(ok, label, detail) {
  findings.push({ ok: !!ok, label: label, detail: detail || "" });
  console.log((ok ? "  ✓ " : "  ✗ ") + label + (detail ? " — " + detail : ""));
}
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? 1.5 : tol);
const fmt = (n) => String(Math.round(n * 1000) / 1000);

/** 两块矩形是否重叠（容差 0.6px：亚像素布局不当作重叠） */
function overlap(a, b, tol = 0.6) {
  return a.left < b.left + b.width - tol && b.left < a.left + a.width - tol && a.top < b.top + b.height - tol && b.top < a.top + a.height - tol;
}

/**
 * 挑一张「点得到」的卡：优先完整落在视口里的叶子卡。
 * 卡片是 A5（560px）之后，窄屏上往往没有一张能完整放下 —— 那就先回到全图再挑，
 * 否则测试会拿一个屏幕外的坐标去点（点不到不是插件的错，是测试没准备好）。
 */
async function pickClickableCard(page, viewport, model) {
  const leafIds = new Set(model.filter((n) => n.children.length === 0 && n.depth > 0).map((n) => n.id));
  const read = () => page.evaluate(() => window.harness.domCards());
  const inside = (c) => c.left >= 0 && c.top >= 0 && c.left + c.width <= viewport.width && c.top + c.height <= viewport.height;
  let cards = (await read()).filter(inside);
  if (cards.length === 0) {
    await page.evaluate(() => window.harness.fitBoard());
    await page.waitForTimeout(140);
    cards = (await read()).filter(inside);
  }
  if (cards.length === 0) return null;
  const rect = cards.find((c) => leafIds.has(c.id)) || cards[cards.length - 1];
  const node = model.find((n) => n.id === rect.id);
  return node ? { node: node, rect: rect } : null;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  /* ======================= 一、桌面：排版几何 + 鼠标手势 ======================= */
  console.log("\n=== 桌面视口 1000x720（排版几何 + 鼠标 + 滚轮）===");
  const desktop = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
  await page.goto(HARNESS, { waitUntil: "load" });
  await page.waitForFunction(() => window.harness && window.harness.snapshot().cards > 0);

  const state = () => page.evaluate(() => window.harness.state());
  const rect = await page.evaluate(() => window.harness.rect());
  const model = await page.evaluate(() => window.harness.modelCards());
  const boardSize = await page.evaluate(() => window.harness.board());
  const snapshot = Object.assign(
    await page.evaluate(() => window.harness.snapshot()),
    { cardWidth: await page.evaluate(() => window.harness.cardWidth()) }
  );
  const contentPointAt = (cx, cy) =>
    page.evaluate(
      (args) => window.harness.contentPoint(args[0] - window.harness.rect().left, args[1] - window.harness.rect().top),
      [cx, cy]
    );

  // ① 出厂默认：卡片就是一张 A5 纸，且打开即原大（用户反馈「白板看起来尺寸很小」的对策）
  const defaults = await page.evaluate(() => ({
    width: window.ZoomableReaderDefaults.boardCardWidth,
    paper: window.Paper.nameFor(window.ZoomableReaderDefaults.boardCardWidth),
    mm: window.Paper.toMm(window.ZoomableReaderDefaults.boardCardWidth),
    label: window.Paper.label(window.ZoomableReaderDefaults.boardCardWidth),
    mode: window.ZoomableReaderDefaults.defaultMode,
  }));
  assert(defaults.paper === "A5", "默认卡片宽度 = A5 纸（148mm）", defaults.width + "px · " + defaults.mm + "mm · " + defaults.label);
  assert(Math.abs(defaults.width - 560) <= 4, "A5 在 96dpi 下的像素值正确（148 / 25.4 × 96 ≈ 560）", defaults.label);
  assert(near(snapshot.scale, 1, 0.001), "打开白板即 100% 原大（不再缩到整块板/标题卡）", "scale=" + fmt(snapshot.scale));
  const openDom = await page.evaluate(() => window.harness.domCards());
  const topMost = Math.min(...openDom.map((c) => c.top));
  const leftMost = Math.min(...openDom.map((c) => c.left));
  /* 白板自身留白 40 + 视口留白 16 = 56：内容就该从这个位置开始，
   * 而不是像「父子垂直居中」时那样被推到屏幕中段（那才是用户看到的「一大块空白」）。 */
  assert(
    topMost <= 60 && leftMost <= 60,
    "打开即原大：内容贴着左上角（不再有一大片上方留白，看着「很小」）",
    "最上面的卡 top=" + fmt(topMost) + "，最左的卡 left=" + fmt(leftMost)
  );
  assert(snapshot.cards === model.length && model.length >= 5, "每个标题都编译成一张卡", "卡片 " + snapshot.cards + " / 模型节点 " + model.length);
  assert(model.some((n) => n.title.indexOf("手势清单") >= 0), "中文标题原样成卡", model.map((n) => n.title).slice(0, 4).join(" / "));

  // ② 排版几何：把 layer 归零到 100%，于是 DOM 坐标 = 排版坐标，可以逐张对
  await page.evaluate(() => window.harness.reset(0));
  await page.waitForTimeout(60);
  const layout = await page.evaluate(() => window.harness.layout());
  const dom = await page.evaluate(() => window.harness.domCards());
  const links = await page.evaluate(() => window.harness.links());
  const byId = new Map(layout.map((c) => [c.id, c]));
  assert(
    layout.every((c) => Math.abs(c.width - snapshot.cardWidth) < 0.5),
    "每张卡的宽度都等于设置里的纸张宽度（A5 一列到底）",
    layout[0].width + "px"
  );

  const overlapping = [];
  for (let i = 0; i < dom.length; i += 1) {
    for (let j = i + 1; j < dom.length; j += 1) {
      if (overlap(dom[i], dom[j])) overlapping.push(dom[i].id + "×" + dom[j].id);
    }
  }
  assert(overlapping.length === 0, "DOM 实测：卡片两两不重叠", overlapping.slice(0, 3).join(", ") || dom.length + " 张卡片");

  const outsideBoard = layout.filter(
    (c) => c.x < -0.5 || c.y < -0.5 || c.x + c.width > boardSize.width + 0.5 || c.y + c.height > boardSize.height + 0.5
  );
  assert(outsideBoard.length === 0, "每张卡都在白板边界内", outsideBoard.map((c) => c.id).join(", ") || "板子 " + boardSize.width + "x" + boardSize.height);

  const mismatched = layout.filter((c) => {
    const node = dom.find((d) => d.id === c.id);
    return !node || Math.abs(node.left - c.x) > 1.5 || Math.abs(node.top - c.y) > 1.5 || Math.abs(node.height - c.height) > 1.5;
  });
  assert(
    mismatched.length === 0,
    "100% 时卡片 DOM 位置/高度 = 排版结果（第二遍按真实高度重排生效）",
    mismatched.map((c) => c.id).join(", ") || "全部一致"
  );

  const relations = model.reduce((sum, n) => sum + n.children.length, 0);
  assert(links.length === relations && relations > 0, "连线条数 = 父子关系数", links.length + " / " + relations);

  const badLinks = links.filter((l) => {
    const from = byId.get(l.from);
    const to = byId.get(l.to);
    if (!from || !to) return true;
    return !(
      near(l.x1, from.x + from.width, 0.5) &&
      near(l.y1, from.y + from.height / 2, 0.5) &&
      near(l.x2, to.x, 0.5) &&
      near(l.y2, to.y + to.height / 2, 0.5)
    );
  });
  assert(badLinks.length === 0, "连线端点贴父卡右中 / 子卡左中", badLinks.map((l) => l.from + "→" + l.to).join(", ") || links.length + " 条");

  const pathCheck = await page.evaluate(() => {
    const svg = document.querySelector(".zr-board-links");
    const paths = Array.from(svg.querySelectorAll("path"));
    const t = window.harness.state();
    return paths.map((p) => {
      const m = /^M ([-\d.]+) ([-\d.]+) C .+, ([-\d.]+) ([-\d.]+)$/.exec(p.getAttribute("d") || "");
      return {
        from: p.getAttribute("data-from"),
        to: p.getAttribute("data-to"),
        x1: m ? parseFloat(m[1]) * t.scale + t.x : NaN,
        y1: m ? parseFloat(m[2]) * t.scale + t.y : NaN,
        x2: m ? parseFloat(m[3]) * t.scale + t.x : NaN,
        y2: m ? parseFloat(m[4]) * t.scale + t.y : NaN,
      };
    });
  });
  const domById = new Map(dom.map((d) => [d.id, d]));
  const badPaths = pathCheck.filter((p) => {
    const from = domById.get(p.from);
    const to = domById.get(p.to);
    if (!from || !to) return true;
    return !(
      near(p.x1, from.left + from.width, 1.5) &&
      near(p.y1, from.top + from.height / 2, 1.5) &&
      near(p.x2, to.left, 1.5) &&
      near(p.y2, to.top + to.height / 2, 1.5)
    );
  });
  assert(badPaths.length === 0, "SVG 连线真的落在卡片边缘上（渲染后实测）", badPaths.length + " 条偏差");

  await page.screenshot({ path: path.join(DOCS, "screenshot-board-desktop.png"), fullPage: false });
  await page.screenshot({ path: path.join(OUT, "board-desktop.png"), fullPage: false });

  // ③ 拖动 = 平移（不改缩放）
  await page.evaluate(() => window.harness.reset(16));
  const d0 = await state();
  const dragFrom = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i += 1) await page.mouse.move(dragFrom.x + i * 12, dragFrom.y + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(60);
  const d1 = await state();
  assert(near(d1.x - d0.x, 60, 3) && near(d1.y - d0.y, 30, 3), "鼠标拖动 → 白板平移", "Δx=" + fmt(d1.x - d0.x) + " Δy=" + fmt(d1.y - d0.y));
  assert(near(d1.scale, d0.scale, 0.0001), "拖动不改变缩放", "scale=" + fmt(d1.scale));

  // ④ 拖动之后的那次 click 不该被当成「点卡片」
  assert(near((await state()).scale, 1, 0.0001), "拖动结束的 click 不触发聚焦（缩放仍是 100%）", "scale=" + fmt((await state()).scale));

  // ⑤ Ctrl+滚轮：以指针为锚点缩放（核心不变量）
  const anchor = { x: rect.left + 320, y: rect.top + 260 };
  const before = await state();
  const cpBefore = await contentPointAt(anchor.x, anchor.y);
  await page.mouse.move(anchor.x, anchor.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -300);
  await page.keyboard.up("Control");
  await page.waitForTimeout(60);
  const after = await state();
  const cpAfter = await contentPointAt(anchor.x, anchor.y);
  assert(after.scale > before.scale * 1.5, "Ctrl+滚轮 → 放大白板", fmt(before.scale) + " → " + fmt(after.scale));
  assert(near(cpAfter.x, cpBefore.x, 0.8) && near(cpAfter.y, cpBefore.y, 0.8), "缩放的锚点在指针下（锚点不变量）", "偏差 " + fmt(Math.abs(cpAfter.x - cpBefore.x)) + "px");

  // ⑥ 普通滚轮 = 平移
  const w0 = await state();
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(60);
  const w1 = await state();
  assert(near(w1.y - w0.y, -100, 2) && near(w1.scale, w0.scale, 0.0001), "普通滚轮 → 平移而非缩放", "Δy=" + fmt(w1.y - w0.y));

  // ⑦ 双击 = 放大到 200%，再双击回 100%
  await page.evaluate(() => window.harness.reset(16));
  await page.mouse.dblclick(dragFrom.x, dragFrom.y);
  await page.waitForTimeout(80);
  const db1 = await state();
  assert(near(db1.scale, 2, 0.05), "双击 → 放大到 200%", "scale=" + fmt(db1.scale));
  await page.mouse.dblclick(dragFrom.x, dragFrom.y);
  await page.waitForTimeout(80);
  const db2 = await state();
  assert(near(db2.scale, 1, 0.05), "再双击 → 回到 100%", "scale=" + fmt(db2.scale));

  // ⑧ 点卡片标题 = 把这张卡放到眼前（并在视口内完整可见）
  await page.evaluate(() => window.harness.reset(16));
  await page.waitForTimeout(40);
  /* 挑一张【当前真的看得见】的卡来点：视野外的卡点不到（这是测试自己的事，不是插件的事）。 */
  const picked = await pickClickableCard(page, rect, model);
  assert(!!picked, "能找到一张可点击的卡（用于验证点标题聚焦）", picked ? picked.node.title : "一张都点不到");
  const leafBefore = picked.rect;
  const leaf = picked.node;
  const headBox = await page.evaluate((id) => window.harness.cardHeadBox(id), leaf.id);
  await page.mouse.click(rect.left + headBox.left + headBox.width / 2, rect.top + headBox.top + headBox.height / 2);
  /* 聚焦带 240ms 过渡（.zr-animating）：必须等它走完再量，
   * 否则量到的是动画中间态（getBoundingClientRect 会跟着过渡走）。 */
  await page.waitForTimeout(420);
  const leafAfter = (await page.evaluate(() => window.harness.domCards())).find((c) => c.id === leaf.id);
  assert(
    near(leafAfter.left + leafAfter.width / 2, rect.width / 2, 12) && near(leafAfter.top + leafAfter.height / 2, rect.height / 2, 12),
    "点卡片标题 → 这张卡居中放到眼前",
    leaf.title + " 中心 (" + fmt(leafAfter.left + leafAfter.width / 2) + ", " + fmt(leafAfter.top + leafAfter.height / 2) + ")"
  );
  const visible = leafAfter.left >= -1 && leafAfter.top >= -1 && leafAfter.left + leafAfter.width <= rect.width + 1 && leafAfter.top + leafAfter.height <= rect.height + 1;
  assert(visible, "聚焦后这张卡完整落在视口内（不用再找）", fmt(leafAfter.width) + "x" + fmt(leafAfter.height));

  // ⑨ 点正文不该聚焦（正文里的链接保持链接语义）
  const bodyTarget = (await page.evaluate(() => window.harness.domCards())).find((c) => c.id === leaf.id);
  const scaleBeforeBody = (await state()).scale;
  await page.mouse.click(rect.left + bodyTarget.left + bodyTarget.width / 2, rect.top + bodyTarget.top + bodyTarget.height - 6);
  await page.waitForTimeout(80);
  assert(near((await state()).scale, scaleBeforeBody, 0.0001), "点正文（不是标题）不触发聚焦", "scale=" + fmt((await state()).scale));

  // ⑩ 回到全图：整块白板都进视口
  await page.evaluate(() => window.harness.fitBoard());
  await page.waitForTimeout(80);
  const fitDom = await page.evaluate(() => window.harness.domCards());
  const outsideView = fitDom.filter(
    (c) => c.left < -1 || c.top < -1 || c.left + c.width > rect.width + 1 || c.top + c.height > rect.height + 1
  );
  assert(outsideView.length === 0, "回到全图：所有卡片都在视口内", outsideView.map((c) => c.id).join(", ") || fitDom.length + " 张");

  /* ⑪ 模式类与可见性：1.3.0「白板一片空白」那个真机 bug 的回归断言
   *    真机时序：onOpen() 按设置（默认版面）把类设成 zr-mode-page → setState() 把模式改成
   *    白板，却没有人再改类 → 白板渲染进 display:none 的那一层，用户看到空的版面层。
   *    这里先用同样的时序复现（必须看得见 0 张卡），再验修复后的渲染路径（必须全可见）。 */
  const visibleNormal = await page.evaluate(() => window.harness.visibleCards());
  assert(visibleNormal === model.length, "正常渲染：卡片真的可见（可见宽高 > 0）", visibleNormal + " / " + model.length);

  await page.evaluate(() => window.harness.setModeClasses("page"));
  await page.evaluate(() => window.harness.renderWithoutModeClasses("board"));
  const visibleBroken = await page.evaluate(() => window.harness.visibleCards());
  assert(
    visibleBroken === 0,
    "复现 1.3.0 的 bug：渲染前不对齐模式类 → 白板落进 display:none 的层，一张卡都看不见",
    visibleBroken + " 张可见"
  );

  await page.evaluate(() => window.harness.renderFileMode("board"));
  const visibleFixed = await page.evaluate(() => window.harness.visibleCards());
  const modeClasses = await page.evaluate(() => window.harness.modeClasses());
  assert(
    visibleFixed === model.length && modeClasses.indexOf("zr-mode-board") >= 0,
    "修复后：渲染路径自己对齐模式类 → 卡片全部可见（这条断言必须一直绿）",
    visibleFixed + " / " + model.length + " · class=" + modeClasses
  );
  assert(pageErrors.length === 0, "桌面验证台无脚本错误", pageErrors.slice(0, 2).join(" | ") || "无");
  await desktop.close();

  /* ======================= 二、手机：真实触摸事件 ======================= */
  console.log("\n=== 手机视口 390x780（CDP 合成触摸：单指拖动 / 双指捏合 / 点标题）===");
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();
  const mErrors = [];
  mpage.on("pageerror", (e) => mErrors.push(String((e && e.message) || e)));
  await mpage.goto(HARNESS, { waitUntil: "load" });
  await mpage.waitForFunction(() => window.harness && window.harness.snapshot().cards > 0);

  const client = await mobile.newCDPSession(mpage);
  const touch = (type, points) =>
    client.send("Input.dispatchTouchEvent", {
      type: type,
      touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id === undefined ? i + 1 : p.id })),
    });
  const tap = async (x, y) => {
    await touch("touchStart", [{ x: x, y: y }]);
    await touch("touchEnd", []);
  };
  const mstate = () => mpage.evaluate(() => window.harness.state());
  const mrect = await mpage.evaluate(() => window.harness.rect());
  const mcenter = { x: mrect.left + mrect.width / 2, y: mrect.top + mrect.height / 2 };

  // ⑪ 单指拖动 = 平移
  await mpage.evaluate(() => window.harness.reset(16));
  const t0 = await mstate();
  await touch("touchStart", [{ x: 200, y: 400 }]);
  for (let i = 1; i <= 6; i += 1) await touch("touchMove", [{ x: 200 + i * 10, y: 400 - i * 4 }]);
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const t1 = await mstate();
  assert(near(t1.x - t0.x, 60, 6) && near(t1.y - t0.y, -24, 6), "单指拖动 → 白板跟随平移", "Δx=" + fmt(t1.x - t0.x) + " Δy=" + fmt(t1.y - t0.y));
  assert(near(t1.scale, t0.scale, 0.0001), "单指拖动不改变缩放", "scale=" + fmt(t1.scale));

  // ⑫ 双指捏合 = 放大（以两指中点为锚点）
  await mpage.evaluate(() => window.harness.reset(16));
  await mpage.waitForTimeout(40);
  const p0 = await mstate();
  const midLocal = { x: mcenter.x - mrect.left, y: 400 - mrect.top };
  const midBefore = await mpage.evaluate((p) => window.harness.contentPoint(p[0], p[1]), [midLocal.x, midLocal.y]);
  await touch("touchStart", [{ x: 145, y: 400, id: 1 }, { x: 245, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i += 1) {
    await touch("touchMove", [{ x: 145 - i * 6, y: 400, id: 1 }, { x: 245 + i * 6, y: 400, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const p1 = await mstate();
  assert(p1.scale > p0.scale * 1.8 && p1.scale < p0.scale * 2.2, "双指张开 → 放大（距离翻倍 ≈ 2 倍）", fmt(p0.scale) + " → " + fmt(p1.scale));
  const midAfter = await mpage.evaluate((p) => window.harness.contentPoint(p[0], p[1]), [midLocal.x, midLocal.y]);
  assert(
    near(midAfter.x, midBefore.x, 1.5) && near(midAfter.y, midBefore.y, 1.5),
    "双指缩放的锚点是两指中点（中点下的内容不动）",
    "偏差 " + fmt(Math.abs(midAfter.x - midBefore.x)) + "px"
  );

  // ⑬ 关掉双指开关：捏合不再缩放（用户找不到的那个开关，行为要真的可控）
  await mpage.evaluate(() => window.harness.setPinch(false));
  await mpage.evaluate(() => window.harness.reset(16));
  await mpage.waitForTimeout(40);
  const off0 = await mstate();
  await touch("touchStart", [{ x: 145, y: 400, id: 1 }, { x: 245, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i += 1) {
    await touch("touchMove", [{ x: 145 - i * 6, y: 400, id: 1 }, { x: 245 + i * 6, y: 400, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const off1 = await mstate();
  assert(near(off1.scale, off0.scale, 0.0001), "关掉「双指捏合缩放」后：捏合不再改变缩放", "scale=" + fmt(off1.scale));
  await mpage.evaluate(() => window.harness.setPinch(true));

  // ⑭ 双击 = 放大到 200%
  await mpage.evaluate(() => window.harness.reset(16));
  await tap(200, 420);
  await mpage.waitForTimeout(60);
  await tap(200, 420);
  await mpage.waitForTimeout(90);
  const dbl = await mstate();
  assert(near(dbl.scale, 2, 0.06), "手机双击 → 放大到 200%", "scale=" + fmt(dbl.scale));

  // ⑮ 点卡片标题 → 聚焦
  await mpage.evaluate(() => window.harness.reset(16));
  await mpage.waitForTimeout(40);
  const mModel = await mpage.evaluate(() => window.harness.modelCards());
  const mPicked = await pickClickableCard(mpage, mrect, mModel);
  assert(!!mPicked, "手机上也能找到一张可点击的卡（560px 的 A5 卡在窄屏上要先回到全图）", mPicked ? mPicked.node.title : "一张都点不到");
  const mDomBefore = mPicked.rect;
  const mLeaf = mPicked.node;
  const mHeadBox = await mpage.evaluate((id) => window.harness.cardHeadBox(id), mLeaf.id);
  await tap(mrect.left + mHeadBox.left + mHeadBox.width / 2, mrect.top + mHeadBox.top + mHeadBox.height / 2);
  await mpage.waitForTimeout(420); // 同上：等 240ms 的聚焦过渡走完
  const mDomAfter = (await mpage.evaluate(() => window.harness.domCards())).find((c) => c.id === mLeaf.id);
  assert(
    mDomAfter && near(mDomAfter.left + mDomAfter.width / 2, mrect.width / 2, 16) && near(mDomAfter.top + mDomAfter.height / 2, mrect.height / 2, 16),
    "手机点卡片标题 → 这张卡居中",
    mLeaf.title
  );
  await mpage.screenshot({ path: path.join(DOCS, "screenshot-board-mobile.png") });
  await mpage.screenshot({ path: path.join(OUT, "board-mobile-focus.png") });

  // ⑯ 手机上「回到全图」：整块白板进一屏
  await mpage.evaluate(() => window.harness.fitBoard());
  await mpage.waitForTimeout(80);
  const mFitDom = await mpage.evaluate(() => window.harness.domCards());
  const mOutside = mFitDom.filter(
    (c) => c.left < -1 || c.top < -1 || c.left + c.width > mrect.width + 1 || c.top + c.height > mrect.height + 1
  );
  assert(mOutside.length === 0, "手机「回到全图」：所有卡片都在一屏内", mOutside.map((c) => c.id).join(", ") || mFitDom.length + " 张");
  await mpage.screenshot({ path: path.join(DOCS, "screenshot-board-fit.png") });
  await mpage.screenshot({ path: path.join(OUT, "board-mobile-fit.png") });

  // ⑰ 手机上「双指捏合放大后读细节」：放大到能读正文的倍率
  const mSnap = await mpage.evaluate(() => window.harness.snapshot());
  await touch("touchStart", [{ x: 130, y: 400, id: 1 }, { x: 260, y: 400, id: 2 }]);
  for (let i = 1; i <= 10; i += 1) {
    await touch("touchMove", [{ x: 130 - i * 7, y: 400, id: 1 }, { x: 260 + i * 7, y: 400, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const mZoomed = await mstate();
  assert(mZoomed.scale > mSnap.scale * 1.5, "从全图态继续双指放大 → 进入读细节的倍率", fmt(mSnap.scale) + " → " + fmt(mZoomed.scale));
  await mpage.screenshot({ path: path.join(OUT, "board-mobile-zoomed.png") });

  assert(mErrors.length === 0, "手机验证台无脚本错误", mErrors.slice(0, 2).join(" | ") || "无");
  assert(mrect.width > 0 && mrect.height > 0, "手机视口尺寸有效（触摸坐标以视口为基准）", mrect.width + "x" + mrect.height);
  await mobile.close();
} finally {
  await browser.close();
}

const failed = findings.filter((f) => !f.ok);
console.log("\n断言 " + (findings.length - failed.length) + "/" + findings.length + " 通过");
console.log("截图：docs/images/screenshot-board-*.png（文档用）+ tests/browser/out/board-*.png（排查用）");
if (failed.length) {
  console.log("\n未通过：");
  for (const f of failed) console.log("  ✗ " + f.label + (f.detail ? " — " + f.detail : ""));
  process.exit(1);
}
