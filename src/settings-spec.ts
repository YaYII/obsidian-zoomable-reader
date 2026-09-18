/* ============================================================================
 * Zoomable Reader · 设置的「数据」部分（纯数据，不依赖 obsidian）
 * ---------------------------------------------------------------------------
 * 为什么要单独一个文件：设置页要同时满足三件事，而它们不该各写一遍 ——
 *   ① 每一项都中英并列（用户手机上是中文界面，英文只用来对文档、对搜索）；
 *   ② Obsidian 1.13+ 用声明式 API（getSettingDefinitions）渲染，这样设置能进
 *      【设置搜索】—— 输入「双指」或 pinch 就能直接跳到那一项；
 *   ③ Obsidian 1.5.7~1.12 没有声明式 API，只能用命令式 Setting 逐行搭。
 * 于是：内容在这里定义一次（纯数据 + 双语 + 搜索别名），settings.ts 里两个
 * 渲染器都读它。数据是纯的，所以 tests/settings-spec.test.ts 能直接断言
 * 「每一项都有中文名和英文名、别名里既有中文也有英文」——双语是硬要求，不是愿望。
 * ========================================================================== */

export type ReaderMode = "page" | "board";
export type ZoomButtonCorner = "top-left" | "top-right";

export interface ZoomableReaderSettings {
  /* --- 手势与缩放 / Gestures & zoom --- */
  /** 双指捏合是否可用（手机上最常用的手势，单独给一个开关） */
  pinchZoom: boolean;
  /** 双指灵敏度：1 = 手指距离翻倍即放大一倍 */
  pinchSensitivity: number;
  /** 双击放大到的倍数 */
  doubleTapZoom: number;
  /** 最大放大倍数 */
  maxScale: number;

  /* --- 打开方式与版面 / Opening & page --- */
  /** 打开笔记时默认用哪种模式：版面（整页）或白板（编译成卡片画布） */
  defaultMode: ReaderMode;
  /** 顶部工具条 */
  showToolbar: boolean;
  /** 版面模式的版心四周留白（px） */
  padding: number;

  /* --- 白板模式 / Whiteboard mode --- */
  /** 白板卡片宽度（px） */
  boardCardWidth: number;
  /** 卡片展开层级：超过这一层的标题折进上一张卡 */
  boardMaxDepth: number;
  /** 卡片间距（px）：兄弟卡之间，父子之间按 2.5 倍走线 */
  boardGap: number;
  /** 画父子连线 */
  boardConnectors: boolean;
  /** 卡片数量上限：超过就自动折得更深，保证手机上不卡 */
  boardMaxCards: number;

  /* --- 图片与图表查看器 / Image & diagram viewer --- */
  imageViewer: boolean;
  diagramViewer: boolean;
  lightboxFitOnOpen: boolean;
  clickToOpenViewer: boolean;
  persistentZoomButton: boolean;
  /** 放大按钮贴在图片/图表的哪个角（默认左上：右上角是 Obsidian 的「编辑源文件」入口） */
  zoomButtonCorner: ZoomButtonCorner;

  /* --- 图表排版 / Diagram layout --- */
  diagramLayout: boolean;
  diagramWrapWidth: number;

  /* --- 数据 / Data --- */
  rememberPosition: boolean;
}

/* --------------------------------------------------------------- 纸张尺寸
 * 白板的卡片是一张「纸」：默认按 A5 走（148mm 宽），因为它最接近中文正文的舒适行长
 * （A5 宽 148mm 在 96dpi 下约 559~560px，15~16px 中文一行 35 字上下，正是书的行长）。
 * 换算按 CSS 的 96dpi：px = mm / 25.4 * 96。 */
export const PAPER_WIDTHS_PX = { A6: 397, A5: 560, A4: 794 } as const;
export type PaperName = keyof typeof PAPER_WIDTHS_PX;

/** 这个宽度是不是某张标准纸（容差 8px：滑块步长 10px，落点不会精确到小数点）。 */
export function paperNameFor(width: number, tolerance: number = 8): PaperName | null {
  for (const name of Object.keys(PAPER_WIDTHS_PX) as PaperName[]) {
    if (Math.abs(PAPER_WIDTHS_PX[name] - width) <= tolerance) return name;
  }
  return null;
}

