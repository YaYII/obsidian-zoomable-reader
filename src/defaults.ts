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
  /* 常驻显示右上角放大按钮（默认）。关掉则只有指针悬停时才出现。 */
  persistentZoomButton: true,
  /* 图表排版增强（默认开）：把 Mermaid 的「一个标签最多铺多宽」从 200px 放宽到 460px，
   * 框随文字走 —— 学 PlantUML 的做法，中文长标签不再被折成四五行的窄条。 */
  diagramLayout: true,
  diagramWrapWidth: 460,
};
