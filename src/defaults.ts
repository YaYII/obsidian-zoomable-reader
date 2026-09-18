import type { ZoomableReaderSettings } from "./settings";

/** 默认值集中在单独文件里，避免 settings.ts 与 main.ts 互相 import 成环。 */
export const DEFAULT_SETTINGS: ZoomableReaderSettings = {
  rememberPosition: true,
  doubleTapZoom: 2,
  maxScale: 8,
  showToolbar: true,
  padding: 16,
};