/** CSS 像素 → 毫米（96dpi）：设置页里让用户看到自己选的是多大一张纸。 */
export function widthToMm(width: number): number {
  return Math.round((width / 96) * 25.4);
}

/** 设置页里滑块右侧的读数：「560 px ≈ A5 · 148mm」。 */
export function cardWidthLabel(width: number): string {
  const paper = paperNameFor(width);
  return width + " px" + (paper ? " ≈ " + paper : "") + " · " + widthToMm(width) + "mm";
}

export const DEFAULT_SETTINGS: ZoomableReaderSettings = {
  pinchZoom: true,
  pinchSensitivity: 1,
  doubleTapZoom: 2,
  /* 默认放宽到 64 倍：看 4K 截图里的小字时，8 倍常常不够。
   * 上限只是防呆，不是设计意图 —— 需要时可在设置里调到 256。 */
  maxScale: 64,
  defaultMode: "page",
  showToolbar: true,
  padding: 16,
  /* 默认 A5：卡片就是一张纸（148mm 宽 ≈ 560px）。以前是 320px，正文一行只有二十来个字，
   * 既不像纸也太窄 —— 用户实测反馈「白板看起来尺寸很小」。 */
  boardCardWidth: PAPER_WIDTHS_PX.A5,
  boardMaxDepth: 3,
  boardGap: 32,
  boardConnectors: true,
  boardMaxCards: 120,
  imageViewer: true,
  diagramViewer: true,
  lightboxFitOnOpen: true,
  clickToOpenViewer: false,
  /* 常驻显示右上角放大按钮（默认）。关掉则只有指针悬停时才出现。 */
  persistentZoomButton: true,
  /* 默认左上角：右上角被 Obsidian 的「编辑源文件 / Edit source」入口占着，
   * 按钮贴在那里会把它盖住（用户实测反馈）。 */
  zoomButtonCorner: "top-left",
  /* 图表排版增强（默认开）：把 Mermaid 的「一个标签最多铺多宽」从 200px 放宽到 460px，
   * 框随文字走 —— 学 PlantUML 的做法，中文长标签不再被折成四五行的窄条。 */
  diagramLayout: true,
  diagramWrapWidth: 460,
  rememberPosition: true,
};

/* ------------------------------------------------------------------ 设置项定义 */

export type SettingControlKind = "toggle" | "slider" | "dropdown" | "info" | "action";

export interface SettingSpecBase {
  /** 稳定 id（用于测试与 DOM 标记） */
  id: string;
  /** 双语名称：中文在前（中文用户先看到），英文在后（对文档、对搜索） */
  zh: string;
  en: string;
  zhDesc?: string;
  enDesc?: string;
  /** 多行说明（手势速查这类「表格」用它），中英并列 */
  lines?: Array<{ zh: string; en: string }>;
  /** 搜索别名：中英都要给，用户在设置搜索里既可能打「双指」也可能打 pinch */
  aliases?: string[];
}

export interface SettingToggleSpec extends SettingSpecBase {
  control: "toggle";
  key: "pinchZoom" | "showToolbar" | "boardConnectors" | "imageViewer" | "diagramViewer" | "lightboxFitOnOpen" | "clickToOpenViewer" | "persistentZoomButton" | "diagramLayout" | "rememberPosition";
}

export interface SettingSliderSpec extends SettingSpecBase {
  control: "slider";
  key: "pinchSensitivity" | "doubleTapZoom" | "maxScale" | "padding" | "boardCardWidth" | "boardMaxDepth" | "boardGap" | "boardMaxCards" | "diagramWrapWidth";
  min: number;
  max: number;
  step: number;
  /** 内联数值格式（如 "1.5×"、"320 px"） */
  format?: (value: number) => string;
}

export interface SettingDropdownSpec extends SettingSpecBase {
  control: "dropdown";
  key: "defaultMode" | "zoomButtonCorner";
  options: Record<string, string>;
}

