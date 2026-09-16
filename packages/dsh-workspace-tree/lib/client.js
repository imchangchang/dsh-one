window.__ModuleLoader__.load({
	id: "@dsh-one/dsh-workspace-tree",
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

// packages/dsh-workspace-tree/src/client.ts
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// src/pure/workspaceGroups.ts
function sanitizeGroups(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const g of raw) {
    if (typeof g !== "object" || g === null) continue;
    const { id, name } = g;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: name.trim() });
  }
  return out;
}
function sanitizeMembership(raw, groupIds) {
  const out = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [wsId, ids] of Object.entries(raw)) {
    if (!Array.isArray(ids)) continue;
    const cleaned = [...new Set(ids.filter((x) => typeof x === "string" && groupIds.has(x)))];
    if (cleaned.length > 0) out[wsId] = cleaned;
  }
  return out;
}
function setWorkspaceGroupIds(membership, workspaceId, groupIds, knownGroupIds) {
  const cleaned = [...new Set(groupIds.filter((id) => knownGroupIds.has(id)))];
  const prev = membership[workspaceId] ?? [];
  if (prev.length === cleaned.length && prev.every((id, i) => id === cleaned[i])) return null;
  const next = { ...membership };
  if (cleaned.length > 0) next[workspaceId] = cleaned;
  else delete next[workspaceId];
  return next;
}
function removeGroupId(membership, groupId) {
  let changed = false;
  const next = {};
  for (const [wsId, ids] of Object.entries(membership)) {
    const cleaned = ids.filter((id) => id !== groupId);
    if (cleaned.length !== ids.length) changed = true;
    if (cleaned.length > 0) next[wsId] = cleaned;
  }
  return changed ? next : membership;
}
function groupNameError(name, groups, excludeId) {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  if (groups.some((g) => g.id !== excludeId && g.name === trimmed)) return "duplicate";
  return null;
}
function addGroup(groups, name, id) {
  if (id === "" || groupNameError(name, groups) !== null) return null;
  return [...groups, { id, name: name.trim() }];
}
function renameGroup(groups, id, name) {
  const current = groups.find((g) => g.id === id);
  if (current === void 0) return null;
  if (groupNameError(name, groups, id) !== null) return null;
  if (current.name === name.trim()) return null;
  return groups.map((g) => g.id === id ? { ...g, name: name.trim() } : g);
}
function deleteGroup(groups, id) {
  if (!groups.some((g) => g.id === id)) return null;
  return groups.filter((g) => g.id !== id);
}

// src/pure/dshStateFile.ts
function parseJsonValue(obj) {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  return obj;
}
function hasField(rec, key) {
  return Object.prototype.hasOwnProperty.call(rec, key);
}
function sanitizeGroupFile(parsed) {
  const rec = parseJsonValue(parsed);
  if (rec === null || rec.version !== 1 || !hasField(rec, "groups") || !hasField(rec, "membership") || !hasField(rec, "activeGroupId")) {
    return null;
  }
  const groups = sanitizeGroups(rec.groups);
  const membership = sanitizeMembership(rec.membership, new Set(groups.map((g) => g.id)));
  const active = typeof rec.activeGroupId === "string" ? rec.activeGroupId : null;
  return {
    version: 1,
    groups,
    membership,
    activeGroupId: active !== null && groups.some((g) => g.id === active) ? active : null
  };
}
function serializeGroupFile(value) {
  return JSON.stringify(value);
}

// src/pure/treeGroups.ts
var TREE_GROUPS_STATE_KEY = "groups";
function emptyTreeGroups() {
  return { version: 1, groups: [], membership: {}, activeGroupId: null };
}
function parseTreeGroups(value) {
  return sanitizeGroupFile(value);
}
function serializeTreeGroups(file) {
  return serializeGroupFile(file);
}
function createTreeGroup(file, name, id) {
  const groups = addGroup(file.groups, name, id);
  if (groups === null) return { ok: false, error: name.trim() === "" ? "empty" : "duplicate" };
  return { ok: true, file: { ...file, groups }, id };
}
function renameTreeGroup(file, id, name) {
  const groups = renameGroup(file.groups, id, name);
  if (groups === null) return null;
  return { ...file, groups };
}
function deleteTreeGroup(file, id) {
  const groups = deleteGroup(file.groups, id);
  if (groups === null) return null;
  return { ...file, groups, membership: removeGroupId(file.membership, id) };
}
function toggleWorkspaceGroup(file, workspaceId, groupId) {
  const known = new Set(file.groups.map((g) => g.id));
  if (!known.has(groupId) || workspaceId === "") return null;
  const current = file.membership[workspaceId] ?? [];
  const next = current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId];
  const membership = setWorkspaceGroupIds(file.membership, workspaceId, next, known);
  if (membership === null) return null;
  return { ...file, membership };
}
function workspaceMatchesGroup(file, workspaceId, activeGroupId) {
  if (activeGroupId === null) return true;
  return (file.membership[workspaceId] ?? []).includes(activeGroupId);
}
function workspaceGroupIds(file, workspaceId) {
  return file.membership[workspaceId] ?? [];
}
function hasTreeGroup(file, groupId) {
  return groupId !== null && file.groups.some((g) => g.id === groupId);
}
function treeGroupDefs(file) {
  return file.groups;
}

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

// src/ui/assembly/shell/workspaceTree/locale.ts
var ZH = {
  "group.ungrouped": "\u672A\u5206\u7EC4",
  "session.new": "\u65B0\u4F1A\u8BDD",
  "section.workspaces": "\u5DE5\u4F5C\u533A",
  "section.sessions": "\u4F1A\u8BDD",
  "viewOptions.label": "\u89C6\u56FE\u9009\u9879",
  "groupBy.label": "\u5206\u7EC4\u65B9\u5F0F",
  "groupBy.workspace": "\u6309\u5DE5\u4F5C\u533A",
  "groupBy.flat": "\u5355\u5217\u8868",
  "orderBy.label": "\u6392\u5E8F\u65B9\u5F0F",
  "orderBy.manual": "\u624B\u52A8\u6392\u5E8F",
  "orderBy.updated": "\u6700\u8FD1\u66F4\u65B0",
  "group.filter.all": "\u5168\u90E8",
  "group.filter.aria": "\u6309\u5206\u7EC4\u8FC7\u6EE4",
  "group.allWorkspaces": "\u5168\u90E8\u5DE5\u4F5C\u533A",
  "group.manage": "\u7BA1\u7406\u5206\u7EC4\u2026",
  "group.manage.title": "\u7BA1\u7406\u5206\u7EC4",
  "group.manage.none": "\u8FD8\u6CA1\u6709\u5206\u7EC4\u3002",
  "group.name.label": "\u5206\u7EC4\u540D\u79F0",
  "group.new": "\u65B0\u5EFA\u5206\u7EC4",
  "group.rename": "\u91CD\u547D\u540D\u5206\u7EC4",
  "group.delete": "\u5220\u9664\u5206\u7EC4",
  "group.delete.desc": "\u5C06\u5220\u9664\u5206\u7EC4\u201C{name}\u201D\u3002\u5DE5\u4F5C\u533A\u4E0E\u4F1A\u8BDD\u90FD\u4E0D\u4F1A\u5220\u9664\uFF0C\u53EA\u662F\u4E0D\u518D\u5F52\u5C5E\u8BE5\u5206\u7EC4\u3002",
  "group.name.empty": "\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002",
  "group.name.duplicate": "\u5DF2\u5B58\u5728\u540C\u540D\u5206\u7EC4\u3002",
  "group.membership": "\u6240\u5C5E\u5206\u7EC4",
  "group.chip.aria": "\u53EA\u770B\u5206\u7EC4\u201C{name}\u201D",
  "activity.running": "{n} \u4E2A\u4F1A\u8BDD\u8FD0\u884C\u4E2D",
  "activity.waiting": "{n} \u4E2A\u4F1A\u8BDD\u7B49\u5F85\u4EA4\u4E92",
  "select.enter": "\u6279\u91CF\u9009\u62E9",
  "select.exit": "\u9000\u51FA\u9009\u62E9",
  "select.row.aria": "\u9009\u4E2D\u4F1A\u8BDD\u201C{name}\u201D",
  "select.count": "\u5DF2\u9009 {n} \u9879",
  "select.none": "\u672A\u9009\u4EFB\u52A9\u4F1A\u8BDD",
  "select.archive": "\u79FB\u5165\u56DE\u6536\u7AD9",
  "select.archivePending": "\u6B63\u5728\u79FB\u5165\u56DE\u6536\u7AD9\u2026",
  "select.archiveFailed": "{n} \u4E2A\u4F1A\u8BDD\u79FB\u5165\u5931\u8D25\u3002",
  "recycle.open": "\u56DE\u6536\u7AD9",
  "recycle.title": "\u56DE\u6536\u7AD9",
  "recycle.close": "\u5173\u95ED\u56DE\u6536\u7AD9",
  "recycle.emptyAll": "\u6E05\u7A7A\u56DE\u6536\u7AD9",
  "recycle.restoreAll": "\u6062\u590D\u5168\u90E8",
  "recycle.empty": "\u56DE\u6536\u7AD9\u662F\u7A7A\u7684\u3002\u5F52\u6863\u7684\u4F1A\u8BDD\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  "recycle.restore": "\u8FD8\u539F",
  "recycle.restoring": "\u6B63\u5728\u8FD8\u539F\u2026",
  "recycle.failed": "\u8FD8\u539F\u5931\u8D25\uFF1A{message}",
  "recycle.restore.aria": "\u8FD8\u539F\u4F1A\u8BDD\u201C{name}\u201D",
  "empty.none": "\u6682\u65E0\u4F1A\u8BDD",
  "empty.noMatches": "\u65E0\u5339\u914D\u7ED3\u679C",
  "search.sessions.aria": "\u641C\u7D22\u4F1A\u8BDD",
  "search.placeholder": "\u641C\u7D22\u4F1A\u8BDD\u2026",
  "search.clear": "\u6E05\u9664\u641C\u7D22",
  "search.results.aria": "\u641C\u7D22\u7ED3\u679C",
  "search.pending": "\u6B63\u5728\u641C\u7D22\u4F1A\u8BDD\u5386\u53F2\u2026",
  "search.unavailable": "\u5185\u5BB9\u641C\u7D22\u6682\u4E0D\u53EF\u7528\uFF0C\u4EC5\u663E\u793A\u540D\u79F0\u5339\u914D\u3002",
  "search.noMatches": "\u65E0\u5339\u914D\u4F1A\u8BDD",
  "search.hasMore": "\u4EC5\u663E\u793A\u524D {n} \u6761\u7ED3\u679C\uFF0C\u8BF7\u7F29\u5C0F\u641C\u7D22\u8303\u56F4\u3002",
  rename: "\u91CD\u547D\u540D",
  "rename.workspace.title": "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A",
  "rename.session.title": "\u91CD\u547D\u540D\u4F1A\u8BDD",
  "field.workspaceName": "\u5DE5\u4F5C\u533A\u540D\u79F0",
  "field.sessionName": "\u4F1A\u8BDD\u540D\u79F0",
  "delete.workspace": "\u5220\u9664\u5DE5\u4F5C\u533A",
  "delete.desc": "\u5C06\u628A\u201C{name}\u201D\u4ECE\u5DE5\u4F5C\u533A\u5217\u8868\u4E2D\u79FB\u9664\u3002\u6587\u4EF6\u5939\u4E0E\u4F1A\u8BDD\u8BB0\u5F55\u4F1A\u4FDD\u7559\uFF0C\u5176\u4F1A\u8BDD\u5C06\u663E\u793A\u5728\u201C\u672A\u5206\u7EC4\u201D\u4E0B\u3002",
  "delete.pending": "\u6B63\u5728\u5220\u9664\u5DE5\u4F5C\u533A\u2026",
  "conflict.named": "\u5DF2\u5B58\u5728\u540D\u4E3A\u201C{name}\u201D\u7684\u5DE5\u4F5C\u533A\u3002",
  "menu.fork": "\u5206\u53C9\u4F1A\u8BDD",
  "menu.openInNewTab": "\u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00",
  "menu.archiveSession": "\u5F52\u6863\u4F1A\u8BDD",
  "workspace.add": "\u6DFB\u52A0\u5DE5\u4F5C\u533A",
  "workspace.pickFolder": "\u9009\u62E9\u5DF2\u6709\u6587\u4EF6\u5939\u2026",
  "workspace.create": "\u521B\u5EFA\u65B0\u5DE5\u4F5C\u533A\u76EE\u5F55\u2026",
  "toolbar.collapseAll": "\u6298\u53E0\u6240\u6709\u5DE5\u4F5C\u533A",
  "toolbar.expandAll": "\u5C55\u5F00\u6240\u6709\u5DE5\u4F5C\u533A",
  "toolbar.settings": "\u8BBE\u7F6E",
  "actions.workspace.aria": "\u5DE5\u4F5C\u533A\u201C{name}\u201D\u7684\u64CD\u4F5C",
  "actions.session.aria": "\u4F1A\u8BDD\u201C{name}\u201D\u7684\u64CD\u4F5C",
  "actions.newSession.aria": "\u5728\u201C{name}\u201D\u4E2D\u65B0\u5EFA\u4F1A\u8BDD",
  "status.running": "\u8FDB\u884C\u4E2D",
  "status.subagentsRunning.one": "{n} \u4E2A\u5B50\u4EE3\u7406\u8FD0\u884C\u4E2D",
  "status.subagentsRunning.other": "{n} \u4E2A\u5B50\u4EE3\u7406\u8FD0\u884C\u4E2D",
  "status.idle": "\u7A7A\u95F2",
  "status.waitingApproval": "\u7B49\u5F85\u5BA1\u6279",
  "status.planReview": "\u8BA1\u5212\u5F85\u5BA1",
  "status.waitingAnswer": "\u7B49\u5F85\u56DE\u7B54",
  "status.completed": "\u5DF2\u5B8C\u6210",
  "schedule.active": "\u6709\u6D3B\u52A8\u5B9A\u65F6\u4EFB\u52A1",
  "hover.created": "\u521B\u5EFA\u4E8E {time}",
  "hover.copied": "\u5DF2\u590D\u5236",
  "date.ymd": "{y}\u5E74{m}\u6708{d}\u65E5",
  "time.now": "\u521A\u521A",
  "time.minutes": "{n}\u5206\u949F",
  "time.hours": "{n}\u5C0F\u65F6",
  "time.days": "{n}\u5929",
  "time.months": "{n}\u4E2A\u6708",
  "time.years": "{n}\u5E74",
  "time.ago": "{t}\u524D"
};
var EN = {
  "group.ungrouped": "Ungrouped",
  "session.new": "New Session",
  "section.workspaces": "Workspaces",
  "section.sessions": "Sessions",
  "viewOptions.label": "View options",
  "groupBy.label": "Group by",
  "groupBy.workspace": "WorkSpace",
  "groupBy.flat": "In one list",
  "orderBy.label": "Order by",
  "orderBy.manual": "Manual",
  "orderBy.updated": "Last updated",
  "group.filter.all": "All",
  "group.filter.aria": "Filter by group",
  "group.allWorkspaces": "All workspaces",
  "group.manage": "Manage groups\u2026",
  "group.manage.title": "Manage groups",
  "group.manage.none": "No groups yet.",
  "group.name.label": "Group name",
  "group.new": "New group",
  "group.rename": "Rename group",
  "group.delete": "Delete group",
  "group.delete.desc": "This deletes the group \u201C{name}\u201D. Workspaces and sessions are kept; they just leave this group.",
  "group.name.empty": "The name must not be empty.",
  "group.name.duplicate": "A group with that name already exists.",
  "group.membership": "Groups",
  "group.chip.aria": "Show only the group \u201C{name}\u201D",
  "activity.running": "{n} running",
  "activity.waiting": "{n} waiting for you",
  "select.enter": "Select sessions",
  "select.exit": "Exit selection",
  "select.row.aria": "Select session \u201C{name}\u201D",
  "select.count": "{n} selected",
  "select.none": "No sessions selected",
  "select.archive": "Move to recycle bin",
  "select.archivePending": "Moving to the recycle bin\u2026",
  "select.archiveFailed": "{n} sessions could not be moved.",
  "recycle.open": "Recycle bin",
  "recycle.title": "Recycle bin",
  "recycle.close": "Close the recycle bin",
  "recycle.emptyAll": "Empty the recycle bin",
  "recycle.restoreAll": "Restore all",
  "recycle.empty": "The recycle bin is empty. Archived sessions show up here.",
  "recycle.restore": "Restore",
  "recycle.restoring": "Restoring\u2026",
  "recycle.failed": "Restore failed: {message}",
  "recycle.restore.aria": "Restore session \u201C{name}\u201D",
  "empty.none": "No sessions yet",
  "empty.noMatches": "No matches",
  "search.sessions.aria": "Search sessions",
  "search.placeholder": "Search sessions...",
  "search.clear": "Clear search",
  "search.results.aria": "Search results",
  "search.pending": "Searching session history\u2026",
  "search.unavailable": "Content search is temporarily unavailable. Showing name matches.",
  "search.noMatches": "No matching sessions",
  "search.hasMore": "Showing the first {n} results. Narrow your search.",
  rename: "Rename",
  "rename.workspace.title": "Rename workspace",
  "rename.session.title": "Rename session",
  "field.workspaceName": "Workspace name",
  "field.sessionName": "Session name",
  "delete.workspace": "Delete workspace",
  "delete.desc": "This removes \u201C{name}\u201D from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
  "delete.pending": "Deleting workspace\u2026",
  "conflict.named": "A workspace named \u201C{name}\u201D already exists.",
  "menu.fork": "Fork session",
  "menu.openInNewTab": "Open in New Tab",
  "menu.archiveSession": "Archive session",
  "workspace.add": "Add workspace",
  "workspace.pickFolder": "Choose an existing folder\u2026",
  "workspace.create": "Create a new workspace folder\u2026",
  "toolbar.collapseAll": "Collapse all workspaces",
  "toolbar.expandAll": "Expand all workspaces",
  "toolbar.settings": "Settings",
  "actions.workspace.aria": "Workspace actions for {name}",
  "actions.session.aria": "Session actions for {name}",
  "actions.newSession.aria": "New session in {name}",
  "status.running": "Running",
  "status.subagentsRunning.one": "{n} subagent running",
  "status.subagentsRunning.other": "{n} subagents running",
  "status.idle": "Idle",
  "status.waitingApproval": "Waiting for approval",
  "status.planReview": "Plan awaiting review",
  "status.waitingAnswer": "Waiting for answer",
  "status.completed": "Completed",
  "schedule.active": "Has active scheduled task",
  "hover.created": "Created {time}",
  "hover.copied": "Copied",
  "date.ymd": "{y}-{m}-{d}",
  "time.now": "now",
  "time.minutes": "{n}min",
  "time.hours": "{n}h",
  "time.days": "{n}d",
  "time.months": "{n}mo",
  "time.years": "{n}y",
  "time.ago": "{t} ago"
};
var LOCALE_NS = "dshOneTree";

