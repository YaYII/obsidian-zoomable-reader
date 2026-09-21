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


  /* ======================= 三、查看器：点图放大 ======================= */
  console.log("\n=== 查看器 900x700（真实点击 / 滚轮 / 拖动 / ESC）===");
  const lbCtx = await browser.newContext({ viewport: { width: 900, height: 700 } });
  const lb = await lbCtx.newPage();
  const lbErrors = [];
  lb.on("pageerror", (e) => lbErrors.push(String((e && e.message) || e)));
  await lb.goto(pathToFileURL(path.join(ROOT, "tests", "browser", "lightbox.html")).href, { waitUntil: "load" });
  await lb.waitForFunction(() => window.lightboxHarness && document.getElementById("photo").naturalWidth > 0);

  const lbState = () => lb.evaluate(() => window.lightboxHarness.transform());

  const photoBox = await lb.locator("#photo").boundingBox();
  const hostBox = await lb.locator("#diagram-host").boundingBox();

  /* ① 常驻模式（默认）：不悬停时按钮也在，而且就贴在图片右上角 */
  const persistentVisible = await lb.evaluate(() => window.lightboxHarness.affordanceVisibleFor("photo"));
  assert(persistentVisible, "常驻按钮：鼠标不在图上时按钮依然可见（不用去找）", "visible=" + persistentVisible);
  const wrapped = await lb.evaluate(() => window.lightboxHarness.hostWrapped("photo"));
  assert(wrapped, "常驻按钮：图片被包进 .zr-zoom-host（按钮跟着内容走，滚动不错位）", "wrapped=" + wrapped);

  const btnBox = await lb.evaluate(() => window.lightboxHarness.affordanceBoxFor("photo"));
  assert(!!btnBox, "常驻按钮存在且可定位", btnBox ? Math.round(btnBox.width) + "x" + Math.round(btnBox.height) : "未找到");
  if (btnBox) {
    /* 默认左上：右上角是 Obsidian 自己的「编辑源文件 / 更多选项」入口，
     * 按钮贴那儿会把它盖住 —— 这是用户实测反馈，所以钉成断言。 */
    const nearLeft = Math.abs(btnBox.left - photoBox.x - 6) <= 2;
    const nearTop = Math.abs(btnBox.top - photoBox.y - 6) <= 2;
    assert(nearLeft && nearTop, "按钮默认贴在图片左上角内侧（距边 6px）",
      "图片左上 (" + Math.round(photoBox.x) + "," + Math.round(photoBox.y) + ") 按钮 (" + Math.round(btnBox.left) + "," + Math.round(btnBox.top) + ")");
  }
  const coversEditEntry = await lb.evaluate(() => window.lightboxHarness.coversTopRightCorner("photo"));
  assert(!coversEditEntry, "按钮不盖住右上角的编辑入口区（用户报的那个问题）",
    coversEditEntry ? "重叠了" : "右上角 32x32 区域干净");
  const leftClass = await lb.evaluate(() => window.lightboxHarness.affordanceClassFor("photo"));
  assert(!!leftClass && leftClass.indexOf("is-left") >= 0, "按钮带 is-left 标记（角由设置决定）", leftClass || "无类名");

  /* 切成右上角：设置真的起作用（老用户想要老位置也不拦着） */
  await lb.evaluate(() => window.lightboxHarness.setCorner("top-right"));
  const rightBox = await lb.evaluate(() => window.lightboxHarness.affordanceBoxFor("photo"));
  const rightClass = await lb.evaluate(() => window.lightboxHarness.affordanceClassFor("photo"));
  assert(!!rightBox && Math.abs(photoBox.x + photoBox.width - rightBox.right - 6) <= 2 && rightClass.indexOf("is-right") >= 0,
    "设置改成右上角后：按钮真的回到右上角内侧", rightClass || "未找到按钮");
  await lb.evaluate(() => window.lightboxHarness.setCorner("top-left"));

  await lb.screenshot({ path: path.join(OUT, "lightbox-affordance.png") });

  /* ② 不点按钮、直接点图片：桌面不应打开查看器（保持点击的原意） */
  await lb.mouse.click(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
  await lb.waitForTimeout(120);
  const afterPlainClick = await lb.evaluate(() => window.lightboxHarness.isOpen());
  assert(!afterPlainClick, "桌面上直接点图片不会打开查看器（点击保持原意）", "open=" + afterPlainClick);

  /* ③ 点常驻按钮才打开 */
  const photoBtn = await lb.evaluate(() => window.lightboxHarness.affordanceBoxFor("photo"));
  await lb.mouse.click(photoBtn.left + photoBtn.width / 2, photoBtn.top + photoBtn.height / 2);
  await lb.waitForTimeout(150);
  const opened = await lb.evaluate(() => ({
    open: window.lightboxHarness.isOpen(),
    overlays: window.lightboxHarness.overlayCount(),
    label: window.lightboxHarness.label(),
    size: window.lightboxHarness.sizeText(),
    moved: window.lightboxHarness.diagramParentIsOverlay(),
    inPlace: window.lightboxHarness.diagramBackInPlace(),
  }));
  const first = await lbState();
  assert(opened.open && opened.overlays === 1, "点右上角按钮 → 打开查看器（且只有一个浮层）", "overlays=" + opened.overlays);
  const backgrounds = await lb.evaluate(() => ({
    matches: window.lightboxHarness.backgroundMatchesNote(),
    canvas: window.lightboxHarness.canvasTransparent(),
  }));
  assert(backgrounds.matches, "查看器底色等于主题的 --background-primary（与笔记一致，不透明元素不会露馅）", "matches=" + backgrounds.matches);
  assert(backgrounds.canvas, "查看器画布本身透明（只有视口有底色）", "canvasTransparent=" + backgrounds.canvas);

  const contentStyle = await lb.evaluate(() => window.lightboxHarness.contentStyle());
  assert(contentStyle && contentStyle.background === "rgba(0, 0, 0, 0)" && contentStyle.borderWidth === "0px" && contentStyle.boxShadow === "none",
    "放大后的内容不加背景/边框/阴影（原本什么样就什么样）",
    JSON.stringify(contentStyle));
  assert(/^\d+ x \d+ px/.test(String(opened.size)), "工具条显示原始尺寸与当前显示尺寸", String(opened.size));
  assert(opened.inPlace && !opened.moved, "未打开图表时，图表仍在原位", "inPlace=" + opened.inPlace);

  const lbRect2 = await lb.evaluate(() => window.lightboxHarness.rect());
  const expectedFit = (lbRect2.width - 48) / 1600;
  assert(Math.abs(first.scale - expectedFit) < 0.02, "打开即适配窗口（按 1600px 自然宽度算比例）",
    "scale=" + fmt(first.scale) + " 期望 " + fmt(expectedFit));

  await lb.evaluate(() => window.lightboxHarness.clickToolbar("Zoom in"));
  await lb.waitForTimeout(80);
  const zoomedIn = await lbState();
  assert(zoomedIn.scale > first.scale, "工具条 + 号放大", fmt(first.scale) + " → " + fmt(zoomedIn.scale));

  /* 顺手把「查看器打开着」的样子截下来，README 与目录列表要用（关闭状态下截图没意义） */
  await lb.screenshot({ path: path.join(OUT, "lightbox-desktop-open.png") });

  await lb.evaluate(() => window.lightboxHarness.clickToolbar("Actual size (100%)"));
  await lb.waitForTimeout(80);
  const actual = await lbState();
  assert(Math.abs(actual.scale - 1) < 0.001, "1:1 按钮回到 100%", "scale=" + fmt(actual.scale));

  const lbCenter = { x: lbRect2.left + lbRect2.width / 2, y: lbRect2.top + lbRect2.height / 2 };
  const lbAnchor = { x: lbRect2.left + 300, y: lbRect2.top + 200 };
  await lb.mouse.move(lbAnchor.x, lbAnchor.y);
  const beforeWheel = await lbState();
  await lb.keyboard.down("Control");
  await lb.mouse.wheel(0, -240);
  await lb.keyboard.up("Control");
  await lb.waitForTimeout(80);
  const afterWheel = await lbState();
  const contentBefore = { x: (lbAnchor.x - lbRect2.left - beforeWheel.x) / beforeWheel.scale, y: (lbAnchor.y - lbRect2.top - beforeWheel.y) / beforeWheel.scale };
  const contentAfter = { x: (lbAnchor.x - lbRect2.left - afterWheel.x) / afterWheel.scale, y: (lbAnchor.y - lbRect2.top - afterWheel.y) / afterWheel.scale };
  assert(afterWheel.scale > beforeWheel.scale, "查看器里 Ctrl+滚轮放大", fmt(beforeWheel.scale) + " → " + fmt(afterWheel.scale));
  assert(near(contentAfter.x, contentBefore.x, 0.6) && near(contentAfter.y, contentBefore.y, 0.6),
    "查看器同样遵守锚点不变量（光标下的像素不动）",
    "内容坐标 (" + fmt(contentBefore.x) + "," + fmt(contentBefore.y) + ") → (" + fmt(contentAfter.x) + "," + fmt(contentAfter.y) + ")");

  const panBefore = await lbState();
  await lb.mouse.move(lbCenter.x, lbCenter.y);
  await lb.mouse.down();
  await lb.mouse.move(lbCenter.x + 70, lbCenter.y + 40, { steps: 8 });
  await lb.mouse.up();
  await lb.waitForTimeout(80);
  const panAfter = await lbState();
  assert(near(panAfter.x - panBefore.x, 70, 3) && near(panAfter.y - panBefore.y, 40, 3),
    "查看器里拖动平移", "Δx=" + fmt(panAfter.x - panBefore.x) + " Δy=" + fmt(panAfter.y - panBefore.y));

  await lb.keyboard.press("Escape");
  await lb.waitForTimeout(120);
  const closed = await lb.evaluate(() => ({ open: window.lightboxHarness.isOpen(), overlays: window.lightboxHarness.overlayCount() }));
  assert(!closed.open && closed.overlays === 0, "ESC 关闭查看器（浮层完全移除）", "overlays=" + closed.overlays);

  await lb.click("#photo");
  await lb.waitForTimeout(100);
  await lb.mouse.click(lbRect2.left + lbRect2.width - 30, lbRect2.top + lbRect2.height - 30);
  await lb.waitForTimeout(120);
  const closedByBackground = await lb.evaluate(() => window.lightboxHarness.isOpen());
  assert(!closedByBackground, "点击空白背景也能关闭", "open=" + closedByBackground);

  const diagramBtn = await lb.evaluate(() => window.lightboxHarness.affordanceBoxFor("diagram"));
  assert(!!diagramBtn && Math.abs(diagramBtn.left - hostBox.x - 6) <= 2,
    "常驻按钮也贴在图表区域的左上角（与图片同一套摆放逻辑）",
    diagramBtn ? "图表左 " + Math.round(hostBox.x) + " 按钮左 " + Math.round(diagramBtn.left) : "未出现");
  await lb.mouse.click(diagramBtn.left + diagramBtn.width / 2, diagramBtn.top + diagramBtn.height / 2);
  await lb.waitForTimeout(150);
  const diagramOpen = await lb.evaluate(() => ({
    open: window.lightboxHarness.isOpen(),
    moved: window.lightboxHarness.diagramParentIsOverlay(),
    style: window.lightboxHarness.contentStyle(),
  }));
  assert(diagramOpen.open && diagramOpen.moved, "点按钮 → 图表被搬进查看器（保留原样式作用域）", "moved=" + diagramOpen.moved);
  assert(diagramOpen.style && diagramOpen.style.background === "rgba(0, 0, 0, 0)",
    "放大的图表背景透明（线框与文字保持实心配色）", JSON.stringify(diagramOpen.style));
  await lb.evaluate(() => window.lightboxHarness.lightbox.close());
  await lb.waitForTimeout(120);
  const svgRestored = await lb.evaluate(() => window.lightboxHarness.diagramBackInPlace());
  assert(svgRestored, "关闭后图表放回原位", "inPlace=" + svgRestored);

  /* ③b 高清（用户原话：「双击后的图片，不要压缩了，因为我双击就是需要高清的，
   *     否则，放大查看都模糊了」）。两条硬要求：
   *       · 画布不能带 will-change: transform —— 它把画面钉死在提层时的比例上，
   *         之后放大只是把旧位图拉大（位图会软、CSS 文字会糊）；
   *       · 打开查看器【绝不放大小图】：装得下就按 100% 放，放大是插值，等于糊。 */
  await lb.evaluate(() => window.lightboxHarness.openImage());
  await lb.waitForTimeout(200);
  const willChange = await lb.evaluate(() => window.lightboxHarness.canvasWillChange());
  assert(willChange !== "transform",
    "查看器画布没有 will-change: transform（否则放大＝拉伸旧位图，越放越糊）",
    "will-change=" + willChange);
  const dProbe = await lb.evaluate(() => window.lightboxHarness.probe());
  assert(!!dProbe && dProbe.cssWidth === 1600 && dProbe.maxWidth === "none",
    "查看器里图片的排版尺寸 = 源图自然尺寸（桌面上 DPR=1，行为与从前一致）",
    dProbe ? dProbe.cssWidth + "px · max-width=" + dProbe.maxWidth : "未打开");
  await lb.evaluate(() => window.lightboxHarness.lightbox.close());
  await lb.waitForTimeout(120);

  await lb.evaluate(() => window.lightboxHarness.openTiny());
  await lb.waitForTimeout(220);
  const tinyProbe = await lb.evaluate(() => window.lightboxHarness.probe());
  assert(!!tinyProbe && tinyProbe.cssWidth === 200 && near(tinyProbe.scale, 1, 0.01),
    "小图（200x80）打开时按 100% 放，不会被「适配」放大到糊",
    tinyProbe ? "css=" + tinyProbe.cssWidth + "px scale=" + fmt(tinyProbe.scale) : "未打开");
  await lb.evaluate(() => window.lightboxHarness.lightbox.close());
  await lb.waitForTimeout(120);

  /* ③c 原图高清：正文里那张可能只是缩略图（srcset 挑了小的、或被懒加载塞了 1px 占位图），
   *     查看器的语义是「我要看原图」—— 用户原话：「点击图片的时候，你需要确定放大的图片是原图高清的」。 */
  const noteSrcset = await lb.evaluate(() => window.lightboxHarness.noteNatural("srcset-img"));
  await lb.evaluate(() => window.lightboxHarness.openSrcset());
  await lb.waitForTimeout(320);
  const srcsetProbe = await lb.evaluate(() => window.lightboxHarness.probe());
  /* 注意这条断言的边界：无头 Chromium 在本地给 srcset 挑的就是最大的那张（"big"），
   * 所以它证明的是「最终拿到的是最大候选 1600px」，不能证明「比浏览器更会挑」——
   * 「挑最大的一张」这条逻辑由 tests/lightbox.test.ts 的 pickHiResSource 单测钉住，
   * 浏览器这一侧的可判定场景是下面的懒加载占位图（旧代码实测只拿到 1x1）。 */
  assert(!!srcsetProbe && srcsetProbe.naturalWidth === 1600,
    "查看器最终拿到的是 srcset 里最大的那张（1600px 原图，而不是正文里的显示尺寸）",
    (noteSrcset ? "浏览器给正文挑了 " + noteSrcset.which + "（滑位 " + noteSrcset.width + "px）" : "?") + " → 查看器 " + (srcsetProbe ? srcsetProbe.naturalWidth : "?") + "px");
  await lb.evaluate(() => window.lightboxHarness.lightbox.close());
  await lb.waitForTimeout(120);

  await lb.evaluate(() => window.lightboxHarness.openLazy());
  await lb.waitForTimeout(320);
  const lazyProbe = await lb.evaluate(() => window.lightboxHarness.probe());
  assert(!!lazyProbe && lazyProbe.naturalWidth === 900,
    "src 是 1px 占位图（懒加载）时改用 data-src 的真图",
    lazyProbe ? lazyProbe.naturalWidth + "x" + lazyProbe.naturalHeight + "px" : "未打开");
  await lb.evaluate(() => window.lightboxHarness.lightbox.close());
  await lb.waitForTimeout(120);

  /* ③d 该关得掉：关闭按钮钉在【图片区域的右上角】（用户要求） */
  await lb.evaluate(() => window.lightboxHarness.openImage());
  await lb.waitForTimeout(320);
  const closeBox = await lb.evaluate(() => window.lightboxHarness.closeButton());
  assert(!!closeBox && closeBox.inViewport && closeBox.gapTop <= 20 && closeBox.gapRight <= 20 && closeBox.display !== "none",
    "关闭按钮钉在图片区域的右上角（与图片缩放无关，永远在同一个位置）",
    closeBox ? Math.round(closeBox.width) + "x" + Math.round(closeBox.height) + " · 距边 " + closeBox.gapRight + "/" + closeBox.gapTop + "px" : "没有按钮");
  assert(!!closeBox && closeBox.width >= 30,
    "关闭按钮是够大的独立按钮（不是工具条里那个 12px 的小叉）", closeBox ? Math.round(closeBox.width) + "px" : "?");
  if (closeBox) {
    await lb.mouse.click(closeBox.left + closeBox.width / 2, closeBox.top + closeBox.height / 2);
    await lb.waitForTimeout(220);
  }
  /* 按钮不存在时这条必然为假（旧代码就是：浮层里没有关闭按钮），
   * 但不能因为拿不到坐标就抛异常 —— 崩在这里会让后面所有断言都跑不到。 */
  const closedByButton = await lb.evaluate(() => ({ open: window.lightboxHarness.isOpen(), overlays: window.lightboxHarness.overlayCount() }));
  assert(!!closeBox && !closedByButton.open && closedByButton.overlays === 0,
    "真实鼠标点右上角关闭按钮 → 关掉放大图", closeBox ? "overlays=" + closedByButton.overlays : "没有关闭按钮");

  /* ③e 点图片 = 原图 100%（用户要的「点击图片 → 确定是原图高清」） */
  await lb.evaluate(() => window.lightboxHarness.openImage());
  await lb.waitForTimeout(320);
  const fitScale0 = await lbState();
  const imgRect = await lb.evaluate(() => window.lightboxHarness.imageRect());
  await lb.mouse.click(imgRect.left + imgRect.width / 2, imgRect.top + imgRect.height / 2);
  await lb.waitForTimeout(220);
  const tapped = await lb.evaluate(() => ({ t: window.lightboxHarness.transform(), size: window.lightboxHarness.sizeText() }));
  assert(near(tapped.t.scale, 1, 0.02) && /原图|native/.test(String(tapped.size)),
    "点一下图片 → 落到原图 100%（读数同时标明「原图 / native」）",
    fmt(fitScale0.scale) + " → " + fmt(tapped.t.scale) + " · " + tapped.size);
  await lb.waitForTimeout(430); /* 越过双击窗口：慢慢点第二下 = 收回适配 */
  await lb.mouse.click(imgRect.left + imgRect.width / 2, imgRect.top + imgRect.height / 2);
  await lb.waitForTimeout(220);
  const tappedBack = await lbState();
  assert(near(tappedBack.scale, fitScale0.scale, 0.05),
    "再点一下（慢点）→ 收回适配宽度", fmt(tapped.t.scale) + " → " + fmt(tappedBack.scale));

  const beforeDrag = await lbState();
  await lb.mouse.move(imgRect.left + 60, imgRect.top + 60);
  await lb.mouse.down();
  await lb.mouse.move(imgRect.left + 180, imgRect.top + 140, { steps: 10 });
  await lb.mouse.up();
  await lb.waitForTimeout(220);
  const afterDrag = await lbState();
  assert(near(afterDrag.scale, beforeDrag.scale, 0.001),
    "拖动平移松手不会误触发「点击 → 原图」（防误触）", fmt(beforeDrag.scale) + " → " + fmt(afterDrag.scale));
  await lb.evaluate(() => window.lightboxHarness.lightbox.close());
  await lb.waitForTimeout(120);

  /* ④ 其它插件画出来的 svg（只有 viewBox / width=100% / 固定像素）也必须能放大，
   *    而且不能再被 8 倍上限卡住（用户报的「其它 svg 放大失效」）。 */
  for (const svgId of ["svg-viewbox", "svg-percent", "svg-fixed"]) {
    await lb.locator("#" + svgId).scrollIntoViewIfNeeded();
    const box = await lb.locator("#" + svgId).boundingBox();
    const btn = await lb.evaluate((id) => window.lightboxHarness.affordanceBoxFor(id), svgId);
    const viewport = lb.viewportSize();
    const insideView = !!btn && btn.left >= 0 && btn.top >= 0 && btn.right <= viewport.width && btn.bottom <= viewport.height;
    const withinBox = !!btn && btn.right >= box.x && btn.left <= box.x + box.width;
    assert(!!btn, svgId + "：常驻放大按钮存在", btn ? "有" : "无");
    assert(insideView && withinBox,
      svgId + "：按钮落在图的范围里且在可视区域内",
      btn ? "按钮 " + Math.round(btn.left) + "-" + Math.round(btn.right) + "，图 " + Math.round(box.x) + "-" + Math.round(box.x + box.width) + "，视口宽 " + viewport.width : "未出现");
    /* 用按钮坐标发真实鼠标事件：Playwright 的 click() 会因「元素在视口外」直接拒绝，
     * 而这里要验的正是「宽图的按钮也在视口内、点得到」。 */
    await lb.mouse.click(btn.left + btn.width / 2, btn.top + btn.height / 2);
    await lb.waitForTimeout(140);
    const openedSvg = await lb.evaluate(() => {
      const node = document.querySelector(".zr-lightbox-node svg");
      const t = window.lightboxHarness.transform();
      return {
        open: window.lightboxHarness.isOpen(),
        pinnedWidth: node ? node.style.width : "",
        fitScale: t ? t.scale : 0,
      };
    });
    assert(openedSvg.open, svgId + "：点按钮 → 打开查看器", "open=" + openedSvg.open);
    assert(/px$/.test(String(openedSvg.pinnedWidth)),
      svgId + "：进查看器后尺寸被钉成像素（否则自身尺寸成循环依赖，放不动）",
      "style.width=" + (openedSvg.pinnedWidth || "(未设置)"));
    for (let i = 0; i < 16; i++) await lb.evaluate(() => window.lightboxHarness.clickToolbar("Zoom in"));
    await lb.waitForTimeout(140);
    const bigScale = await lb.evaluate(() => window.lightboxHarness.transform().scale);
    /* 断言写成「相对起点放大 10 倍以上」而不是绝对倍数：适配比例因图而异
     * （宽图起点小），绝对值会把正确的行为判成失败（这一条自己踩过）。 */
    assert(bigScale > 8 && bigScale >= openedSvg.fitScale * 10,
      svgId + "：可以持续放大（≥ 起点 10 倍，且突破旧的 8 倍上限）",
      "起点 " + fmt(openedSvg.fitScale) + " → " + fmt(bigScale) + "（" + fmt(bigScale / (openedSvg.fitScale || 1)) + "x）");
    await lb.evaluate(() => window.lightboxHarness.lightbox.close());
    await lb.waitForTimeout(100);
  }

  /* ⑤ 悬停模式（设置里关掉常驻时）：不悬停不出现，悬停才出现 */
  await lb.evaluate(() => window.lightboxHarness.setHoverMode());
  await lb.mouse.move(4, 4);
  await lb.waitForTimeout(120);
  const hoverHidden = await lb.evaluate(() => window.lightboxHarness.affordanceVisible());
  assert(!hoverHidden, "悬停模式：未悬停时按钮不出现（设置可切回这种干净的样子）", "visible=" + hoverHidden);
  await lb.mouse.move(photoBox.x + photoBox.width / 2, photoBox.y + photoBox.height / 2);
  await lb.waitForTimeout(120);
  const hoverShown = await lb.evaluate(() => window.lightboxHarness.affordanceVisible());
  assert(hoverShown, "悬停模式：指针移到图上按钮出现", "visible=" + hoverShown);
  /* 悬停模式走的是另一段摆放代码（position: fixed 的单例按钮），角也必须跟着设置走 */
  const hoverBox = await lb.evaluate(() => window.lightboxHarness.affordanceBox());
  assert(!!hoverBox && Math.abs(hoverBox.left - photoBox.x - 6) <= 3,
    "悬停模式的按钮同样默认贴左上（两段摆放代码行为一致）",
    hoverBox ? "按钮 left=" + Math.round(hoverBox.left) + " 图片 left=" + Math.round(photoBox.x) : "未找到按钮");
  await lb.evaluate(() => window.lightboxHarness.setPersistentMode());
  await lb.waitForTimeout(120);

  await lb.screenshot({ path: path.join(OUT, "lightbox-desktop.png") });
  assert(lbErrors.length === 0, "查看器验证台无脚本错误", lbErrors.slice(0, 2).join(" | ") || "无");
  await lbCtx.close();


  /* ======================= 四、查看器（手机触摸） ======================= */
  console.log("\n=== 查看器 手机 390x780（触摸打开 / 双指放大）===");
  const mLbCtx = await browser.newContext({
    viewport: { width: 390, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  const mLb = await mLbCtx.newPage();
  const mLbErrors = [];
  mLb.on("pageerror", (e) => mLbErrors.push(String((e && e.message) || e)));
  await mLb.goto(pathToFileURL(path.join(ROOT, "tests", "browser", "lightbox.html")).href, { waitUntil: "load" });
  await mLb.waitForFunction(() => window.lightboxHarness && document.getElementById("photo").naturalWidth > 0);
  const mLbClient = await mLbCtx.newCDPSession(mLb);
  const mTouch = (type, points) =>
    mLbClient.send("Input.dispatchTouchEvent", {
      type: type,
      touchPoints: points.map((pt, i) => ({ x: pt.x, y: pt.y, radiusX: 8, radiusY: 8, force: 1, id: pt.id === undefined ? i + 1 : pt.id })),
    });

  /* 切到真实触屏判定：没有悬停 → 轻点即打开查看器（这才是手机上的行为） */
  await mLb.evaluate(() => window.lightboxHarness.setTouchMode());
  const mPhotoBox = await mLb.locator("#photo").boundingBox();
  await mTouch("touchStart", [{ x: mPhotoBox.x + mPhotoBox.width / 2, y: mPhotoBox.y + mPhotoBox.height / 2 }]);
  await mTouch("touchEnd", []);
  await mLb.waitForTimeout(150);
  const mOpened = await mLb.evaluate(() => ({ open: window.lightboxHarness.isOpen(), label: window.lightboxHarness.label() }));
  assert(mOpened.open, "手机：触摸图片 → 打开查看器", "label=" + mOpened.label);

  const mBefore = await mLb.evaluate(() => window.lightboxHarness.transform());
  await mTouch("touchStart", [{ x: 120, y: 400, id: 1 }, { x: 220, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i++) {
    await mTouch("touchMove", [{ x: 120 - i * 5, y: 400, id: 1 }, { x: 220 + i * 5, y: 400, id: 2 }]);
  }
  await mTouch("touchEnd", []);
  await mLb.waitForTimeout(120);
  const mAfter = await mLb.evaluate(() => window.lightboxHarness.transform());
  assert(mAfter && mBefore && mAfter.scale > mBefore.scale * 1.5,
    "手机：查看器里双指张开 → 放大（距离翻倍 ≈ 2 倍）",
    fmt(mBefore ? mBefore.scale : 0) + " → " + fmt(mAfter ? mAfter.scale : 0));

  await mLb.evaluate(() => window.lightboxHarness.lightbox.close());
  await mLb.waitForTimeout(100);
  const mClosed = await mLb.evaluate(() => ({ open: window.lightboxHarness.isOpen(), overlays: window.lightboxHarness.overlayCount() }));
  assert(!mClosed.open && mClosed.overlays === 0, "手机：关闭后浮层彻底移除", "overlays=" + mClosed.overlays);
  await mLb.screenshot({ path: path.join(OUT, "lightbox-mobile.png") });

  /* ⑤ 手机：放大按钮必须自己看得见、按得准 —— 用户原话：
   *    「你应该展示放大的 icon，这样我就可以点击了，而不是依靠点击图片，
   *      因为图片点击的时候可能点击到了背景上去了」。 */
  await mLb.evaluate(() => window.lightboxHarness.setPersistentMode());
  await mLb.waitForTimeout(120);
  const mBtn = await mLb.evaluate(() => window.lightboxHarness.affordanceBoxFor("photo"));
  const mBtnVisible = await mLb.evaluate(() => window.lightboxHarness.affordanceVisibleFor("photo"));
  assert(!!mBtn && mBtnVisible && mBtn.display !== "none" && Number(mBtn.opacity) >= 0.85,
    "手机上放大按钮常驻可见（以前触屏是 display:none：用户看不到 icon，只能去点图）",
    mBtn ? "display=" + mBtn.display + " opacity=" + mBtn.opacity + " " + Math.round(mBtn.width) + "x" + Math.round(mBtn.height) : "没有按钮");
  const mOutsideHit = mBtn ? await mLb.evaluate((b) => window.lightboxHarness.hitIsAffordance(b.left + 3, b.top - 5), mBtn) : false;
  assert(mOutsideHit, "触区比图标大：贴着按钮外沿 5px 也算按到按钮（手指按不准）", "hit=" + mOutsideHit);

  if (mBtn) {
    await mTouch("touchStart", [{ x: mBtn.left + mBtn.width / 2, y: mBtn.top + mBtn.height / 2 }]);
    await mTouch("touchEnd", []);
    await mLb.waitForTimeout(240);
  }
  const mBtnOpen = await mLb.evaluate(() => ({ open: window.lightboxHarness.isOpen(), overlays: window.lightboxHarness.overlayCount() }));
  assert(mBtnOpen.open && mBtnOpen.overlays === 1,
    "手机：触摸这个 icon 就打开查看器（不必去点图片本身）", "overlays=" + mBtnOpen.overlays);

  /* ⑥ 高清：1 源像素 = 1 设备像素（用户原话：双击就是要高清的，否则放大都模糊） */
  const mProbe = await mLb.evaluate(() => window.lightboxHarness.probe());
  assert(!!mProbe && Math.abs(mProbe.cssWidth - mProbe.naturalWidth / mProbe.dpr) <= 1.5,
    "手机（DPR " + (mProbe ? mProbe.dpr : "?") + "）：查看器按 1 源像素 = 1 设备像素摆放",
    mProbe ? "1600px 的图 → " + mProbe.cssWidth + " CSS px（旧版是 1600 CSS px，等于把位图横向拉伸 3 倍）" : "未打开");
  await mLb.evaluate(() => window.lightboxHarness.setActualSize());
  await mLb.waitForTimeout(180);
  const mActual = await mLb.evaluate(() => window.lightboxHarness.probe());
  assert(!!mActual && near(mActual.scale, 1, 0.01) && Math.abs(mActual.devicePixels - mActual.naturalWidth) <= 3,
    "手机：100% 就是原图分辨率（一个源像素对一个物理像素，放大查看不再模糊）",
    mActual ? "scale=" + fmt(mActual.scale) + " · 物理像素 " + mActual.devicePixels + " / 源 " + mActual.naturalWidth : "未打开");
  await mLb.evaluate(() => window.lightboxHarness.lightbox.close());
  await mLb.waitForTimeout(120);

  /* ⑦ 手机：右上角关闭按钮 44px（手指按得到）+ 触摸图片 = 原图 */
  await mLb.evaluate(() => window.lightboxHarness.openImage());
  await mLb.waitForTimeout(320);
  const mClose = await mLb.evaluate(() => window.lightboxHarness.closeButton());
  assert(!!mClose && mClose.width >= 44 && mClose.height >= 44 && mClose.gapTop <= 20 && mClose.gapRight <= 20,
    "手机关闭按钮 44px 且钉在图片右上角（Apple HIG 的最小可点尺寸）",
    mClose ? Math.round(mClose.width) + "x" + Math.round(mClose.height) + " · 距边 " + mClose.gapRight + "/" + mClose.gapTop + "px" : "没有按钮");
  const mImgRect = await mLb.evaluate(() => window.lightboxHarness.imageRect());
  await mTouch("touchStart", [{ x: mImgRect.left + mImgRect.width / 2, y: mImgRect.top + mImgRect.height / 2 }]);
  await mTouch("touchEnd", []);
  await mLb.waitForTimeout(240);
  const mTapNative = await mLb.evaluate(() => ({ t: window.lightboxHarness.transform(), size: window.lightboxHarness.sizeText() }));
  assert(near(mTapNative.t.scale, 1, 0.02) && /原图|native/.test(String(mTapNative.size)),
    "手机：触摸图片 → 落到原图 100%", fmt(mTapNative.t.scale) + " · " + mTapNative.size);
  if (mClose) {
    await mTouch("touchStart", [{ x: mClose.left + mClose.width / 2, y: mClose.top + mClose.height / 2 }]);
    await mTouch("touchEnd", []);
    await mLb.waitForTimeout(240);
  }
  const mClosedByBtn = await mLb.evaluate(() => ({ open: window.lightboxHarness.isOpen(), overlays: window.lightboxHarness.overlayCount() }));
  assert(!!mClose && !mClosedByBtn.open && mClosedByBtn.overlays === 0,
    "手机：触摸右上角关闭按钮 → 关掉放大图（不用去找工具条）", mClose ? "overlays=" + mClosedByBtn.overlays : "没有关闭按钮");

  assert(mLbErrors.length === 0, "查看器手机验证台无脚本错误", mLbErrors.slice(0, 2).join(" | ") || "无");
  await mLbCtx.close();

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