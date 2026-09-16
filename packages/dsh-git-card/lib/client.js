window.__ModuleLoader__.load({
	id: "@dsh-one/dsh-git-card",
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

// packages/dsh-git-card/src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/ui/assembly/shell/gitCardPlugin.ts
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/pure/hostCallError.ts
function isHostCallError(value) {
  return typeof value === "object" && value !== null && typeof value.code === "string" && typeof value.message === "string";
}

// src/pure/hostCapabilities.ts
var HOST_CAPABILITY_SERVICE = "dshOneHostCapabilities";
function capabilityEndpoint(method) {
  return `${HOST_CAPABILITY_SERVICE}/${method}`;
}
function isCapabilityFailure(value) {
  if (typeof value !== "object" || value === null) return false;
  const record = value;
  return record.ok === false && isHostCallError(record.error);
}
var SAVE_CONTENT_MAX_BASE64 = 64 * 1024 * 1024;
var ALLOWED_URL_PROTOCOLS = /* @__PURE__ */ new Set(["http:", "https:", "mailto:"]);
function parseAllowedUrl(value) {
  if (typeof value !== "string" || value === "") return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return ALLOWED_URL_PROTOCOLS.has(parsed.protocol) ? value : null;
}

// src/ui/assembly/shell/hostClient.ts
var sdk = () => globalThis.__DSH_ONE_HOST__;
function hostCallAvailable() {
  return sdk() !== void 0;
}
function hostCall(call, args) {
  const face = sdk();
  if (face === void 0) {
    const error = new Error("the host capability bridge is unavailable in this page");
    error.code = "no-host";
    return Promise.reject(error);
  }
  return face.call(call, args);
}

// src/ui/assembly/shell/hostCapabilities.ts
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function connectionRpc(ctx) {
  const connection = ctx?.get("connection");
  const rpc = connection?.rpc;
  if (rpc === void 0 || typeof rpc.call !== "function") {
    throw fail("unavailable", "this shell provides no official Connection service");
  }
  return rpc;
}
async function capabilityCall(ctx, method, args) {
  const rpc = connectionRpc(ctx);
  const endpoint = capabilityEndpoint(method);
  let result;
  try {
    result = await rpc.call("/api", endpoint, { args });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/HTTP 404/.test(message)) {
      throw fail("unavailable", `the host half does not serve ${endpoint} in this dsh instance`);
    }
    throw fail("failed", `${endpoint} transport failure: ${message}`);
  }
  if (!result.ok) throw fail("failed", `${endpoint} failed: ${result.error.code}: ${result.error.message}`);
  const payload = result.value;
  if (isCapabilityFailure(payload)) throw fail(payload.error.code, payload.error.message);
  if (typeof payload !== "object" || payload === null || payload.ok !== true) {
    throw fail("failed", `${endpoint} returned an unexpected shape`);
  }
  return payload;
}
async function bridgeCall(name, args) {
  try {
    const data = await hostCall(name, args);
    if (typeof data === "object" && data !== null) return data;
    return {};
  } catch (err) {
    const code = err.code;
    const message = err instanceof Error ? err.message : String(err);
    throw fail(code ?? "failed", message);
  }
}
async function browserDownload(path, suggestedName) {
  const response = await fetch(path);
  if (!response.ok) throw fail("failed", `HTTP ${response.status} while fetching ${path}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = suggestedName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 6e4);
  }
  return { path: null };
}
function hostCapabilities(ctx) {
  const viaBridge = () => hostCallAvailable();
  return {
    async stateRead(key) {
      if (viaBridge()) {
        const data = await bridgeCall("state.read", { key });
        return data.value ?? null;
      }
      const payload = await capabilityCall(ctx, "stateRead", { key });
      return payload.value ?? null;
    },
    async stateWrite(key, value) {
      if (viaBridge()) {
        await bridgeCall("state.write", { key, value });
        return;
      }
      await capabilityCall(ctx, "stateWrite", { key, value });
    },
    async stateDelete(key) {
      if (viaBridge()) {
        const data = await bridgeCall("state.delete", { key });
        return data.deleted === true;
      }
      const payload = await capabilityCall(ctx, "stateDelete", { key });
      return payload.deleted === true;
    },
    async gitShow(args) {
      if (viaBridge()) {
        return await bridgeCall("git.show", { hash: args.hash, cwd: args.cwd });
      }
      return await capabilityCall(ctx, "gitShow", { hash: args.hash, cwd: args.cwd });
    },
    async saveContent(args) {
      if (viaBridge()) {
        const data = await bridgeCall("file.save", { suggestedName: args.suggestedName, base64: args.base64 });
        return { path: String(data.path ?? "") };
      }
      const payload = await capabilityCall(ctx, "saveContent", args);
      return { path: String(payload.path ?? "") };
    },
    async downloadGatewayFile(args) {
      if (viaBridge()) {
        const data = await bridgeCall("file.download", { path: args.path, suggestedName: args.suggestedName });
        return { path: String(data.path ?? "") };
      }
      return await browserDownload(args.path, args.suggestedName);
    },
    async openExternal(url) {
      const allowed = parseAllowedUrl(url);
      if (allowed === null) throw fail("invalid-args", "expected a http/https/mailto url");
      if (viaBridge()) {
        await bridgeCall("vscode.openExternal", { url: allowed });
        return;
      }
      if (typeof window === "undefined" || typeof window.open !== "function") {
        throw fail("unavailable", "this shell provides no way to open an external link");
      }
      window.open(allowed, "_blank", "noopener,noreferrer");
    },
    // 读时判定（不是构造时定值）：路由键在调用瞬间定生死，能力有没有也照同一
    // 口径——页面侧 SDK 若在建好能力口之后才装，这里照样能如实上报。
    get editorTabs() {
      return viaBridge();
    },
    async openSessionInNewTab(sessionId) {
      if (viaBridge()) {
        await bridgeCall("session.openInNewTab", { sessionId });
        return;
      }
      throw fail("unavailable", "this shell has no editor tabs; the host half serves no session tab action");
    },
    get settingsPage() {
      return viaBridge();
    },
    async openSettings() {
      if (viaBridge()) {
        await bridgeCall("vscode.openSettings", {});
        return;
      }
      throw fail("unavailable", "this shell has no separate settings page; the official settings row owns settings here");
    },
    get workspaceCreate() {
      return viaBridge();
    },
    async createWorkspaceDirectory() {
      if (viaBridge()) {
        await bridgeCall("vscode.workspaceCreate", {});
        return;
      }
      throw fail("unavailable", "this shell cannot create a workspace directory; the official directory flow owns creation here");
    }
  };
}

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
function positioningContext(element) {
  let current = element.parentElement;
  while (current !== null) {
    const style = getComputedStyle(current);
    if (style.position !== "static" && style.display !== "contents") return current;
    current = current.parentElement;
  }
  return document.documentElement;
}

// src/pure/sessionWorkspace.ts
function pickSessionWorkspacePath(sources) {
  const cwd = sources.sessionCwd;
  if (typeof cwd === "string" && cwd !== "") return cwd;
  const path = sources.workspacePath;
  if (typeof path === "string" && path !== "") return path;
  return void 0;
}

// src/ui/assembly/shell/gitCardPlugin.ts
var HASH_ATTR = "data-dshone-commit";
var COMMIT_SHA_RE = /(?<![0-9a-fA-F])([0-9a-fA-F]{7,40})(?![0-9a-fA-F])/g;
var CSS = [
  `.dshOneGitCard_hash{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px;text-decoration-color:var(--dsw-alias-border-l2)}`,
  `.dshOneGitCard_hash:hover{text-decoration-color:var(--dsw-alias-label-primary)}`,
  // 卡片：overlay 层默认 pointer-events:none（官方 AppFrame 语义），自己的贡献要交互须自行开启。
  `.dshOneGitCard_card{position:absolute;z-index:30;pointer-events:auto;box-sizing:border-box;min-width:280px;max-width:min(420px,calc(100% - 24px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));box-shadow:0 6px 24px rgba(0,0,0,.18);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}`,
  `.dshOneGitCard_row{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}`,
  `.dshOneGitCard_time{margin-left:auto;display:inline-flex;align-items:center;gap:4px}`,
  `.dshOneGitCard_subject{margin-top:6px;font-weight:500}`,
  `.dshOneGitCard_body{margin-top:4px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:180px;overflow:auto}`,
  `.dshOneGitCard_sep{margin:8px 0;height:1px;background:var(--dsw-alias-border-l3)}`,
  `.dshOneGitCard_stat{color:var(--dsw-alias-label-secondary)}`,
  `.dshOneGitCard_add{color:var(--dsw-alias-status-success,#2ea043)}`,
  `.dshOneGitCard_del{color:var(--dsw-alias-status-danger,#d1242f)}`,
  `.dshOneGitCard_repo{display:flex;align-items:center;gap:4px;margin-top:6px;color:var(--dsw-alias-label-secondary)}`,
  `.dshOneGitCard_notPushed{margin-top:6px;color:var(--dsw-alias-label-tertiary)}`,
  `.dshOneGitCard_repoPath{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
  `.dshOneGitCard_footer{display:flex;align-items:center;gap:8px;margin-top:8px}`,
  `.dshOneGitCard_cmd{display:inline-flex;align-items:center;gap:4px;cursor:pointer;border:none;border-radius:6px;padding:2px 6px;background:transparent;color:inherit;font:inherit}`,
  `.dshOneGitCard_cmd:hover{background:var(--dsw-alias-interactive-bg-hover)}`,
  `.dshOneGitCard_meta{color:var(--dsw-alias-label-secondary)}`
].join("");
var CSS_TAG_ID = "@dsh-one/dsh-git-card/Card.css";
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dsh-one/dsh-git-card";
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
function scannableTextNode(node) {
  const parent = node.parentElement;
  if (parent === null) return false;
  if (parent.closest("pre, a, button, textarea, input, [contenteditable], [data-dshone-commit]") !== null) return false;
  const value = node.nodeValue;
  if (value === null || value.length < 7) return false;
  COMMIT_SHA_RE.lastIndex = 0;
  return COMMIT_SHA_RE.test(value);
}
function decorateTextNode(node) {
  const value = node.nodeValue ?? "";
  COMMIT_SHA_RE.lastIndex = 0;
  const matches = [...value.matchAll(COMMIT_SHA_RE)];
  if (matches.length === 0) return false;
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of matches) {
    if (match.index > last) frag.appendChild(document.createTextNode(value.slice(last, match.index)));
    const span = document.createElement("span");
    span.className = "dshOneGitCard_hash";
    span.setAttribute(HASH_ATTR, match[1]);
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    span.textContent = match[1];
    frag.appendChild(span);
    last = match.index + match[1].length;
  }
  if (last < value.length) frag.appendChild(document.createTextNode(value.slice(last)));
  node.parentNode?.replaceChild(frag, node);
  return true;
}
function relativeLabel(info, tr) {
  if (info.commitDate === void 0) return "";
  const then = new Date(info.commitDate).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const MINUTE = 6e4;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  if (diff < MINUTE) return tr("justNow");
  if (diff < HOUR) return tr("minutesAgo", { count: Math.floor(diff / MINUTE) });
  if (diff < DAY) return tr("hoursAgo", { count: Math.floor(diff / HOUR) });
  return tr("daysAgo", { count: Math.floor(diff / DAY) });
}
function GitCardLayer({ t, sessionWorkspacePath, capabilities }) {
  const tr = t;
  const [state, setState] = (0, import_react.useState)({ kind: "idle" });
  const [anchor, setAnchor] = (0, import_react.useState)(null);
  const [position, setPosition] = (0, import_react.useState)(null);
  const [pinned, setPinned] = (0, import_react.useState)(false);
  const [copied, setCopied] = (0, import_react.useState)(false);
  const cache = (0, import_react.useRef)(/* @__PURE__ */ new Map());
  const inflight = (0, import_react.useRef)(/* @__PURE__ */ new Map());
  const cardRef = (0, import_react.useRef)(null);
  const closeTimer = (0, import_react.useRef)(null);
  const currentSha = (0, import_react.useRef)(null);
  const lookup = (sha) => {
    const cwd = sessionWorkspacePath();
    const key = `${cwd ?? ""}\0${sha}`;
    const cached = cache.current.get(key);
    if (cached !== void 0) return Promise.resolve(cached);
    const pending = inflight.current.get(key);
    if (pending !== void 0) return pending;
    const args = cwd === void 0 ? { hash: sha } : { hash: sha, cwd };
    const asked = capabilities.gitShow(args).then(
      (info) => {
        const resolved = info;
        cache.current.set(key, resolved);
        inflight.current.delete(key);
        return resolved;
      },
      (err) => {
        inflight.current.delete(key);
        throw err;
      }
    );
    inflight.current.set(key, asked);
    return asked;
  };
  (0, import_react.useLayoutEffect)(() => {
    const card = cardRef.current;
    if (state.kind === "idle" || anchor === null || card === null) return;
    const space = positioningContext(card).getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left - space.left, 8),
      Math.max(8, space.width - card.offsetWidth - 8)
    );
    const below = rect.bottom - space.top + 6;
    const above = rect.top - space.top - 6;
    const top = below + card.offsetHeight > space.height - 8 ? Math.max(8, above - card.offsetHeight) : below;
    setPosition((prev) => prev !== null && prev.left === left && prev.top === top ? prev : { left, top });
  }, [state, anchor]);
  const show = (span, sha) => {
    currentSha.current = sha;
    setAnchor(span);
    const cached = cache.current.get(sha);
    if (cached !== void 0) {
      setState({ kind: "info", sha, info: cached });
      return;
    }
    setState({ kind: "pending", sha });
    void lookup(sha).then(
      (info) => {
        if (currentSha.current !== sha) return;
        setState({ kind: "info", sha, info });
      },
      (err) => {
        if (currentSha.current !== sha) return;
        const code = err.code ?? "failed";
        setState({ kind: "error", sha, code });
      }
    );
  };
  const close = () => {
    if (closeTimer.current !== null) return;
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      currentSha.current = null;
      setPinned(false);
      setState({ kind: "idle" });
    }, 150);
  };
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  (0, import_react.useEffect)(() => {
    return mountOnConversation((conversation) => {
      let scheduled = false;
      let timer = null;
      const scan = () => {
        const walker = document.createTreeWalker(conversation, NodeFilter.SHOW_TEXT, {
          acceptNode: (node2) => scannableTextNode(node2) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
        });
        const textNodes = [];
        let node = walker.nextNode();
        while (node !== null) {
          textNodes.push(node);
          node = walker.nextNode();
        }
        for (const textNode of textNodes) decorateTextNode(textNode);
        observer.takeRecords();
      };
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        timer = window.setTimeout(() => {
          scheduled = false;
          timer = null;
          scan();
        }, 120);
      };
      const observer = new MutationObserver(schedule);
      observer.observe(conversation, { childList: true, subtree: true, characterData: true });
      scan();
      const onPointerOver = (event) => {
        const target = event.target;
        const span = target?.closest?.(`[${HASH_ATTR}]`);
        if (span === null || span === void 0) return;
        cancelClose();
        const sha = span.getAttribute(HASH_ATTR);
        if (sha !== null && sha !== "") show(span, sha);
      };
      const onPointerOut = (event) => {
        const target = event.target;
        if (target?.closest?.(`[${HASH_ATTR}]`) == null) return;
        if (pinned) return;
        close();
      };
      const onClick = (event) => {
        const target = event.target;
        const span = target?.closest?.(`[${HASH_ATTR}]`);
        if (span === null || span === void 0) return;
        const sha = span.getAttribute(HASH_ATTR);
        if (sha === null || sha === "") return;
        cancelClose();
        if (pinned && currentSha.current === sha) {
          setPinned(false);
          currentSha.current = null;
          setState({ kind: "idle" });
          return;
        }
        setPinned(true);
        show(span, sha);
      };
      const onPointerDownOutside = (event) => {
        const target = event.target;
        if (target === null) return;
        if (cardRef.current?.contains(target) === true) return;
        if (target.closest?.(`[${HASH_ATTR}]`) != null) return;
        cancelClose();
        setPinned(false);
        currentSha.current = null;
        setState({ kind: "idle" });
      };
      conversation.addEventListener("pointerover", onPointerOver, true);
      conversation.addEventListener("pointerout", onPointerOut, true);
      conversation.addEventListener("click", onClick, true);
      document.addEventListener("pointerdown", onPointerDownOutside, true);
      return () => {
        observer.disconnect();
        if (timer !== null) clearTimeout(timer);
        conversation.removeEventListener("pointerover", onPointerOver, true);
        conversation.removeEventListener("pointerout", onPointerOut, true);
        conversation.removeEventListener("click", onClick, true);
        document.removeEventListener("pointerdown", onPointerDownOutside, true);
        if (closeTimer.current !== null) clearTimeout(closeTimer.current);
      };
    });
  }, [pinned]);
  if (state.kind === "idle" || anchor === null) return null;
  const copyHash = (hash) => {
    void (0, import_dsh_client_ui_primitives.writeClipboard)(hash).then((ok) => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      return ok;
    });
  };
  const body = [];
  if (state.kind === "pending") {
    body.push((0, import_react.createElement)("div", { key: "pending", className: "dshOneGitCard_meta" }, tr("checking")));
  } else if (state.kind === "error") {
    body.push((0, import_react.createElement)("div", { key: "error", className: "dshOneGitCard_meta" }, tr(state.code === "git-missing" ? "gitMissing" : "lookupFailed")));
  } else if (state.kind === "info" && !state.info.found) {
    body.push((0, import_react.createElement)("div", { key: "missing", className: "dshOneGitCard_meta" }, tr("notFound")));
  } else if (state.kind === "info") {
    const info = state.info;
    body.push(
      (0, import_react.createElement)(
        "div",
        { key: "author", className: "dshOneGitCard_row" },
        (0, import_react.createElement)(import_dsh_client_ui_primitives.IconUserOutline16, { size: 14 }),
        (0, import_react.createElement)("span", null, info.authorName ?? ""),
        info.commitDate !== void 0 && (0, import_react.createElement)(
          "span",
          { className: "dshOneGitCard_time" },
          (0, import_react.createElement)(import_dsh_client_ui_primitives.IconClockOutline16, { size: 14 }),
          (0, import_react.createElement)("span", null, `${relativeLabel(info, tr)} (${info.commitDate.replace("T", " ")})`)
        )
      )
    );
    if (info.fullMessage !== void 0 && info.fullMessage !== "") {
      const lines = info.fullMessage.split("\n");
      body.push((0, import_react.createElement)("div", { key: "subject", className: "dshOneGitCard_subject" }, lines[0] ?? ""));
      const rest = lines.slice(1).join("\n").trim();
      if (rest !== "") body.push((0, import_react.createElement)("div", { key: "body", className: "dshOneGitCard_body" }, rest));
    } else if (info.message !== void 0) {
      body.push((0, import_react.createElement)("div", { key: "subject", className: "dshOneGitCard_subject" }, info.message));
    }
    if (info.files !== void 0) {
      body.push((0, import_react.createElement)("div", { key: "sep", className: "dshOneGitCard_sep" }));
      body.push(
        (0, import_react.createElement)(
          "div",
          { key: "stat", className: "dshOneGitCard_stat" },
          (0, import_react.createElement)("span", null, tr("filesChanged", { count: info.files })),
          info.insertions !== void 0 && (0, import_react.createElement)("span", { className: "dshOneGitCard_add" }, `, +${String(info.insertions)}`),
          info.deletions !== void 0 && (0, import_react.createElement)("span", { className: "dshOneGitCard_del" }, `, -${String(info.deletions)}`)
        )
      );
    }
    if (info.repoRelative !== void 0) {
      body.push(
        (0, import_react.createElement)(
          "div",
          { key: "repo", className: "dshOneGitCard_repo" },
          (0, import_react.createElement)(import_dsh_client_ui_primitives.IconFolderOpenOutline16, { size: 14 }),
          (0, import_react.createElement)("span", null, tr("repoLabel")),
          (0, import_react.createElement)("span", { className: "dshOneGitCard_repoPath", title: info.repoPath ?? info.repoRelative }, info.repoRelative)
        )
      );
    }
    if (info.pushedToRemote === false) {
      body.push((0, import_react.createElement)("div", { key: "not-pushed", className: "dshOneGitCard_notPushed" }, tr("notPushed")));
    }
    const canOpenOnGithub = info.githubUrl !== void 0 && info.pushedToRemote !== false;
    const shortHash = (info.commitHash ?? info.sha).slice(0, 7);
    body.push(
      (0, import_react.createElement)(
        "div",
        { key: "footer", className: "dshOneGitCard_footer" },
        (0, import_react.createElement)("span", { className: "dshOneGitCard_meta" }, tr("commit") + " " + shortHash),
        (0, import_react.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneGitCard_cmd",
            title: tr("copyHash"),
            "aria-label": tr("copyHash"),
            onClick: () => copyHash(info.commitHash ?? info.sha)
          },
          (0, import_react.createElement)(copied ? import_dsh_client_ui_primitives.IconCheckOutline16 : import_dsh_client_ui_primitives.IconCopyOutline16, { size: 14 })
        ),
        canOpenOnGithub && (0, import_react.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneGitCard_cmd",
            title: tr("openOnGithub"),
            onClick: () => {
              void capabilities.openExternal(info.githubUrl ?? "");
            }
          },
          (0, import_react.createElement)(import_dsh_client_ui_primitives.IconRightUpOutline16, { size: 14 }),
          (0, import_react.createElement)("span", null, tr("openOnGithub"))
        )
      )
    );
  }
  return (0, import_react.createElement)(
    "div",
    {
      ref: cardRef,
      className: "dshOneGitCard_card",
      "data-dshone-git-card": "",
      // 首帧（还没算位置）先放坐标系原点，绘制前由 useLayoutEffect 摆正
      style: {
        left: `${String(position?.left ?? 0)}px`,
        top: `${String(position?.top ?? 0)}px`
      },
      onPointerEnter: cancelClose,
      onPointerLeave: () => {
        if (!pinned) close();
      }
    },
    body
  );
}
var inject = ["slots", "locale", "sessions"];
function apply(ctx) {
  const capabilities = hostCapabilities(ctx);
  const sessionWorkspacePath = () => {
    const list = ctx.get("sessions").list.getSnapshot();
    const current = list.current;
    if (current === void 0) return void 0;
    let workspacePath;
    try {
      const items = ctx.get("workspaces").list.getSnapshot().items;
      workspacePath = items.find((w) => (w.sessionIds ?? []).includes(current))?.path;
    } catch {
    }
    return pickSessionWorkspacePath({ sessionCwd: list.byId[current]?.cwd, workspacePath });
  };
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register("dshOneGitCard", {
      zh: {
        checking: "\u6B63\u5728\u67E5\u8BE2\u63D0\u4EA4\u4FE1\u606F\u2026",
        notFound: "\u672A\u627E\u5230\u8BE5\u63D0\u4EA4",
        lookupFailed: "\u63D0\u4EA4\u4FE1\u606F\u67E5\u8BE2\u5931\u8D25",
        gitMissing: "\u5F53\u524D\u672A\u5B89\u88C5 git",
        commit: "\u63D0\u4EA4",
        repoLabel: "\u4ED3\u5E93",
        notPushed: "\u5C1A\u672A\u63A8\u9001\u5230\u8FDC\u7AEF",
        copyHash: "\u590D\u5236\u5B8C\u6574 hash",
        openOnGithub: "\u5728 GitHub \u6253\u5F00",
        justNow: "\u521A\u521A",
        minutesAgo: "{count} \u5206\u949F\u524D",
        hoursAgo: "{count} \u5C0F\u65F6\u524D",
        daysAgo: "{count} \u5929\u524D",
        filesChanged: "{count} \u4E2A\u6587\u4EF6\u53D8\u66F4"
      },
      en: {
        checking: "Checking commit info\u2026",
        notFound: "Commit not found",
        lookupFailed: "Commit lookup failed",
        gitMissing: "Git is not installed",
        commit: "Commit",
        repoLabel: "Repo",
        notPushed: "Not pushed to the remote yet",
        copyHash: "Copy full hash",
        openOnGithub: "Open on GitHub",
        justNow: "just now",
        minutesAgo: "{count} minutes ago",
        hoursAgo: "{count} hours ago",
        daysAgo: "{count} days ago",
        filesChanged: "{count} files changed"
      }
    });
    const disposeInject = ctx.slots.inject(
      "shell.overlay",
      () => ctx.slots.register(
        {
          name: "shell.overlay",
          id: "dsh-one-git-card",
          locale: "dshOneGitCard",
          inject: () => ({ sessionWorkspacePath, capabilities })
        },
        GitCardLayer
      )
    );
    return () => {
      disposeInject();
      disposeLocale();
    };
  }, "dsh-one git card: commit hash decoration + hover card");
}

		return module.exports;
	}
});