// src/ui/assembly/shell/workspaceTree/recycleEntry.ts
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// src/pure/workspaceTreeView.ts
var UNGROUPED_KEY = "";
function indexSubagentDescendants(byId) {
  const indexed = /* @__PURE__ */ new Map();
  for (const descendant of Object.values(byId)) {
    if (descendant.origin !== "subagent") continue;
    const seen = /* @__PURE__ */ new Set();
    let current = descendant;
    while (current?.origin === "subagent" && current.parentId !== void 0 && !seen.has(current.id)) {
      seen.add(current.id);
      const aggregate = indexed.get(current.parentId);
      if (aggregate === void 0) {
        indexed.set(current.parentId, { count: 1, runningCount: descendant.running ? 1 : 0 });
      } else {
        aggregate.count += 1;
        if (descendant.running) aggregate.runningCount += 1;
      }
      current = byId[current.parentId];
    }
  }
  return indexed;
}
function owningGroupKey(workspaces, sessionId) {
  return workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId ?? UNGROUPED_KEY;
}
function sessionVisible(session, current, archived) {
  return session.origin !== "subagent" && !archived.has(session.id) && (!session.blank || session.id === current);
}
function sessionTitle(session) {
  if (session.blank) return "";
  return session.displayTitle ?? session.title ?? session.id;
}
function visiblePendingKind(kind) {
  return kind === "approval" || kind === "plan-review" || kind === "question" ? kind : void 0;
}
function hasActiveSchedule(session) {
  return (session.projectionValues?.schedule?.length ?? 0) > 0;
}
function sessionNode(session, descendants, pending) {
  const pendingInteraction = visiblePendingKind(pending.get(session.id)?.kind);
  return {
    id: session.id,
    title: sessionTitle(session),
    blank: session.blank,
    running: session.running,
    runningSubagentCount: descendants.get(session.id)?.runningCount ?? 0,
    completed: session.completed === true,
    hasActiveSchedule: hasActiveSchedule(session),
    updatedAt: session.updatedAt,
    ...pendingInteraction === void 0 ? {} : { pendingInteraction }
  };
}
function orderByRecency(ids, byId) {
  return ids.flatMap((id) => {
    const summary = byId[id];
    return summary === void 0 ? [] : [{ id, updatedAt: summary.updatedAt }];
  }).sort((a, b) => a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.id < b.id ? -1 : 1).map((member) => member.id);
}
function deriveGroups(list, workspaces, archivedSessionIds, pending, view) {
  const archived = new Set(archivedSessionIds);
  const expanded = new Set(view.expandedGroups);
  const descendants = indexSubagentDescendants(list.byId);
  const currentGroup = list.current === void 0 ? void 0 : owningGroupKey(workspaces, list.current);
  const groups = [];
  const accounted = /* @__PURE__ */ new Set();
  for (const workspace of workspaces) {
    const members = [];
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === void 0) continue;
      accounted.add(id);
      if (!sessionVisible(summary, list.current, archived)) continue;
      members.push(summary);
    }
    if (view.workspaceFilter !== void 0 && !view.workspaceFilter(workspace.workspaceId)) continue;
    const createdAt = Date.parse(workspace.createdAt);
    groups.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      cwd: workspace.path,
      createdAt: Number.isNaN(createdAt) ? void 0 : createdAt,
      label: workspace.title,
      sessionCount: members.length,
      containsCurrent: workspace.workspaceId === currentGroup,
      sessions: expanded.has(workspace.workspaceId) ? members.map((m) => sessionNode(m, descendants, pending)) : []
    });
  }
  const stray = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && !accounted.has(s.id) && sessionVisible(s, list.current, archived));
  if (stray.length > 0 && view.workspaceFilter === void 0) {
    const strayIds = new Set(stray.map((s) => s.id));
    const ordered = orderByRecency(
      stray.map((s) => s.id),
      list.byId
    ).filter((id) => strayIds.has(id));
    groups.push({
      key: UNGROUPED_KEY,
      label: "",
      sessionCount: ordered.length,
      containsCurrent: currentGroup === UNGROUPED_KEY && list.current !== void 0,
      sessions: expanded.has(UNGROUPED_KEY) ? ordered.flatMap((id) => {
        const summary = list.byId[id];
        return summary === void 0 ? [] : [sessionNode(summary, descendants, pending)];
      }) : []
    });
  }
  return groups;
}
function deriveFlat(list, archivedSessionIds, pending) {
  const archived = new Set(archivedSessionIds);
  const descendants = indexSubagentDescendants(list.byId);
  const visible = list.ids.map((id) => list.byId[id]).filter((s) => s !== void 0 && sessionVisible(s, list.current, archived));
  return orderByRecency(
    visible.map((s) => s.id),
    list.byId
  ).flatMap((id) => {
    const summary = list.byId[id];
    return summary === void 0 ? [] : [sessionNode(summary, descendants, pending)];
  });
}
function sessionStatuses(node) {
  const subagents = node.runningSubagentCount === 0 ? void 0 : {
    state: "ongoing",
    labelCount: node.runningSubagentCount,
    labelKey: node.runningSubagentCount === 1 ? "status.subagentsRunning.one" : "status.subagentsRunning.other"
  };
  let pending;
  switch (node.pendingInteraction) {
    case "approval":
      pending = { state: "warning", labelKey: "status.waitingApproval" };
      break;
    case "plan-review":
      pending = { state: "warning", labelKey: "status.planReview" };
      break;
    case "question":
      pending = { state: "warning", labelKey: "status.waitingAnswer" };
      break;
    default:
      break;
  }
  if (pending !== void 0) return subagents === void 0 ? [pending] : [pending, subagents];
  if (node.running) {
    const primary = { state: "ongoing", labelKey: "status.running" };
    return subagents === void 0 ? [primary] : [primary, subagents];
  }
  if (subagents !== void 0) return [subagents];
  if (node.completed) return [{ state: "done", labelKey: "status.completed" }];
  return [{ state: "done", labelKey: "status.idle" }];
}
function showsStatusDot(statuses, completed) {
  return statuses[0]?.state !== "done" || completed;
}
function workspaceActivityCounts(list, workspaces, archivedSessionIds, pending) {
  const archived = new Set(archivedSessionIds);
  const counts = /* @__PURE__ */ new Map();
  const bump = (key, running, waiting) => {
    if (!running && !waiting) return;
    const current = counts.get(key) ?? { running: 0, waiting: 0 };
    if (waiting) current.waiting += 1;
    else current.running += 1;
    counts.set(key, current);
  };
  const accounted = /* @__PURE__ */ new Set();
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === void 0) continue;
      accounted.add(id);
      if (!sessionVisible(summary, list.current, archived)) continue;
      const waiting = visiblePendingKind(pending.get(id)?.kind) !== void 0;
      bump(workspace.workspaceId, summary.running, waiting);
    }
  }
  for (const id of list.ids) {
    const summary = list.byId[id];
    if (summary === void 0 || accounted.has(id)) continue;
    if (!sessionVisible(summary, list.current, archived)) continue;
    const waiting = visiblePendingKind(pending.get(id)?.kind) !== void 0;
    bump(UNGROUPED_KEY, summary.running, waiting);
  }
  return counts;
}
function deriveRecycleGroups(list, workspaces, archivedSessionIds) {
  const archived = new Set(archivedSessionIds);
  const descendants = indexSubagentDescendants(list.byId);
  const seen = /* @__PURE__ */ new Set();
  const byKey = /* @__PURE__ */ new Map();
  const push = (key, summary) => {
    if (seen.has(summary.id)) return;
    seen.add(summary.id);
    const bucket = byKey.get(key);
    if (bucket === void 0) byKey.set(key, [summary]);
    else bucket.push(summary);
  };
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === void 0 || !archived.has(id)) continue;
      if (summary.origin === "subagent") continue;
      push(workspace.workspaceId, summary);
    }
  }
  for (const id of list.ids) {
    const summary = list.byId[id];
    if (summary === void 0 || !archived.has(id) || seen.has(id)) continue;
    if (summary.origin === "subagent") continue;
    push(UNGROUPED_KEY, summary);
  }
  const groups = [];
  for (const workspace of workspaces) {
    const members = byKey.get(workspace.workspaceId);
    if (members === void 0 || members.length === 0) continue;
    groups.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      label: workspace.title,
      sessions: orderByRecency(members.map((m) => m.id), list.byId).flatMap((id) => {
        const summary = list.byId[id];
        return summary === void 0 ? [] : [sessionNode(summary, descendants, EMPTY_PENDING)];
      })
    });
  }
  const stray = byKey.get(UNGROUPED_KEY);
  if (stray !== void 0 && stray.length > 0) {
    groups.push({
      key: UNGROUPED_KEY,
      label: "",
      sessions: orderByRecency(stray.map((s) => s.id), list.byId).flatMap((id) => {
        const summary = list.byId[id];
        return summary === void 0 ? [] : [sessionNode(summary, descendants, EMPTY_PENDING)];
      })
    });
  }
  return groups;
}
function recycleCount(groups) {
  return groups.reduce((total, group) => total + group.sessions.length, 0);
}
var EMPTY_PENDING = /* @__PURE__ */ new Map();

