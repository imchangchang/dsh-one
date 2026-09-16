window.__ModuleLoader__.load({
	id: "@dsh-one/dsh-composer-clear",
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

// packages/dsh-composer-clear/src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/ui/assembly/shell/composerClearPlugin.ts
var import_react = require("react");

// src/pure/composerClearState.ts
function decideKeyAction(state) {
  if (state.composing) return "pass";
  if (state.blocked) return "pass";
  if (state.key === "ctrl-c" && state.hasSelection) return "pass";
  if (!state.hasContent) return "pass";
  return state.armed ? "clear" : "arm";
}
function clearHintKind(state) {
  if (state.undoOpen) return "undo";
  if (state.armed) return state.armedKey === "escape" ? "arm-escape" : "arm-ctrl-c";
  return null;
}

// src/ui/assembly/shell/mountPoints.ts
var CONVERSATION_SCROLL_SELECTOR = "[data-conversation-scroll]";
var COMPOSER_SEAT_SELECTOR = '[data-slot="conversation.composer.bar"]';
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

// src/ui/assembly/shell/composerClearPlugin.ts
var UNDO_WINDOW_MS = 8e3;
var ARM_WINDOW_MS = 4e3;
var CSS = [
  ".dshOneClear_hint{display:flex;align-items:center;gap:6px;margin:0 0 6px;padding:2px 8px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;width:max-content}",
  ".dshOneClear_undo{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;padding:0 2px;text-decoration:underline}"
].join("");
var CSS_TAG_ID = "@dsh-one/dsh-composer-clear/Hint.css";
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dsh-one/dsh-composer-clear";
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
var NO_ATTACHMENTS = [];
function attachmentIdsOf(state) {
  return state.attachmentIds ?? state.imageIds ?? NO_ATTACHMENTS;
}
function removeAttachments(actions, ids) {
  for (const id of ids) {
    if (typeof actions.removeAttachment === "function") actions.removeAttachment(id);
    else actions.removeImage?.(id);
  }
}
function restoreAttachments(actions, ids) {
  if (ids.length === 0) return;
  if (typeof actions.addAttachments === "function") actions.addAttachments(ids);
  else actions.addImages?.(ids);
}
var COMPOSER_SEAT = COMPOSER_SEAT_SELECTOR;
function overlayOpen() {
  for (const el of Array.from(document.querySelectorAll('[role="listbox"], [role="option"], [role="menu"], [role="dialog"], [aria-modal="true"]'))) {
    if (el.getClientRects().length > 0) return true;
  }
  return false;
}
function hasSelection() {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed) return false;
  return (selection.toString() ?? "") !== "";
}
function ComposerClear({ useInput, inputActions, sessionId, t, sessionFaceOf }) {
  const tr = t;
  const draft = useInput((s) => s.draft);
  const attachmentIds = useInput((s) => attachmentIdsOf(s));
  const occurrences = useInput((s) => s.occurrences);
  const [armedKey, setArmedKey] = (0, import_react.useState)(null);
  const [snapshot, setSnapshot] = (0, import_react.useState)(null);
  const armTimer = (0, import_react.useRef)(null);
  const undoTimer = (0, import_react.useRef)(null);
  const live = (0, import_react.useRef)({ draft, attachmentIds, occurrences });
  live.current = { draft, attachmentIds, occurrences };
  const snapshotRef = (0, import_react.useRef)(null);
  const armedRef = (0, import_react.useRef)(null);
  armedRef.current = armedKey;
  const closeUndoWindow = () => {
    if (undoTimer.current !== null) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    snapshotRef.current = null;
    setSnapshot(null);
  };
  const clearArmTimer = () => {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
  };
  const clearNow = () => {
    const current = live.current;
    const taken = { draft: current.draft, occurrences: current.occurrences, attachmentIds: current.attachmentIds };
    snapshotRef.current = taken;
    setSnapshot(taken);
    inputActions.setDraft("");
    removeAttachments(inputActions, current.attachmentIds);
    setArmedKey(null);
    clearArmTimer();
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(closeUndoWindow, UNDO_WINDOW_MS);
  };
  const undoClear = () => {
    const taken = snapshotRef.current;
    if (taken === null) return;
    inputActions.setDraft(taken.draft);
    const face = sessionFaceOf(sessionId);
    if (face !== void 0 && taken.occurrences.length > 0) {
      try {
        for (let i = taken.occurrences.length - 1; i >= 0; i -= 1) {
          const occ = taken.occurrences[i];
          face.insertReference(
            {
              source: occ.source,
              ref: occ.ref,
              label: occ.label,
              ...occ.appearance === void 0 ? {} : { appearance: occ.appearance },
              clipboardText: occ.clipboardText
            },
            { start: occ.offset, end: occ.offset + occ.length, draftRev: face.draftRev() }
          );
        }
      } catch (err) {
        console.warn(`[dsh-one] composer clear: reference restore skipped: ${String(err)}`);
      }
    }
    restoreAttachments(inputActions, taken.attachmentIds);
    closeUndoWindow();
  };
  (0, import_react.useEffect)(() => {
    if (snapshotRef.current !== null && (draft !== "" || attachmentIds.length > 0)) closeUndoWindow();
  }, [draft, attachmentIds]);
  (0, import_react.useEffect)(() => {
    return mountOnConversation((container) => {
      const onKeyDown = (event) => {
        const target = event.target;
        if (target === null || target.closest(COMPOSER_SEAT) === null) return;
        const isEscape = event.key === "Escape";
        const isCtrlC = event.key.toLowerCase() === "c" && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        if (!isEscape && !isCtrlC) return;
        const undoOpen = snapshotRef.current !== null;
        if (undoOpen && isEscape) return;
        const action = decideKeyAction({
          key: isCtrlC ? "ctrl-c" : "escape",
          hasContent: live.current.draft !== "" || live.current.attachmentIds.length > 0,
          armed: armedRef.current !== null,
          hasSelection: hasSelection(),
          blocked: overlayOpen(),
          composing: event.isComposing
        });
        if (action === "pass") return;
        event.preventDefault();
        if (action === "clear") {
          clearNow();
          return;
        }
        setArmedKey(isCtrlC ? "ctrl-c" : "escape");
        clearArmTimer();
        armTimer.current = setTimeout(() => {
          armTimer.current = null;
          setArmedKey(null);
        }, ARM_WINDOW_MS);
      };
      const onUndoKey = (event) => {
        const key = event.key.toLowerCase();
        if (key !== "z" || !(event.metaKey || event.ctrlKey) || event.shiftKey) return;
        if (snapshotRef.current === null) return;
        const target = event.target;
        if (target === null || target.closest(COMPOSER_SEAT) === null) return;
        event.preventDefault();
        undoClear();
      };
      container.addEventListener("keydown", onKeyDown, true);
      container.addEventListener("keydown", onUndoKey, true);
      return () => {
        container.removeEventListener("keydown", onKeyDown, true);
        container.removeEventListener("keydown", onUndoKey, true);
        clearArmTimer();
        if (undoTimer.current !== null) clearTimeout(undoTimer.current);
      };
    });
  }, [sessionId]);
  const hintKind = clearHintKind({ armed: armedKey !== null, undoOpen: snapshot !== null, armedKey: armedKey ?? "escape" });
  if (hintKind === null) return null;
  const text = hintKind === "undo" ? tr("undoAvailable") : hintKind === "arm-escape" ? tr("armEscape") : tr("armCtrlC");
  return (0, import_react.createElement)(
    "div",
    { className: "dshOneClear_hint", "data-dshone-clear-hint": hintKind },
    (0, import_react.createElement)("span", null, text),
    hintKind === "undo" && (0, import_react.createElement)("button", { type: "button", className: "dshOneClear_undo", onClick: undoClear }, tr("undoAction"))
  );
}
var inject = ["slots", "locale", "sessions"];
function apply(ctx) {
  const sessionFaceOf = (sessionId) => {
    const scoped = ctx.get("sessions").scope(sessionId);
    if (scoped === void 0) return void 0;
    const conversation = scoped.get("conversation");
    if (conversation === void 0) return void 0;
    return {
      insertReference: (ref, span) => conversation.input.for(scoped).insertReference(ref, span),
      draftRev: () => conversation.input.for(scoped).state.getSnapshot().draftRev
    };
  };
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register("dshOneClear", {
      zh: {
        armEscape: "\u518D\u6309\u4E00\u6B21 Esc \u6E05\u7A7A",
        armCtrlC: "\u518D\u6309\u4E00\u6B21 Ctrl+C \u6E05\u7A7A",
        undoAvailable: "\u5DF2\u6E05\u7A7A",
        undoAction: "\u64A4\u9500"
      },
      en: {
        armEscape: "Press Esc again to clear",
        armCtrlC: "Press Ctrl+C again to clear",
        undoAvailable: "Cleared",
        undoAction: "Undo"
      }
    });
    const disposeInject = ctx.slots.inject(
      "conversation.input.overlay",
      () => ctx.slots.register(
        {
          name: "conversation.input.overlay",
          id: "dsh-one-composer-clear",
          locale: "dshOneClear",
          inject: () => ({ sessionFaceOf })
        },
        ComposerClear
      )
    );
    return () => {
      disposeInject();
      disposeLocale();
    };
  }, "dsh-one composer clear: Esc / Ctrl+C clear with undo hint");
}

		return module.exports;
	}
});

