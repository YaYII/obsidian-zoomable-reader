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

/** 阅读视图（Obsidian 自带的那个）的版心宽度：跟随主题，或固定一个像素值。 */
export type ReadingWidth = "theme" | "760" | "800" | "900" | "1000" | "1100" | "1200";

/** 把设置里的宽度取值换算成样式层要的数字（"theme" → 跟随主题）。 */
export function readingLineWidth(value: ReadingWidth): number | "theme" {
  if (value === "theme") return "theme";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : "theme";
}
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

  /* --- 阅读视图 / Reading view（Obsidian 自带的那个页面） --- */
  /** 阅读视图版心宽度：跟随主题，或固定值（用户要求 900） */
  readingWidth: ReadingWidth;
  /** 阅读视图缩放（%）：100 = 原样，只看字号与内容大小，版心宽度不变 */
  readingZoom: number;
  /** 阅读视图手势缩放：手机双指捏合 / 桌面 Ctrl+滚轮 */
  readingGestures: boolean;

  /* --- 打开方式与版面 / Opening & page --- */
  /** 打开笔记时默认用哪种模式：版面（跟随主题行宽）或白板（一整张 1280px 宽版面） */
  defaultMode: ReaderMode;
  /** 顶部工具条 */
  showToolbar: boolean;
  /** 版面模式的版心四周留白（px） */
  padding: number;

  /* --- 白板模式 / Whiteboard mode --- */
  /** 白板版面宽度（px）：整篇笔记渲染成【一张】这么宽的版面，没有卡片 */
  boardWidth: number;

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

/* --------------------------------------------------------------- 版面宽度
 * 白板版面宽度默认 1280px（网页版心宽：一行放得下长句，整篇往下滑着读）。
 * 想按纸的感觉选也行 —— A5 宽 148mm 在 96dpi 下约 560px（一行 35 字上下，正是书的行长），
 * A4 约 794px。换算按 CSS 的 96dpi：px = mm / 25.4 * 96。 */
export const PAPER_WIDTHS_PX = { A6: 397, A5: 560, A4: 794 } as const;
export type PaperName = keyof typeof PAPER_WIDTHS_PX;

/** 网页版心宽度（桌面 Web 的常见内容宽度）。白板默认就是它：一行放得下长句，
 *  配合「往下滑就是往下读」最顺 —— 比 A5（560px）宽得多，不再是窄窄一条。 */
export const WEB_WIDTH_PX = 1280;

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

/** 这个宽度的人话名字：网页宽 / A5 / A4 …… 都不是就返回 null（只报毫米）。 */
export function widthPresetName(width: number, tolerance: number = 8): string | null {
  if (Math.abs(width - WEB_WIDTH_PX) <= tolerance) return "网页宽 Web";
  return paperNameFor(width, tolerance);
}

/** 设置页里滑块右侧的读数：「1280 px · 网页宽 Web」/「560 px · A5 · 148mm」。 */
export function widthLabel(width: number): string {
  const paper = paperNameFor(width);
  if (paper) return width + " px · " + paper + " · " + widthToMm(width) + "mm";
  const preset = widthPresetName(width);
  if (preset) return width + " px · " + preset;
  return width + " px · " + widthToMm(width) + "mm";
}

export const DEFAULT_SETTINGS: ZoomableReaderSettings = {
  pinchZoom: true,
  pinchSensitivity: 1,
  doubleTapZoom: 2,
  /* 默认放宽到 64 倍：看 4K 截图里的小字时，8 倍常常不够。
   * 上限只是防呆，不是设计意图 —— 需要时可在设置里调到 256。 */
  maxScale: 64,
  /* 阅读视图（不是本插件的视图）：默认把版心放宽到 900px —— 用户明确要求「把阅读视图
   * 的页面改为 900 的宽度，放大缩小我自己操作就可以了」。想完全交给主题就选「跟随主题」。 */
  readingWidth: "900",
  readingZoom: 100,
  readingGestures: true,
  defaultMode: "page",
  showToolbar: true,
  padding: 16,
  /* 默认 1280px = 网页版心宽度。白板模式就是【一整张 1280 宽的版面】，上下滑动着读。 */
  boardWidth: WEB_WIDTH_PX,
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
  key: "readingGestures" | "pinchZoom" | "showToolbar" | "imageViewer" | "diagramViewer" | "lightboxFitOnOpen" | "clickToOpenViewer" | "persistentZoomButton" | "diagramLayout" | "rememberPosition";
}

export interface SettingSliderSpec extends SettingSpecBase {
  control: "slider";
  key: "readingZoom" | "pinchSensitivity" | "doubleTapZoom" | "maxScale" | "padding" | "boardWidth" | "diagramWrapWidth";
  min: number;
  max: number;
  step: number;
  /** 内联数值格式（如 "1.5×"、"320 px"） */
  format?: (value: number) => string;
}