// src/ui/assembly/shell/workspaceTree/recycleEntry.ts
var listeners = /* @__PURE__ */ new Set();
var recycleEntrySignal = {
  /** 入口行点了主区：请求开抽屉。 */
  requestOpen() {
    for (const listener of [...listeners]) listener();
  },
  /** 树主组件挂载时订阅（返回退订）。 */
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }
};
function RecycleEntry({ wide = true, t, useSessions, useWorkspaces }) {
  const tr = t;
  const list = useSessions((state) => state);
  const workspaces = useWorkspaces((state) => state.items);
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
  const total = recycleCount(deriveRecycleGroups(list, workspaces, archivedSessionIds));
  const action = (kind) => {
    const label = kind === "empty" ? tr("recycle.emptyAll") : tr("recycle.restoreAll");
    return (0, import_react.createElement)(import_dsh_client_ui_primitives.Tooltip, {
      label,
      side: "top",
      delayMs: 500,
      children: (0, import_react.createElement)(
        "button",
        {
          type: "button",
          className: `dshOneTree_footerIconButton${kind === "empty" ? " dshOneTree_footerIconDanger" : ""}`,
          "aria-label": label,
          "data-dshone-tree-action": kind === "empty" ? "recycle-empty-all" : "recycle-restore-all",
          // 形态占位：动作语义属 #98 的 H1（回收站两层语义），本条只立入口行。
          disabled: true
        },
        kind === "empty" ? (0, import_react.createElement)(import_dsh_client_ui_primitives.IconTrashOutline16, { size: 14 }) : (0, import_react.createElement)(import_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 })
      )
    });
  };
  return (0, import_react.createElement)(
    "div",
    {
      className: `dshOneTree_footerRow${total === 0 ? " dshOneTree_footerRowEmpty" : ""}`,
      "data-dshone-tree": "recycle-entry",
      "data-dshone-tree-recycle-count": total,
      "data-rail": wide ? void 0 : ""
    },
    (0, import_react.createElement)(
      "button",
      {
        type: "button",
        className: "dshOneTree_footerMain",
        "aria-label": `${tr("recycle.open")} (${String(total)})`,
        "data-dshone-tree-action": "recycle-open",
        "data-dshone-tree-recycle-count": total,
        onClick: () => recycleEntrySignal.requestOpen()
      },
      (0, import_react.createElement)("span", { className: "dshOneTree_footerIcon" }, (0, import_react.createElement)(import_dsh_client_ui_primitives.IconArchiveOutline20, { size: 16 })),
      (0, import_react.createElement)("span", { className: "dshOneTree_footerLabel" }, tr("recycle.open")),
      (0, import_react.createElement)("span", { className: "dshOneTree_footerCount" }, String(total))
    ),
    action("empty"),
    action("restore")
  );
}

// src/ui/assembly/shell/workspaceTree/tree.ts
var import_react9 = require("react");

// src/pure/workspaceTreePrefs.ts
var TREE_VIEW_PREF_KEY = "dsh.workspaceTree.view";
function defaultTreeViewPrefs() {
  return { groupBy: "workspace", orderBy: "manual", activeGroupId: null, expandedGroups: [] };
}
function parseTreeViewPrefs(raw) {
  const defaults = defaultTreeViewPrefs();
  if (typeof raw !== "object" || raw === null) return defaults;
  const record = raw;
  const expanded = Array.isArray(record.expandedGroups) ? [...new Set(record.expandedGroups.filter((key) => typeof key === "string"))] : [];
  return {
    groupBy: record.groupBy === "flat" ? "flat" : "workspace",
    orderBy: record.orderBy === "updated" ? "updated" : "manual",
    activeGroupId: typeof record.activeGroupId === "string" && record.activeGroupId !== "" ? record.activeGroupId : null,
    expandedGroups: expanded
  };
}
function readTreeViewPrefs(storage) {
  if (storage === void 0) return defaultTreeViewPrefs();
  let text;
  try {
    text = storage.getItem(TREE_VIEW_PREF_KEY);
  } catch {
    return defaultTreeViewPrefs();
  }
  if (text === null || text === "") return defaultTreeViewPrefs();
  try {
    return parseTreeViewPrefs(JSON.parse(text));
  } catch {
    return defaultTreeViewPrefs();
  }
}
function writeTreeViewPrefs(storage, prefs) {
  if (storage === void 0) return;
  try {
    storage.setItem(TREE_VIEW_PREF_KEY, JSON.stringify(prefs));
  } catch {
  }
}
function pageStorage() {
  try {
    return typeof localStorage === "undefined" ? void 0 : localStorage;
  } catch {
    return void 0;
  }
}

// src/ui/assembly/shell/workspaceTree/groupFilterBar.ts
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
function menuRow(name, count) {
  return (0, import_react2.createElement)(
    "span",
    { className: "dshOneTree_menuRow" },
    (0, import_react2.createElement)("span", { className: "dshOneTree_menuRowLabel" }, name),
    (0, import_react2.createElement)("span", { className: "dshOneTree_menuRowCount" }, String(count))
  );
}
function GroupFilterBar({
  groups,
  activeGroupId,
  groupCounts,
  totalCount,
  tr,
  onPick,
  onCreate,
  onManage
}) {
  const [open, setOpen] = (0, import_react2.useState)(false);
  const active = activeGroupId === null ? null : groups.find((group) => group.id === activeGroupId) ?? null;
  const count = active === null ? totalCount : groupCounts.get(active.id) ?? 0;
  const label = active === null ? tr("group.allWorkspaces") : active.name;
  return (0, import_react2.createElement)(
    "div",
    {
      className: "dshOneTree_filterBar",
      "data-dshone-tree": "group-filter",
      role: "group",
      "aria-label": tr("group.filter.aria")
    },
    (0, import_react2.createElement)(import_dsh_client_ui_primitives2.Menu, {
      open,
      onClose: () => setOpen(false),
      items: [
        {
          id: "all",
          label: (0, import_react2.createElement)(
            "span",
            { "data-dshone-tree-pill-item": "all" },
            menuRow(tr("group.allWorkspaces"), totalCount)
          )
        },
        ...groups.map((group) => ({
          id: group.id,
          label: (0, import_react2.createElement)(
            "span",
            { "data-dshone-tree-pill-item": group.id },
            menuRow(group.name, groupCounts.get(group.id) ?? 0)
          )
        })),
        { type: "separator", id: "group-menu-separator" },
        {
          id: "new",
          label: (0, import_react2.createElement)("span", { "data-dshone-tree-action": "group-new" }, tr("group.new")),
          icon: (0, import_react2.createElement)(import_dsh_client_ui_primitives2.IconPlusOutline16, {})
        },
        {
          id: "manage",
          label: (0, import_react2.createElement)("span", { "data-dshone-tree-action": "group-manage" }, tr("group.manage")),
          icon: (0, import_react2.createElement)(import_dsh_client_ui_primitives2.IconSettingsOutline16, {})
        }
      ],
      selectedIds: [activeGroupId ?? "all"],
      onSelect: (id) => {
        setOpen(false);
        if (id === "new") onCreate();
        else if (id === "manage") onManage();
        else onPick(id === "all" ? null : id);
      },
      align: "start",
      dense: true,
      portal: true,
      closeOnPointerLeave: true,
      anchor: (0, import_react2.createElement)(
        "button",
        {
          type: "button",
          className: `dshOneTree_pill${active === null ? "" : " dshOneTree_pillActive"}`,
          "aria-label": `${tr("group.filter.aria")} - ${label}`,
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "data-dshone-tree-action": "group-pill",
          "data-dshone-tree-group": active?.id ?? "all",
          "data-dshone-tree-group-count": count,
          onClick: () => setOpen((value) => !value)
        },
        (0, import_react2.createElement)("span", { className: "dshOneTree_pillTag" }, (0, import_react2.createElement)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, { size: 12 })),
        (0, import_react2.createElement)("span", { className: "dshOneTree_pillLabel" }, label),
        (0, import_react2.createElement)("span", { className: "dshOneTree_pillCount" }, String(count)),
        (0, import_react2.createElement)("span", { className: "dshOneTree_pillChevron" }, (0, import_react2.createElement)(import_dsh_client_ui_primitives2.IconChevronDownOutline14, {}))
      )
    })
  );
}

// src/ui/assembly/shell/workspaceTree/groups.ts
var GROUP_MENU_PREFIX = "group:";
function newGroupId() {
  const uuid = typeof crypto === "object" && crypto !== null && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `g-${uuid}`;
}

