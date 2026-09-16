window.__ModuleLoader__.load({
	id: "@dsh-one/dsh-session-export",
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

// packages/dsh-session-export/src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/ui/assembly/shell/sessionExportPlugin.ts
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
    },
    // #109：工作区行的两个宿主动作（在编辑器里打开文件夹 / 开集成终端）。与
    // editorTabs 同一形态——两侧语义不同，没有的那一端少的就是入口本身。
    get workspaceOpen() {
      return viaBridge();
    },
    async openWorkspaceFolder(path, options) {
      if (!viaBridge()) {
        throw fail("unavailable", "this shell has no editor window; the official web page opens folders elsewhere");
      }
      await bridgeCall("vscode.openFolder", { path, newWindow: options?.newWindow === true });
    },
    get workspaceTerminal() {
      return viaBridge();
    },
    async openWorkspaceTerminal(path) {
      if (!viaBridge()) {
        throw fail("unavailable", "this shell has no integrated terminal; dsh web owns its own terminal panel");
      }
      await bridgeCall("vscode.openTerminal", { path });
    },
    get shellName() {
      return viaBridge() ? "vscode" : "web";
    }
  };
}

// src/pure/sessionExport.ts
var SESSION_EXPORT_PATH = "/api/session.export";
function sessionExportFileName(sessionId) {
  return `dsh-session-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.zip`;
}
function sessionExportPath(sessionId) {
  return `${SESSION_EXPORT_PATH}?sessionId=${encodeURIComponent(sessionId)}&includeDescendants=true`;
}
function shouldReportExportFailure(code) {
  return code !== "cancelled";
}

// src/ui/assembly/shell/sessionExportPlugin.ts
var REAL_CSS = ".dshOneExport_btn{display:inline-flex;align-items:center;gap:4px}.dshOneExport_error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-left:6px}";
var CSS_TAG_ID = "@dsh-one/dsh-session-export/Export.css";
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dsh-one/dsh-session-export";
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = REAL_CSS;
  document.head.appendChild(tag);
}
function SessionExportAction({ sessionId, t, capabilities }) {
  const tr = t;
  const [error, setError] = (0, import_react.useState)(null);
  const onClick = () => {
    if (typeof sessionId !== "string" || sessionId === "") return;
    setError(null);
    void capabilities.downloadGatewayFile({ path: sessionExportPath(sessionId), suggestedName: sessionExportFileName(sessionId) }).catch((err) => {
      if (!shouldReportExportFailure(err.code)) return;
      setError(err instanceof Error ? err.message : String(err));
    });
  };
  return (0, import_react.createElement)(
    "span",
    { "data-dshone-export": "", className: "dshOneExport_btn" },
    (0, import_react.createElement)(
      import_dsh_client_ui_primitives.Button,
      { variant: "outline", size: "sm", onClick },
      tr("export"),
      (0, import_react.createElement)(import_dsh_client_ui_primitives.IconDownloadOutline16, { size: 12 })
    ),
    error === null ? null : (0, import_react.createElement)("span", { className: "dshOneExport_error", title: error }, tr("failed"))
  );
}
var OFFICIAL_ENTRY_ID = "session-log-download";
var inject = ["slots", "locale"];
function apply(ctx) {
  const capabilities = hostCapabilities(ctx);
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register("dshOneExport", {
      zh: { export: "Session \u65E5\u5FD7", failed: "\u5BFC\u51FA\u5931\u8D25" },
      en: { export: "Session log", failed: "Export failed" }
    });
    const disposeInject = ctx.slots.inject(
      "conversation.session.header.utilities",
      () => ctx.slots.register(
        {
          name: "conversation.session.header.utilities",
          id: OFFICIAL_ENTRY_ID,
          // 优先号 −1 < 官方条目的默认 0 → 同一个 cell 里本件上位、官方那条不渲染
          // （官方条目仍在注册表里，服务与钩子照常存活）。
          priority: -1,
          order: 1,
          locale: "dshOneExport",
          inject: () => ({ capabilities })
        },
        SessionExportAction
      )
    );
    return () => {
      disposeInject();
      disposeLocale();
    };
  }, "dsh-one session export: host capability action");
}

		return module.exports;
	}
});

