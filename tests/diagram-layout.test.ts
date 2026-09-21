import { describe, expect, it } from "vitest";
import { DEFAULT_DIAGRAM_LAYOUT, applyDiagramLayout, mergeDiagramConfig } from "../src/diagram-layout";

/* 宿主（Obsidian）真实传给 Mermaid 的参数：这里逐项复刻，
 * 用来守「深合并不能把宿主的设置冲掉」这条底线。 */
function hostConfig() {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    themeVariables: { fontFamily: "var(--font-mermaid)" },
    flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis", wrappingWidth: 200, padding: 15 },
    sequence: { useMaxWidth: false, actorMargin: 50, width: 150 },
    gantt: { useMaxWidth: false },
  };
}

describe("mergeDiagramConfig", () => {
  it("放宽标签宽度并给框更多留白", () => {
    const merged = mergeDiagramConfig(hostConfig(), DEFAULT_DIAGRAM_LAYOUT);
    const flow = merged.flowchart as Record<string, unknown>;
    expect(flow.wrappingWidth).toBe(260);
    expect(flow.padding).toBe(18);
    expect((merged.sequence as Record<string, unknown>).actorMargin).toBe(60);
  });

  it("宿主的设置原样保留（整块替换会把主题字体冲掉）", () => {
    const merged = mergeDiagramConfig(hostConfig(), DEFAULT_DIAGRAM_LAYOUT);
    const flow = merged.flowchart as Record<string, unknown>;
    const seq = merged.sequence as Record<string, unknown>;
    expect(flow.useMaxWidth).toBe(false);
    expect(flow.htmlLabels).toBe(true);
    expect(flow.curve).toBe("basis");
    expect(seq.useMaxWidth).toBe(false);
    expect(merged.securityLevel).toBe("strict");
    expect((merged.themeVariables as Record<string, unknown>).fontFamily).toBe("var(--font-mermaid)");
    expect((merged.gantt as Record<string, unknown>).useMaxWidth).toBe(false);
  });

  it("不修改入参（Mermaid 的配置对象是共享的，就地改会污染宿主）", () => {
    const host = hostConfig();
    const snapshot = JSON.stringify(host);
    mergeDiagramConfig(host, DEFAULT_DIAGRAM_LAYOUT);
    expect(JSON.stringify(host)).toBe(snapshot);
  });

  it("关闭时等于什么都不做", () => {
    const merged = mergeDiagramConfig(hostConfig(), DEFAULT_DIAGRAM_LAYOUT, false);
    expect((merged.flowchart as Record<string, unknown>).wrappingWidth).toBe(200);
    expect((merged.sequence as Record<string, unknown>).actorMargin).toBe(50);
  });

  it("宿主没给某一段时自己建出来（不是每个版本都带着这些键）", () => {
    const merged = mergeDiagramConfig({}, DEFAULT_DIAGRAM_LAYOUT);
    expect((merged.flowchart as Record<string, unknown>).wrappingWidth).toBe(260);
    expect((merged.sequence as Record<string, unknown>).width).toBe(160);
    expect((merged.state as Record<string, unknown>).wrappingWidth).toBe(260);
  });

  it("state / class / er 与 flowchart 用同一个宽度上限", () => {
    const merged = mergeDiagramConfig(hostConfig(), DEFAULT_DIAGRAM_LAYOUT);
    for (const key of ["state", "class", "er"]) {
      expect((merged[key] as Record<string, unknown>).wrappingWidth).toBe(260);
    }
  });

  it("打开 markdownAutoWrap —— 不打开的话 wrappingWidth 对标签完全不起作用", () => {
    const merged = mergeDiagramConfig(hostConfig(), DEFAULT_DIAGRAM_LAYOUT);
    expect((merged.flowchart as Record<string, unknown>).markdownAutoWrap).toBe(true);
    /* 关闭时不许偷偷打开 */
    const off = mergeDiagramConfig(hostConfig(), DEFAULT_DIAGRAM_LAYOUT, false);
    expect((off.flowchart as Record<string, unknown>).markdownAutoWrap).toBeUndefined();
  });
});

describe("applyDiagramLayout", () => {
  /* 仿真实行为：initialize 之后 getConfig() 会返回【新】配置
   * （第一版 mock 让它一直返回旧配置，于是「已经是目标状态就不重复 initialize」这条假失败）。 */
  const makeWindow = (initial: Record<string, unknown>) => {
    const calls: Record<string, unknown>[] = [];
    let config = initial;
    return {
      calls,
      win: {
        mermaid: {
          initialize: (next: Record<string, unknown>) => {
            calls.push(next);
            config = next;
          },
          mermaidAPI: { getConfig: () => config },
        },
      },
    };
  };

  it("Mermaid 还没加载时返回 false（插件据此重试）", () => {
    expect(applyDiagramLayout({}, DEFAULT_DIAGRAM_LAYOUT)).toBe(false);
    expect(applyDiagramLayout(null, DEFAULT_DIAGRAM_LAYOUT)).toBe(false);
  });

  it("装上时用深合并后的配置调用 initialize", () => {
    const { win, calls } = makeWindow(hostConfig());
    expect(applyDiagramLayout(win, DEFAULT_DIAGRAM_LAYOUT)).toBe(true);
    expect(calls).toHaveLength(1);
    const flow = calls[0].flowchart as Record<string, unknown>;
    expect(flow.wrappingWidth).toBe(260);
    expect(flow.useMaxWidth).toBe(false);
  });

  it("已经是目标状态就不重复 initialize（layout-change 会频繁触发）", () => {
    const { win, calls } = makeWindow(hostConfig());
    applyDiagramLayout(win, DEFAULT_DIAGRAM_LAYOUT);
    applyDiagramLayout(win, DEFAULT_DIAGRAM_LAYOUT);
    expect(calls).toHaveLength(1);
  });
});
