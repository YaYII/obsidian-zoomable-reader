#!/usr/bin/env node
/**
 * Zoomable Reader · 阅读视图（Obsidian 自带的页面）验证台
 * ---------------------------------------------------------------------------
 * 「阅读视图能不能改宽度、能不能缩放」读代码看不出来 —— 要看真实排版：
 *   · 版心宽度到底是多少（覆盖主题了没有、跟随主题时有没有留下痕迹）；
 *   · 缩放是不是【重排】而不是把整页拉变形（字变大、屏幕上的版心宽度不变）；
 *   · 手机在阅读视图里双指捏合、桌面 Ctrl+滚轮，是否真的改了缩放，且不干扰滚动；
 *   · 手势是不是只在阅读视图里生效、卸载后是否真的不再插手。
 *
 * 用法：npm run verify:reading
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
const HARNESS = pathToFileURL(path.join(ROOT, "tests", "browser", "reading.html")).href;
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
const fmt = (n) => String(Math.round(n * 100) / 100);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

try {
  /* ================= 一、桌面：宽度 + Ctrl 滚轮 ================= */
  console.log("\n=== 桌面视口 1200x800（版心宽度 + Ctrl 滚轮缩放）===");
  const desktop = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));
  await page.goto(HARNESS, { waitUntil: "load" });
  await page.waitForFunction(() => window.harness && window.harness.sizerBox().height > 0);

  const state = () => page.evaluate(() => window.harness.state());
  const sizerBox = () => page.evaluate(() => window.harness.sizerBox());
  const paragraphBox = () => page.evaluate(() => window.harness.paragraphBox());
  const rect = await page.evaluate(() => window.harness.rect());

  /* ① 跟随主题：一个字都不注入，版心就是主题的 720 */
  const themeState = await page.evaluate(() => window.harness.setOptions({ lineWidth: "theme", zoom: 1 }));
  const themeBox = await sizerBox();
  const themeClean = !themeState.styleText.includes("--file-line-width") && !themeState.styleText.includes("zoom:");
  assert(
    near(themeBox.width, 720, 2) && themeClean,
    "「跟随主题」：不注入宽度/缩放规则，版心就是主题的 720px（只留一条 touch-action）",
    fmt(themeBox.width) + "px · 宽度与缩放规则=" + (themeClean ? "无" : "有")
  );

  /* ② 设成 900：覆盖主题变量 + sizer 兜底，真实排版宽度 = 900 */
  await page.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1 }));
  await page.waitForTimeout(40);
  const w900 = await sizerBox();
  assert(near(w900.width, 900, 2), "设成 900px：阅读视图版心真实宽度 = 900（覆盖了主题的 720）", fmt(w900.width) + "px");
  const styleText = (await state()).styleText;
  assert(styleText.includes("--file-line-width: 900px") && styleText.includes(".markdown-preview-sizer"), "注入的规则同时改变量与 sizer 兜底（主题写死也管用）", styleText.replace(/\n/g, " ").slice(0, 90) + "…");

  /* ③ 缩放 150%：字变大、屏幕上的版心宽度不变（补偿生效，不是把整页拉变形） */
  const base100 = await paragraphBox();
  const box100 = await sizerBox();
  await page.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1.5 }));
  await page.waitForTimeout(40);
  const base150 = await paragraphBox();
  const box150 = await sizerBox();
  assert(
    near(box150.width, 900, 2),
    "缩放 150%：屏幕上的版心宽度仍是 900px（sizer 宽度按比例除掉 → 字变大幅面不变）",
    fmt(box100.width) + " → " + fmt(box150.width)
  );
  assert(
    base150.height > base100.height * 1.2 && Math.abs(base150.width - base100.width) <= 2,
    "缩放 150%：字真的变大了（段落更高），而段落宽度不变 —— 重排，不是把整页拉变形",
    "段宽 " + fmt(base100.width) + " → " + fmt(base150.width) + "，段高 " + fmt(base100.height) + " → " + fmt(base150.height)
  );
  const zoomCss = (await state()).styleText;
  assert(zoomCss.includes("zoom: 1.5"), "用的是 CSS zoom（Chromium/WebKit 都支持，且会重排）", zoomCss.replace(/\n/g, " ").slice(0, 80) + "…");

  /* ④ 上下限夹紧 */
  const clamped = await page.evaluate(() => [window.harness.clampZoom(0.1), window.harness.clampZoom(9), window.harness.clampZoom(1.234)]);
  assert(clamped[0] === 0.6 && clamped[1] === 2 && clamped[2] === 1.23, "缩放的上下限被夹在 60%~200%（1% 取整）", clamped.join(" / "));

  /* ⑤ Ctrl+滚轮：在阅读视图里才会改缩放 */
  await page.evaluate(() => {
    window.harness.setOptions({ lineWidth: 900, zoom: 1 });
    window.harness.installGestures();
    window.harness.clearEvents();
  });
  await page.mouse.move(rect.left + rect.width / 2, rect.top + 300);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(140);
  const wheelZoom = await page.evaluate(() => window.harness.zoom());
  assert(wheelZoom > 1, "Ctrl+滚轮（阅读视图内）→ 放大", "zoom=" + fmt(wheelZoom));

  await page.evaluate(() => window.harness.clearEvents());
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(140);
  const plainWheel = await page.evaluate(() => ({ zoom: window.harness.zoom(), events: window.harness.zoomEvents().length }));
  assert(plainWheel.events === 0 && near(plainWheel.zoom, wheelZoom, 0.001), "普通滚轮不插手（滚动照旧归 Obsidian）", "事件 " + plainWheel.events + " 次 · zoom=" + fmt(plainWheel.zoom));

  const outside = await page.evaluate(() => window.harness.outsideRect());
  await page.evaluate(() => window.harness.clearEvents());
  await page.mouse.move(outside.left + outside.width / 2, outside.top + outside.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(140);
  assert((await page.evaluate(() => window.harness.zoomEvents().length)) === 0, "阅读视图【之外】的 Ctrl+滚轮不生效（只在阅读视图里插手）", "事件 0 次");

  /* ⑥ 卸载后彻底不再插手 */
  await page.evaluate(() => {
    window.harness.detachGestures();
    window.harness.clearEvents();
    window.harness.installStyleOnly && window.harness.installStyleOnly();
  });
  await page.mouse.move(rect.left + rect.width / 2, rect.top + 300);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -240);
  await page.keyboard.up("Control");
  await page.waitForTimeout(140);
  assert((await page.evaluate(() => window.harness.zoomEvents().length)) === 0, "卸载手势后：Ctrl+滚轮不再被接管", "事件 0 次");

  /* ⑦ 图片宽度：严格按版心宽度等比放大 */
  await page.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "fill" }));
  await page.waitForTimeout(60);
  const fillBox = await page.evaluate(() => window.harness.imageBox("photo"));
  const ratio = fillBox.width / fillBox.height;
  assert(near(fillBox.width, 900, 2), "fill：图片按版心宽度等比撑满（600px 的图放大到 900px）", fmt(fillBox.width) + "px");
  assert(near(ratio, 3, 0.05), "fill：等比放大，不变形（宽高比仍是 3:1）", "比例 " + fmt(ratio));

  await page.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "contain" }));
  await page.waitForTimeout(60);
  const containBox = await page.evaluate(() => window.harness.imageBox("photo"));
  assert(near(containBox.width, 600, 2), "contain：不放大（600px 的图仍是 600px）", fmt(containBox.width) + "px");

  await page.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "natural" }));
  await page.waitForTimeout(60);
  const naturalState = await page.evaluate(() => ({ box: window.harness.imageBox("photo"), css: window.harness.state().styleText }));
  assert(!naturalState.css.includes("img") && near(naturalState.box.width, 600, 2), "natural：不注入图片规则，完全交给主题", fmt(naturalState.box.width) + "px · 含 img 规则=" + naturalState.css.includes("img"));

  /* ⑦-2 流程图（svg）：只保证【不溢出】，不再被拉伸到版心宽度。
   * 为什么反过来（1.3.12）：拉伸是把 svg 连字带线一起放大 —— 478px 的图铺进 900px 版心是
   * 1.9 倍，图里 16px 的字渲染成 30px。用户的要求是「文字大小应该固定，不能超过 16px」。 */
  for (const imageWidth of ["fill", "contain"]) {
    await page.evaluate((w) => window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: w }), imageWidth);
    await page.waitForTimeout(60);
    const box = await page.evaluate(() => window.harness.imageBox("diagram"));
    assert(
      near(box.width, 478, 2),
      imageWidth + "：流程图保持自然宽度 478px（不拉伸 —— 拉伸会把图里的字放大到超过 16px）",
      fmt(box.width) + "px"
    );
  }
  const diagramRatio = await page.evaluate(() => {
    const box = window.harness.imageBox("diagram");
    return box.width / box.height;
  });
  assert(near(diagramRatio, 478 / 98, 0.05), "流程图不变形（478:98 的比例保持）", "比例 " + fmt(diagramRatio) + "（期望 " + fmt(478 / 98) + "）");

  const readingStyle = await page.evaluate(() => window.harness.state().styleText);
  const start = readingStyle.indexOf(".markdown-reading-view .mermaid svg");
  const diagramCss = start < 0 ? "" : readingStyle.slice(start, readingStyle.indexOf("}", start));
  assert(
    diagramCss.includes("max-width: 100% !important;") &&
      !diagramCss.split("\n").some((line) => line.trim() === "width: 100% !important;"),
    "注入的样式里图表只有 max-width（宽图缩进版心、窄图保持原样）",
    diagramCss.split("\n").filter((l) => l.trim()).join(" / ").slice(0, 70)
  );

  await page.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "fill" }));
  await page.waitForTimeout(40);

  /* ⑧ 手机版才管的双击：桌面（mobile:false）不插手，双击图片照旧是「编辑」 */
  await page.evaluate(() => {
    window.harness.installMobileGestures({ mobile: false });
    window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "fill" });
  });
  const photoBox = await page.evaluate(() => window.harness.imageBox("photo"));
  await page.mouse.dblclick(rect.left + photoBox.left + photoBox.width / 2, rect.top + photoBox.top + photoBox.height / 2);
  await page.waitForTimeout(80);
  const desktopGesture = await page.evaluate(() => ({ hits: window.harness.gestureLog().length, edits: window.harness.editCount() }));
  assert(desktopGesture.hits === 0, "桌面（mobile:false）：双击图片不打开查看器（不抢桌面行为）", "命中 " + desktopGesture.hits + " 次");

  assert(pageErrors.length === 0, "桌面验证台无脚本错误", pageErrors.slice(0, 2).join(" | ") || "无");
  await desktop.close();

  /* ================= 二、手机：双指捏合缩放阅读视图 ================= */
  console.log("\n=== 手机视口 390x780（CDP 合成触摸：阅读视图里双指捏合）===");
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
  await mpage.waitForFunction(() => window.harness && window.harness.sizerBox().height > 0);

  const client = await mobile.newCDPSession(mpage);
  const touch = (type, points) =>
    client.send("Input.dispatchTouchEvent", {
      type: type,
      touchPoints: points.map((p, i) => ({
        x: p.x,
        y: p.y,
        radiusX: 8,
        radiusY: 8,
        force: 1,
        id: p.id === undefined ? i + 1 : p.id,
      })),
    });
  const tap = async (x, y) => {
    await touch("touchStart", [{ x: x, y: y }]);
    await touch("touchEnd", []);
  };
  const mrect = await mpage.evaluate(() => window.harness.rect());

  await mpage.evaluate(() => {
    window.harness.setOptions({ lineWidth: 900, zoom: 1 });
    window.harness.installGestures();
    window.harness.clearEvents();
  });
  await touch("touchStart", [{ x: 120, y: 400, id: 1 }, { x: 260, y: 400, id: 2 }]);
  for (let i = 1; i <= 10; i += 1) {
    await touch("touchMove", [{ x: 120 - i * 6, y: 400, id: 1 }, { x: 260 + i * 6, y: 400, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(200);
  const pinchZoom = await mpage.evaluate(() => ({ zoom: window.harness.zoom(), events: window.harness.zoomEvents().length }));
  assert(pinchZoom.zoom > 1.2, "手机在阅读视图里双指张开 → 缩放变大（就是用户要的「我自己捏」）", "zoom=" + fmt(pinchZoom.zoom));
  assert(
    pinchZoom.events >= 1 && pinchZoom.events < 10,
    "缩放是节流应用的（10 帧手势的应用次数少于帧数，重排不至于每帧一次）",
    "onZoom " + pinchZoom.events + " 次 / 手势 10 帧"
  );

  const mBase = await mpage.evaluate(() => window.harness.sizerBox());
  await mpage.evaluate(() => {
    window.harness.setOptions({ lineWidth: 900, zoom: 1 });
    window.harness.clearEvents();
  });
  const outRect = await mpage.evaluate(() => window.harness.outsideRect());
  await touch("touchStart", [{ x: outRect.left + 20, y: outRect.top + 20, id: 1 }, { x: outRect.left + 80, y: outRect.top + 20, id: 2 }]);
  for (let i = 1; i <= 6; i += 1) {
    await touch("touchMove", [{ x: outRect.left + 20 - i * 4, y: outRect.top + 20, id: 1 }, { x: outRect.left + 80 + i * 4, y: outRect.top + 20, id: 2 }]);
  }
  await touch("touchEnd", []);
  await mpage.waitForTimeout(200);
  assert((await mpage.evaluate(() => window.harness.zoomEvents().length)) === 0, "阅读视图之外的双指捏合不生效（不抢别处的手势）", "事件 0 次");

  /* ⑨ 手机：双击图片 = 放大查看，并且【禁止双击进入编辑】 */
  await mpage.evaluate(() => {
    window.harness.installMobileGestures({ mobile: true });
    window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "fill" });
  });
  const mPhoto = await mpage.evaluate(() => window.harness.imageBox("photo"));
  const photoCenter = {
    x: mrect.left + mPhoto.left + mPhoto.width / 2,
    y: mrect.top + mPhoto.top + Math.min(mPhoto.height / 2, 200),
  };

  // 单次 tap：不该打开（这是「双击」才有的入口）
  await tap(photoCenter.x, photoCenter.y);
  await mpage.waitForTimeout(360);
  const singleTap = await mpage.evaluate(() => ({ hits: window.harness.gestureLog().length, opens: window.harness.openLog().length }));
  assert(singleTap.hits === 0 && singleTap.opens === 0, "手机单击图片不触发（这是双击才有的入口）", "命中 " + singleTap.hits + " 次");

  // 双击：打开查看器 + 吃掉事件（模拟的 Obsidian 编辑处理器一次都不该被调用）
  await tap(photoCenter.x, photoCenter.y);
  await mpage.waitForTimeout(60);
  await tap(photoCenter.x, photoCenter.y);
  await mpage.waitForTimeout(200);
  const doubleTap = await mpage.evaluate(() => ({
    hits: window.harness.gestureLog(),
    opens: window.harness.openLog(),
    edits: window.harness.editCount(),
  }));
  assert(
    doubleTap.opens.length === 1 && doubleTap.hits[0] && doubleTap.hits[0].kind === "image",
    "手机双击图片 → 打开可缩放的查看器",
    "打开 " + doubleTap.opens.length + " 次 · 命中手势 " + (doubleTap.hits[0] ? doubleTap.hits[0].gesture : "无")
  );
  assert(doubleTap.edits === 0, "手机双击图片【不会】进入编辑模式（事件被吃掉，模拟的编辑处理器 0 次）", "编辑触发 " + doubleTap.edits + " 次");

  /* ⑩ 关键：双击【正文】（不是图片）也不该进编辑 —— 用户实测反馈的就是这一条 */
  await mpage.evaluate(() => {
    window.harness.installMobileGestures({ mobile: true, blockDoubleTapEdit: true });
  });
  const paragraphPoint = await mpage.evaluate(() => {
    const p = document.querySelector("#sizer p");
    const r = p.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await tap(mrect.left + paragraphPoint.x, mrect.top + paragraphPoint.y);
  await mpage.waitForTimeout(60);
  await tap(mrect.left + paragraphPoint.x, mrect.top + paragraphPoint.y);
  await mpage.waitForTimeout(220);
  const textDoubleTap = await mpage.evaluate(() => ({
    hits: window.harness.gestureLog(),
    opens: window.harness.openLog().length,
    edits: window.harness.editCount(),
  }));
  assert(
    textDoubleTap.edits === 0,
    "手机双击【正文】不会进入编辑（用户实测反馈的那一条：编辑只能走菜单按钮）",
    "编辑触发 " + textDoubleTap.edits + " 次 · 命中 " + (textDoubleTap.hits[0] ? textDoubleTap.hits[0].kind : "无")
  );
  assert(textDoubleTap.opens === 0, "双击正文不打开查看器（只有图片/图表才打开）", "打开 " + textDoubleTap.opens + " 次");

  // 阅读视图【之外】的图片（模拟编辑区）：不接管
  await mpage.evaluate(() => window.harness.clearGestureLogForTest && window.harness.clearGestureLogForTest());
  const mEdit = await mpage.evaluate(() => window.harness.imageBox("editImg"));
  await tap(mrect.left + mEdit.left + mEdit.width / 2, mrect.top + mEdit.top + mEdit.height / 2);
  await mpage.waitForTimeout(60);
  await tap(mrect.left + mEdit.left + mEdit.width / 2, mrect.top + mEdit.top + mEdit.height / 2);
  await mpage.waitForTimeout(200);
  const outsideLog = await mpage.evaluate(() => ({ opens: window.harness.openLog().length, hits: window.harness.gestureLog().length }));
  assert(
    outsideLog.opens === 0 && outsideLog.hits === 0,
    "阅读视图之外的图片不接管（模拟的编辑区里双击照旧，不进我们的查看器）",
    "打开 " + outsideLog.opens + " 次 · 命中 " + outsideLog.hits + " 次"
  );

  /* ⑪ 手机：流程图与图片都按【手机上的宽度】显示（用户就是在这个尺寸下读的） */
  await mpage.evaluate(() => window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "fill" }));
  await mpage.waitForTimeout(80);
  const mobileBoxes = await mpage.evaluate(() => ({
    reading: window.harness.rect().width,
    diagram: window.harness.imageBox("diagram").width,
    photo: window.harness.imageBox("photo").width,
  }));
  const contentWidth = Math.max(mobileBoxes.diagram, mobileBoxes.photo);
  assert(
    contentWidth <= mobileBoxes.reading + 1 && near(mobileBoxes.diagram, mobileBoxes.photo, 2),
    "手机：流程图与图片都被压到同一屏宽（等比缩小到可用宽度，不再溢出或比正文窄）",
    "屏宽 " + fmt(mobileBoxes.reading) + " · 图 " + fmt(mobileBoxes.diagram) + " · 照片 " + fmt(mobileBoxes.photo)
  );

  /* ⑫ 手机：放大按钮要【自己看得见、点得开】—— 用户原话：
   *    「你应该展示放大的 icon，这样我就可以点击了，而不是依靠点击图片，
   *      因为图片点击的时候可能点击到了背景上去了，所以体验不是很好」。
   *    这条路以前是封死的：styles.css 里 @media (hover: none) 直接把按钮 display:none 了。 */
  await mpage.evaluate(() => {
    window.harness.setOptions({ lineWidth: 900, zoom: 1, imageWidth: "fill" });
    window.harness.installMobileGestures({ mobile: true, blockDoubleTapEdit: true });
    window.harness.installAffordance("top-left");
  });
  await mpage.waitForTimeout(150);
  const btn = await mpage.evaluate(() => window.harness.affordanceBoxFor("photo"));
  assert(
    !!btn && btn.display !== "none" && btn.visibility !== "hidden" && Number(btn.opacity) >= 0.85,
    "手机（触屏、没有悬停）上放大按钮【常驻可见】（以前是 display:none，用户根本看不到）",
    btn ? "display=" + btn.display + " opacity=" + btn.opacity + " " + Math.round(btn.width) + "x" + Math.round(btn.height) : "没有按钮"
  );
  const btnOutsideHit = btn ? await mpage.evaluate((b) => window.harness.hitIsAffordance(b.left + 3, b.top - 5), btn) : false;
  assert(btnOutsideHit, "触区比图标大：贴着按钮外沿 5px 也算按到按钮（手指按不准）", "hit=" + btnOutsideHit);

  // 单点按钮：打开的就是那张图（绝不能把按钮里的图标 svg 当成「图表」打开）
  await tap(btn.left + btn.width / 2, btn.top + btn.height / 2);
  await mpage.waitForTimeout(220);
  const btnTap = await mpage.evaluate(() => ({ opens: window.harness.openLog(), edits: window.harness.editCount() }));
  assert(
    btnTap.opens.length === 1 && btnTap.opens[0] === "image:photo",
    "手机点这个 icon → 打开的就是那张图（不是按钮里的图标，也不用去点图片本身）",
    "打开 " + JSON.stringify(btnTap.opens)
  );

  // 连点两下按钮：第二次 tap 被吃掉 —— 不然宿主的「双击进编辑」会顺势触发
  await mpage.evaluate(() => window.harness.clearGestureLogForTest());
  await mpage.waitForTimeout(400); /* 让上一轮的 tap 计数过期，双击判定从零开始 */
  const btn2 = await mpage.evaluate(() => window.harness.affordanceBoxFor("photo"));
  await tap(btn2.left + btn2.width / 2, btn2.top + btn2.height / 2);
  await mpage.waitForTimeout(80);
  await tap(btn2.left + btn2.width / 2, btn2.top + btn2.height / 2);
  await mpage.waitForTimeout(240);
  const btnDouble = await mpage.evaluate(() => ({ opens: window.harness.openLog().length, edits: window.harness.editCount() }));
  assert(
    btnDouble.edits === 0,
    "手机连点两下放大按钮也不会进编辑（按钮就在图的角上，手指稍偏就会点到它）",
    "编辑触发 " + btnDouble.edits + " 次 · 打开 " + btnDouble.opens + " 次"
  );
  await mpage.evaluate(() => window.harness.detachAffordance());

  assert(mErrors.length === 0, "手机验证台无脚本错误", mErrors.slice(0, 2).join(" | ") || "无");
  assert(mrect.width > 0, "手机视口宽度有效（触摸坐标以视口为基准）", mrect.width + "px");
  void mBase;
  await mobile.close();
} finally {
  await browser.close();
}

const failed = findings.filter((f) => !f.ok);
console.log("\n断言 " + (findings.length - failed.length) + "/" + findings.length + " 通过");
if (failed.length) {
  console.log("\n未通过：");
  for (const f of failed) console.log("  ✗ " + f.label + (f.detail ? " — " + f.detail : ""));
  process.exit(1);
}
