#!/usr/bin/env node
/**
 * Zoomable Reader · 白板模式验证台（真实浏览器 + 真实事件）
 * ---------------------------------------------------------------------------
 * 白板模式的定义只有一句话：**把整篇笔记渲染成一整张 1280px 宽的版面**，放在能平移、
 * 缩放、往下滑的板子上 —— 没有卡片、没有分栏。所以这里验的也是这几件读代码看不出来的事：
 *   ① 宽度对不对（白板 1280 / 版面跟随主题行宽 / 改设置真的会变）；
 *   ② 卡片概念是否【彻底】退场（源码、构建产物、真实 DOM 三处都要查不到痕迹）；
 *   ③ 手势与往下滑（拖动平移、Ctrl+滚轮锚点、双指捏合、适配宽度、一直往下滑能读到末尾）。
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

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  /* ================= 零、卡片概念是否彻底退场 ================= */
  console.log("\n=== 卡片概念是否彻底退场（源码 / 构建产物 / DOM 三处都查） ===");
  for (const file of ["src/board-model.ts", "src/board-layout.ts", "src/board-render.ts"]) {
    assert(!fs.existsSync(path.join(ROOT, file)), "源码已删除：" + file, fs.existsSync(path.join(ROOT, file)) ? "文件还在" : "已删除");
  }
  const bundleSource = fs.readFileSync(path.join(ROOT, "main.js"), "utf8");
  const cardHits = ["zr-card", "data-zr-card", "boardConnectors", "boardMaxCards", "boardMaxDepth"].filter((needle) =>
    bundleSource.includes(needle)
  );
  assert(cardHits.length === 0, "构建产物里没有卡片痕迹（类名/设置项全部退场）", cardHits.join(", ") || "干净");
  const widthHits = ["boardWidth", "1280"].filter((needle) => bundleSource.includes(needle));
  assert(widthHits.length === 2, "构建产物里有白板版面宽度与 1280 默认值", widthHits.join(", "));

  /* ================= 一、桌面：宽度 + 鼠标手势 ================= */
  console.log("\n=== 桌面视口 1000x720（版面宽度 + 鼠标 + 滚轮）===");
  const desktop = await browser.newContext({ viewport: { width: 1000, height: 720 } });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
  await page.goto(HARNESS, { waitUntil: "load" });
  await page.waitForFunction(() => window.harness && window.harness.snapshot().pageHeight > 0);

  const state = () => page.evaluate(() => window.harness.state());
  const rect = await page.evaluate(() => window.harness.rect());
  const snapshot = await page.evaluate(() => window.harness.snapshot());
  const defaults = await page.evaluate(() => ({
    width: window.ZoomableReaderDefaults.boardWidth,
    web: window.Width.web,
    label: window.Width.label(window.ZoomableReaderDefaults.boardWidth),
    a5: window.Width.papers.A5,
    a5Name: window.Width.nameFor(window.Width.papers.A5),
    a5mm: window.Width.toMm(window.Width.papers.A5),
  }));
  const contentPointAt = (cx, cy) =>
    page.evaluate(
      (args) => window.harness.contentPoint(args[0] - window.harness.rect().left, args[1] - window.harness.rect().top),
      [cx, cy]
    );

  /**
   * 出场默认：白板 = 一整张 1280px 宽的版面（用户要求「按 1280 的宽度展示，去掉卡片」）
   */
  assert(defaults.width === 1280 && defaults.web === 1280, "出厂默认白板版面宽度 = 1280px（网页版心）", defaults.width + "px · " + defaults.label);
  assert(near(snapshot.pageWidth, 1280, 1), "白板模式：版面真实宽度 = 1280px（DOM 实测）", fmt(snapshot.pageWidth) + "px");
  assert(near(snapshot.scale, 1, 0.001), "打开即 100% 原大（不缩到整块板）", "scale=" + fmt(snapshot.scale));
  const pageBox0 = await page.evaluate(() => window.harness.pageBox());
  assert(pageBox0.top <= 20 && pageBox0.left <= 20, "打开即原大：版面左上角就在视口左上角（没有大留白）", "top=" + fmt(pageBox0.top) + " left=" + fmt(pageBox0.left));
  assert((await page.evaluate(() => window.harness.pageCount())) === 1, "整篇只有一张版面（不是一堆卡片）", "页面元素 1 个");
  assert((await page.evaluate(() => window.harness.cardArtifacts())) === 0, "真实 DOM 里没有卡片痕迹", ".zr-card / .zr-board* / [data-zr-card] 全为 0");
  assert(
    defaults.a5Name === "A5" && defaults.a5mm === 148 && Math.abs(defaults.a5 - 560) <= 1,
    "纸张仍是可选宽度预设：A5 = 148mm ≈ 560px",
    "A5 " + defaults.a5 + "px · " + defaults.a5mm + "mm"
  );

  const imgFits = await page.evaluate(() => {
    const img = document.querySelector(".zr-page img");
    const pageEl = document.getElementById("page");
    return img && pageEl ? img.getBoundingClientRect().width <= pageEl.getBoundingClientRect().width + 1 : false;
  });
  assert(imgFits, "宽版面里图片不溢出（1200px 的图收进 1280 的版面）", imgFits ? "未溢出" : "溢出了");

  /* 版面模式：宽度跟随主题行宽 —— 两种模式的区别就是宽度 */
  await page.evaluate(() => window.harness.setMode("page"));
  await page.waitForTimeout(60);
  const pageMode = await page.evaluate(() => window.harness.snapshot());
  assert(
    near(pageMode.pageWidth, 760, 2),
    "切到版面模式：宽度跟随主题行宽（760px），而不是 1280",
    fmt(pageMode.pageWidth) + "px"
  );
  await page.evaluate(() => window.harness.setMode("board"));
  await page.waitForTimeout(60);

  /* 改宽度设置真的会变 */
  await page.evaluate(() => window.harness.setBoardWidth(1920));
  await page.waitForTimeout(60);
  const wide = await page.evaluate(() => window.harness.snapshot());
  assert(near(wide.pageWidth, 1920, 1), "把白板版面宽度改成 1920，版面真的变宽", fmt(wide.pageWidth) + "px");
  await page.evaluate(() => window.harness.setBoardWidth(window.ZoomableReaderDefaults.boardWidth));
  await page.waitForTimeout(60);

  /* 一直往下滑能读到文档末尾 */
  await page.mouse.move(rect.left + rect.width / 2, rect.top + rect.height / 2);
  let reachedEnd = false;
  for (let i = 0; i < 40 && !reachedEnd; i += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(6);
    const box = await page.evaluate(() => window.harness.pageBox());
    reachedEnd = box.top + box.height <= rect.height + 1;
  }
  assert(reachedEnd, "只往下滑就能读到文档最后一段（版面底部进入视口）", reachedEnd ? "滑到了末尾" : "滑不到底");
  await page.evaluate(() => window.harness.reset(16));
  await page.waitForTimeout(40);

  /* 拖动 = 平移（不改缩放） */
  const d0 = await state();
  const dragFrom = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  await page.mouse.move(dragFrom.x, dragFrom.y);
  await page.mouse.down();
  for (let i = 1; i <= 5; i += 1) await page.mouse.move(dragFrom.x + i * 12, dragFrom.y + i * 6);
  await page.mouse.up();
  await page.waitForTimeout(60);
  const d1 = await state();
  assert(near(d1.x - d0.x, 60, 3) && near(d1.y - d0.y, 30, 3), "鼠标拖动 → 版面平移", "Δx=" + fmt(d1.x - d0.x) + " Δy=" + fmt(d1.y - d0.y));
  assert(near(d1.scale, d0.scale, 0.0001), "拖动不改变缩放", "scale=" + fmt(d1.scale));

  /* Ctrl+滚轮：以指针为锚点缩放 */
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
  assert(after.scale > before.scale * 1.5, "Ctrl+滚轮 → 放大版面", fmt(before.scale) + " → " + fmt(after.scale));
  assert(near(cpAfter.x, cpBefore.x, 0.8) && near(cpAfter.y, cpBefore.y, 0.8), "缩放的锚点在指针下（锚点不变量）", "偏差 " + fmt(Math.abs(cpAfter.x - cpBefore.x)) + "px");

  const w0 = await state();
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(60);
  const w1 = await state();
  assert(near(w1.y - w0.y, -100, 2) && near(w1.scale, w0.scale, 0.0001), "普通滚轮 → 平移而非缩放", "Δy=" + fmt(w1.y - w0.y));

  await page.evaluate(() => window.harness.reset(16));
  await page.mouse.dblclick(dragFrom.x, dragFrom.y);
  await page.waitForTimeout(80);
  const db1 = await state();
  assert(near(db1.scale, 2, 0.05), "双击 → 放大到 200%", "scale=" + fmt(db1.scale));
  await page.mouse.dblclick(dragFrom.x, dragFrom.y);
  await page.waitForTimeout(80);
  assert(near((await state()).scale, 1, 0.05), "再双击 → 回到 100%", "scale=" + fmt((await state()).scale));

  /* 适配宽度：整张版面铺满视口（1280 装不下一屏时的一键动作） */
  await page.evaluate(() => window.harness.fitWidth());
  await page.waitForTimeout(80);
  const fitted = await page.evaluate(() => ({ scale: window.harness.state().scale, box: window.harness.pageBox() }));
  assert(
    fitted.scale < 1 && fitted.box.left + fitted.box.width <= rect.width + 1,
    "适配宽度：整张版面铺满视口（之后只剩上下滑动）",
    "scale=" + fmt(fitted.scale) + "，版面右边缘 " + fmt(fitted.box.left + fitted.box.width) + " / 视口 " + rect.width
  );
  await page.screenshot({ path: path.join(DOCS, "screenshot-board-desktop.png"), fullPage: false });
  await page.screenshot({ path: path.join(OUT, "board-desktop.png"), fullPage: false });
  assert(pageErrors.length === 0, "桌面验证台无脚本错误", pageErrors.slice(0, 2).join(" | ") || "无");
  await desktop.close();

  /* ================= 二、手机：真实触摸事件 ================= */
  console.log("\n=== 手机视口 390x780（CDP 合成触摸：单指拖动 / 双指捏合 / 双击）===");
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
  await mpage.waitForFunction(() => window.harness && window.harness.snapshot().pageHeight > 0);

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

  await mpage.evaluate(() => window.harness.reset(16));
  const t0 = await mstate();
  await touch("touchStart", [{ x: 200, y: 400 }]);
  for (let i = 1; i <= 6; i += 1) await touch("touchMove", [{ x: 200 + i * 10, y: 400 - i * 4 }]);
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const t1 = await mstate();
  assert(near(t1.x - t0.x, 60, 6) && near(t1.y - t0.y, -24, 6), "单指拖动 → 版面跟随平移", "Δx=" + fmt(t1.x - t0.x) + " Δy=" + fmt(t1.y - t0.y));
  assert(near(t1.scale, t0.scale, 0.0001), "单指拖动不改变缩放", "scale=" + fmt(t1.scale));

  await mpage.evaluate(() => window.harness.reset(16));
  await mpage.waitForTimeout(40);
  const p0 = await mstate();
  /* 触摸坐标是页面坐标，锚点不变量要在【视口内坐标】上验：减掉视口左上角 */
  const midLocal = { x: 195 - mrect.left, y: 400 - mrect.top };
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
  assert(near((await mstate()).scale, off0.scale, 0.0001), "关掉「双指捏合缩放」后：捏合不再改变缩放", "scale=" + fmt((await mstate()).scale));
  await mpage.evaluate(() => window.harness.setPinch(true));

  await mpage.evaluate(() => window.harness.reset(16));
  await tap(200, 420);
  await mpage.waitForTimeout(60);
  await tap(200, 420);
  await mpage.waitForTimeout(90);
  assert(near((await mstate()).scale, 2, 0.06), "手机双击 → 放大到 200%", "scale=" + fmt((await mstate()).scale));

  await mpage.evaluate(() => window.harness.fitWidth());
  await mpage.waitForTimeout(80);
  const mFit = await mpage.evaluate(() => ({ scale: window.harness.state().scale, box: window.harness.pageBox() }));
  assert(
    mFit.scale < 1 && mFit.box.left + mFit.box.width <= mrect.width + 1,
    "手机「适配宽度」：整张 1280 版面装进 390 的屏宽（之后只剩上下滑动）",
    "scale=" + fmt(mFit.scale) + "，版面右边缘 " + fmt(mFit.box.left + mFit.box.width) + " / 视口 " + mrect.width
  );
  await mpage.screenshot({ path: path.join(DOCS, "screenshot-board-mobile.png") });
  await mpage.screenshot({ path: path.join(OUT, "board-mobile-fit.png") });

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