export interface SettingInfoSpec extends SettingSpecBase {
  control: "info";
}

export interface SettingActionSpec extends SettingSpecBase {
  control: "action";
  /** 按钮文案（双语） */
  buttonZh: string;
  buttonEn: string;
  action: "clear-positions";
}

export type SettingSpec = SettingToggleSpec | SettingSliderSpec | SettingDropdownSpec | SettingInfoSpec | SettingActionSpec;

export interface SettingsGroupSpec {
  zh: string;
  en: string;
  zhIntro?: string;
  enIntro?: string;
  items: SettingSpec[];
}

const times = (value: number): string => value + "×";

export const SETTINGS_GROUPS: SettingsGroupSpec[] = [
  {
    zh: "手势与缩放",
    en: "Gestures & zoom",
    zhIntro: "双指捏合、拖动平移、双击放大都在这里。Obsidian 自带的阅读视图无法缩放（是应用层的限制），要缩放请用本插件的视图。",
    enIntro: "Pinch, drag and double-tap live here. Obsidian's own reading view cannot be zoomed (an app-level limit); open a note with this plugin's view to zoom.",
    items: [
      {
        control: "info",
        id: "gesture-help",
        zh: "手势速查",
        en: "Gesture cheat sheet",
        aliases: ["手势", "双指", "捏合", "缩放", "gesture", "pinch", "two finger", "zoom", "touch"],
        lines: [
          { zh: "手机 · 单指拖动 = 平移", en: "Mobile - one finger drag = pan" },
          { zh: "手机 · 双指捏合 = 缩放（就在下面这条开关里）", en: "Mobile - two finger pinch = zoom (the switch right below)" },
          { zh: "手机 · 双击 = 在 100% 与「双击倍数」之间切换", en: "Mobile - double tap = toggle between 100% and the double-tap zoom" },
          { zh: "桌面 · Ctrl / ⌘ + 滚轮 = 以指针为中心缩放", en: "Desktop - Ctrl / Cmd + wheel = zoom at the pointer" },
          { zh: "桌面 · 滚轮 / 拖动 = 平移", en: "Desktop - wheel / drag = pan" },
          { zh: "键盘 · + − 0 = 放大 / 缩小 / 复位", en: "Keyboard - + - 0 = zoom in / out / reset" },
          { zh: "白板 · 点卡片标题 = 放大到这张卡；点空白 + 拖动 = 平移全图", en: "Board - click a card title = zoom to that card; drag the background = pan the whole board" },
        ],
      },
      {
        control: "toggle",
        id: "pinch-zoom",
        key: "pinchZoom",
        zh: "双指捏合缩放",
        en: "Two-finger pinch zoom",
        zhDesc: "关掉后双指只跟随中点平移、不改缩放（有些输入法或手写笔会误发第二根指针时，可以关掉）。",
        enDesc: "Off: two fingers only pan with their midpoint. Useful when an IME or stylus emits a phantom second pointer.",
        aliases: ["双指", "两指", "捏合", "缩放", "pinch", "two finger", "gesture", "zoom"],
      },
      {
        control: "slider",
        id: "pinch-sensitivity",
        key: "pinchSensitivity",
        min: 0.5,
        max: 2,
        step: 0.25,
        format: times,
        zh: "捏合灵敏度",
        en: "Pinch sensitivity",
        zhDesc: "1× 表示手指距离翻倍即放大一倍。觉得「一捏就飞出去」就调小，觉得「捏半天不动」就调大。",
        enDesc: "1x means doubling the finger distance doubles the zoom. Lower it if zoom feels jumpy, raise it if it feels sluggish.",
        aliases: ["双指", "捏合", "灵敏度", "pinch", "sensitivity", "gesture"],
      },
      {
        control: "slider",
        id: "double-tap-zoom",
        key: "doubleTapZoom",
        min: 1.25,
        max: 4,
        step: 0.25,
        format: times,
        zh: "双击放大倍数",
        en: "Double-tap zoom",
        zhDesc: "双击（手机上双击、桌面双击）一次放大到多少倍。",
        enDesc: "How far a double-click or double-tap zooms in.",
        aliases: ["双击", "放大", "double tap", "double click", "zoom"],
      },
      {
        control: "slider",
        id: "max-scale",
        key: "maxScale",
        min: 8,
        max: 256,
        step: 8,
        format: times,
        zh: "最大放大倍数",
        en: "Maximum zoom",
        zhDesc: "捏合与滚轮的上限。设大一点没坏处 —— 这个上限只是防呆，避免误触后找不到自己在哪里。",
        enDesc: "Upper limit for pinch and wheel zoom. High values are fine; the cap only exists so a stray gesture cannot lose your place.",
        aliases: ["最大", "上限", "放大", "max", "limit", "zoom"],
      },
    ],
  },
  {
    zh: "打开方式与版面",
    en: "Opening & page",
    items: [
      {
        control: "dropdown",
        id: "default-mode",
        key: "defaultMode",
        options: { page: "版面（整页）/ Page", board: "白板（编译成卡片）/ Whiteboard" },
        zh: "打开笔记时的默认模式",
        en: "Default mode when a note opens",
        zhDesc: "白板模式会把 Markdown 编译成卡片画布：标题成卡、正文成块、大纲成连线，捏合放大后读细节。也可以在视图工具条上随时切换。",
        enDesc: "Whiteboard compiles the Markdown into a card canvas: headings become cards, content becomes blocks, the outline becomes connectors. You can also switch from the view toolbar.",
        aliases: ["白板", "模式", "默认", "board", "whiteboard", "mode", "default", "canvas"],
      },
      {
        control: "toggle",
        id: "show-toolbar",
        key: "showToolbar",
        zh: "显示工具条",
        en: "Show toolbar",
        zhDesc: "缩放按钮、当前倍数、模式切换、回到全图。",
        enDesc: "Zoom buttons, the current zoom level, the mode switch and fit-board.",
        aliases: ["工具条", "工具栏", "toolbar"],
      },
      {
        control: "slider",
        id: "page-padding",
        key: "padding",
        min: 0,
        max: 48,
        step: 4,
        format: (v) => v + " px",
        zh: "版心四周留白",
        en: "Page padding",
        zhDesc: "仅版面模式：笔记与视图边缘的距离（像素）。",
        enDesc: "Page mode only: gap between the note and the edge of the view, in pixels.",
        aliases: ["留白", "边距", "padding", "margin"],
      },
    ],
  },
  {
    zh: "白板模式",
    en: "Whiteboard mode",
    zhIntro: "白板模式把一篇 Markdown 编译成一张卡片画布：每个标题是一张卡，卡里是这一节的正文，卡片之间连出大纲。默认卡片按 A5 纸走（148mm），打开即原大；每次进白板都重新编译一遍，笔记改了白板跟着变（只读，不落盘）。",
    enIntro: "Whiteboard compiles a note into a card canvas: every heading is a card holding that section's content, and connectors draw the outline. Cards default to A5 paper (148mm) and open at natural size; the board is recompiled every time you enter it and follows the note as you edit (read-only, nothing is written).",
    items: [
      {
        control: "slider",
        id: "board-card-width",
        key: "boardCardWidth",
        min: 320,
        max: 900,
        step: 10,
        format: cardWidthLabel,
        zh: "卡片宽度（纸张大小）",
        en: "Card width (paper size)",
        zhDesc: "默认 A5（148mm ≈ 560px）：卡片就是一张纸，一行 30~40 个汉字，接近书的行长。A4 更宽、A6 更窄；白板本身可以捏合缩放，选自己顺眼的。",
        enDesc: "Defaults to A5 (148mm, about 560px): a card is a sheet of paper, 30-40 Chinese characters per line. A4 is wider, A6 narrower; the board itself zooms, so pick what reads best.",
        aliases: ["卡片", "宽度", "纸张", "尺寸", "A4", "A5", "A6", "card", "width", "paper", "size", "board"],
      },
      {
        control: "slider",
        id: "board-max-depth",
        key: "boardMaxDepth",
        min: 1,
        max: 6,
        step: 1,
        format: (v) => "H" + v,
        zh: "卡片展开层级",
        en: "Outline depth",
        zhDesc: "超过这一层的标题不单独成卡，而是作为小节折进上一张卡 —— 中文笔记常写到四五级标题，逐级成列会把白板拉得太宽。",
        enDesc: "Headings deeper than this fold into the ancestor card as a section, so a four-level note does not stretch the board into a thin ribbon.",
        aliases: ["层级", "深度", "大纲", "折叠", "depth", "heading", "outline", "fold"],
      },
      {
        control: "slider",
        id: "board-gap",
        key: "boardGap",
        min: 12,
        max: 80,
        step: 4,
        format: (v) => v + " px",
        zh: "卡片间距",
        en: "Card spacing",
        zhDesc: "兄弟卡片之间的垂直间距；父子之间按它的 2.5 倍留出走线的位置。",
        enDesc: "Vertical gap between sibling cards; parent-to-child spacing is 2.5x that, leaving room for the connectors.",
        aliases: ["间距", "间隔", "gap", "spacing"],
      },
      {
        control: "toggle",
        id: "board-connectors",
        key: "boardConnectors",
        zh: "显示连线",
        en: "Show connectors",
        zhDesc: "画出父卡到子卡的贝塞尔连线，一眼看出大纲结构。",
        enDesc: "Draws curved connectors from a parent card to its children.",
        aliases: ["连线", "连接", "线", "connector", "edge", "line"],
      },
      {
        control: "slider",
        id: "board-max-cards",
        key: "boardMaxCards",
        min: 20,
        max: 400,
        step: 20,
        format: (v) => v + " 张",
        zh: "卡片数量上限",
        en: "Card limit",
        zhDesc: "超过这个数量就自动折得更深（保证手机上不卡）。一篇几百个标题的长文档靠它保住手感。",
        enDesc: "Above this count the board folds deeper automatically, so a note with hundreds of headings stays responsive on a phone.",
        aliases: ["数量", "上限", "性能", "card", "limit", "performance"],
      },
    ],
  },
  {
    zh: "图片与图表查看器",
    en: "Image & diagram viewer",
    zhIntro: "阅读时点图片右上角的放大按钮（可改成左上角）就能全屏看细节。",
    enIntro: "Every image and diagram carries a small zoom button (movable to the top-left) that opens it full screen.",
    items: [
      {
        control: "dropdown",
        id: "zoom-button-corner",
        key: "zoomButtonCorner",
        options: { "top-left": "左上角 / Top left", "top-right": "右上角 / Top right" },
        zh: "放大按钮的位置",
        en: "Zoom button corner",
        zhDesc: "默认左上角。右上角是 Obsidian 的「编辑源文件 / 更多选项」入口，按钮放那里会把它盖住。",
        enDesc: "Defaults to the top-left: the top-right corner belongs to Obsidian's own edit-source and more-options controls, and the button used to cover them.",
        aliases: ["按钮", "位置", "角", "左上", "右上", "button", "corner", "position", "cover"],
      },
      {
        control: "toggle",
        id: "persistent-zoom-button",
        key: "persistentZoomButton",
        zh: "放大按钮常驻显示",
        en: "Always show the zoom button",
        zhDesc: "开：每张图片、每个图表都带一个小按钮，不用去找。关：只有指针悬停在图上时才出现。",
        enDesc: "On: every image and diagram carries a small button, so you never hunt for it. Off: the button only appears while the pointer is over it.",
        aliases: ["按钮", "常驻", "悬停", "button", "always", "hover"],
      },
      {
        control: "toggle",
        id: "image-viewer",
        key: "imageViewer",
        zh: "点击图片打开可缩放查看器",
        en: "Click images to open a zoomable viewer",
        zhDesc: "全屏查看图片，支持滚轮缩放、拖动平移与缩放按钮。",
        enDesc: "Opens the image full screen with wheel zoom, drag to pan and zoom buttons.",
        aliases: ["图片", "查看器", "放大", "image", "viewer", "zoom"],
      },
      {
        control: "toggle",
        id: "diagram-viewer",
        key: "diagramViewer",
        zh: "点击图表打开可缩放查看器",
        en: "Click diagrams to open a zoomable viewer",
        zhDesc: "Mermaid、Excalidraw、charts 画出来的图都能放大看。",
        enDesc: "Mermaid, Excalidraw and chart renders open in the same viewer, so you can zoom into a dense flow chart.",
        aliases: ["图表", "流程图", "查看器", "diagram", "mermaid", "viewer"],
      },
      {
        control: "toggle",
        id: "click-to-open-viewer",
        key: "clickToOpenViewer",
        zh: "点图片本身也打开查看器",
        en: "Open the viewer by clicking images too",
        zhDesc: "关（默认）：桌面上用图片角落的小按钮，点图片保持它原本的含义。触屏没有悬停，轻点总是打开查看器。",
        enDesc: "Off: on desktop the corner button opens the viewer and clicking the image keeps its usual meaning. On touch a tap always opens the viewer, since there is no hover.",
        aliases: ["点击", "图片", "查看器", "click", "image", "viewer"],
      },
      {
        control: "toggle",
        id: "lightbox-fit-on-open",
        key: "lightboxFitOnOpen",
        zh: "查看器打开时适配窗口",
        en: "Fit to window when the viewer opens",
        zhDesc: "关掉则以 100% 打开（适合对照像素细节）。",
        enDesc: "Off: images open at 100% instead of being scaled to fit.",
        aliases: ["适配", "适应", "100%", "fit", "window", "100"],
      },
    ],
  },
  {
    zh: "图表排版",
    en: "Diagram layout",
    items: [
      {
        control: "toggle",
        id: "diagram-layout",
        key: "diagramLayout",
        zh: "图表框随文字走",
        en: "Wider diagram boxes",
        zhDesc: "Mermaid 默认把标签限制在 200px，中文长标签会被折成四五行窄条。打开后放宽上限、给框更多留白（学 PlantUML 的做法）。已经打开的图表会在下次渲染时生效。",
        enDesc: "Mermaid caps a label at 200px, folding long Chinese labels into four or five narrow lines. This widens the cap and adds padding so boxes follow the text. Open diagrams pick it up on their next render.",
        aliases: ["mermaid", "图表", "排版", "框图", "diagram", "layout", "width", "plantuml"],
      },
      {
        control: "slider",
        id: "diagram-wrap-width",
        key: "diagramWrapWidth",
        min: 240,
        max: 800,
        step: 20,
        format: (v) => v + " px",
        zh: "标签最大宽度",
        en: "Max label width",
        zhDesc: "一个标签最多铺多宽才折行。460 是实测的中文舒适值，800 基本不折行。",
        enDesc: "How wide one label may get before it wraps. 460 is a comfortable value for Chinese; 800 is close to no wrapping at all.",
        aliases: ["标签", "宽度", "折行", "label", "width", "wrap"],
      },
    ],
  },
  {
    zh: "数据",
    en: "Data",
    items: [
      {
        control: "toggle",
        id: "remember-position",
        key: "rememberPosition",
        zh: "记住每篇笔记的缩放与位置",
        en: "Remember zoom and position per note",
        zhDesc: "存在本插件自己的 data.json 里，不上传到任何地方。",
        enDesc: "Stored locally in this plugin's data.json. Nothing is uploaded.",
        aliases: ["记住", "位置", "缩放", "remember", "position", "zoom", "privacy"],
      },
      {
        control: "action",
        id: "clear-positions",
        action: "clear-positions",
        buttonZh: "清除",
        buttonEn: "Clear",
        zh: "清除已保存的缩放与位置",
        en: "Clear saved zoom and positions",
        zhDesc: "每篇笔记下次打开都从 100% 开始。",
        enDesc: "Reset every note back to 100% next time it opens.",
        aliases: ["清除", "重置", "清空", "clear", "reset", "forget"],
      },
    ],
  },
];

/** 全部设置项（打平），测试与渲染器都从这里取。 */
export const ALL_SETTING_SPECS: SettingSpec[] = SETTINGS_GROUPS.flatMap((group) => group.items);
