/* 兼容旧引用：默认值与设置模型现在住在 settings-spec.ts（那里不依赖 obsidian，
 * 所以 tests/settings-spec.test.ts 能直接断言双语与取值范围）。 */
export { DEFAULT_SETTINGS } from "./settings-spec";
export type { ReaderMode, ZoomableReaderSettings, ZoomButtonCorner } from "./settings-spec";