export interface SettingDropdownSpec extends SettingSpecBase {
  control: "dropdown";
  key: "readingWidth" | "defaultMode" | "zoomButtonCorner";
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
          { zh: "白板 · 拖动 = 平移版面（往下滑就是往下读）；工具条「适配宽度」一键把版面铺满", en: "Board - drag = pan the page (scrolling down is reading down); the fit-width button fills the viewport with the page" },
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
    zh: "阅读视图（Obsidian 自带的页面）",
    en: "Reading view (Obsidian's own page)",
    zhIntro: "这里改的是 Obsidian 自带阅读视图的版心宽度与缩放：只注入两条样式，不动你的主题文件。缩放会【重排】（字变大、行宽不变），不是把整页拉变形。手机在阅读视图里双指捏合、桌面按 Ctrl+滚轮即可自己调，命令面板还有放大/缩小/复位。",
    enIntro: "These change Obsidian's own reading view: its line width and its zoom. Only two CSS rules are injected — your theme files are untouched. Zoom reflows (bigger text, same measure) instead of stretching the page. Pinch inside the reading view on mobile, Ctrl+wheel on desktop, or use the zoom commands.",
    items: [
      {
        control: "dropdown",
        id: "reading-width",
        key: "readingWidth",
        options: {
          theme: "跟随主题 / Follow the theme",
          "760": "760 px",
          "800": "800 px",
          "900": "900 px（默认 / default）",
          "1000": "1000 px",
          "1100": "1100 px",
          "1200": "1200 px",
        },
        zh: "阅读视图版心宽度",
        en: "Reading view line width",
        zhDesc: "默认 900px：比多数主题的 700~760 更宽，一行放得下长句。选「跟随主题」则完全不注入宽度规则。",
        enDesc: "Defaults to 900 px, wider than the 700–760 px most themes use, so long lines fit. Pick Follow the theme to inject nothing at all.",
        aliases: ["阅读视图", "宽度", "版心", "行宽", "页面", "reading", "view", "width", "line", "page"],
      },
      {
        control: "slider",
        id: "reading-zoom",
        key: "readingZoom",
        min: 60,
        max: 200,
        step: 5,
        format: (v) => v + "%",
        zh: "阅读视图缩放",
        en: "Reading view zoom",
        zhDesc: "100% = 原样。放大后字变大、版心宽度不变（会自动重排）；手机双指捏合、桌面 Ctrl+滚轮也能直接改。",
        enDesc: "100% is untouched. Above that the text grows while the measure stays the same (the page reflows). Pinch on mobile or Ctrl+wheel on desktop to change it live.",
        aliases: ["阅读视图", "缩放", "放大", "缩小", "字号", "reading", "zoom", "scale", "font"],
      },
      {
        control: "toggle",
        id: "reading-gestures",
        key: "readingGestures",
        zh: "阅读视图手势缩放",
        en: "Reading view zoom gestures",
        zhDesc: "手机在阅读视图里双指捏合、桌面按 Ctrl+滚轮即可缩放（单指滚动、单击、普通滚轮不受影响）。",
        enDesc: "Pinch inside the reading view on mobile, Ctrl+wheel on desktop (one-finger scrolling, taps and plain wheel are left alone).",
        aliases: ["手势", "双指", "捏合", "滚轮", "缩放", "gesture", "pinch", "wheel", "zoom"],
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
        options: { page: "版面（跟随主题行宽）/ Page", board: "白板（1280px 宽版面）/ Whiteboard" },
        zh: "打开笔记时的默认模式",
        en: "Default mode when a note opens",
        zhDesc: "白板模式把整篇笔记渲染成一张 1280px 宽的版面（网页版心宽），放在可平移缩放的板子上，往下滑着读；没有卡片、没有分栏。也可以在视图工具条上随时切换。",
        enDesc: "Whiteboard renders the whole note as one 1280 px page (a desktop web content width) on a pan-and-zoom surface, read by scrolling down: no cards, no columns. You can also switch from the view toolbar.",
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
    zhIntro: "白板模式 = 把整篇笔记渲染成【一张】1280px 宽的版面（网页版心宽），放在可以平移、缩放、往下滑的板子上读；没有卡片、没有分栏。每次进白板都重新编译一遍，笔记改了白板跟着变（只读，不落盘）。",
    enIntro: "Whiteboard renders the whole note as ONE 1280 px page (a desktop web content width) on a surface you can pan, zoom and scroll down: no cards, no columns. It is recompiled every time you enter it and follows the note as you edit (read-only, nothing is written).",
    items: [
      {
        control: "slider",
        id: "board-width",
        key: "boardWidth",
        min: 480,
        max: 1920,
        step: 20,
        format: widthLabel,
        zh: "白板版面宽度",
        en: "Whiteboard page width",
        zhDesc: "默认 1280px（网页版心宽）：一行放得下长句，整篇往下滑着读。想要纸的感觉可以调到 560（A5）或 794（A4），读数会显示毫米数；版面本身能捏合缩放，选自己顺眼的。",
        enDesc: "Defaults to 1280 px, a desktop web content width: long lines, one page you scroll down. Pick 560 (A5) or 794 (A4) for a paper feel — the readout shows millimetres. The page zooms, so use what reads best.",
        aliases: ["白板", "版面", "宽度", "版心", "网页", "纸张", "尺寸", "A4", "A5", "board", "page", "width", "web", "paper", "size"],
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
