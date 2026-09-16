window.__ModuleLoader__.load({
	id: "@dsh-one/dsh-context-menu",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/dsh-context-menu/src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/ui/assembly/shell/contextMenuPlugin.ts
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/ui/assembly/shell/mountPoints.ts
var CONVERSATION_SCROLL_SELECTOR = "[data-conversation-scroll]";
function conversationContainer() {
  return document.querySelector(CONVERSATION_SCROLL_SELECTOR);
}
function mountOnConversation(attach) {
  let container = null;
  let detach = null;
  const sync = () => {
    if (container !== null && container.isConnected) return;
    detach?.();
    detach = null;
    container = conversationContainer();
    if (container !== null) detach = attach(container);
  };
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  sync();
  return () => {
    observer.disconnect();
    detach?.();
    detach = null;
    container = null;
  };
}

// src/ui/assembly/shell/contextMenuPlugin.ts
var TARGET_ATTR = "data-dshone-menu-target";
var MENU_ATTR = "data-dshone-menu";
var MENU_ICON_MARK = "icon";
var ICON_ITEM_ATTR = "data-dshone-icon-item";
var ICON_ITEM_CLASS = "dshOneMenu_iconItem";
var COPIED_FEEDBACK_MS = 700;
var CSS = [
  // 右键目标高亮：以**官方侧栏当前会话行（选中态）**为基准。官方那条规则逐字是
  // `.YDXeBa_sessionRow:hover, .YDXeBa_sessionRow.YDXeBa_selected { background:
  // var(--dsw-alias-interactive-bg-hover) }`（无描边），所以底色取同一个 token；
  // 行内码自身有底色、单靠底色不够显眼，再叠一圈官方细描边 token
  // `--dsw-alias-border-l2`（官方菜单/卡片的描边同族）与同色外扩，形成明确轮廓。
  // 全部官方 token，浅/暗主题自动跟随。
  `code[${TARGET_ATTR}]{background-color:var(--dsw-alias-interactive-bg-hover);box-shadow:0 0 0 1px var(--dsw-alias-border-l2),0 0 0 3px var(--dsw-alias-interactive-bg-hover)}`,
  // 单图标项：官方**没有纯图标菜单项的先例**（48 个插件 bundle 全量扫 items 条目：
  // 19 条都有 label，没有一条是「有 icon 无 label」；官方的纯图标控件是 Button
  // 工具条档，不是 Menu 项），所以按第 4 层兜底：只对**本图标项**改成对称内边距、
  // 方盒。数值按图标档位推：(26px 官方紧凑行高 − 14px 图标) / 2 = 6px，上下左右等值、
  // 盒子 26×26（官方紧凑档行高不变）。
  // 判定用 :has(自有标记) —— 只命中我们自己那一项，不动官方任一项；:has 在本仓库
  // 已有多处使用（导出胶囊、设置行动），目标运行环境（VS Code Electron / Chromium）
  // 原生支持。风险：若官方未来给菜单项加同名 slot 结构，:has 仍只看我们自己的属性。
  `[${MENU_ATTR}="${MENU_ICON_MARK}"] button[role="menuitem"]:has([${ICON_ITEM_ATTR}]){padding:6px;justify-content:center}`,
  // 图标容器：flex 居中（消掉行内盒的基线偏移——实测改前图标上方 9px、下方 15px，
  // 因为官方 itemLabel 是 22px 行盒、内联 svg 坐在基线上）。
  `.${ICON_ITEM_CLASS}{display:flex;align-items:center;justify-content:center}`,
  `.dshOneMenu_copied{gap:4px;justify-content:flex-start}`,
  `.dshOneMenu_copiedText{white-space:nowrap}`,
  // 单图标项：官方列表默认 min-width:218px（文字菜单的档位），图标项只需要图标
  // 的自然宽度，所以把列表收到内容宽。机制层 4 举证：官方 Menu 没有列表宽度属性口
  // （props 只有 open/anchor/items/onSelect/onClose/align/side/portal/
  // closeOnPointerLeave/dense/compact/getAnchorRect/footer/className，源码逐字确认；
  // 且 className 落在 root span 上、不是列表元素）；这里给**列表元素**加一个自有
  // 属性再按属性选择器上样式，不依赖任何 css-module 哈希；定位靠 role="menu"
  // 语义属性（仅在我们自己的菜单开着时）。
  // !important：官方紧凑档的规则是双类选择器（`._list_x._compactList_y{min-width:164px}`），
  // 单属性选择器的特异性压不过它——这里是我们自己给自己加的标记属性，代价可控。
  `[${MENU_ATTR}="${MENU_ICON_MARK}"]{min-width:0!important;width:max-content}`
].join("");
var CSS_TAG_ID = "@dsh-one/dsh-context-menu/Target.css";
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dsh-one/dsh-context-menu";
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
function clearHighlight() {
  for (const el of Array.from(document.querySelectorAll(`[${TARGET_ATTR}]`))) el.removeAttribute(TARGET_ATTR);
}
function clearMenuMark() {
  for (const el of Array.from(document.querySelectorAll(`[${MENU_ATTR}]`))) el.removeAttribute(MENU_ATTR);
}
var CLOSED = { open: false, x: 0, y: 0, text: "" };
function inlineCodeOf(target) {
  const code = target.closest("code");
  if (code === null) return null;
  if (code.closest("pre, a, button") !== null) return null;
  if (code.querySelector("button") !== null) return null;
  return code;
}
function ContextMenuLayer({ t }) {
  const tr = t;
  const [state, setState] = (0, import_react.useState)(CLOSED);
  const [copied, setCopied] = (0, import_react.useState)(false);
  const copiedTimer = (0, import_react.useRef)(null);
  const targetRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    return mountOnConversation((container) => {
      const onContextMenu = (event) => {
        const target = event.target;
        if (target === null) return;
        const code = inlineCodeOf(target);
        if (code === null) return;
        const text = (code.textContent ?? "").trim();
        if (text === "") return;
        event.preventDefault();
        event.stopPropagation();
        clearHighlight();
        clearMenuMark();
        code.setAttribute(TARGET_ATTR, "");
        targetRef.current = code;
        setState({ open: true, x: event.clientX, y: event.clientY, text });
      };
      container.addEventListener("contextmenu", onContextMenu, true);
      return () => {
        container.removeEventListener("contextmenu", onContextMenu, true);
        clearHighlight();
        clearMenuMark();
      };
    });
  }, []);
  (0, import_react.useEffect)(() => {
    if (!state.open) {
      clearMenuMark();
      return void 0;
    }
    const lists = Array.from(document.querySelectorAll('[role="menu"]'));
    const list = lists[lists.length - 1];
    list?.setAttribute(MENU_ATTR, MENU_ICON_MARK);
    return () => {
      clearMenuMark();
    };
  }, [state.open]);
  if (!state.open) return null;
  const closeMenu = () => {
    if (copiedTimer.current !== null) {
      clearTimeout(copiedTimer.current);
      copiedTimer.current = null;
    }
    clearHighlight();
    clearMenuMark();
    setCopied(false);
    setState(CLOSED);
  };
  const copy = () => {
    void (0, import_dsh_client_ui_primitives.writeClipboard)(state.text);
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      copiedTimer.current = null;
      closeMenu();
    }, COPIED_FEEDBACK_MS);
  };
  const items = [
    {
      id: "copy-inline-code",
      label: copied ? (
        // 「已复制」瞬时态：对勾 + 文字（自有 locale），随后关闭
        (0, import_react.createElement)(
          "span",
          { className: `${ICON_ITEM_CLASS} dshOneMenu_copied`, "aria-label": tr("copied"), [ICON_ITEM_ATTR]: "" },
          (0, import_react.createElement)(import_dsh_client_ui_primitives.IconCheckOutline16, { size: 14 }),
          (0, import_react.createElement)("span", { className: "dshOneMenu_copiedText" }, tr("copied"))
        )
      ) : (
        // 常态：只有一个官方复制图标，悬浮由官方 Tooltip 给「复制」提示
        (0, import_react.createElement)(
          import_dsh_client_ui_primitives.Tooltip,
          { label: tr("copyInlineCode"), side: "top", delayMs: 300 },
          (0, import_react.createElement)(
            "span",
            { className: ICON_ITEM_CLASS, "aria-label": tr("copyInlineCode"), [ICON_ITEM_ATTR]: "" },
            (0, import_react.createElement)(import_dsh_client_ui_primitives.IconCopyOutline16, { size: 14 })
          )
        )
      )
    }
  ];
  return (0, import_react.createElement)(import_dsh_client_ui_primitives.Menu, {
    open: true,
    items,
    // 右键坐标当作零尺寸锚点：官方 Menu 的定位算法据此把菜单挂到指针下方 4px
    // （越界时官方自己夹进视口）。
    getAnchorRect: () => new DOMRect(state.x, state.y, 0, 0),
    portal: true,
    // 官方紧凑档（26px 项 / 12px 字号 / 14px 图标位）——官方支持但未使用的变体，
    // 取它与 14 档图标搭配（见文件头说明）。
    compact: true,
    onClose: closeMenu,
    onSelect: (id) => {
      if (id === "copy-inline-code") copy();
    }
  });
}
var inject = ["slots", "locale"];
function apply(ctx) {
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register("dshOneMenu", {
      zh: { copyInlineCode: "\u590D\u5236\u8FD9\u6BB5", copied: "\u5DF2\u590D\u5236" },
      en: { copyInlineCode: "Copy inline code", copied: "Copied" }
    });
    const disposeInject = ctx.slots.inject(
      "shell.overlay",
      () => ctx.slots.register(
        {
          name: "shell.overlay",
          id: "dsh-one-context-menu",
          locale: "dshOneMenu",
          inject: () => ({})
        },
        ContextMenuLayer
      )
    );
    return () => {
      disposeInject();
      disposeLocale();
    };
  }, "dsh-one context menu: inline-code copy");
}

		return module.exports;
	}
});

