import type { ZoomableReaderSettings } from "./settings";

/** 默认值集中在单独文件里，避免 settings.ts 与 main.ts 互相 import 成环。 */
export const DEFAULT_SETTINGS: ZoomableReaderSettings = {
  rememberPosition: true,
  doubleTapZoom: 2,
  /* 默认放宽到 64 倍：看 4K 截图里的小字时，8 倍常常不够。
   * 上限只是防呆，不是设计意图 —— 需要时可在设置里调到 256。 */
  maxScale: 64,
  showToolbar: true,
  padding: 16,
  imageViewer: true,
  diagramViewer: true,
  lightboxFitOnOpen: true,
  clickToOpenViewer: false,
};
