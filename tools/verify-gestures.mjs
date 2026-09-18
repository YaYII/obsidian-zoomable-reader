#!/usr/bin/env node
/**
 * Zoomable Reader · 真实手势验证台
 * ---------------------------------------------------------------------------
 * 为什么要有它：这个插件的全部价值都在「手势对不对」上，而手势恰恰是**读代码看不出来**的
 * 那一类东西（拖动阈值、锚点算法、双指中点、缩放夹紧，错了都能编译通过）。
 * 所以在真实 Chromium 里用**真事件**验证：
 *   · 桌面：mouse.wheel / Ctrl+wheel / 按下-拖动-抬起 / 双击 / 点击链接；
 *   · 手机：CDP 合成触摸事件（单指拖动、双指捏合、双击）。
 * 断言的核心不变量是「锚点不变量」——缩放时光标（或两指中点）下面的内容必须不动，
 * 满足它，用户才会觉得「图跟着手指走」。
 *
 * 用法：npm run verify:gestures
 * 退出码：0 全部通过；1 有断言失败。
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
    try { return createRequire(import.meta.url)(c); } catch (e) { /* 试下一个 */ }
  }
  throw new Error("未找到 playwright，请先安装：npm i -D playwright");
}

const { chromium } = loadPlaywright();
const CHROME = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));
const HARNESS = pathToFileURL(path.join(ROOT, "tests", "browser", "harness.html")).href;
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
  /* ======================= 一、桌面：鼠标与滚轮 ======================= */
  console.log("\n=== 桌面视口 900x700（鼠标 + 滚轮 + Ctrl 缩放）===");
  const desktop = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
  await page.goto(HARNESS, { waitUntil: "load" });

  const rect = await page.evaluate(() => window.harness.rect());
  const state = () => page.evaluate(() => window.harness.state());
  const contentPointAt = (cx, cy) =>
    page.evaluate(
      (args) => window.harness.contentPoint(args[0] - window.harness.rect().left, args[1] - window.harness.rect().top),
      [cx, cy]
    );
  const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  // ① 滚轮平移
  const s0 = await state();
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(60);
  const s1 = await state();
  assert(near(s1.y - s0.y, -120, 2) && near(s1.x - s0.x, 0, 2),
    "滚轮向下 → 内容上移 120px（平移而非缩放）",
    "Δx=" + fmt(s1.x - s0.x) + " Δy=" + fmt(s1.y - s0.y) + " scale=" + fmt(s1.scale));
  assert(near(s1.scale, s0.scale, 0.0001), "普通滚轮不改变缩放", "scale=" + fmt(s1.scale));

  // ② Ctrl+滚轮：以光标为锚点缩放（核心不变量）
  const anchorPoint = { x: rect.left + 320, y: rect.top + 220 };
  const before = await state();
  const cpBefore = await contentPointAt(anchorPoint.x, anchorPoint.y);
  await page.mouse.move(anchorPoint.x, anchorPoint.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(60);
  const after = await state();
  const cpAfter = await contentPointAt(anchorPoint.x, anchorPoint.y);
  assert(after.scale > before.scale, "Ctrl+滚轮向上 → 放大",
    fmt(before.scale) + " → " + fmt(after.scale));
  assert(near(cpAfter.x, cpBefore.x, 0.6) && near(cpAfter.y, cpBefore.y, 0.6),
    "缩放以光标为锚点，光标下的内容不动（锚点不变量）",
    "内容坐标 (" + fmt(cpBefore.x) + "," + fmt(cpBefore.y) + ") → (" + fmt(cpAfter.x) + "," + fmt(cpAfter.y) + ")");

  // ③ 拖动平移
  const d0 = await state();
  await page.mouse.move(rect.left + 500, rect.top + 400);
  await page.mouse.down();
  await page.mouse.move(rect.left + 560, rect.top + 430, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const d1 = await state();
  assert(near(d1.x - d0.x, 60, 2) && near(d1.y - d0.y, 30, 2),
    "鼠标拖动 → 画布跟随移动",
    "Δx=" + fmt(d1.x - d0.x) + " Δy=" + fmt(d1.y - d0.y));

  // ④ 拖动结束不误触链接；普通点击仍然可用
  const clicks0 = await page.evaluate(() => window.harness.linkClicks);
  const linkBox = await page.locator("#link").boundingBox();
  await page.mouse.move(linkBox.x + 4, linkBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(linkBox.x + 80, linkBox.y + 40, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const clicks1 = await page.evaluate(() => window.harness.linkClicks);
  assert(clicks1 === clicks0, "在链接上拖动不会误点开链接", "点击数 " + clicks1);
  /* 上一步的拖动把画布移出了视口，先复位再点，否则测的是 Playwright 的滚动行为 */
  await page.evaluate(() => window.harness.layer.reset(16));
  await page.waitForTimeout(30);
  await page.click("#link");
  await page.waitForTimeout(60);
  const clicks2 = await page.evaluate(() => window.harness.linkClicks);
  assert(clicks2 === clicks0 + 1, "普通点击仍然能点开链接（平移不会把链接点废）", "点击数 " + clicks2);

  // ⑤ 双击在 100% 与设定倍数之间切换
  await page.evaluate(() => window.harness.layer.reset(16));
  await page.waitForTimeout(30);
  const target = { x: rect.left + 300, y: rect.top + 250 };
  await page.mouse.dblclick(target.x, target.y);
  await page.waitForTimeout(60);
  const zoomed = await state();
  assert(near(zoomed.scale, 2, 0.02), "双击 → 放大到 200%", "scale=" + fmt(zoomed.scale));
  await page.mouse.dblclick(target.x, target.y);
  await page.waitForTimeout(60);
  const restored = await state();
  assert(near(restored.scale, 1, 0.02), "再双击 → 回到 100%", "scale=" + fmt(restored.scale));

  // ⑥ 缩放夹紧（不会缩成 0，也不会无限放大）
  await page.evaluate(() => window.harness.layer.reset(16));
  await page.mouse.move(center.x, center.y);
  await page.keyboard.down("Control");
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
  await page.keyboard.up("Control");
  await page.waitForTimeout(60);
  const maxed = await state();
  assert(maxed.scale <= 8.0001 && maxed.scale > 4, "持续放大被上限截住（≤ 8 倍）", "scale=" + fmt(maxed.scale));
  await page.keyboard.down("Control");
  for (let i = 0; i < 24; i++) await page.mouse.wheel(0, 400);
  await page.keyboard.up("Control");
  await page.waitForTimeout(60);
  const mined = await state();
  assert(mined.scale >= 0.2 - 0.0001 && mined.scale < 0.5, "持续缩小被下限截住（≥ 20%）", "scale=" + fmt(mined.scale));

  // ⑦ 适配宽度：按内容实际宽度算比例
  await page.evaluate(() => {
    document.getElementById("page").style.width = "1600px";
    window.harness.layer.fitWidth(16);
  });
  await page.waitForTimeout(60);
  const fitted = await state();
  const expected = (rect.width - 32) / 1600;
  assert(near(fitted.scale, expected, 0.01), "适配宽度：按内容宽度算出比例",
    "scale=" + fmt(fitted.scale) + "，期望 " + fmt(expected));

  // ⑧ 位移持久化所需的 onCommit 回调确实在触发
  const commits = await page.evaluate(() => window.harness.commits);
  assert(commits > 0, "每次状态变化都会触发 onCommit（用于保存位置）", commits + " 次");

  // ⑨ destroy 之后不再改 DOM（视图关闭后不能继续改 transform）
  await page.evaluate(() => window.harness.layer.destroy());
  const frozen = await state();
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, 300);
  await page.mouse.down();
  await page.mouse.move(center.x + 50, center.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(60);
  const afterDestroy = await state();
  assert(near(afterDestroy.x, frozen.x, 0.001) && near(afterDestroy.y, frozen.y, 0.001),
    "destroy 之后手势不再生效（避免视图关闭后仍改 DOM）",
    "Δx=" + fmt(afterDestroy.x - frozen.x));

  await page.screenshot({ path: path.join(OUT, "desktop-zoomed.png") });
  assert(pageErrors.length === 0, "桌面验证台无脚本错误", pageErrors.slice(0, 2).join(" | ") || "无");
  await desktop.close();

  /* ======================= 二、手机：真实触摸事件 ======================= */
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
  const client = await mobile.newCDPSession(mpage);
  const touch = (type, points) =>
    client.send("Input.dispatchTouchEvent", {
      type: type,
      touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, radiusX: 8, radiusY: 8, force: 1, id: p.id === undefined ? i + 1 : p.id })),
    });
  const mstate = () => mpage.evaluate(() => window.harness.state());
  const mrect = await mpage.evaluate(() => window.harness.rect());

  // ⑩ 单指拖动 = 平移
  const t0 = await mstate();
  await touch("touchStart", [{ x: 200, y: 400 }]);
  for (let i = 1; i <= 6; i++) await touch("touchMove", [{ x: 200 + i * 10, y: 400 - i * 4 }]);
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const t1 = await mstate();
  assert(near(t1.x - t0.x, 60, 6) && near(t1.y - t0.y, -24, 6),
    "单指拖动 → 画布跟随平移",
    "Δx=" + fmt(t1.x - t0.x) + " Δy=" + fmt(t1.y - t0.y));
  assert(near(t1.scale, t0.scale, 0.0001), "单指拖动不改变缩放", "scale=" + fmt(t1.scale));

  // ⑪ 双指捏合 = 放大（距离翻倍 → 约 2 倍）
  await mpage.evaluate(() => window.harness.layer.reset(16));
  await mpage.waitForTimeout(30);
  const p0 = await mstate();
  /* 锚点不变量要在【内容坐标】上验：以两指中点为锚点放大时，画布的 x/y 必然变化
   * （这正是「图跟着手指走」的表现），拿变换前的 x/y 直接比会误判成漂移。 */
  const midLocal = { x: 195 - mrect.left, y: 400 - mrect.top };
  const midContentBefore = await mpage.evaluate(
    (p) => window.harness.contentPoint(p[0], p[1]),
    [midLocal.x, midLocal.y]
  );
  await touch("touchStart", [{ x: 145, y: 400, id: 1 }, { x: 245, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", [{ x: 145 - i * 6, y: 400, id: 1 }, { x: 245 + i * 6, y: 400, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const p1 = await mstate();
  assert(p1.scale > p0.scale * 1.8 && p1.scale < p0.scale * 2.2,
    "双指张开 → 放大（距离翻倍 ≈ 2 倍）",
    fmt(p0.scale) + " → " + fmt(p1.scale));
  const midContentAfter = await mpage.evaluate(
    (p) => window.harness.contentPoint(p[0], p[1]),
    [midLocal.x, midLocal.y]
  );
  assert(near(midContentAfter.x, midContentBefore.x, 1) && near(midContentAfter.y, midContentBefore.y, 1),
    "双指缩放的锚点是两指中点（中点下的内容不动）",
    "内容坐标 (" + fmt(midContentBefore.x) + "," + fmt(midContentBefore.y) + ") → (" +
      fmt(midContentAfter.x) + "," + fmt(midContentAfter.y) + ")，" +
      "画布位移 Δx=" + fmt(p1.x - p0.x));

  // ⑫ 双指收拢 = 缩小
  await mpage.evaluate(() => window.harness.layer.reset(16));
  await mpage.evaluate(() => window.harness.layer.zoomTo(4));
  await mpage.waitForTimeout(30);
  const q0 = await mstate();
  await touch("touchStart", [{ x: 65, y: 400, id: 1 }, { x: 325, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", [{ x: 65 + i * 7, y: 400, id: 1 }, { x: 325 - i * 7, y: 400, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const q1 = await mstate();
  assert(q1.scale < q0.scale * 0.75, "双指收拢 → 缩小",
    fmt(q0.scale) + " → " + fmt(q1.scale));

  // ⑬ 双击（双击）放大 → 再双击还原
  await mpage.evaluate(() => window.harness.layer.reset(16));
  await mpage.waitForTimeout(30);
  const tap = async (x, y) => {
    await touch("touchStart", [{ x: x, y: y, id: 1 }]);
    await touch("touchEnd", []);
  };
  await tap(200, 400);
  await mpage.waitForTimeout(60);
  await tap(200, 400);
  await mpage.waitForTimeout(80);
  const dbl = await mstate();
  assert(near(dbl.scale, 2, 0.05), "双击 → 放大到 200%", "scale=" + fmt(dbl.scale));
  await tap(200, 400);
  await mpage.waitForTimeout(60);
  await tap(200, 400);
  await mpage.waitForTimeout(80);
  const dbl2 = await mstate();
  assert(near(dbl2.scale, 1, 0.05), "再双击 → 回到 100%", "scale=" + fmt(dbl2.scale));

  // ⑭ 双指捏合后仍能继续单指平移（手势不互相污染）
  const r0 = await mstate();
  await touch("touchStart", [{ x: 200, y: 500, id: 1 }]);
  for (let i = 1; i <= 5; i++) await touch("touchMove", [{ x: 200 + i * 8, y: 500, id: 1 }]);
  await touch("touchEnd", []);
  await mpage.waitForTimeout(60);
  const r1 = await mstate();
  assert(near(r1.x - r0.x, 40, 6) && near(r1.scale, r0.scale, 0.0001),
    "捏合之后再单指拖动：只平移、不误缩放",
    "Δx=" + fmt(r1.x - r0.x) + " scale=" + fmt(r1.scale));

  await mpage.screenshot({ path: path.join(OUT, "mobile-pinched.png") });
  assert(mErrors.length === 0, "手机验证台无脚本错误", mErrors.slice(0, 2).join(" | ") || "无");
  assert(mrect.width > 0, "手机视口宽度有效（触摸坐标以视口为基准）", mrect.width + "px");
  await mobile.close();
} finally {
  await browser.close();
}

const failed = findings.filter((f) => !f.ok);
console.log("\n断言 " + (findings.length - failed.length) + "/" + findings.length + " 通过");
console.log("截图：tests/browser/out/desktop-zoomed.png / mobile-pinched.png");
if (failed.length) {
  console.log("\n未通过：");
  for (const f of failed) console.log("  ✗ " + f.label + (f.detail ? " — " + f.detail : ""));
  process.exit(1);
}