// src/ui/assembly/shell/workspaceTree/hoverCard.ts
var import_react3 = require("react");
var HOVER_CARD_WIDTH = 244;
var HOVER_CARD_GAP = 8;
function useHoverCardRoom(rootRef) {
  const [room, setRoom] = (0, import_react3.useState)(false);
  (0, import_react3.useEffect)(() => {
    const measure = () => {
      const el2 = rootRef.current;
      if (el2 === null) return;
      const available = document.documentElement.clientWidth - el2.getBoundingClientRect().right;
      setRoom(available >= HOVER_CARD_WIDTH + HOVER_CARD_GAP);
    };
    measure();
    const el = rootRef.current;
    if (el === null) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return room;
}

// src/ui/assembly/shell/workspaceTree/modals.ts
var import_react4 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
function GroupModal({
  dialog,
  groups,
  tr,
  error,
  onSubmit,
  onClose
}) {
  const [draft, setDraft] = (0, import_react4.useState)("");
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const open = dialog !== null;
  const kind = dialog?.kind ?? "create";
  const initialName = dialog === null || dialog.kind === "create" ? "" : dialog.name;
  const lastOpen = (0, import_react4.useRef)(false);
  (0, import_react4.useEffect)(() => {
    if (open && !lastOpen.current) {
      setDraft(initialName);
      setBusy(false);
    }
    lastOpen.current = open;
  }, [open, initialName]);
  const submit = () => {
    if (busy) return;
    setBusy(true);
    onSubmit(draft.trim());
  };
  const nameError = (() => {
    if (kind === "delete") return null;
    const trimmed = draft.trim();
    if (trimmed === "") return tr("group.name.empty");
    if (groups.some((g) => g.id !== (dialog?.kind === "rename" ? dialog.id : "") && g.name === trimmed)) return tr("group.name.duplicate");
    return null;
  })();
  if (kind === "delete") {
    return (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Modal, {
      open,
      onClose,
      closeLabel: tr("close"),
      title: tr("group.delete"),
      ...dialog === null || dialog.kind === "create" ? {} : { description: tr("group.delete.desc", { name: dialog.name }) },
      footer: (0, import_react4.createElement)(
        "div",
        { style: { display: "flex", gap: "8px" } },
        (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
        (0, import_react4.createElement)(
          import_dsh_client_ui_primitives3.Button,
          {
            variant: "outline",
            disabled: busy,
            className: "dshOneTree_deleteAction",
            onClick: () => {
              setBusy(true);
              onSubmit("");
            }
          },
          tr("group.delete")
        )
      ),
      children: error === null ? null : (0, import_react4.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)
    });
  }
  return (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Modal, {
    open,
    onClose,
    closeLabel: tr("close"),
    title: kind === "create" ? tr("group.new") : tr("group.rename"),
    footer: (0, import_react4.createElement)(
      "div",
      { style: { display: "flex", gap: "8px" } },
      (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
      (0, import_react4.createElement)(
        import_dsh_client_ui_primitives3.Button,
        { variant: "primary", disabled: busy || nameError !== null, onClick: submit },
        kind === "create" ? tr("group.new") : tr("rename")
      )
    ),
    children: [
      (0, import_react4.createElement)("input", {
        className: "dshOneTree_renameInput",
        value: draft,
        "aria-label": kind === "create" ? tr("group.new") : tr("group.rename"),
        autoFocus: true,
        disabled: busy,
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (nameError === null) submit();
        }
      }),
      nameError === null && error === null ? null : (0, import_react4.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, nameError ?? error)
    ]
  });
}
function RenameModal({
  open,
  titleKey,
  fieldKey,
  initial,
  tr,
  onSubmit,
  onClose
}) {
  const [draft, setDraft] = (0, import_react4.useState)(initial);
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const lastOpen = (0, import_react4.useRef)(false);
  (0, import_react4.useEffect)(() => {
    if (open && !lastOpen.current) {
      setDraft(initial);
      setError(null);
      setBusy(false);
    }
    lastOpen.current = open;
  }, [open, initial]);
  const commit = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onSubmit(draft.trim()).then(() => {
      setBusy(false);
      onClose();
    }).catch((reason) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };
  return (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Modal, {
    open,
    onClose,
    closeLabel: tr("close"),
    title: tr(titleKey),
    footer: (0, import_react4.createElement)(
      "div",
      { style: { display: "flex", gap: "8px" } },
      (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
      (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "primary", disabled: busy || draft.trim() === "", onClick: commit }, tr("rename"))
    ),
    children: [
      (0, import_react4.createElement)("input", {
        className: "dshOneTree_renameInput",
        value: draft,
        "aria-label": tr(fieldKey),
        autoFocus: true,
        disabled: busy,
        onChange: (e) => {
          setDraft(e.target.value);
          setError(null);
        },
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }
      }),
      error === null ? null : (0, import_react4.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)
    ]
  });
}
function DeleteWorkspaceModal({
  target,
  tr,
  onSubmit,
  onClose
}) {
  const [busy, setBusy] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)(null);
  const commit = () => {
    if (busy || target === null) return;
    setBusy(true);
    setError(null);
    onSubmit(target.workspaceId).then(() => {
      setBusy(false);
      onClose();
    }).catch((reason) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };
  return (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Modal, {
    open: target !== null,
    onClose,
    closeLabel: tr("close"),
    title: tr("delete.workspace"),
    ...target === null ? {} : { description: tr("delete.desc", { name: target.title }) },
    footer: (0, import_react4.createElement)(
      "div",
      { style: { display: "flex", gap: "8px" } },
      (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
      (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "outline", disabled: busy, onClick: commit, className: "dshOneTree_deleteAction" }, tr("delete.workspace"))
    ),
    children: [
      busy ? (0, import_react4.createElement)("div", { className: "dshOneTree_deleteStatus", role: "status" }, tr("delete.pending")) : null,
      error === null ? null : (0, import_react4.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)
    ]
  });
}
function ManageGroupsModal({
  open,
  groups,
  counts,
  tr,
  onCreate,
  onRename,
  onDelete,
  onClose
}) {
  const [draft, setDraft] = (0, import_react4.useState)("");
  const [error, setError] = (0, import_react4.useState)(null);
  const lastOpen = (0, import_react4.useRef)(false);
  (0, import_react4.useEffect)(() => {
    if (open && !lastOpen.current) {
      setDraft("");
      setError(null);
    }
    lastOpen.current = open;
  }, [open]);
  const submit = () => {
    const failure = onCreate(draft.trim());
    if (failure === null) {
      setDraft("");
      setError(null);
      return;
    }
    setError(failure === "empty" ? tr("group.name.empty") : tr("group.name.duplicate"));
  };
  const rowIcon = (groupId, name, action) => (0, import_react4.createElement)(
    "button",
    {
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": action === "rename" ? tr("group.rename") : tr("group.delete"),
      "data-dshone-tree-action": `group-${action}`,
      "data-dshone-group-target": groupId,
      onClick: () => action === "rename" ? onRename(groupId, name) : onDelete(groupId, name)
    },
    action === "rename" ? (0, import_react4.createElement)(import_dsh_client_ui_primitives3.IconEditOutline16, {}) : (0, import_react4.createElement)(import_dsh_client_ui_primitives3.IconTrashOutline16, {})
  );
  return (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Modal, {
    open,
    onClose,
    closeLabel: tr("close"),
    title: tr("group.manage.title"),
    footer: (0, import_react4.createElement)(
      "div",
      { style: { display: "flex", gap: "8px" } },
      (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "outline", onClick: onClose }, tr("close"))
    ),
    children: [
      (0, import_react4.createElement)(
        "div",
        { className: "dshOneTree_manageList", "data-dshone-tree": "group-manage-list" },
        groups.length === 0 ? (0, import_react4.createElement)("div", { className: "dshOneTree_manageEmpty" }, tr("group.manage.none")) : groups.map(
          (group) => (0, import_react4.createElement)(
            "div",
            { className: "dshOneTree_manageRow", key: group.id, "data-dshone-manage-group": group.id },
            (0, import_react4.createElement)("span", { className: "dshOneTree_manageName" }, group.name),
            (0, import_react4.createElement)("span", { className: "dshOneTree_manageCount" }, String(counts.get(group.id) ?? 0)),
            rowIcon(group.id, group.name, "rename"),
            rowIcon(group.id, group.name, "delete")
          )
        )
      ),
      (0, import_react4.createElement)(
        "div",
        { className: "dshOneTree_manageCreate" },
        (0, import_react4.createElement)("input", {
          className: "dshOneTree_renameInput",
          "data-dshone-tree": "group-manage-input",
          value: draft,
          placeholder: tr("group.name.label"),
          "aria-label": tr("group.name.label"),
          onChange: (event) => {
            setDraft(event.target.value);
            setError(null);
          },
          onKeyDown: (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            submit();
          }
        }),
        (0, import_react4.createElement)(import_dsh_client_ui_primitives3.Button, { variant: "primary", disabled: draft.trim() === "", onClick: submit }, tr("group.new"))
      ),
      error === null ? null : (0, import_react4.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)
    ]
  });
}

// src/ui/assembly/shell/workspaceTree/recycleDrawer.ts
var import_react5 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/ui/assembly/shell/workspaceTree/format.ts
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
function timeLabel(updatedAt, now, tr) {
  const { unit, n } = (0, import_dsh_client_ui_primitives4.relativeTime)(updatedAt, now);
  return unit === "now" ? tr("time.now") : tr(`time.${unit}`, { n });
}
function hoverTimeLabel(updatedAt, now, tr) {
  const { unit, n } = (0, import_dsh_client_ui_primitives4.relativeTime)(updatedAt, now);
  return unit === "now" ? tr("time.now") : tr("time.ago", { t: tr(`time.${unit}`, { n }) });
}
function createdLabel(createdAt, tr) {
  const d = new Date(createdAt);
  const pad2 = (v) => String(v).padStart(2, "0");
  return tr("hover.created", {
    time: `${tr("date.ymd", { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  });
}
function displayTitle(node, tr) {
  return node.blank ? tr("session.new") : node.title;
}

// src/ui/assembly/shell/workspaceTree/recycleDrawer.ts
function RecycleDrawer({
  open,
  groups,
  now,
  tr,
  busyId,
  error,
  onClose,
  onOpen,
  onRestore
}) {
  if (!open) return null;
  const total = recycleCount(groups);
  return (0, import_react5.createElement)(
    "div",
    { className: "dshOneTree_drawer", "data-dshone-tree": "recycle-drawer", role: "region", "aria-label": tr("recycle.title") },
    (0, import_react5.createElement)(
      "div",
      { className: "dshOneTree_drawerHeader" },
      (0, import_react5.createElement)("span", { className: "dshOneTree_drawerTitle" }, tr("recycle.title")),
      (0, import_react5.createElement)(
        "button",
        {
          type: "button",
          className: "dshOneTree_iconButton",
          "aria-label": tr("recycle.close"),
          "data-dshone-tree-action": "recycle-close",
          onClick: onClose
        },
        (0, import_react5.createElement)(import_dsh_client_ui_primitives5.IconCloseFill14, {})
      )
    ),
    total === 0 ? (0, import_react5.createElement)("div", { className: "dshOneTree_drawerStatus" }, tr("recycle.empty")) : (0, import_react5.createElement)(
      "div",
      { className: "dshOneTree_drawerList" },
      groups.map(
        (group) => (0, import_react5.createElement)(
          "div",
          { className: "dshOneTree_drawerGroup", key: group.key, "data-dshone-recycle-group": group.key },
          (0, import_react5.createElement)("div", { className: "dshOneTree_drawerGroupLabel" }, group.workspaceId === void 0 ? tr("group.ungrouped") : group.label),
          group.sessions.map((node) => {
            const title = displayTitle(node, tr);
            return (0, import_react5.createElement)(
              "div",
              {
                className: "dshOneTree_drawerRow",
                key: node.id,
                role: "treeitem",
                "data-dshone-recycle-row": node.id,
                onClick: () => onOpen(node.id)
              },
              (0, import_react5.createElement)(
                "span",
                { className: "dshOneTree_title" },
                title
              ),
              (0, import_react5.createElement)("span", { className: "dshOneTree_time" }, timeLabel(node.updatedAt, now, tr)),
              (0, import_react5.createElement)(
                "button",
                {
                  type: "button",
                  className: "dshOneTree_drawerRestore",
                  disabled: busyId !== null,
                  "aria-label": tr("recycle.restore.aria", { name: title }),
                  "data-dshone-recycle-restore": node.id,
                  onClick: (event) => {
                    event.stopPropagation();
                    onRestore(node.id);
                  }
                },
                (0, import_react5.createElement)(import_dsh_client_ui_primitives5.IconRefreshOutline16, { size: 14 }),
                busyId === node.id ? tr("recycle.restoring") : tr("recycle.restore")
              )
            );
          })
        )
      )
    ),
    error === null ? null : (0, import_react5.createElement)("div", { className: "dshOneTree_selectionError", role: "alert" }, error)
  );
}

// src/ui/assembly/shell/workspaceTree/rows.ts
var import_react7 = require("react");
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/ui/assembly/shell/workspaceTree/selection.ts
var import_react6 = require("react");
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
function SelectMark({ on }) {
  return (0, import_react6.createElement)(
    "span",
    { className: `dshOneTree_checkBox${on ? " dshOneTree_checkOn" : ""}` },
    on ? (0, import_react6.createElement)(import_dsh_client_ui_primitives6.IconCheckOutline16, { size: 12 }) : null
  );
}
function SelectionBar({
  count,
  busy,
  error,
  tr,
  onArchive,
  onExit
}) {
  return (0, import_react6.createElement)(
    "div",
    { className: "dshOneTree_selectionBarWrap", "data-dshone-tree": "selection-bar" },
    (0, import_react6.createElement)(
      "div",
      { className: "dshOneTree_selectionBar" },
      (0, import_react6.createElement)("span", { className: "dshOneTree_selectionCount" }, count === 0 ? tr("select.none") : tr("select.count", { n: count })),
      (0, import_react6.createElement)(
        import_dsh_client_ui_primitives6.Button,
        {
          variant: "outline",
          disabled: busy || count === 0,
          onClick: onArchive,
          className: "dshOneTree_selectionArchive",
          children: busy ? tr("select.archivePending") : tr("select.archive")
        }
      ),
      (0, import_react6.createElement)(
        import_dsh_client_ui_primitives6.Button,
        { variant: "outline", disabled: busy, onClick: onExit, children: tr("select.exit") }
      )
    ),
    error === null ? null : (0, import_react6.createElement)("div", { className: "dshOneTree_selectionError", role: "alert" }, error)
  );
}

// src/ui/assembly/shell/workspaceTree/rows.ts
function SessionStatusDots({ statuses, tr }) {
  const labels = statuses.map(
    (status) => (0, import_react7.createElement)(
      "span",
      { className: "dshOneTree_visuallyHidden", key: status.labelKey },
      status.labelCount === void 0 ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount })
    )
  );
  return (0, import_react7.createElement)("span", { className: "dshOneTree_slot" }, (0, import_react7.createElement)(import_dsh_client_ui_primitives7.StateDot, { state: statuses[0].state, className: "dshOneTree_dot" }), labels);
}
function SessionHoverContent({ node, now, tr }) {
  const statuses = sessionStatuses(node);
  return (0, import_react7.createElement)(
    "div",
    { className: "dshOneTree_hoverContent" },
    (0, import_react7.createElement)("div", { className: "dshOneTree_hoverTitle" }, displayTitle(node, tr)),
    node.blank ? null : (0, import_react7.createElement)("div", { className: "dshOneTree_hoverTime" }, hoverTimeLabel(node.updatedAt, now, tr)),
    statuses.map(
      (status) => (0, import_react7.createElement)(
        "div",
        { className: "dshOneTree_hoverStatus", key: status.labelKey },
        (0, import_react7.createElement)(import_dsh_client_ui_primitives7.StateDot, { state: status.state }),
        (0, import_react7.createElement)("span", null, status.labelCount === void 0 ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount }))
      )
    )
  );
}
function WorkspaceHoverContent({
  label,
  cwd,
  createdAt,
  tr
}) {
  return (0, import_react7.createElement)(
    "div",
    { className: "dshOneTree_hoverContent" },
    (0, import_react7.createElement)("div", { className: "dshOneTree_hoverTitle" }, label),
    cwd === void 0 ? null : (0, import_react7.createElement)("div", { className: "dshOneTree_hoverPath" }, cwd),
    createdAt === void 0 ? null : (0, import_react7.createElement)("div", { className: "dshOneTree_hoverTime" }, createdLabel(createdAt, tr))
  );
}
function ProjectRow({
  group,
  tr,
  expanded,
  hoverCard,
  counts,
  groups,
  memberOf,
  onToggle,
  onCreate,
  onRename,
  onDelete,
  onToggleGroup
}) {
  const [menuOpen, setMenuOpen] = (0, import_react7.useState)(false);
  const label = group.workspaceId === void 0 ? tr("group.ungrouped") : group.label;
  const active = expanded && group.containsCurrent;
  const groupItems = groups.length === 0 || onRename === void 0 ? [] : [
    { type: "separator", id: "group-separator" },
    { type: "label", id: "group-label", text: tr("group.membership") },
    ...groups.map((entry) => ({ id: `${GROUP_MENU_PREFIX}${entry.id}`, label: entry.name }))
  ];
  const menuItems = onRename === void 0 || onDelete === void 0 ? null : [
    { id: "rename", label: tr("rename"), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconEditOutline16, {}) },
    { id: "delete", label: tr("delete.workspace"), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconTrashOutline16, {}), danger: true },
    ...groupItems
  ];
  const anchor = (0, import_react7.createElement)(
    "button",
    {
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": tr("actions.workspace.aria", { name: label }),
      "data-dshone-tree-action": "workspace-menu",
      onClick: (event) => {
        event.stopPropagation();
        setMenuOpen((open) => !open);
      }
    },
    (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconEllipsisOutline16, {})
  );
  const row = (0, import_react7.createElement)(
    "div",
    {
      className: `dshOneTree_projectRow${menuOpen ? " dshOneTree_menuOpen" : ""}`,
      role: "treeitem",
      "aria-expanded": expanded,
      "data-dshone-tree-row": "workspace",
      "data-dshone-tree-key": group.key,
      "data-dshone-tree-count": group.sessionCount,
      onClick: onToggle,
      children: [
        (0, import_react7.createElement)(
          "span",
          {
            key: "folder",
            className: `dshOneTree_slot dshOneTree_folder${active ? " dshOneTree_folderActive" : ""}`,
            children: expanded ? (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconFolderOpen16, {}) : (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconFolderClose16, {})
          }
        ),
        (0, import_react7.createElement)("span", {
          key: "chevron",
          className: "dshOneTree_slot dshOneTree_chevron",
          children: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconTriangleRightFill14, {
            className: `dshOneTree_arrow${expanded ? " dshOneTree_arrowOpen" : ""}`
          })
        }),
        (0, import_react7.createElement)("span", {
          key: "text",
          className: "dshOneTree_projectText",
          children: (0, import_react7.createElement)("span", { className: "dshOneTree_title" }, label)
        }),
        counts === void 0 ? null : (0, import_react7.createElement)(ActivityBadge, { key: "activity", counts, tr }),
        (0, import_react7.createElement)("span", {
          key: "actions",
          className: "dshOneTree_rowActions",
          children: [
            menuItems === null ? null : (0, import_react7.createElement)(import_dsh_client_ui_primitives7.Menu, {
              key: "menu",
              open: menuOpen,
              onClose: () => setMenuOpen(false),
              items: menuItems,
              selectedIds: memberOf.map((id) => `${GROUP_MENU_PREFIX}${id}`),
              onSelect: (id) => {
                if (id.startsWith(GROUP_MENU_PREFIX)) {
                  onToggleGroup(id.slice(GROUP_MENU_PREFIX.length));
                  return;
                }
                setMenuOpen(false);
                if (id === "rename") onRename?.();
                if (id === "delete") onDelete?.();
              },
              portal: true,
              closeOnPointerLeave: true,
              anchor
            }),
            (0, import_react7.createElement)(
              "button",
              {
                key: "new",
                type: "button",
                className: "dshOneTree_rowIconButton",
                "aria-label": tr("actions.newSession.aria", { name: label }),
                onClick: (event) => {
                  event.stopPropagation();
                  onCreate();
                }
              },
              (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconPlusOutline16, {})
            )
          ]
        })
      ]
    }
  );
  if (group.createdAt === void 0 || !hoverCard) return row;
  return (0, import_react7.createElement)(import_dsh_client_ui_primitives7.HoverCard, {
    anchor: row,
    content: (0, import_react7.createElement)(WorkspaceHoverContent, { label: group.label, cwd: group.cwd, createdAt: group.createdAt, tr }),
    disabled: menuOpen,
    copyText: group.cwd,
    copyLabel: tr("copy"),
    copiedLabel: tr("hover.copied")
  });
}
function SessionRow({
  node,
  currentId,
  now,
  flat,
  hoverCard,
  tr,
  selectMode,
  selected,
  onToggleSelect,
  onOpen,
  onRename,
  onFork,
  onArchive,
  onOpenInNewTab
}) {
  const [menuOpen, setMenuOpen] = (0, import_react7.useState)(false);
  const [menuAt, setMenuAt] = (0, import_react7.useState)(null);
  const title = displayTitle(node, tr);
  const isCurrent = node.id === currentId;
  const statuses = sessionStatuses(node);
  const showStatus = showsStatusDot(statuses, node.completed);
  const openInNewTabItem = onOpenInNewTab === void 0 ? [] : [
    {
      id: "openInNewTab",
      // 标记属性（自有契约）：菜单项类名是官方哈希，验证套件与样式都不该认它，
      // 按这个属性取「我们那一项」（与 contextMenuPlugin 的图标项同一做法）。
      label: (0, import_react7.createElement)("span", { "data-dshone-tree-item": "openInNewTab" }, tr("menu.openInNewTab")),
      // 图标取官方 primitives 的 IconRightUpOutline16（向右上离开方框 = 到别处打开），
      // 与官方行菜单项同为 16 档、同为 icon 槽位的次级色。
      icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconRightUpOutline16, {})
    }
  ];
  const menuItems = [
    { id: "rename", label: tr("rename"), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconEditOutline16, {}) },
    { id: "fork", label: tr("menu.fork"), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconBranchOutline16, {}) },
    ...openInNewTabItem,
    { id: "archive", label: tr("menu.archiveSession"), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconArchiveOutline20, { size: 16 }) }
  ];
  const anchor = (0, import_react7.createElement)(
    "button",
    {
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": tr("actions.session.aria", { name: title }),
      "data-dshone-tree-action": "session-menu",
      onClick: (event) => {
        event.stopPropagation();
        setMenuAt(null);
        setMenuOpen((open) => !open);
      }
    },
    (0, import_react7.createElement)(import_dsh_client_ui_primitives7.IconEllipsisOutline16, {})
  );
  const row = (0, import_react7.createElement)(
    "div",
    {
      className: `dshOneTree_sessionRow${(selectMode ? selected : isCurrent) ? " dshOneTree_selected" : ""}${menuOpen ? " dshOneTree_menuOpen" : ""}${flat && !showStatus && !selectMode ? " dshOneTree_flatRowWithoutStatus" : ""}`,
      role: "treeitem",
      "aria-selected": selectMode ? selected : isCurrent,
      "data-dshone-tree-row": "session",
      // 行上的活状态（供验证套件把「工作区行尾的计数」与「行内真实状态」对照）：
      // 等待交互 > 运行中 > 空闲，与状态点的优先级同源。
      "data-dshone-tree-status": node.pendingInteraction !== void 0 ? "waiting" : node.running ? "running" : "idle",
      ...selectMode ? { "data-dshone-tree-checked": selected } : {},
      onClick: selectMode ? onToggleSelect : onOpen,
      // 行右键开出同一份菜单（指针位置锚定）。三条不接管的线：
      // - 多开不可用的宿主（官方 web）：那里没有这一项可给，抢掉原生右键菜单只是添乱；
      // - 空白会话行（`node.blank`）：官方对这类行整个不给行菜单（见下面 actions 的
      //   `node.blank ? null`），接了右键却没有菜单可弹，只会白白吃掉原生菜单；
      // - 选择态：整行只有「勾选」一个动作（同上面 onClick 的处置）。
      onContextMenu: node.blank || onOpenInNewTab === void 0 || selectMode ? void 0 : (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuAt({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      },
      children: [
        selectMode ? (0, import_react7.createElement)("span", { key: "check", className: "dshOneTree_check" }, (0, import_react7.createElement)(SelectMark, { on: selected })) : !flat || showStatus ? showStatus ? (0, import_react7.createElement)(SessionStatusDots, { key: "status", statuses, tr }) : (0, import_react7.createElement)("span", { key: "status", className: "dshOneTree_slot" }) : null,
        (0, import_react7.createElement)("span", { key: "title", className: "dshOneTree_title" }, title),
        node.blank || selectMode ? null : (0, import_react7.createElement)("span", {
          key: "time",
          className: "dshOneTree_time",
          children: timeLabel(node.updatedAt, now, tr)
        }),
        node.blank || selectMode ? null : (0, import_react7.createElement)("span", {
          key: "actions",
          className: "dshOneTree_rowActions",
          children: (0, import_react7.createElement)(import_dsh_client_ui_primitives7.Menu, {
            open: menuOpen,
            onClose: () => {
              setMenuAt(null);
              setMenuOpen(false);
            },
            items: menuItems,
            onSelect: (id) => {
              setMenuAt(null);
              setMenuOpen(false);
              if (id === "rename") onRename(node.title);
              if (id === "fork") onFork();
              if (id === "openInNewTab") onOpenInNewTab?.();
              if (id === "archive") onArchive();
            },
            portal: true,
            closeOnPointerLeave: true,
            anchor,
            // 行右键开的那一份：菜单锚在指针处（官方 Menu 的 getAnchorRect
            // 优先于 anchor 的矩形，官方自己的右键菜单也是这么用的）。
            ...menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }
          })
        })
      ]
    }
  );
  if (!hoverCard || selectMode) return row;
  return (0, import_react7.createElement)(import_dsh_client_ui_primitives7.HoverCard, {
    anchor: row,
    content: (0, import_react7.createElement)(SessionHoverContent, { node, now, tr }),
    disabled: menuOpen,
    copyText: node.blank ? void 0 : node.title,
    copyLabel: tr("copy"),
    copiedLabel: tr("hover.copied")
  });
}
function SearchResultRow({
  node,
  workspaceLabel,
  snippet,
  selected,
  tr,
  onOpen
}) {
  const statuses = sessionStatuses(node);
  const showStatus = showsStatusDot(statuses, node.completed);
  return (0, import_react7.createElement)(
    "button",
    {
      type: "button",
      className: `dshOneTree_searchRow${selected ? " dshOneTree_selected" : ""}`,
      role: "treeitem",
      "aria-selected": selected,
      onClick: onOpen,
      children: [
        (0, import_react7.createElement)("span", {
          key: "heading",
          className: "dshOneTree_searchRowHeading",
          children: [
            showStatus ? (0, import_react7.createElement)(SessionStatusDots, { key: "status", statuses, tr }) : (0, import_react7.createElement)("span", { key: "status", className: "dshOneTree_slot" }),
            (0, import_react7.createElement)("span", { key: "title", className: "dshOneTree_searchRowTitle" }, displayTitle(node, tr))
          ]
        }),
        (0, import_react7.createElement)("span", {
          key: "meta",
          className: "dshOneTree_searchRowMeta",
          children: [
            (0, import_react7.createElement)("span", { key: "ws", className: "dshOneTree_searchRowWorkspace" }, workspaceLabel || tr("group.ungrouped")),
            snippet === void 0 || snippet === "" ? null : (0, import_react7.createElement)("span", { key: "snip", className: "dshOneTree_searchRowSnippet" }, snippet)
          ]
        })
      ]
    }
  );
}
function ActivityBadge({ counts, tr }) {
  return (0, import_react7.createElement)(
    "span",
    {
      className: "dshOneTree_activity",
      "data-dshone-tree-activity": `${String(counts.running)}/${String(counts.waiting)}`
    },
    counts.running > 0 ? (0, import_react7.createElement)(
      "span",
      { className: "dshOneTree_activityItem", "data-dshone-tree-running": counts.running, title: tr("activity.running", { n: counts.running }) },
      (0, import_react7.createElement)(import_dsh_client_ui_primitives7.StateDot, { state: "ongoing" }),
      String(counts.running)
    ) : null,
    counts.waiting > 0 ? (0, import_react7.createElement)(
      "span",
      { className: "dshOneTree_activityItem", "data-dshone-tree-waiting": counts.waiting, title: tr("activity.waiting", { n: counts.waiting }) },
      (0, import_react7.createElement)(import_dsh_client_ui_primitives7.StateDot, { state: "warning" }),
      String(counts.waiting)
    ) : null
  );
}

// src/ui/assembly/shell/workspaceTree/search.ts
var SEARCH_DEBOUNCE_MS = 250;
var SEARCH_QUERY_MAX = 500;
function sanitizeQuery(value) {
  const withoutNul = value.replaceAll("\0", "");
  return withoutNul.length <= SEARCH_QUERY_MAX ? withoutNul : withoutNul.slice(0, SEARCH_QUERY_MAX);
}
var EMPTY_SEARCH = { items: [], hasMore: false, pending: false, failed: false };

// src/ui/assembly/shell/workspaceTree/styles.ts
var CSS = (
  // overflow:hidden 是给分节头的 `margin-right:-4px`（官方原值，让标题栏贴到侧栏
  // 右缘）兜住溢出：shell 把 `--dsh-sidebar-inline-padding` 置 0 之后，那 4px 会伸到
  // 容器外，让侧栏外层（官方 hHd-Xa_regionArea）的 scrollWidth 比 clientWidth 大 4px
  // ——平时看不见，但官方在「单列表」视图里对选中行 scrollIntoView 时会被横滚 4px，
  // 整棵树跟着左移 4px（#85 回归断言实测到的既有缺陷）。列表自己的滚动在 .dshOneTree_list。
  ".dshOneTree_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);overflow:hidden;flex-direction:column;flex:1;display:flex;position:relative}.dshOneTree_iconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_sectionHeader{box-sizing:border-box;height:var(--dsh-one-density-section-header-height,36px);color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:4px;margin-bottom:var(--dsh-one-density-section-header-gap,4px);padding-left:4px;display:flex;overflow:hidden;margin-top:2px;margin-right:-4px}.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:var(--dsh-one-density-icon-button-size,28px);transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1;align-items:center;margin-left:auto;padding-left:0;display:flex}.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:0}.dshOneTree_headerActions{opacity:1;visibility:visible;max-width:none;flex:none;align-items:center;gap:4px;display:flex}.dshOneTree_search{box-sizing:border-box;cursor:text;width:100%;height:var(--dsh-one-density-search-height,28px);color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}.dshOneTree_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);width:calc(100% + 4px);height:var(--dsh-one-density-search-expanded-height,30px);color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}.dshOneTree_searchButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_searchExpanded .dshOneTree_searchButton{width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-search-expanded-height,30px)}.dshOneTree_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_searchExpanded .dshOneTree_searchButton:hover{background:0 0}.dshOneTree_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}.dshOneTree_searchExpanded .dshOneTree_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}.dshOneTree_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}.dshOneTree_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}.dshOneTree_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:var(--dsh-one-density-list-padding-bottom,16px);overflow-y:auto}.dshOneTree_flatList>*+*,.dshOneTree_groupSection>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}.dshOneTree_groupSection{position:relative}.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:var(--dsh-one-density-group-gap,4px)}.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:var(--dsh-one-density-overflow-row-height,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:8px;padding:0 12px 0 28px;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:var(--dsh-one-density-row-height,34px)}.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}.dshOneTree_sessionRow{height:var(--dsh-one-density-session-row-height,32px);gap:0}.dshOneTree_sessionRow .dshOneTree_title{flex:1;margin:0 6px 0 4px}.dshOneTree_flatRowWithoutStatus .dshOneTree_title{margin-left:0}.dshOneTree_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.dshOneTree_folderActive{color:var(--dsw-alias-state-business-primary)}.dshOneTree_projectRow .dshOneTree_chevron{display:none}.dshOneTree_projectRow:hover .dshOneTree_chevron{display:inline-flex}.dshOneTree_projectRow:hover .dshOneTree_folder{display:none}.dshOneTree_arrow{transition:transform .15s var(--ds-ease-in-out)}.dshOneTree_arrowOpen{transform:rotate(90deg)}.dshOneTree_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.dshOneTree_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}.dshOneTree_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}.dshOneTree_scheduleIndicator{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex}.dshOneTree_dot{flex:none}.dshOneTree_rowActions{flex:none;align-items:center;gap:12px;display:none}.dshOneTree_projectRow:hover .dshOneTree_rowActions,.dshOneTree_sessionRow:hover .dshOneTree_rowActions,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowActions,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}.dshOneTree_sessionRow:hover .dshOneTree_time,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_time{display:none}.dshOneTree_rowIconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_rowIconButton:hover{color:var(--dsw-alias-label-primary)}.dshOneTree_chevron{color:var(--dsw-alias-label-caption)}.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:var(--dsh-one-density-search-row-min-height,48px);color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:8px;flex-direction:column;align-items:stretch;padding:4px 8px;display:flex}.dshOneTree_searchRow:hover,.dshOneTree_searchRow.dshOneTree_selected{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_searchRowHeading{align-items:center;min-width:0;display:flex}.dshOneTree_searchRowTitle{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;margin-left:4px;font-size:14px;line-height:20px;overflow:hidden}.dshOneTree_searchRowMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}.dshOneTree_searchRowWorkspace,.dshOneTree_searchRowSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}.dshOneTree_searchRowWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}.dshOneTree_searchRowSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}.dshOneTree_hoverContent{flex-direction:column;gap:8px;display:flex}.dshOneTree_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}.dshOneTree_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}.dshOneTree_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}.dshOneTree_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}.dshOneTree_renameInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:44px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:22px;outline:none;padding:7px 14px;font-size:14px;font-weight:400;line-height:22px}.dshOneTree_renameError{color:var(--dsw-alias-state-error-primary);margin-top:8px;font-size:12px;line-height:18px}.dshOneTree_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dshOneTree_filterBar{align-items:center;gap:4px;margin:0 0 var(--dsh-one-density-group-gap,4px);padding-left:4px;display:flex}.dshOneTree_pill{cursor:pointer;height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;flex:none;align-items:center;gap:4px;max-width:100%;padding:0 6px 0 8px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex;overflow:hidden}.dshOneTree_pill:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_pillActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_pillTag{flex:none;align-items:center;color:var(--dsw-alias-label-tertiary);display:inline-flex}.dshOneTree_pillLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.dshOneTree_pillCount{color:var(--dsw-alias-label-tertiary);flex:none}.dshOneTree_pillChevron{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;display:inline-flex}.dshOneTree_menuRow{align-items:center;gap:12px;min-width:0;width:100%;display:flex}.dshOneTree_menuRowLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}.dshOneTree_menuRowCount{color:var(--dsw-alias-label-tertiary);flex:none}.dshOneTree_footerRow{align-items:center;gap:2px;padding:0 4px;display:flex}.dshOneTree_footerRowEmpty{color:var(--dsw-alias-label-tertiary)}.dshOneTree_footerMain{cursor:pointer;min-width:0;height:var(--dsh-one-density-row-height,34px);color:inherit;background:0 0;border:none;border-radius:8px;flex:1;align-items:center;gap:8px;padding:0 8px;font-family:inherit;font-size:var(--dsh-one-density-title-font-size,14px);display:inline-flex;overflow:hidden}.dshOneTree_footerMain:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_footerIcon{flex:none;align-items:center;display:inline-flex}.dshOneTree_footerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}.dshOneTree_footerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_footerIconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_footerIconButton:disabled{cursor:default;opacity:.45}.dshOneTree_footerIconButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_manageList{max-height:240px;margin-bottom:12px;overflow-y:auto}.dshOneTree_manageRow{align-items:center;gap:8px;height:var(--dsh-one-density-row-height,34px);padding:0 4px;display:flex}.dshOneTree_manageName{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}.dshOneTree_manageCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_manageEmpty{color:var(--dsw-alias-label-tertiary);padding:8px 4px;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_manageCreate{align-items:center;gap:8px;display:flex}.dshOneTree_manageCreate .dshOneTree_renameInput{flex:1;min-width:0}.dshOneTree_manageCreate button{white-space:nowrap;flex:none}.dshOneTree_activity{pointer-events:none;position:absolute;right:var(--dsh-one-density-row-padding-inline,8px);align-items:center;gap:6px;display:inline-flex}.dshOneTree_projectRow:hover .dshOneTree_activity,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_activity{display:none}.dshOneTree_activityItem{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px);align-items:center;gap:4px;display:inline-flex}.dshOneTree_check{cursor:pointer;width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_checkBox{box-sizing:border-box;width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_checkOn{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,#fff)}.dshOneTree_selectionBarWrap{flex:none}.dshOneTree_selectionBar{gap:8px;box-sizing:border-box;padding:4px 8px;align-items:center;display:flex}.dshOneTree_selectionCount{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_selectionError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 8px 4px}.dshOneTree_drawer{z-index:10;background:var(--dsw-alias-bg-base);position:absolute;inset:0;flex-direction:column;display:flex}.dshOneTree_drawerHeader{height:var(--dsh-one-density-section-header-height,36px);flex:none;align-items:center;gap:4px;padding:0 4px 0 8px;display:flex}.dshOneTree_drawerTitle{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshOneTree_drawerList{min-height:0;padding:0 4px var(--dsh-one-density-list-padding-bottom,16px);flex:1;overflow-y:auto}.dshOneTree_drawerGroup+.dshOneTree_drawerGroup{margin-top:var(--dsh-one-density-group-gap,4px)}.dshOneTree_drawerGroupLabel{color:var(--dsw-alias-label-tertiary);height:24px;align-items:center;padding:0 8px;font-size:var(--dsh-one-density-meta-font-size,12px);display:flex}.dshOneTree_drawerRow{cursor:pointer;height:var(--dsh-one-density-session-row-height,32px);color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_drawerRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_drawerRow .dshOneTree_title{flex:1}.dshOneTree_drawerRestore{cursor:pointer;height:20px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;align-items:center;gap:4px;padding:0 4px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}.dshOneTree_drawerRestore:hover{color:var(--dsw-alias-label-primary)}.dshOneTree_drawerStatus{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:var(--dsh-one-density-meta-font-size,12px)}"
);
var CSS_TAG_ID = "@dsh-one/dsh-workspace-tree/Tree.css";
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${CSS_TAG_ID}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@dsh-one/dsh-workspace-tree";
  tag.dataset.pluginCss = CSS_TAG_ID;
  tag.textContent = CSS;
  document.head.append(tag);
}

// src/ui/assembly/shell/workspaceTree/toolbar.ts
var import_react8 = require("react");
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
function ViewOptionsMenu({
  groupBy,
  orderBy,
  tr,
  onGroupPick,
  onOrderPick
}) {
  const [open, setOpen] = (0, import_react8.useState)(false);
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Menu, {
    open,
    onClose: () => setOpen(false),
    items: [
      { type: "label", id: "group-by", text: tr("groupBy.label") },
      { id: "workspace", label: tr("groupBy.workspace") },
      { id: "flat", label: tr("groupBy.flat") },
      { type: "separator", id: "order-by-separator" },
      { type: "label", id: "order-by", text: tr("orderBy.label") },
      { id: "manual", label: tr("orderBy.manual") },
      { id: "updated", label: tr("orderBy.updated") }
    ],
    selectedIds: [groupBy, orderBy],
    onSelect: (id) => {
      if (id === "workspace" || id === "flat") onGroupPick(id);
      else if (id === "manual" || id === "updated") onOrderPick(id);
      setOpen(false);
    },
    align: "end",
    dense: true,
    portal: true,
    anchor: (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Tooltip, {
      label: tr("viewOptions.label"),
      side: "bottom",
      delayMs: 500,
      children: (0, import_react8.createElement)(
        "button",
        {
          type: "button",
          className: "dshOneTree_iconButton",
          "aria-label": tr("viewOptions.label"),
          "data-dshone-tree-action": "view-options",
          onClick: () => setOpen((v) => !v)
        },
        (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconPersonalizationOutline16, {})
      )
    })
  });
}
function TopBar(props) {
  const { tr, query, allCollapsed, selectMode } = props;
  const [addOpen, setAddOpen] = (0, import_react8.useState)(false);
  const searchInput = (0, import_react8.useRef)(null);
  const addItems = [
    {
      id: "pick-folder",
      label: (0, import_react8.createElement)("span", { "data-dshone-tree-item": "workspace-pick" }, tr("workspace.pickFolder")),
      icon: (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconFolderOpenOutline16, {})
    },
    ...props.onCreateWorkspaceFolder === void 0 ? [] : [
      {
        id: "create-folder",
        label: (0, import_react8.createElement)("span", { "data-dshone-tree-item": "workspace-create" }, tr("workspace.create")),
        icon: (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconPlusOutline16, {})
      }
    ]
  ];
  return (0, import_react8.createElement)(
    "div",
    { className: "dshOneTree_sectionHeader", "data-dshone-tree": "top-bar" },
    // 官方搜索栏的**展开态**（search / searchSlot 两层都带 Expanded 变体，与官方
    // SidebarRoot 展开后的 DOM 同构）：折叠态不在（#99 退役放大镜胶囊）。
    (0, import_react8.createElement)(
      "div",
      { className: "dshOneTree_searchSlot dshOneTree_searchSlotExpanded" },
      (0, import_react8.createElement)(
        "div",
        {
          className: "dshOneTree_search dshOneTree_searchExpanded",
          "data-dshone-tree": "search-box",
          onClick: () => searchInput.current?.focus()
        },
        (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Tooltip, {
          label: tr("search"),
          side: "bottom",
          delayMs: 500,
          children: (0, import_react8.createElement)(
            "button",
            {
              type: "button",
              className: "dshOneTree_searchButton",
              "aria-label": tr("search.sessions.aria"),
              "aria-expanded": true,
              "data-dshone-tree-action": "search",
              onClick: () => searchInput.current?.focus()
            },
            (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconSearchOutline16, { size: 11 })
          )
        }),
        (0, import_react8.createElement)("input", {
          ref: searchInput,
          className: "dshOneTree_searchInput",
          "data-dshone-tree": "search-input",
          type: "text",
          placeholder: tr("search.placeholder"),
          maxLength: SEARCH_QUERY_MAX,
          value: query,
          onChange: (event) => props.onQueryChange(event.target.value),
          onKeyDown: (event) => {
            if (event.key !== "Escape") return;
            props.onQueryClear();
          }
        }),
        (0, import_react8.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_clearButton",
            "data-dshone-tree": "search-clear",
            "aria-label": tr("search.clear"),
            onClick: (event) => {
              event.stopPropagation();
              props.onQueryClear();
            }
          },
          (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconCloseFill14, {})
        )
      )
    ),
    (0, import_react8.createElement)(
      "div",
      { className: "dshOneTree_headerActions", "data-dshone-tree": "top-bar-actions" },
      // 折叠 / 展开全部（#99）：图标与提示随当前态翻转，语义同旧侧栏。
      (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Tooltip, {
        label: allCollapsed ? tr("toolbar.expandAll") : tr("toolbar.collapseAll"),
        side: "bottom",
        delayMs: 500,
        children: (0, import_react8.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_iconButton",
            "aria-label": allCollapsed ? tr("toolbar.expandAll") : tr("toolbar.collapseAll"),
            "data-dshone-tree-action": "collapse-all",
            "data-dshone-tree-collapsed": allCollapsed,
            onClick: props.onToggleCollapseAll
          },
          allCollapsed ? (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconChevronDownOutline14, {}) : (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconChevronUpOutline14, {})
        )
      }),
      // 添加工作区（＋）：两项菜单（选已有文件夹 / 创建新工作区目录）。
      (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Menu, {
        open: addOpen,
        onClose: () => setAddOpen(false),
        items: addItems,
        onSelect: (id) => {
          setAddOpen(false);
          if (id === "pick-folder") props.onPickWorkspaceFolder();
          if (id === "create-folder") props.onCreateWorkspaceFolder?.();
        },
        align: "end",
        dense: true,
        portal: true,
        closeOnPointerLeave: true,
        anchor: (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Tooltip, {
          label: tr("workspace.add"),
          side: "bottom",
          delayMs: 500,
          children: (0, import_react8.createElement)(
            "button",
            {
              type: "button",
              className: "dshOneTree_iconButton",
              "aria-label": tr("workspace.add"),
              "data-dshone-tree-action": "add-workspace",
              onClick: () => setAddOpen((open) => !open)
            },
            (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconProjectAddOutline16, { size: 16 })
          )
        })
      }),
      // 设置齿轮（#99）：宿主有独立设置页时才有这一枚（官方 web 侧设置归官方底部行）。
      props.onOpenSettings === void 0 ? null : (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Tooltip, {
        label: tr("toolbar.settings"),
        side: "bottom",
        delayMs: 500,
        children: (0, import_react8.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_iconButton",
            "aria-label": tr("toolbar.settings"),
            "data-dshone-tree-action": "settings",
            onClick: props.onOpenSettings
          },
          (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconSettingsOutline16, { size: 16 })
        )
      }),
      // #81 已有入口（位置本条不动）。
      (0, import_react8.createElement)(ViewOptionsMenu, {
        groupBy: props.groupBy,
        orderBy: props.orderBy,
        tr,
        onGroupPick: props.onGroupPick,
        onOrderPick: props.onOrderPick
      }),
      (0, import_react8.createElement)(import_dsh_client_ui_primitives8.Tooltip, {
        label: selectMode ? tr("select.exit") : tr("select.enter"),
        side: "bottom",
        delayMs: 500,
        children: (0, import_react8.createElement)(
          "button",
          {
            type: "button",
            className: `dshOneTree_iconButton${selectMode ? " dshOneTree_menuOpen" : ""}`,
            "aria-label": selectMode ? tr("select.exit") : tr("select.enter"),
            "aria-pressed": selectMode,
            "data-dshone-tree-action": "select-mode",
            onClick: props.onToggleSelectMode
          },
          (0, import_react8.createElement)(import_dsh_client_ui_primitives8.IconChecklistOutline14, { size: 16 })
        )
      })
    )
  );
}

// src/ui/assembly/shell/workspaceTree/tree.ts
function WorkspaceTree(props) {
  const {
    t,
    useSessions,
    useWorkspaces,
    useSessionPendingInteraction,
    open: openSession,
    startSession,
    renameSession,
    forkSession,
    archiveSession,
    renameWorkspace,
    deleteWorkspace,
    pickWorkspaceFolder,
    createWorkspaceFolder,
    openSettings,
    searchSessions,
    searchResultLimit,
    loadGroups,
    saveGroups,
    recycleSessions,
    restoreSession,
    openInNewTab
  } = props;
  const tr = t;
  const now = Date.now();
  const list = useSessions((state) => state);
  const workspaces = useWorkspaces((state) => state.items);
  const workspacePhase = useWorkspaces((state) => state.phase);
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
  const pending = useSessionPendingInteraction((state) => state);
  const [prefs, setPrefs] = (0, import_react9.useState)(readTreeViewPrefs(pageStorage()));
  const groupBy = prefs.groupBy;
  const orderBy = prefs.orderBy;
  const activeGroupId = prefs.activeGroupId;
  const groupExpansion = prefs.expandedGroups;
  const [searchText, setSearchText] = (0, import_react9.useState)("");
  const [content, setContent] = (0, import_react9.useState)(EMPTY_SEARCH);
  const [renameTarget, setRenameTarget] = (0, import_react9.useState)(null);
  const [sessionRenameTarget, setSessionRenameTarget] = (0, import_react9.useState)(null);
  const [deleteTarget, setDeleteTarget] = (0, import_react9.useState)(null);
  const [groupsFile, setGroupsFile] = (0, import_react9.useState)(emptyTreeGroups());
  const [groupDialog, setGroupDialog] = (0, import_react9.useState)(null);
  const [groupError, setGroupError] = (0, import_react9.useState)(null);
  const [manageGroupsOpen, setManageGroupsOpen] = (0, import_react9.useState)(false);
  const [selectMode, setSelectMode] = (0, import_react9.useState)(false);
  const [selection, setSelection] = (0, import_react9.useState)([]);
  const [archiving, setArchiving] = (0, import_react9.useState)(false);
  const [selectionError, setSelectionError] = (0, import_react9.useState)(null);
  const [drawerOpen, setDrawerOpen] = (0, import_react9.useState)(false);
  const [restoringId, setRestoringId] = (0, import_react9.useState)(null);
  const [recycleError, setRecycleError] = (0, import_react9.useState)(null);
  const rootRef = (0, import_react9.useRef)(null);
  const hoverCard = useHoverCardRoom(rootRef);
  (0, import_react9.useEffect)(() => {
    return recycleEntrySignal.subscribe(() => {
      setDrawerOpen(true);
      setRecycleError(null);
    });
  }, []);
  (0, import_react9.useEffect)(() => {
    writeTreeViewPrefs(pageStorage(), prefs);
  }, [prefs]);
  const groupsLoaded = (0, import_react9.useRef)(false);
  (0, import_react9.useEffect)(() => {
    if (groupsLoaded.current) return;
    groupsLoaded.current = true;
    let cancelled = false;
    loadGroups().then(
      (file) => {
        if (!cancelled) setGroupsFile(file);
      },
      (reason) => {
        if (!cancelled) console.warn("[dsh-one] workspace groups unavailable:", reason);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loadGroups]);
  const writeGroups = (next) => {
    if (next === null) return;
    setGroupsFile(next);
    saveGroups(next);
  };
  (0, import_react9.useEffect)(() => {
    if (list.current === void 0 || workspacePhase !== "ready") return;
    const key = owningGroupKey(workspaces, list.current);
    setPrefs(
      (prev) => prev.expandedGroups.includes(key) ? prev : { ...prev, expandedGroups: [...prev.expandedGroups, key] }
    );
  }, [list.current, workspaces, workspacePhase]);
  const trimmedQuery = searchText.trim();
  (0, import_react9.useEffect)(() => {
    if (trimmedQuery === "") {
      setContent(EMPTY_SEARCH);
      return;
    }
    const controller = new AbortController();
    setContent((prev) => ({ ...prev, pending: true, failed: false }));
    const timer = setTimeout(() => {
      searchSessions(trimmedQuery, controller.signal).then(
        (page) => setContent({ items: page.items, hasMore: page.hasMore, pending: false, failed: false }),
        () => {
          if (controller.signal.aborted) return;
          setContent({ items: [], hasMore: false, pending: false, failed: true });
        }
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedQuery, searchSessions]);
  const archived = new Set(archivedSessionIds);
  const withOrder = (sessions) => orderBy === "updated" ? [...sessions].sort((a, b) => b.updatedAt - a.updatedAt) : sessions;
  const filterActive = groupBy === "workspace" && activeGroupId !== null && hasTreeGroup(groupsFile, activeGroupId);
  const groups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: groupExpansion,
    ...filterActive && activeGroupId !== null ? { workspaceFilter: (workspaceId) => workspaceMatchesGroup(groupsFile, workspaceId, activeGroupId) } : {}
  });
  const activity = workspaceActivityCounts(list, workspaces, archivedSessionIds, pending);
  const flatRows = withOrder(deriveFlat(list, archivedSessionIds, pending));
  const recycleGroups = deriveRecycleGroups(list, workspaces, archivedSessionIds);
  const selectedSet = new Set(selection);
  const expandableKeys = deriveGroups(list, workspaces, archivedSessionIds, pending, { expandedGroups: [] }).filter((group) => group.sessionCount > 0).map((group) => group.key);
  const allCollapsed = expandableKeys.length > 0 && expandableKeys.every((key) => !groupExpansion.includes(key));
  const toggleCollapseAll = () => {
    setPrefs((prev) => ({
      ...prev,
      expandedGroups: allCollapsed ? [.../* @__PURE__ */ new Set([...prev.expandedGroups, ...expandableKeys])] : []
    }));
  };
  const groupDefs = treeGroupDefs(groupsFile);
  const groupCounts = new Map(
    groupDefs.map((def) => [def.id, workspaces.filter((workspace) => workspaceMatchesGroup(groupsFile, workspace.workspaceId, def.id)).length])
  );
  const applyGroupCreate = (name) => {
    const result = createTreeGroup(groupsFile, name, newGroupId());
    if (!result.ok) return result.error;
    writeGroups(result.file);
    return null;
  };
  const applyGroupRename = (groupId, name) => {
    const next = renameTreeGroup(groupsFile, groupId, name);
    if (next === null) return "duplicate";
    writeGroups(next);
    return null;
  };
  const applyGroupDelete = (groupId) => {
    const next = deleteTreeGroup(groupsFile, groupId);
    if (next !== null) writeGroups(next);
    setPrefs((prev) => prev.activeGroupId === groupId ? { ...prev, activeGroupId: null } : prev);
  };
  const toggleSelected = (sessionId) => {
    setSelectionError(null);
    setSelection(
      (prev) => prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };
  const exitSelection = () => {
    setSelectMode(false);
    setSelection([]);
    setSelectionError(null);
  };
  const archiveSelected = () => {
    if (archiving || selection.length === 0) return;
    setArchiving(true);
    setSelectionError(null);
    recycleSessions(selection).then(
      (result) => {
        setArchiving(false);
        setSelection(result.failed);
        if (result.failed.length > 0) setSelectionError(tr("select.archiveFailed", { n: result.failed.length }));
        else exitSelection();
      },
      (reason) => {
        setArchiving(false);
        setSelectionError(reason instanceof Error ? reason.message : String(reason));
      }
    );
  };
  const restoreFromRecycle = (sessionId) => {
    if (restoringId !== null) return;
    setRestoringId(sessionId);
    setRecycleError(null);
    restoreSession(sessionId).then(
      () => setRestoringId(null),
      (reason) => {
        setRestoringId(null);
        setRecycleError(tr("recycle.failed", { message: reason instanceof Error ? reason.message : String(reason) }));
      }
    );
  };
  const workspaceLabelOf = (sessionId) => {
    const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
    return owner === void 0 ? "" : owner.title;
  };
  const searchRows = (() => {
    if (trimmedQuery === "") return [];
    const needle = trimmedQuery.toLowerCase();
    const local = list.ids.flatMap((id) => {
      const summary = list.byId[id];
      if (summary === void 0 || summary.origin === "subagent" || archived.has(id)) return [];
      if (summary.blank && id !== list.current) return [];
      const matches = `${summary.displayTitle ?? summary.title ?? ""} ${workspaceLabelOf(id)}`.toLowerCase().includes(needle);
      return matches ? [{
        id,
        title: summary.blank ? "" : summary.displayTitle ?? summary.title ?? id,
        blank: summary.blank,
        running: summary.running,
        runningSubagentCount: 0,
        completed: summary.completed === true,
        hasActiveSchedule: (summary.projectionValues?.schedule?.length ?? 0) > 0,
        updatedAt: summary.updatedAt
      }] : [];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    const seen = new Set(local.map((row) => row.id));
    const extra = [];
    for (const item of content.items) {
      if (seen.has(item.id)) continue;
      const summary = list.byId[item.id];
      if (summary === void 0) continue;
      seen.add(item.id);
      extra.push({
        id: item.id,
        title: summary.blank ? "" : summary.displayTitle ?? summary.title ?? item.id,
        blank: summary.blank,
        running: summary.running,
        runningSubagentCount: 0,
        completed: summary.completed === true,
        hasActiveSchedule: (summary.projectionValues?.schedule?.length ?? 0) > 0,
        updatedAt: summary.updatedAt
      });
    }
    return [...local, ...extra].slice(0, searchResultLimit);
  })();
  const snippetOf = (sessionId) => content.items.find((item) => item.id === sessionId)?.snippet;
  const treeBody = trimmedQuery !== "" ? searchRows.length > 0 ? (0, import_react9.createElement)(
    "div",
    { className: "dshOneTree_searchTree", role: "tree", "aria-label": tr("search.results.aria"), "data-dshone-tree": "search" },
    searchRows.map(
      (row) => (0, import_react9.createElement)(SearchResultRow, {
        key: row.id,
        node: row,
        workspaceLabel: workspaceLabelOf(row.id),
        ...snippetOf(row.id) === void 0 ? {} : { snippet: snippetOf(row.id) },
        selected: row.id === list.current,
        tr,
        onOpen: () => openSession(row.id)
      })
    )
  ) : content.pending ? (0, import_react9.createElement)("div", { className: "dshOneTree_searchStatus" }, tr("search.pending")) : (0, import_react9.createElement)(
    "div",
    { className: "dshOneTree_searchStatus" },
    content.failed ? tr("search.unavailable") : tr("search.noMatches")
  ) : groupBy === "flat" ? (0, import_react9.createElement)(
    "div",
    { className: "dshOneTree_flatList", role: "tree", "data-dshone-tree": "flat" },
    flatRows.map(
      (row) => (0, import_react9.createElement)(SessionRow, {
        key: row.id,
        node: row,
        ...list.current === void 0 ? {} : { currentId: list.current },
        now,
        flat: true,
        hoverCard,
        tr,
        selectMode,
        selected: selectedSet.has(row.id),
        onToggleSelect: () => toggleSelected(row.id),
        onOpen: () => openSession(row.id),
        onRename: (title) => setSessionRenameTarget({ id: row.id, title }),
        onFork: () => forkSession(row.id),
        onArchive: () => void archiveSession(row.id).catch(() => {
        }),
        onOpenInNewTab: openInNewTab === void 0 ? void 0 : () => openInNewTab(row.id)
      })
    )
  ) : (0, import_react9.createElement)(
    "div",
    { role: "tree", "data-dshone-tree": "groups" },
    groups.map(
      (group) => (0, import_react9.createElement)(
        "div",
        { className: "dshOneTree_groupSection", key: group.key, "data-dshone-group-key": group.key },
        (0, import_react9.createElement)(ProjectRow, {
          group,
          tr,
          expanded: groupExpansion.includes(group.key),
          hoverCard,
          ...activity.get(group.key) === void 0 ? {} : { counts: activity.get(group.key) },
          groups: treeGroupDefs(groupsFile),
          memberOf: group.workspaceId === void 0 ? [] : workspaceGroupIds(groupsFile, group.workspaceId),
          onToggle: () => setPrefs((prev) => ({
            ...prev,
            expandedGroups: prev.expandedGroups.includes(group.key) ? prev.expandedGroups.filter((key) => key !== group.key) : [...prev.expandedGroups, group.key]
          })),
          onCreate: () => startSession(group.workspaceId),
          onToggleGroup: (groupId) => {
            if (group.workspaceId === void 0) return;
            writeGroups(toggleWorkspaceGroup(groupsFile, group.workspaceId, groupId));
          },
          ...group.workspaceId === void 0 ? {} : {
            onRename: () => setRenameTarget({ workspaceId: group.workspaceId, title: group.label }),
            onDelete: () => setDeleteTarget({ workspaceId: group.workspaceId, title: group.label })
          }
        }),
        ...withOrder(group.sessions).map(
          (row) => (0, import_react9.createElement)(SessionRow, {
            key: row.id,
            node: row,
            ...list.current === void 0 ? {} : { currentId: list.current },
            now,
            flat: false,
            hoverCard,
            tr,
            selectMode,
            selected: selectedSet.has(row.id),
            onToggleSelect: () => toggleSelected(row.id),
            onOpen: () => openSession(row.id),
            onRename: (title) => setSessionRenameTarget({ id: row.id, title }),
            onFork: () => forkSession(row.id),
            onArchive: () => void archiveSession(row.id).catch(() => {
            }),
            onOpenInNewTab: openInNewTab === void 0 ? void 0 : () => openInNewTab(row.id)
          })
        )
      )
    )
  );
  return (0, import_react9.createElement)(
    "div",
    { className: "dshOneTree_root", ref: rootRef, "data-shell": "dsh-one-tree", "data-dshone-tree": "root" },
    // 顶部工具栏（#99 B 段）：官方搜索栏（展开态）+ 折叠/展开全部 + 添加工作区 + 设置齿轮，
    // 末尾保留 #81 已有的视图选项与多选入口。见 toolbar.ts 的说明与机制举证。
    (0, import_react9.createElement)(TopBar, {
      tr,
      query: searchText,
      onQueryChange: (value) => setSearchText(sanitizeQuery(value)),
      onQueryClear: () => setSearchText(""),
      allCollapsed,
      onToggleCollapseAll: toggleCollapseAll,
      onPickWorkspaceFolder: pickWorkspaceFolder,
      ...createWorkspaceFolder === void 0 ? {} : { onCreateWorkspaceFolder: createWorkspaceFolder },
      ...openSettings === void 0 ? {} : { onOpenSettings: openSettings },
      groupBy,
      orderBy,
      onGroupPick: (mode) => setPrefs((prev) => ({ ...prev, groupBy: mode })),
      onOrderPick: (mode) => setPrefs((prev) => ({ ...prev, orderBy: mode })),
      selectMode,
      onToggleSelectMode: () => selectMode ? exitSelection() : setSelectMode(true)
    }),
    (0, import_react9.createElement)(
      "div",
      { className: "dshOneTree_listArea" },
      // #81 功能 1 / #99 B 段：分组过滤条 = 单胶囊 + 成员计数 + ▾ 下拉
      //（只在「按工作区」下有意义；搜索态下让位给结果）。
      groupBy === "workspace" && trimmedQuery === "" && !selectMode ? (0, import_react9.createElement)(GroupFilterBar, {
        groups: groupDefs,
        activeGroupId: filterActive ? activeGroupId : null,
        groupCounts,
        totalCount: workspaces.length,
        tr,
        onPick: (groupId) => setPrefs((prev) => ({ ...prev, activeGroupId: groupId })),
        onCreate: () => {
          setGroupError(null);
          setGroupDialog({ kind: "create" });
        },
        onManage: () => setManageGroupsOpen(true)
      }) : null,
      // #81 功能 4：选择态的动作条（已选计数 + 批量移入回收站 + 退出）。
      selectMode ? (0, import_react9.createElement)(SelectionBar, {
        count: selection.length,
        busy: archiving,
        error: selectionError,
        tr,
        onArchive: archiveSelected,
        onExit: exitSelection
      }) : null,
      (0, import_react9.createElement)(
        "div",
        { className: "dshOneTree_list" },
        workspacePhase !== "ready" ? null : groups.length === 0 && trimmedQuery === "" ? (0, import_react9.createElement)("div", { className: "dshOneTree_empty" }, tr("empty.none")) : treeBody
      )
    ),
    (0, import_react9.createElement)(RecycleDrawer, {
      open: drawerOpen,
      groups: recycleGroups,
      now,
      tr,
      busyId: restoringId,
      error: recycleError,
      onClose: () => {
        setDrawerOpen(false);
        setRecycleError(null);
      },
      onOpen: (sessionId) => openSession(sessionId),
      onRestore: restoreFromRecycle
    }),
    (0, import_react9.createElement)(RenameModal, {
      open: renameTarget !== null,
      titleKey: "rename.workspace.title",
      fieldKey: "field.workspaceName",
      initial: renameTarget?.title ?? "",
      tr,
      onClose: () => setRenameTarget(null),
      onSubmit: async (value) => {
        if (renameTarget === null) return;
        await renameWorkspace(renameTarget.workspaceId, value);
      }
    }),
    (0, import_react9.createElement)(RenameModal, {
      open: sessionRenameTarget !== null,
      titleKey: "rename.session.title",
      fieldKey: "field.sessionName",
      initial: sessionRenameTarget?.title ?? "",
      tr,
      onClose: () => setSessionRenameTarget(null),
      onSubmit: async (value) => {
        if (sessionRenameTarget === null) return;
        await renameSession(sessionRenameTarget.id, value);
      }
    }),
    (0, import_react9.createElement)(GroupModal, {
      dialog: groupDialog,
      groups: groupDefs,
      tr,
      error: groupError,
      onClose: () => {
        setGroupDialog(null);
        setGroupError(null);
      },
      onSubmit: (value) => {
        const dialog = groupDialog;
        if (dialog === null) return;
        if (dialog.kind === "create") {
          const failure = applyGroupCreate(value);
          if (failure !== null) {
            setGroupError(failure === "empty" ? tr("group.name.empty") : tr("group.name.duplicate"));
            return;
          }
        } else if (dialog.kind === "rename") {
          if (applyGroupRename(dialog.id, value) !== null) {
            setGroupError(tr("group.name.duplicate"));
            return;
          }
        } else {
          applyGroupDelete(dialog.id);
        }
        setGroupDialog(null);
        setGroupError(null);
      }
    }),
    // 「管理分组…」对话框（#99 B 段）：行内 ✎/🗑 关掉本框、开上面那套对话框去做
    //（校核复用），建新组则内联走同一份 `applyGroupCreate`。
    (0, import_react9.createElement)(ManageGroupsModal, {
      open: manageGroupsOpen,
      groups: groupDefs,
      counts: groupCounts,
      tr,
      onCreate: applyGroupCreate,
      onRename: (groupId, name) => {
        setManageGroupsOpen(false);
        setGroupError(null);
        setGroupDialog({ kind: "rename", id: groupId, name });
      },
      onDelete: (groupId, name) => {
        setManageGroupsOpen(false);
        setGroupError(null);
        setGroupDialog({ kind: "delete", id: groupId, name });
      },
      onClose: () => setManageGroupsOpen(false)
    }),
    (0, import_react9.createElement)(DeleteWorkspaceModal, {
      target: deleteTarget,
      tr,
      onClose: () => setDeleteTarget(null),
      onSubmit: (workspaceId) => deleteWorkspace(workspaceId)
    })
  );
}

// src/ui/assembly/shell/workspaceTreePlugin.ts
var inject = ["slots", "locale", "sessions", "workspaces"];
function apply(ctx) {
  const sessions = ctx.get("sessions");
  const workspaces = ctx.get("workspaces");
  const caps = hostCapabilities(ctx);
  const startSessionIn = async (workspaceId) => {
    const snapshot = workspaces.list.getSnapshot();
    const workspace = snapshot.items.find((item) => item.workspaceId === workspaceId);
    if (workspace === void 0) throw new Error(`workspace tree: unknown workspace ${workspaceId}`);
    const list = sessions.list.getSnapshot();
    for (const id of list.ids) {
      const summary = list.byId[id];
      if (summary !== void 0 && summary.blank && summary.cwd === workspace.path && workspace.sessionIds.includes(summary.id) && !snapshot.archivedSessionIds.includes(summary.id)) {
        return summary.id;
      }
    }
    return await sessions.create({ workspaceId });
  };
  const buildInjected = () => {
    const uiWorkspace = () => ctx.uiWorkspace;
    return {
      // 「在新标签页打开」（#72 多开通道）：走宿主能力口（抽象口，插件不碰宿主 API）。
      // 能力口如实上报 `editorTabs`：没有编辑器标签页的宿主（官方 web 形态）不注入
      // 这个动作，菜单项与行右键都不出现——那是同一份插件在另一端的正确形态。
      ...caps.editorTabs ? {
        openInNewTab: (sessionId) => {
          caps.openSessionInNewTab(sessionId).catch((reason) => {
            console.warn("[dsh-one] open session in new tab failed:", reason);
          });
        }
      } : {},
      // #99 顶栏 ＋ 菜单第二项「创建新工作区目录…」：宿主能力口，宿主没有这条能力
      // （官方 web 形态）时不注入 = 那一项不出现。
      ...caps.workspaceCreate ? {
        createWorkspaceFolder: () => {
          caps.createWorkspaceDirectory().catch((reason) => {
            console.warn("[dsh-one] create workspace directory failed:", reason);
          });
        }
      } : {},
      // #99 顶栏最右的设置齿轮：宿主能力口，宿主没有独立设置页（官方 web 形态）时
      // 不注入 = 齿轮不渲染（那一端设置归官方侧栏底部那一行）。
      ...caps.settingsPage ? {
        openSettings: () => {
          caps.openSettings().catch((reason) => {
            console.warn("[dsh-one] open settings failed:", reason);
          });
        }
      } : {},
      // 官方 sessions 服务：选中会话（镜像官方 ui-workspace 的 openSession，
      // 不调 layout.selectPanel——自有侧栏树没有主面板概念）。
      open: (sessionId) => {
        sessions.open(sessionId);
      },
      // 工作区行的「+」：官方 uiWorkspace.startSession 的语义（它依赖 layout 服务的
      // beginNavigation/selectPanel，自有 layout 桩没有这两件，故按同一语义直接
      // 用 sessions 服务实现）。
      startSession: (workspaceId) => {
        if (workspaceId === void 0) return;
        void startSessionIn(workspaceId).then((id) => sessions.open(id)).catch((reason) => console.warn("[dsh-one] new session failed:", reason));
      },
      // 官方 ui-workspace 的 renameSession：binding → session.rename。
      renameSession: async (sessionId, title) => {
        const session = sessions.binding(sessionId)?.session;
        if (session === void 0) throw new Error(`unknown session "${sessionId}"`);
        const result = await session.rename(title);
        if (!result.ok) throw new Error(result.error?.message ?? "rename failed");
      },
      // 官方 uiWorkspace.forkSession：sessions.fork(increaseTitle) 后打开子会话。
      forkSession: (sessionId) => {
        void sessions.fork({ sessionId, increaseTitle: true }).then((childId) => sessions.open(childId)).catch(() => {
        });
      },
      archiveSession: (sessionId) => workspaces.archiveSession(sessionId),
      renameWorkspace: (workspaceId, title) => workspaces.rename(workspaceId, title),
      deleteWorkspace: (workspaceId) => workspaces.delete(workspaceId),
      // 官方 uiWorkspace.pickDirectory：宿主原生选择器。**为什么直调服务而不是渲染
      // 官方 `sidebar.workspaces.directoryFlow` 子槽**（#99 B 段原本要求渲染子槽）：
      // 那口子由官方 WorkspaceBrowser 条目在它自己的 `children` 里声明，而官方渲染器
      // **只允许声明该槽的条目渲染它**——`dsh-client-ui-renderer/lib/client.js` 的
      // boundRenderSlot 原文：
      //   `const declared = entry.children?.[key]; if (declared === void 0) throw new
      //    SlotOwnershipError("slot '<key>' is not declared by this entry's children")`
      // 我们这条 shadow entry 声明不了同名槽（同名二次声明注册表直接报错，本文件头
      // 已举证），所以「渲染官方子槽」在当前架构下不可达：官方那口的占用者（browse
      // picker）也只在 ui-conversation 在场时才注册（它把 sidebar 那半嵌在 hero 那半的
      // inject 里）。走官方服务是第 2 层机制、语义一致（同一个宿主原生选择器），
      // 且不接手任何隐式契约。
      pickWorkspaceFolder: () => {
        const service = uiWorkspace();
        if (service === void 0) return;
        void service.pickDirectory().then((path) => path === null ? void 0 : workspaces.create({ path })).catch(() => {
        });
      },
      searchSessions: async (query, signal) => {
        const result = await sessions.search(query, signal);
        if (!result.ok || result.value === void 0) throw new Error(result.error?.message ?? "search failed");
        return result.value;
      },
      searchResultLimit: sessions.searchResultLimit,
      // #82：本插件的持久状态走**宿主能力口**（`stateRead/stateWrite`）——VS Code 侧
      // 落到扩展宿主的能力桥，官方 web 侧落到宿主半的网关 RPC，插件代码两端一样。
      // 键 `groups` 与 `~/.dsh/dsh-one/groups.json` 同名同形：旧侧栏建的分组开箱即见，
      // 不需要任何数据搬家（理由写在 pure/treeGroups.ts 的头注释里）。
      loadGroups: async () => {
        const value = await hostCapabilities(ctx).stateRead(TREE_GROUPS_STATE_KEY);
        return parseTreeGroups(value) ?? emptyTreeGroups();
      },
      saveGroups: (file) => {
        void hostCapabilities(ctx).stateWrite(TREE_GROUPS_STATE_KEY, JSON.parse(serializeTreeGroups(file))).catch((reason) => {
          console.warn("[dsh-one] workspace groups not persisted:", reason);
        });
      },
      // #81 功能 3/4：进回收站 = 官方归档（逐个走官方 uiWorkspace.archiveSession；
      // 串行而不是并发：归档会更新官方工作区注册表，逐个落地便于精确报出失败项）。
      recycleSessions: async (sessionIds) => {
        const service = uiWorkspace();
        const failed = [];
        for (const sessionId of sessionIds) {
          try {
            if (service === void 0) await workspaces.archiveSession(sessionId);
            else await service.archiveSession(sessionId);
          } catch {
            failed.push(sessionId);
          }
        }
        return { failed };
      },
      // #81 功能 5：还原 = 官方 uiWorkspace.unarchiveSession（官方有此接口，不自造）。
      restoreSession: async (sessionId) => {
        const service = uiWorkspace();
        if (service === void 0) throw new Error("this shell provides no official uiWorkspace service");
        await service.unarchiveSession(sessionId);
      }
    };
  };
  ctx.effect(() => {
    const disposeLocale = ctx.locale.register(LOCALE_NS, { zh: ZH, en: EN });
    const disposeInject = ctx.slots.inject(
      "sidebar.workspaces",
      () => ctx.slots.register(
        {
          name: "sidebar.workspaces",
          priority: -1,
          children: {},
          locale: LOCALE_NS,
          inject: buildInjected
        },
        WorkspaceTree
      )
    );
    const disposeFooterEntry = ctx.slots.inject(
      "sidebar.footer.action",
      () => ctx.slots.register(
        {
          name: "sidebar.footer.action",
          id: "dsh-one-recycle-bin",
          locale: LOCALE_NS
        },
        RecycleEntry
      )
    );
    return () => {
      disposeFooterEntry();
      disposeInject();
      disposeLocale();
    };
  }, "dsh-one workspace tree: shadow sidebar.workspaces");
}

		return module.exports;
	}
});

