import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/* 目录审核与用户最先看到的三样东西：manifest.json / versions.json / README。
 * 它们出错的方式都很安静（版本号不匹配 → 用户装不上新版本），所以用测试钉住。 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")) as Record<string, unknown>;
const versions = JSON.parse(fs.readFileSync(path.join(ROOT, "versions.json"), "utf8")) as Record<string, string>;
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, unknown>;

describe("manifest.json", () => {
  it("必填字段齐全", () => {
    for (const key of ["id", "name", "version", "minAppVersion", "description", "author"]) {
      expect(typeof manifest[key], key).toBe("string");
      expect(String(manifest[key]).length, key).toBeGreaterThan(0);
    }
  });

  it("id 是社区目录要求的形态（小写、连字符、无空格）", () => {
    expect(String(manifest.id)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("version 与 package.json 一致，且是语义化版本", () => {
    expect(manifest.version).toBe(pkg.version);
    expect(String(manifest.version)).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("versions.json 里有当前版本到 minAppVersion 的映射", () => {
    expect(versions[String(manifest.version)]).toBe(manifest.minAppVersion);
  });

  it("description 符合目录规则：≤250 字符、以句号结尾、无 emoji、不以 This is a plugin 开头", () => {
    const description = String(manifest.description);
    expect(description.length).toBeLessThanOrEqual(250);
    expect(description.endsWith(".")).toBe(true);
    expect(description).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    expect(description.toLowerCase().startsWith("this is a plugin")).toBe(false);
  });

  it("isDesktopOnly 为 false（不使用 Node/Electron API，手机端可用）", () => {
    expect(manifest.isDesktopOnly).toBe(false);
  });
});

describe("仓库文件与披露", () => {
  it("README 说明用途与用法，并写明不联网、不收集数据", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    expect(readme.length).toBeGreaterThan(500);
    expect(readme).toMatch(/privacy|Privacy|隐私/);
    expect(readme.toLowerCase()).toMatch(/no network|offline|不联网|no telemetry/);
  });

  it("LICENSE 存在且为 MIT", () => {
    const license = fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8");
    expect(license).toMatch(/MIT License/);
  });

  it("源码里没有网络请求与遥测（审核政策硬性要求）", () => {
    const files = [
      "main.ts",
      "src/view.ts",
      "src/zoom-pan.ts",
      "src/settings.ts",
      "src/settings-spec.ts",
      "src/defaults.ts",
      "src/board-model.ts",
      "src/board-layout.ts",
      "src/board-render.ts",
    ];
    for (const file of files) {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const forbidden of ["fetch(", "XMLHttpRequest", "navigator.sendBeacon", "require(\"http\")", "requestUrl"]) {
        expect(source.includes(forbidden), file + " 不应包含 " + forbidden).toBe(false);
      }
    }
  });
});
