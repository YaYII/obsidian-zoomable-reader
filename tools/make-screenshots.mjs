#!/usr/bin/env node
/**
 * 生成目录列表用的截图：1200x800（桌面）与 900x1600（手机）。
 * 用的是【真实插件样式 + 真实手势层】渲染的一份笔记夹具（tools/screenshot-fixture.html），
 * 不是画出来的效果图；截图上传入口在社区目录的 Edit listing。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "images");
fs.mkdirSync(OUT, { recursive: true });
const FIXTURE = pathToFileURL(path.join(ROOT, "tools", "screenshot-fixture.html")).href;

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
const { chromium } = loadPlaywright();
const CHROME = ["/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/usr/bin/chromium"].find((p) => fs.existsSync(p));

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

const shots = [
  { name: "screenshot-desktop.png", width: 1200, height: 800, dpr: 1, mobile: false, zoom: 1.35, offsetY: -20 },
  { name: "screenshot-mobile.png", width: 450, height: 800, dpr: 2, mobile: true, zoom: 1.9, offsetY: -30 },
];

for (const shot of shots) {
  const context = await browser.newContext({
    viewport: { width: shot.width, height: shot.height },
    deviceScaleFactor: shot.dpr,
    isMobile: shot.mobile,
    hasTouch: shot.mobile,
  });
  const page = await context.newPage();
  await page.goto(FIXTURE, { waitUntil: "load" });
  await page.evaluate((spec) => {
    /* 用与插件相同的变换方式设置缩放与位置（translate + scale） */
    const canvas = document.getElementById("canvas");
    const label = document.querySelector(".zr-label");
    canvas.style.transform = "translate3d(16px, " + spec.offsetY + "px, 0) scale(" + spec.zoom + ")";
    if (label) label.textContent = Math.round(spec.zoom * 100) + "%";
  }, shot);
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(OUT, shot.name) });
  console.log("已生成 " + shot.name + "  " + shot.width * shot.dpr + "x" + shot.height * shot.dpr);
  await context.close();
}

await browser.close();
