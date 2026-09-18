/* ============================================================================
 * Zoomable Reader · 图表排版增强（学 PlantUML 的思路，但不改渲染器）
 * ---------------------------------------------------------------------------
 * 病根不在主题、也不在配色：Mermaid 把「一个标签最多铺多宽」写死在配置里 ——
 *   flowchart.wrappingWidth = 200（Mermaid 自带默认值）
 * 于是中文长标签被折成 3~5 行、框又窄又高。实测（同一段 46 字中文）：
 *   200px 上限 → 框 215x143，4 行；460px 上限 → 框 478x98，2 行。
 * PlantUML 的做法正相反：**框随文字走**，只有作者显式换行（\n）才折行。
 * 这就是「专业排版」的手感来源，也是这里要补的那一块。
 *
 * 主题是纯 CSS，动不了渲染器的布局参数；能动的只有插件。这里只做两件事：
 *
 * ① 【在宿主已有配置上深合并】，绝不整块替换。
 *    mermaid.initialize() 对嵌套对象是整体替换：直接传 { flowchart: { wrappingWidth } }
 *    会把 Obsidian 自己的 flowchart.useMaxWidth:false 与
 *    themeVariables.fontFamily: var(--font-mermaid) 一起冲掉 ——
 *    实测后果是中文掉回 Mermaid 默认的 "trebuchet ms"，整套字体都变了。
 *    深合并之后实测：useMaxWidth / fontFamily / securityLevel 全部原样保留。
 *
 * ② Mermaid 是**懒加载**的（第一次出现图表时才注入 window.mermaid），
 *    所以装不上要重试，并在 layout-change 时再试一次。
 * ========================================================================== */

/** 排版参数（每一项都写清「学的是 PlantUML 的哪一条」） */
export interface DiagramLayout {
  /** 流程图/状态图/类图：一个标签最多铺多宽（px）。
   *  PlantUML 不设这个上限（框随文字走），这里放宽到 460 而不是取消上限：
   *  完全不折行会让超长标签把图撑得极宽，手机上看不清。 */
  wrapWidth: number;
  /** 框内文字四周留白（px）。Mermaid 默认 15，PlantUML 的 padding 默认 10 —— 取 18，让框更透气 */
  nodePadding: number;
  /** 同级节点间距（px）。Mermaid 默认 50，PlantUML 的 nodesep 默认也是 50 —— 略放宽 */
  nodeSpacing: number;
  /** 层级间距（px）。Mermaid 默认 50，PlantUML 的 ranksep 默认 50 */
  rankSpacing: number;
  /** 整图四周留白（px）。Mermaid 默认 8 */
  diagramPadding: number;
  /** 时序图：参与者间距 / 参与者框宽 / 消息间距（Mermaid 默认 50 / 150 / 35，PlantUML 更宽松） */
  sequence: {
    actorMargin: number;
    width: number;
    messageMargin: number;
    diagramMarginX: number;
    diagramMarginY: number;
    boxMargin: number;
  };
}

export const DEFAULT_DIAGRAM_LAYOUT: DiagramLayout = {
  wrapWidth: 460,
  nodePadding: 18,
  nodeSpacing: 55,
  rankSpacing: 60,
  diagramPadding: 12,
  sequence: {
    actorMargin: 60,
    width: 160,
    messageMargin: 40,
    diagramMarginX: 60,
    diagramMarginY: 14,
    boxMargin: 12,
  },
};

/** window.mermaid 里我们要用到的那一小部分（Mermaid 由 Obsidian 注入，不是我们的依赖） */
export interface MermaidGlobal {
  initialize?: (config: Record<string, unknown>) => void;
  mermaidAPI?: { getConfig?: () => Record<string, unknown> };
}

/** 只复制普通对象/数组/原始值；函数等其它东西原样带过去（Mermaid 的配置里可能有它们） */
function clonePlain(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) out[key] = clonePlain(source[key]);
    return out;
  }
  return value;
}

/** 配置对象是「任意层级的普通对象」，用它来避免到处写断言 */
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function section(container: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = container[key];
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return asRecord(existing);
  }
  const created: Record<string, unknown> = {};
  container[key] = created;
  return created;
}

/**
 * 把排版参数【深合并】到宿主当前配置上，返回一份新对象（不修改入参）。
 * 关闭时只返回克隆，等于什么都不做 —— 让「关掉这个功能」是可验证的行为，而不是「不调用」。
 */
export function mergeDiagramConfig(
  current: Record<string, unknown> | null | undefined,
  layout: DiagramLayout,
  enabled: boolean = true
): Record<string, unknown> {
  const merged = asRecord(clonePlain(current ?? {}));
  if (!enabled) return merged;

  Object.assign(section(merged, "flowchart"), {
    wrappingWidth: layout.wrapWidth,
    padding: layout.nodePadding,
    nodeSpacing: layout.nodeSpacing,
    rankSpacing: layout.rankSpacing,
    diagramPadding: layout.diagramPadding,
  });

  /* state / class / er 也走 flowchart 那套 dagre 布局，标签宽度用的是同一个上限；
   * 不设 wrappingWidth 时它们各自继承默认值，所以这里显式写一份，保持同一手感。 */
  for (const key of ["state", "class", "er"]) {
    const node = section(merged, key);
    if (node.wrappingWidth === undefined) node.wrappingWidth = layout.wrapWidth;
    if (node.padding === undefined) node.padding = layout.nodePadding;
  }

  Object.assign(section(merged, "sequence"), {
    actorMargin: layout.sequence.actorMargin,
    width: layout.sequence.width,
    messageMargin: layout.sequence.messageMargin,
    diagramMarginX: layout.sequence.diagramMarginX,
    diagramMarginY: layout.sequence.diagramMarginY,
    boxMargin: layout.sequence.boxMargin,
  });

  return merged;
}

/**
 * 把参数装进 Mermaid。返回 true 表示「现在已经是我们要的状态」。
 * Mermaid 还没加载时返回 false（宿主可以稍后重试）。
 */
export function applyDiagramLayout(
  win: { mermaid?: MermaidGlobal } | null | undefined,
  layout: DiagramLayout,
  enabled: boolean = true
): boolean {
  const mermaid = win?.mermaid;
  if (!mermaid || typeof mermaid.initialize !== "function") return false;

  const current = asRecord(mermaid.mermaidAPI?.getConfig?.());
  if (!enabled) return true;

  /* 已经是我们设过的值就不再重复 initialize：layout-change 会频繁触发，
   * 每次都重设一遍配置既没必要，也可能把别人（其它插件）后来的改动顶掉。 */
  if (asRecord(current.flowchart).wrappingWidth === layout.wrapWidth) return true;

  mermaid.initialize(mergeDiagramConfig(current, layout, true));
  return true;
}
