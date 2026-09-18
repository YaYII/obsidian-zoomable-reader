/* 官方 ESLint 规则集（eslint-plugin-obsidianmd 的 recommended，41 条）。
 * 社区目录的扫描器会用同一套规则检查源码，所以本地先跑一遍，把 Error 清零再提交。
 * 三处本地放宽，都写清理由：
 *   ① 若干规则需要类型信息（await-thenable 等），故补 projectService；
 *   ② tests/ 与 tools/ 是开发期脚本（vitest、Playwright），跑在 Node 里而不是插件运行时，
 *      允许 Node 内建模块、console 与 process —— 这些目录/后缀本来就在社区扫描器的忽略清单内；
 *   ③ 保留一条非阻塞警告 settings-tab/prefer-setting-definitions：声明式设置 API
 *      （getSettingDefinitions）能让设置在 1.13+ 的设置搜索里出现，但需要按新版 API 重写
 *      整张设置页，留到后续版本做，不影响当前功能。 */
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: ["node_modules/**", "main.js", "tests/browser/out/**", "docs/**", "eslint.config.mjs", "esbuild.config.mjs"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["tests/**/*.ts", "tools/**/*.mjs"],
    rules: {
      "obsidianmd/no-nodejs-modules": "off",
      "obsidianmd/rule-custom-message": "off",
      "obsidianmd/no-static-styles-assignment": "off",
      "no-console": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { args: "none", caughtErrors: "none" }],
    },
  },
];
