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
function reorderGroups(groups, groupIds) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const next = groupIds.map((id) => byId.get(id)).filter((g) => g !== void 0);
  if (next.length === 0 || next.length !== groups.length) return null;
  if (next.every((g, i) => g.id === groups[i].id)) return null;
  return next;
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

// src/pure/recycleBinState.ts
function sanitizeRecycleIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const id of raw) {
    if (typeof id !== "string" || !id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
function pruneRecycleIds(recycleBin, knownSessionIds, baselineReady) {
  if (!baselineReady) return null;
  const next = recycleBin.filter((id) => knownSessionIds.has(id));
  return next.length === recycleBin.length ? null : next;
}
function emptyRecycleBin() {
  return { version: 1, sessionIds: [] };
}
function parseRecycleBin(raw) {
  if (Array.isArray(raw)) return { version: 1, sessionIds: sanitizeRecycleIds(raw) };
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw;
  if (record.version !== 1 || !("sessionIds" in record)) return null;
  return { version: 1, sessionIds: sanitizeRecycleIds(record.sessionIds) };
}
function serializeRecycleBin(file) {
  return { version: 1, sessionIds: [...file.sessionIds] };
}
function moveIntoRecycleBin(file, sessionIds) {
  const present = new Set(file.sessionIds);
  const added = [];
  for (const id of sessionIds) {
    if (typeof id !== "string" || id === "" || present.has(id)) continue;
    present.add(id);
    added.push(id);
  }
  if (added.length === 0) return null;
  return { version: 1, sessionIds: [...file.sessionIds, ...added] };
}
function restoreFromRecycleBin(file, sessionIds) {
  const drop = new Set(sessionIds);
  const next = file.sessionIds.filter((id) => !drop.has(id));
  return next.length === file.sessionIds.length ? null : { version: 1, sessionIds: next };
}

// src/pure/sessionTags.ts
var TAG_COLORS = ["yellow", "blue", "green", "orange", "purple", "red"];

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
function reorderTreeGroups(file, groupIds) {
  const groups = reorderGroups(file.groups, groupIds);
  if (groups === null) return null;
  return { ...file, groups };
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
function setWorkspacesGroupMembership(file, workspaceIds, groupId, member) {
  let next = file;
  let changed = false;
  for (const workspaceId of workspaceIds) {
    if (workspaceMatchesGroup(next, workspaceId, groupId) === member) continue;
    const updated = toggleWorkspaceGroup(next, workspaceId, groupId);
    if (updated === null) continue;
    next = updated;
    changed = true;
  }
  return changed ? next : null;
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

// src/pure/sessionMarks.ts
var SESSION_PINNED_STATE_KEY = "pinned";
var SESSION_UNREAD_STATE_KEY = "unread";
function emptySessionMarks() {
  return { pinned: [], unread: [] };
}
function sanitizeMarkIds(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const id of raw) {
    if (typeof id !== "string" || id === "") continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
function migrateMarkIds(value) {
  if (value === null || value === void 0) return { ids: [], needsRewrite: false };
  if (Array.isArray(value)) return { ids: sanitizeMarkIds(value), needsRewrite: true };
  if (typeof value === "object") {
    const record = value;
    if (record.version === 1 && Array.isArray(record.sessionIds)) {
      return { ids: sanitizeMarkIds(record.sessionIds), needsRewrite: false };
    }
  }
  return { ids: [], needsRewrite: true };
}
function markStateFile(ids) {
  return { version: 1, sessionIds: [...ids] };
}
function migrateSessionMarks(values) {
  const pinned = migrateMarkIds(values.pinned);
  const unread = migrateMarkIds(values.unread);
  const rewrite = [];
  if (pinned.needsRewrite) rewrite.push("pinned");
  if (unread.needsRewrite) rewrite.push("unread");
  return { marks: { pinned: pinned.ids, unread: unread.ids }, rewrite };
}
function toggleMarkId(ids, id, on) {
  const has = ids.includes(id);
  if (on) return has ? ids : [...ids, id];
  return has ? ids.filter((value) => value !== id) : ids;
}
function pinnedFirst(items, isPinned) {
  const pinned = [];
  const rest = [];
  for (const item of items) (isPinned(item) ? pinned : rest).push(item);
  return [...pinned, ...rest];
}

// src/pure/sessionTagGroups.ts
var TAG_GROUPS_STATE_KEY = "tags";
var LEGACY_PRESET_IDS = /* @__PURE__ */ new Set(["preset-todo", "preset-doing", "preset-done"]);
function emptyTagGroups() {
  return { version: 2, workspaces: {} };
}
function emptyTagBucket() {
  return { tags: [], sessionTags: {} };
}
function sanitizeColor(raw) {
  return TAG_COLORS.includes(raw) ? raw : "orange";
}
function sanitizeTagBucket(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw;
  const tags = [];
  const seen = /* @__PURE__ */ new Set();
  if (Array.isArray(record.tags)) {
    for (const item of record.tags) {
      if (typeof item !== "object" || item === null) continue;
      const { id, name, color } = item;
      if (typeof id !== "string" || id === "" || seen.has(id)) continue;
      if (LEGACY_PRESET_IDS.has(id)) continue;
      if (typeof name !== "string" || name.trim() === "") continue;
      seen.add(id);
      tags.push({ id, name: name.trim(), color: sanitizeColor(color) });
    }
  }
  const sessionTags = {};
  if (typeof record.sessionTags === "object" && record.sessionTags !== null && !Array.isArray(record.sessionTags)) {
    for (const [sessionId, groupId] of Object.entries(record.sessionTags)) {
      if (sessionId === "") continue;
      if (typeof groupId === "string" && seen.has(groupId)) sessionTags[sessionId] = groupId;
    }
  }
  return { tags, sessionTags };
}
function parseTagGroups(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value;
  if (record.version !== 2) return null;
  const raw = record.workspaces;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const workspaces = {};
  for (const [workspaceId, bucket] of Object.entries(raw)) {
    if (workspaceId === "") continue;
    const sanitized = sanitizeTagBucket(bucket);
    if (sanitized === null) continue;
    workspaces[workspaceId] = sanitized;
  }
  return { version: 2, workspaces };
}
function serializeTagGroups(file) {
  return JSON.stringify(file);
}
function tagBucketOf(file, workspaceId) {
  return file.workspaces[workspaceId] ?? emptyTagBucket();
}
function withTagBucket(file, workspaceId, bucket) {
  const workspaces = { ...file.workspaces };
  if (bucket.tags.length === 0) delete workspaces[workspaceId];
  else workspaces[workspaceId] = bucket;
  return { version: 2, workspaces };
}
function tagGroupNameError(bucket, name, excludeId) {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (bucket.tags.some((tag) => tag.id !== excludeId && tag.name === trimmed)) return "duplicate";
  return null;
}
function nextTagColor(bucket) {
  return TAG_COLORS[bucket.tags.length % TAG_COLORS.length] ?? "orange";
}
function createTagGroup(bucket, name, id, color) {
  const error = tagGroupNameError(bucket, name);
  if (error !== null) return { ok: false, error };
  return { ok: true, bucket: { ...bucket, tags: [...bucket.tags, { id, name: name.trim(), color }] }, id };
}
function updateTagGroup(bucket, id, patch) {
  const index = bucket.tags.findIndex((tag) => tag.id === id);
  if (index === -1) return null;
  const current = bucket.tags[index];
  const name = patch.name === void 0 ? current.name : patch.name.trim();
  const color = patch.color ?? current.color;
  if (name === "" || tagGroupNameError(bucket, name, id) !== null) return null;
  if (name === current.name && color === current.color) return null;
  const tags = [...bucket.tags];
  tags[index] = { id, name, color };
  return { ...bucket, tags };
}
function deleteTagGroup(bucket, id) {
  if (!bucket.tags.some((tag) => tag.id === id)) return null;
  const sessionTags = {};
  for (const [sessionId, groupId] of Object.entries(bucket.sessionTags)) {
    if (groupId !== id) sessionTags[sessionId] = groupId;
  }
  return { tags: bucket.tags.filter((tag) => tag.id !== id), sessionTags };
}
function reorderTagGroups(bucket, ids) {
  if (ids.length !== bucket.tags.length) return null;
  const byId = new Map(bucket.tags.map((tag) => [tag.id, tag]));
  const seen = /* @__PURE__ */ new Set();
  const next = [];
  for (const id of ids) {
    const tag = byId.get(id);
    if (tag === void 0 || seen.has(id)) return null;
    seen.add(id);
    next.push(tag);
  }
  if (next.every((tag, index) => tag.id === bucket.tags[index]?.id)) return null;
  return { ...bucket, tags: next };
}
function setSessionTagGroup(bucket, sessionId, groupId) {
  if (sessionId === "") return null;
  if (groupId !== null && !bucket.tags.some((tag) => tag.id === groupId)) return null;
  const current = bucket.sessionTags[sessionId];
  if ((current ?? null) === groupId) return null;
  const sessionTags = { ...bucket.sessionTags };
  if (groupId === null) delete sessionTags[sessionId];
  else sessionTags[sessionId] = groupId;
  return { ...bucket, sessionTags };
}
function setSessionsTagGroup(bucket, sessionIds, groupId) {
  let current = null;
  for (const sessionId of sessionIds) {
    const next = setSessionTagGroup(current ?? bucket, sessionId, groupId);
    if (next !== null) current = next;
  }
  return current;
}
function pruneTagGroups(bucket, isAlive) {
  if (bucket.tags.length === 0) return null;
  const alive = /* @__PURE__ */ new Set();
  for (const [sessionId, groupId] of Object.entries(bucket.sessionTags)) {
    if (isAlive(sessionId)) alive.add(groupId);
  }
  const tags = bucket.tags.filter((tag) => alive.has(tag.id));
  if (tags.length === bucket.tags.length) return null;
  const kept = new Set(tags.map((tag) => tag.id));
  const sessionTags = {};
  for (const [sessionId, groupId] of Object.entries(bucket.sessionTags)) {
    if (kept.has(groupId)) sessionTags[sessionId] = groupId;
  }
  return { tags, sessionTags };
}
function splitByTagGroups(sessions, bucket, isPinned) {
  const byGroup = /* @__PURE__ */ new Map();
  const ungrouped = [];
  for (const node of sessions) {
    const groupId = bucket.sessionTags[node.id];
    if (groupId === void 0) {
      ungrouped.push(node);
      continue;
    }
    const list = byGroup.get(groupId);
    if (list === void 0) byGroup.set(groupId, [node]);
    else list.push(node);
  }
  const blocks = [];
  for (const def of bucket.tags) {
    const members = byGroup.get(def.id);
    if (members === void 0 || members.length === 0) continue;
    blocks.push({ def, sessions: pinnedFirst(members, isPinned) });
  }
  return { blocks, ungrouped: pinnedFirst(ungrouped, isPinned) };
}
function tagGroupCounts(sessions, isUnread) {
  let pending = 0;
  let running = 0;
  let unread = 0;
  for (const node of sessions) {
    if (node.pendingInteraction !== void 0) pending += 1;
    else if (node.running || node.runningSubagentCount > 0) running += 1;
    else if (isUnread(node.id)) unread += 1;
  }
  return { pending, running, unread };
}

// src/pure/sessionOwnership.ts
var SESSION_ALREADY_OWNED_ERROR_NAME = "SessionAlreadyOwnedError";
function isSessionAlreadyOwnedError(message) {
  return typeof message === "string" && message.includes(SESSION_ALREADY_OWNED_ERROR_NAME);
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
    // #121：会话行点击的两条。没有桥 = 官方 web 一侧（或页面还没装上桥）：那一端没有
    // 「宿主面板」这个概念，查询如实回 false（= 一律按打开处理），动作静默返回
    //（那边的「打开」由官方 sessions.open 负责，消费方已经先走过它了）。
    async isSessionInPanel(sessionId) {
      if (!viaBridge()) return false;
      try {
        const data = await bridgeCall("session.inPanel", { sessionId });
        return data.open === true;
      } catch (err) {
        console.warn("[dsh-one] session panel state unavailable:", err);
        return false;
      }
    },
    async openSessionPanel(sessionId) {
      if (!viaBridge()) return;
      await bridgeCall("session.openPanel", { sessionId });
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
    // #112：当前 VS Code 打开的文件夹。**没有桥 = 官方 web 一侧**（或页面还没装上桥）：
    // 这一端没有「VS Code 打开的文件夹」这个概念，如实回空表——调用方（侧栏树）按
    // 「没有当前工作区」渲染（不显示徽标、不置顶），与「VS Code 空窗口」同一个形态。
    // 与上面几条 workspace* 能力不同，这里不抛 `unavailable`：文件夹表是个**只读查询**，
    // 空表本身就是正确答案，抛错只会逼每个调用方再写一遍降级。
    async currentWorkspaceFolders() {
      if (!viaBridge()) return [];
      const data = await bridgeCall("vscode.workspaceFolders", {});
      const paths = data.paths;
      if (!Array.isArray(paths)) return [];
      return paths.filter((path) => typeof path === "string" && path !== "");
    },
    get shellName() {
      return viaBridge() ? "vscode" : "web";
    }
  };
}

// src/ui/assembly/shell/workspaceTree/locale.ts
var ZH = {
  "group.ungrouped": "\u672A\u5206\u7EC4",
  "session.new": "\u65B0\u4F1A\u8BDD",
  "section.workspaces": "\u5DE5\u4F5C\u533A",
  "section.sessions": "\u4F1A\u8BDD",
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
  "group.name.empty": "\u5206\u7EC4\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A",
  "group.name.duplicate": "\u5DF2\u5B58\u5728\u540C\u540D\u5206\u7EC4",
  "group.membership": "\u6240\u5C5E\u5206\u7EC4",
  // #155 管理框里组行抓手的提示（取值逐字取自旧侧栏同一条：「拖动排序」）。
  "group.drag": "\u62D6\u52A8\u6392\u5E8F",
  // #139 成员清单（管理分组对话框的第二层）。
  "group.members.open": "\u7F16\u8F91\u201C{name}\u201D\u7684\u6210\u5458",
  "group.members.back": "\u8FD4\u56DE\u5206\u7EC4\u5217\u8868",
  "group.members.search": "\u641C\u7D22\u5DE5\u4F5C\u533A",
  "group.members.selectAll": "\u5168\u9009",
  "group.members.clear": "\u6E05\u7A7A",
  "group.members.count": "\u5DF2\u9009 {n} / {m}",
  "group.members.none": "\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002",
  "group.members.noMatch": "\u6CA1\u6709\u5339\u914D\u7684\u5DE5\u4F5C\u533A\u3002",
  "group.chip.aria": "\u53EA\u770B\u5206\u7EC4\u201C{name}\u201D",
  "activity.running": "{n} \u4E2A\u4F1A\u8BDD\u8FD0\u884C\u4E2D",
  "activity.waiting": "{n} \u4E2A\u4F1A\u8BDD\u7B49\u5F85\u4EA4\u4E92",
  "activity.unread": "{n} \u4E2A\u4F1A\u8BDD\u672A\u8BFB",
  "select.enter": "\u6279\u91CF\u9009\u62E9",
  "select.exit": "\u9000\u51FA\u9009\u62E9",
  "select.row.aria": "\u9009\u4E2D\u4F1A\u8BDD\u201C{name}\u201D",
  "select.count": "\u5DF2\u9009 {n} \u9879",
  "select.none": "\u672A\u9009\u4EFB\u4F55\u4F1A\u8BDD",
  "select.moveToRecycleBin": "\u79FB\u5165\u56DE\u6536\u7AD9",
  "select.archivePermanent": "\u5F52\u6863",
  "select.group.none": "\u5168\u9009\u201C{name}\u201D\u91CC\u7684\u4F1A\u8BDD",
  "select.group.some": "\u5168\u9009\u201C{name}\u201D\u91CC\u8FD8\u6CA1\u9009\u4E2D\u7684\u4F1A\u8BDD",
  "select.group.all": "\u53D6\u6D88\u5168\u9009\u201C{name}\u201D",
  "select.group.pinned": "\u7EC4\u5185\u6709 {n} \u4E2A\u7F6E\u9876\u4F1A\u8BDD\u4E0D\u80FD\u88AB\u52FE\u9009\uFF0C\u6240\u4EE5\u8FD9\u4E00\u7EC4\u9009\u4E0D\u6EE1",
  "recycle.open": "\u56DE\u6536\u7AD9",
  "recycle.title": "\u56DE\u6536\u7AD9",
  "recycle.close": "\u5173\u95ED\u56DE\u6536\u7AD9",
  "recycle.back": "\u8FD4\u56DE",
  "recycle.emptyAll": "\u6E05\u7A7A\u56DE\u6536\u7AD9",
  "recycle.restoreAll": "\u6062\u590D\u5168\u90E8",
  "recycle.handle": "\u4E0A\u62C9\u8C03\u6574\u9AD8\u5EA6\uFF0C\u70B9\u4E00\u4E0B\u6536\u8D77",
  "recycle.empty": "\u56DE\u6536\u7AD9\u662F\u7A7A\u7684\u3002\u79FB\u5165\u56DE\u6536\u7AD9\u7684\u4F1A\u8BDD\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
  "recycle.restore": "\u8FD8\u539F",
  "recycle.failed": "\u8FD8\u539F\u5931\u8D25\uFF1A{message}",
  "recycle.restoreFailed": "{n} \u4E2A\u4F1A\u8BDD\u8FD8\u539F\u5931\u8D25",
  "recycle.restore.aria": "\u8FD8\u539F\u4F1A\u8BDD\u201C{name}\u201D",
  "recycle.archive.aria": "\u6C38\u4E45\u5F52\u6863\u4F1A\u8BDD\u201C{name}\u201D",
  "recycle.moved": "\u5DF2\u79FB\u5165\u56DE\u6536\u7AD9\uFF08{n} \u4E2A\u4F1A\u8BDD\uFF09",
  "recycle.moveFailed": "{n} \u4E2A\u4F1A\u8BDD\u6CA1\u80FD\u79FB\u5165\u56DE\u6536\u7AD9",
  "recycle.restored": "\u5DF2\u8FD8\u539F {n} \u4E2A\u4F1A\u8BDD",
  "menu.moveToRecycleBin": "\u79FB\u5165\u56DE\u6536\u7AD9",
  "menu.archiveForever": "\u6C38\u4E45\u5F52\u6863",
  "menu.recycle.blocked.pinned": "\u7F6E\u9876\u7684\u4F1A\u8BDD\u4E0D\u80FD\u79FB\u5165\u56DE\u6536\u7AD9\uFF0C\u8BF7\u5148\u53D6\u6D88\u7F6E\u9876",
  "menu.archive.blocked.pinned": "\u7F6E\u9876\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863\uFF0C\u8BF7\u5148\u53D6\u6D88\u7F6E\u9876",
  "menu.archive.blocked.pending": "\u6709\u5F85\u5904\u7406\u4E8B\u9879\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
  "menu.archive.blocked.running": "\u8FD0\u884C\u4E2D\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
  "menu.archive.blocked.descendantRunning": "\u6709\u5B50\u4EE3\u7406\u5728\u8FD0\u884C\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
  "menu.archive.blocked.unread": "\u672A\u8BFB\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
  "archive.title.one": "\u5F52\u6863\u8FD9\u4E2A\u4F1A\u8BDD\uFF1F",
  "archive.title.many": "\u5F52\u6863 {n} \u4E2A\u4F1A\u8BDD\uFF1F",
  "archive.title.empty": "\u6E05\u7A7A\u56DE\u6536\u7AD9\uFF08{n} \u4E2A\u4F1A\u8BDD\uFF09\uFF1F",
  "archive.desc": "\u5F52\u6863 = \u5220\u9664\uFF1A\u8FD9\u4E9B\u4F1A\u8BDD\u4F1A\u4ECE\u5217\u8868\u91CC\u6D88\u5931\uFF0C\u4E0D\u80FD\u5728\u8FD9\u91CC\u6062\u590D\uFF08\u4F1A\u8BDD\u8BB0\u5F55\u4ECD\u7559\u5728 dsh \u4E0A\uFF09\u3002",
  "archive.skipped": "\u53E6\u6709 {n} \u4E2A\u4F1A\u8BDD\u4E0D\u7B26\u5408\u5F52\u6863\u6761\u4EF6\uFF0C\u5DF2\u8DF3\u8FC7\u3002",
  "archive.confirm": "\u5F52\u6863",
  "archive.pending": "\u6B63\u5728\u5F52\u6863\u2026",
  "archive.failed": "{n} \u4E2A\u4F1A\u8BDD\u5F52\u6863\u5931\u8D25",
  "archive.failed.reason": "\u5F52\u6863\u5931\u8D25\uFF1A{message}",
  "archive.done": "\u5DF2\u5F52\u6863 {n} \u4E2A\u4F1A\u8BDD",
  "empty.none": "\u6682\u65E0\u4F1A\u8BDD",
  "empty.noMatches": "\u65E0\u5339\u914D\u7ED3\u679C",
  "empty.loading": "\u52A0\u8F7D\u4E2D\u2026",
  "empty.noWorkspaces": "\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002\u7528\u4E0A\u65B9\u7684 \uFF0B \u6DFB\u52A0\u5DF2\u6709\u6587\u4EF6\u5939\uFF0C\u6216\u521B\u5EFA\u65B0\u5DE5\u4F5C\u533A\u3002",
  "empty.groupMembers": "\u8BE5\u5206\u7EC4\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002\u5148\u5728\u300C\u7BA1\u7406\u5206\u7EC4\u2026\u300D\u91CC\u7ED9\u5DE5\u4F5C\u533A\u6253\u6807\u3002",
  "empty.groupMembers.hint": "\u4E5F\u53EF\u4EE5\u5728\u4E0A\u65B9\u5206\u7EC4\u83DC\u5355\u91CC\u300C\u65B0\u5EFA\u5206\u7EC4\u2026\u300D\u3002",
  "search.sessions.aria": "\u641C\u7D22\u4F1A\u8BDD",
  "search.placeholder": "\u641C\u7D22\u4F1A\u8BDD\u2026",
  "search.clear": "\u6E05\u9664\u641C\u7D22",
  "search.results.aria": "\u641C\u7D22\u7ED3\u679C",
  "search.pending": "\u6B63\u5728\u641C\u7D22\u4F1A\u8BDD\u5386\u53F2\u2026",
  "search.unavailable": "\u5185\u5BB9\u641C\u7D22\u6682\u4E0D\u53EF\u7528\uFF0C\u4EC5\u663E\u793A\u540D\u79F0\u5339\u914D\u3002",
  "search.noMatches": "\u65E0\u5339\u914D\u4F1A\u8BDD",
  "search.hasMore": "\u4EC5\u663E\u793A\u524D {n} \u6761\u7ED3\u679C\uFF0C\u8BF7\u7F29\u5C0F\u641C\u7D22\u8303\u56F4\u3002",
  rename: "\u91CD\u547D\u540D",
  // #115 行内改名失败：行内这条路没有弹窗可写红字，失败要飘一行（与 fork.failed 同一口径）。
  "rename.failed": "\u91CD\u547D\u540D\u4F1A\u8BDD\u5931\u8D25\uFF1A{message}",
  "rename.workspace.title": "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A",
  "rename.session.title": "\u91CD\u547D\u540D\u4F1A\u8BDD",
  "field.workspaceName": "\u5DE5\u4F5C\u533A\u540D\u79F0",
  "field.sessionName": "\u4F1A\u8BDD\u540D\u79F0",
  "delete.workspace": "\u5220\u9664\u5DE5\u4F5C\u533A",
  "delete.desc": "\u5C06\u628A\u201C{name}\u201D\u4ECE\u5DE5\u4F5C\u533A\u5217\u8868\u4E2D\u79FB\u9664\u3002\u6587\u4EF6\u5939\u4E0E\u4F1A\u8BDD\u8BB0\u5F55\u4F1A\u4FDD\u7559\uFF0C\u5176\u4F1A\u8BDD\u5C06\u663E\u793A\u5728\u201C\u672A\u5206\u7EC4\u201D\u4E0B\u3002",
  "delete.pending": "\u6B63\u5728\u5220\u9664\u5DE5\u4F5C\u533A\u2026",
  "conflict.named": "\u5DF2\u5B58\u5728\u540D\u4E3A\u201C{name}\u201D\u7684\u5DE5\u4F5C\u533A\u3002",
  "menu.fork": "\u5206\u53C9\u4F1A\u8BDD",
  "fork.failed": "\u5206\u53C9\u4F1A\u8BDD\u5931\u8D25\uFF1A{message}",
  "menu.openInNewTab": "\u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00",
  "openInNewTab.failed": "\u5728\u65B0\u6807\u7B7E\u9875\u6253\u5F00\u5931\u8D25\uFF1A{message}",
  "menu.archiveSession": "\u5F52\u6863\u4F1A\u8BDD",
  // #109 会话行菜单补齐（10 项，顺序按用户给的截图）
  "menu.sessionTitle": "\u4F1A\u8BDD: {name}",
  "menu.workspaceTitle": "\u5DE5\u4F5C\u533A: {name}",
  "menu.selectMultiple": "\u9009\u62E9\u591A\u4E2A",
  "menu.moveToGroup": "\u79FB\u5230\u5206\u7EC4\u2026",
  "menu.groups": "\u5206\u7EC4\u2026",
  "menu.copyReference": "\u590D\u5236\u5F15\u7528",
  "menu.copyFolderReference": "\u590D\u5236\u6587\u4EF6\u5939\u5F15\u7528",
  "menu.copyPath": "\u590D\u5236\u8DEF\u5F84",
  "menu.archiveWorkspace": "\u5F52\u6863\u8BE5\u5DE5\u4F5C\u533A\u5168\u90E8\u4F1A\u8BDD",
  "menu.archiveUngrouped": "\u5F52\u6863\u5168\u90E8\u672A\u5206\u7EC4\u4F1A\u8BDD",
  "menu.openFolderInNewWindow": "\u5728\u65B0\u7A97\u53E3\u6253\u5F00\u6587\u4EF6\u5939",
  "menu.renameWorkspace": "\u91CD\u547D\u540D\u5DE5\u4F5C\u533A",
  "menu.removeWorkspace": "\u4ECE\u5217\u8868\u79FB\u9664",
  "menu.newSession": "\u65B0\u5EFA\u4F1A\u8BDD",
  "menu.archiveBlocked": "\u8FD9\u4E2A\u5DE5\u4F5C\u533A\u91CC\u6CA1\u6709\u53EF\u5F52\u6863\u7684\u4F1A\u8BDD",
  "menu.forkBlocked": "\u7A7A\u767D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5B8C\u6210\u8FC7\u4E00\u8F6E\uFF0C\u4E0D\u80FD\u5206\u53C9",
  "actions.workspace.terminal": "\u5728\u201C{name}\u201D\u4E2D\u6253\u5F00\u7EC8\u7AEF",
  "actions.workspace.open": "\u5728 VS Code \u4E2D\u6253\u5F00\u201C{name}\u201D",
  "actions.workspace.remove": "\u628A\u201C{name}\u201D\u4ECE\u5217\u8868\u79FB\u9664",
  "badge.current": "\u5F53\u524D\u5DE5\u4F5C\u533A",
  "copied.sessionRef": "\u5DF2\u590D\u5236\u4F1A\u8BDD\u5F15\u7528",
  "copied.folderRef": "\u5DF2\u590D\u5236\u6587\u4EF6\u5939\u5F15\u7528",
  "copied.path": "\u5DF2\u590D\u5236\u8DEF\u5F84",
  "copy.failed": "\u590D\u5236\u5931\u8D25",
  // #145：会话被另一个 dsh 进程占着写句柄（官方单写者约束），这里用不了。
  "session.ownedElsewhere": "\u8BE5\u4F1A\u8BDD\u6B63\u88AB\u53E6\u4E00\u4E2A dsh \u5360\u7528\uFF0C\u8FD9\u91CC\u6682\u65F6\u4E0D\u80FD\u6253\u5F00\uFF1A\u5148\u5728\u90A3\u8FB9\u5173\u6389\u5B83\u518D\u56DE\u6765",
  "menu.pin": "\u7F6E\u9876",
  "menu.unpin": "\u53D6\u6D88\u7F6E\u9876",
  "menu.markUnread": "\u6807\u4E3A\u672A\u8BFB",
  "menu.markRead": "\u6807\u4E3A\u5DF2\u8BFB",
  "menu.unreadBlocked": "\u8FD0\u884C\u4E2D\u7684\u4F1A\u8BDD\u4E0D\u652F\u6301\u624B\u52A8\u6807\u4E3A\u5DF2\u8BFB/\u672A\u8BFB",
  // ---- #107 会话标签组 ----
  "tag.pill.aria": "\u6807\u7B7E\u7EC4\u201C{name}\u201D",
  "tag.expand": "\u5C55\u5F00\u6807\u7B7E\u7EC4\u201C{name}\u201D",
  "tag.collapse": "\u6298\u53E0\u6807\u7B7E\u7EC4\u201C{name}\u201D",
  "tag.count.pending": "{n} \u4E2A\u4F1A\u8BDD\u7B49\u5F85\u4EA4\u4E92",
  "tag.count.running": "{n} \u4E2A\u4F1A\u8BDD\u8FD0\u884C\u4E2D",
  "tag.count.unread": "{n} \u4E2A\u4F1A\u8BDD\u672A\u8BFB",
  "tag.menu.title": "\u6807\u7B7E\u7EC4\uFF1A{name}",
  "tag.newSession": "\u5728\u6B64\u6807\u7B7E\u7EC4\u4E2D\u65B0\u5EFA\u4F1A\u8BDD",
  "tag.archive": "\u5F52\u6863\u6574\u7EC4\uFF08{n} \u4E2A\u4F1A\u8BDD\uFF09",
  "tag.archive.none": "\u7EC4\u5185\u6CA1\u6709\u53EF\u5F52\u6863\u7684\u4F1A\u8BDD",
  "tag.recycle": "\u6574\u7EC4\u79FB\u5165\u56DE\u6536\u7AD9\uFF08{n} \u4E2A\u4F1A\u8BDD\uFF09",
  "tag.recycle.blocked": "\u7EC4\u5185\u4F1A\u8BDD\u90FD\u7F6E\u9876\u4E86\uFF0C\u4E0D\u80FD\u79FB\u5165\u56DE\u6536\u7AD9",
  "tag.ungroup": "\u79FB\u51FA\u6807\u7B7E\u7EC4",
  "tag.rename": "\u91CD\u547D\u540D\u6807\u7B7E\u7EC4",
  "tag.rename.title": "\u91CD\u547D\u540D\u6807\u7B7E\u7EC4",
  "tag.color": "\u989C\u8272",
  "tag.delete": "\u5220\u9664\u6807\u7B7E\u7EC4",
  "tag.delete.desc": "\u5C06\u5220\u9664\u6807\u7B7E\u7EC4\u201C{name}\u201D\u3002\u4F1A\u8BDD\u4E00\u6761\u90FD\u4E0D\u4F1A\u5220\uFF0C\u53EA\u662F\u4E0D\u518D\u5F52\u5165\u8BE5\u7EC4\u3002",
  "tag.new": "\u65B0\u5EFA\u6807\u7B7E\u7EC4",
  "tag.name.label": "\u6807\u7B7E\u7EC4\u540D\u79F0",
  "tag.name.empty": "\u6807\u7B7E\u7EC4\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A\u3002",
  "tag.name.duplicate": "\u5DF2\u5B58\u5728\u540C\u540D\u6807\u7B7E\u7EC4\u3002",
  "tag.membership": "\u6807\u7B7E\u7EC4",
  "tag.none": "\u4E0D\u5F52\u5165\u6807\u7B7E\u7EC4",
  "tag.color.yellow": "\u9EC4\u8272",
  "tag.color.blue": "\u84DD\u8272",
  "tag.color.green": "\u7EFF\u8272",
  "tag.color.orange": "\u6A59\u8272",
  "tag.color.purple": "\u7D2B\u8272",
  "tag.color.red": "\u7EA2\u8272",
  "tag.moved": "\u5DF2\u79FB\u5165\u6807\u7B7E\u7EC4\u201C{name}\u201D",
  "tag.created": "\u5DF2\u65B0\u5EFA\u6807\u7B7E\u7EC4\u201C{name}\u201D",
  "actions.tag.aria": "\u6807\u7B7E\u7EC4\u201C{name}\u201D\u7684\u64CD\u4F5C",
  "protect.recycle.pinned": "\u7F6E\u9876\u4F1A\u8BDD\u4E0D\u80FD\u79FB\u5165\u56DE\u6536\u7AD9\u6216\u5F52\u6863\uFF0C\u5148\u53D6\u6D88\u7F6E\u9876",
  "protect.archive.pinned": "\u7F6E\u9876\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863\uFF0C\u5148\u53D6\u6D88\u7F6E\u9876",
  "protect.archive.pending": "\u5F85\u5904\u7406\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
  "protect.archive.running": "\u8FD0\u884C\u4E2D\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
  "protect.archive.unread": "\u672A\u8BFB\u7684\u4F1A\u8BDD\u4E0D\u80FD\u5F52\u6863",
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
  "status.unread": "\u672A\u8BFB",
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
  "group.name.empty": "Group name cannot be empty",
  "group.name.duplicate": "A group with this name already exists",
  "group.membership": "Groups",
  // #155 drag handle of a group row in the manage dialog (same string as the old sidebar).
  "group.drag": "Drag to reorder",
  // #139 member list (second level of the manage-groups dialog).
  "group.members.open": "Edit members of \u201C{name}\u201D",
  "group.members.back": "Back to the group list",
  "group.members.search": "Search workspaces",
  "group.members.selectAll": "Select all",
  "group.members.clear": "Clear",
  "group.members.count": "Selected {n} / {m}",
  "group.members.none": "No workspaces yet.",
  "group.members.noMatch": "No workspace matches.",
  "group.chip.aria": "Show only the group \u201C{name}\u201D",
  "activity.running": "{n} running",
  "activity.waiting": "{n} waiting for you",
  "activity.unread": "{n} unread",
  "select.enter": "Select sessions",
  "select.exit": "Exit selection",
  "select.row.aria": "Select session \u201C{name}\u201D",
  "select.count": "{n} selected",
  "select.none": "No sessions selected",
  "select.moveToRecycleBin": "Move to recycle bin",
  "select.archivePermanent": "Archive",
  "select.group.none": "Select all sessions in \u201C{name}\u201D",
  "select.group.some": "Select the remaining sessions in \u201C{name}\u201D",
  "select.group.all": "Clear the selection in \u201C{name}\u201D",
  "select.group.pinned": "{n} pinned session(s) here cannot be selected, so this group cannot be fully selected",
  "recycle.open": "Recycle bin",
  "recycle.title": "Recycle bin",
  "recycle.close": "Close the recycle bin",
  "recycle.back": "Back",
  "recycle.emptyAll": "Empty the recycle bin",
  "recycle.restoreAll": "Restore all",
  "recycle.handle": "Drag up to resize, click to collapse",
  "recycle.empty": "The recycle bin is empty. Sessions you move here show up here.",
  "recycle.restore": "Restore",
  "recycle.failed": "Restore failed: {message}",
  "recycle.restoreFailed": "{n} sessions could not be restored",
  "recycle.restore.aria": "Restore session \u201C{name}\u201D",
  "recycle.archive.aria": "Archive session \u201C{name}\u201D permanently",
  "recycle.moved": "Moved to the recycle bin ({n} sessions)",
  "recycle.moveFailed": "{n} sessions could not be moved to the recycle bin",
  "recycle.restored": "Restored {n} sessions",
  "menu.moveToRecycleBin": "Move to recycle bin",
  "menu.archiveForever": "Archive permanently",
  "menu.recycle.blocked.pinned": "Pinned sessions cannot be moved to the recycle bin; unpin them first",
  "menu.archive.blocked.pinned": "Pinned sessions cannot be archived; unpin them first",
  "menu.archive.blocked.pending": "Sessions with pending items cannot be archived",
  "menu.archive.blocked.running": "Running sessions cannot be archived",
  "menu.archive.blocked.descendantRunning": "Sessions with a running subagent cannot be archived",
  "menu.archive.blocked.unread": "Unread sessions cannot be archived",
  "archive.title.one": "Archive this session?",
  "archive.title.many": "Archive {n} sessions?",
  "archive.title.empty": "Empty the recycle bin ({n} sessions)?",
  "archive.desc": "Archiving deletes: these sessions disappear from the list and cannot be restored here (the session records stay on dsh).",
  "archive.skipped": "{n} selected sessions cannot be archived and were skipped.",
  "archive.confirm": "Archive",
  "archive.pending": "Archiving\u2026",
  "archive.failed": "{n} sessions could not be archived",
  "archive.failed.reason": "Archive failed: {message}",
  "archive.done": "Archived {n} sessions",
  "empty.none": "No sessions yet",
  "empty.noMatches": "No matches",
  "empty.loading": "Loading\u2026",
  "empty.noWorkspaces": "No workspaces yet. Add an existing folder or create a new workspace with the + button above.",
  "empty.groupMembers": 'This group has no workspaces yet. Tag workspaces in "Manage groups\u2026" first.',
  "empty.groupMembers.hint": "You can also create a new group from the group menu above.",
  "search.sessions.aria": "Search sessions",
  "search.placeholder": "Search sessions...",
  "search.clear": "Clear search",
  "search.results.aria": "Search results",
  "search.pending": "Searching session history\u2026",
  "search.unavailable": "Content search is temporarily unavailable. Showing name matches.",
  "search.noMatches": "No matching sessions",
  "search.hasMore": "Showing the first {n} results. Narrow your search.",
  rename: "Rename",
  "rename.failed": "Could not rename the session: {message}",
  "rename.workspace.title": "Rename workspace",
  "rename.session.title": "Rename session",
  "field.workspaceName": "Workspace name",
  "field.sessionName": "Session name",
  "delete.workspace": "Delete workspace",
  "delete.desc": "This removes \u201C{name}\u201D from the workspace list. The folder and session logs will be kept. Its sessions will appear under Ungrouped.",
  "delete.pending": "Deleting workspace\u2026",
  "conflict.named": "A workspace named \u201C{name}\u201D already exists.",
  "menu.fork": "Fork session",
  "fork.failed": "Could not fork the session: {message}",
  "menu.openInNewTab": "Open in New Tab",
  "openInNewTab.failed": "Could not open the session in a new tab: {message}",
  "menu.archiveSession": "Archive session",
  "menu.sessionTitle": "Session: {name}",
  "menu.workspaceTitle": "Workspace: {name}",
  "menu.selectMultiple": "Select multiple",
  "menu.moveToGroup": "Move to group\u2026",
  "menu.groups": "Groups\u2026",
  "menu.copyReference": "Copy reference",
  "menu.copyFolderReference": "Copy folder reference",
  "menu.copyPath": "Copy path",
  "menu.archiveWorkspace": "Archive all sessions in this workspace",
  "menu.archiveUngrouped": "Archive all ungrouped sessions",
  "menu.openFolderInNewWindow": "Open folder in a new window",
  "menu.renameWorkspace": "Rename workspace",
  "menu.removeWorkspace": "Remove from list",
  "menu.newSession": "New session",
  "menu.archiveBlocked": "No archivable sessions in this workspace",
  "menu.forkBlocked": "A blank session has no completed turn; cannot fork",
  "actions.workspace.terminal": "Open a terminal in \u201C{name}\u201D",
  "actions.workspace.open": "Open \u201C{name}\u201D in VS Code",
  "actions.workspace.remove": "Remove \u201C{name}\u201D from the list",
  "badge.current": "Current workspace",
  "copied.sessionRef": "Session reference copied",
  "copied.folderRef": "Folder reference copied",
  "copied.path": "Path copied",
  "copy.failed": "Copy failed",
  // #145：会话被另一个 dsh 进程占着写句柄（官方单写者约束），这里用不了。
  "session.ownedElsewhere": "Another dsh has this session open, so it cannot be opened here: close it there first",
  "menu.pin": "Pin",
  "menu.unpin": "Unpin",
  "menu.markUnread": "Mark as unread",
  "menu.markRead": "Mark as read",
  "menu.unreadBlocked": "Running sessions cannot be marked read/unread manually",
  // ---- #107 tag groups ----
  "tag.pill.aria": "Tag group \u201C{name}\u201D",
  "tag.expand": "Expand the tag group \u201C{name}\u201D",
  "tag.collapse": "Collapse the tag group \u201C{name}\u201D",
  "tag.count.pending": "{n} sessions waiting for you",
  "tag.count.running": "{n} sessions running",
  "tag.count.unread": "{n} sessions unread",
  "tag.menu.title": "Tag group: {name}",
  "tag.newSession": "New session in this group",
  "tag.archive": "Archive the group ({n} sessions)",
  "tag.archive.none": "No archivable sessions in this group",
  "tag.recycle": "Move the group to the recycle bin ({n} sessions)",
  "tag.recycle.blocked": "Every session in this group is pinned; unpin them first",
  "tag.ungroup": "Remove from the tag group",
  "tag.rename": "Rename group",
  "tag.rename.title": "Rename the tag group",
  "tag.color": "Color",
  "tag.delete": "Delete group",
  "tag.delete.desc": "This deletes the tag group \u201C{name}\u201D. No session is deleted; they just leave this group.",
  "tag.new": "New group",
  "tag.name.label": "Tag group name",
  "tag.name.empty": "The tag group name must not be empty.",
  "tag.name.duplicate": "A tag group with that name already exists.",
  "tag.membership": "Tag group",
  "tag.none": "No tag group",
  "tag.color.yellow": "Yellow",
  "tag.color.blue": "Blue",
  "tag.color.green": "Green",
  "tag.color.orange": "Orange",
  "tag.color.purple": "Purple",
  "tag.color.red": "Red",
  "tag.moved": "Moved to the tag group \u201C{name}\u201D",
  "tag.created": "Created the tag group \u201C{name}\u201D",
  "actions.tag.aria": "Tag group actions for {name}",
  "protect.recycle.pinned": "Pinned sessions cannot be moved to the recycle bin or archived; unpin them first",
  "protect.archive.pinned": "Pinned sessions cannot be archived; unpin them first",
  "protect.archive.pending": "Sessions with pending items cannot be archived",
  "protect.archive.running": "Running sessions cannot be archived",
  "protect.archive.unread": "Unread sessions cannot be archived",
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
  "status.unread": "Unread",
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

// src/ui/assembly/shell/workspaceTree/recycleBinStore.ts
var import_react = require("react");

// src/pure/sessionEligibility.ts
function sessionBusy(facts) {
  return facts.running || (facts.runningSubagentCount ?? 0) > 0;
}
function canRecycle(facts) {
  return cannotRecycleReason(facts) === null;
}
function canArchive(facts) {
  return cannotArchiveReason(facts) === null;
}
function cannotRecycleReason(facts) {
  return facts.pinned ? "pinned" : null;
}
function cannotArchiveReason(facts) {
  if (facts.pinned) return "pinned";
  if (facts.pendingInteraction !== void 0) return "pending";
  if (sessionBusy(facts)) return "running";
  if (facts.unread) return "unread";
  return null;
}
function groupSelectionState(members, isSelectable, isSelected) {
  const selectable = members.filter((member) => isSelectable(member));
  if (selectable.length === 0) return "none";
  const selected = selectable.filter((member) => isSelected(member)).length;
  if (selected === 0) return "none";
  if (selected === selectable.length && selectable.length === members.length) return "all";
  return "some";
}
function groupSelectionToggle(members, isSelectable, isSelected, idOf) {
  const selectable = members.filter((member) => isSelectable(member));
  const ids = selectable.map((member) => idOf(member));
  const allSelectableSelected = selectable.length > 0 && selectable.every((member) => isSelected(member));
  return { select: !allSelectableSelected, ids };
}

// src/pure/recycleActions.ts
var NOTHING = { done: [], failed: [] };
async function moveSessionsToRecycleBin(sessionIds, sink2) {
  const current = await sink2.load();
  const next = moveIntoRecycleBin(current, sessionIds);
  if (next === null) return NOTHING;
  const before = new Set(current.sessionIds);
  const done = next.sessionIds.filter((id) => !before.has(id));
  try {
    await sink2.commit(next);
  } catch {
    return { done: [], failed: done };
  }
  return { done, failed: [] };
}
async function restoreSessionsFromRecycleBin(sessionIds, sink2) {
  const current = await sink2.load();
  const next = restoreFromRecycleBin(current, sessionIds);
  if (next === null) return NOTHING;
  const remaining = new Set(next.sessionIds);
  const done = current.sessionIds.filter((id) => !remaining.has(id));
  try {
    await sink2.commit(next);
  } catch {
    return { done: [], failed: done };
  }
  return { done, failed: [] };
}
async function archiveSessionsPermanently(sessionIds, sink2) {
  const done = [];
  const failed = [];
  for (const sessionId of sessionIds) {
    try {
      await sink2.archiveSession(sessionId);
      done.push(sessionId);
    } catch {
      failed.push(sessionId);
    }
  }
  if (done.length > 0) {
    const current = await sink2.load();
    const next = restoreFromRecycleBin(current, done);
    if (next !== null) {
      try {
        await sink2.commit(next);
      } catch {
      }
    }
  }
  return { done, failed };
}
function partitionArchivable(sessions) {
  const ready = [];
  const skipped = [];
  for (const session of sessions) (canArchive(session) ? ready : skipped).push(session);
  return { ready, skipped };
}
async function emptyRecycleBin2(sink2) {
  const current = await sink2.load();
  if (current.sessionIds.length === 0) return NOTHING;
  return await archiveSessionsPermanently(current.sessionIds, sink2);
}

// src/ui/assembly/shell/workspaceTree/recycleBinStore.ts
var RECYCLE_BIN_STATE_KEY = "recycle-bin";
var port = null;
var snapshot = { ids: [], ready: false, error: null };
var listeners = /* @__PURE__ */ new Set();
var loading = null;
function publish(next) {
  snapshot = next;
  for (const listener of [...listeners]) listener();
}
function configureRecycleBin(io) {
  port = {
    read: () => io.capabilities.stateRead(RECYCLE_BIN_STATE_KEY),
    write: (file) => io.capabilities.stateWrite(RECYCLE_BIN_STATE_KEY, serializeRecycleBin(file)),
    archive: io.archiveSession
  };
  loading = null;
}
function requirePort() {
  if (port === null) throw new Error("recycle bin is not wired to this shell");
  return port;
}
function ensureRecycleBinLoaded() {
  if (loading !== null) return loading;
  const io = port;
  if (io === null) return Promise.resolve();
  loading = (async () => {
    try {
      const file = parseRecycleBin(await io.read()) ?? emptyRecycleBin();
      publish({ ids: file.sessionIds, ready: true, error: null });
    } catch (reason) {
      publish({ ids: [], ready: true, error: reason instanceof Error ? reason.message : String(reason) });
    }
  })();
  return loading;
}
function subscribeRecycleBin(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function useRecycleBin() {
  const [state, setState] = (0, import_react.useState)(snapshot);
  (0, import_react.useEffect)(() => {
    setState(snapshot);
    const unsubscribe = subscribeRecycleBin(() => setState(snapshot));
    void ensureRecycleBinLoaded();
    return unsubscribe;
  }, []);
  return state;
}
var sink = {
  load: async () => {
    await ensureRecycleBinLoaded();
    if (snapshot.error !== null) throw new Error(snapshot.error);
    return { version: 1, sessionIds: [...snapshot.ids] };
  },
  commit: async (file) => {
    const io = requirePort();
    await io.write(file);
    publish({ ids: file.sessionIds, ready: true, error: null });
  },
  archiveSession: async (sessionId) => {
    await requirePort().archive(sessionId);
  }
};
async function pruneRecycleBin(knownSessionIds, baselineReady) {
  await ensureRecycleBinLoaded();
  if (snapshot.error !== null) return;
  const next = pruneRecycleIds(snapshot.ids, knownSessionIds, baselineReady);
  if (next === null) return;
  try {
    await sink.commit({ version: 1, sessionIds: next });
  } catch {
    publish({ ids: next, ready: true, error: null });
  }
}
var recycleBinActions = {
  /** 移入回收站：只写本地集合（不动 dsh）。 */
  move: (sessionIds) => moveSessionsToRecycleBin(sessionIds, sink),
  /** 还原：只写本地集合。 */
  restore: (sessionIds) => restoreSessionsFromRecycleBin(sessionIds, sink),
  /** 永久归档：逐个走官方归档（终点动作），成功项同时划出本地集合。 */
  archive: (sessionIds) => archiveSessionsPermanently(sessionIds, sink),
  /** 清空回收站 = 把里面每一条都永久归档。 */
  empty: () => emptyRecycleBin2(sink)
};

// src/ui/assembly/shell/workspaceTree/recycleEntry.ts
var import_react3 = require("react");
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
function workspacePathKey(value) {
  const slashed = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:\/|^\/\//.test(slashed) ? slashed.toLowerCase() : slashed;
}
function sameWorkspacePath(a, b) {
  return workspacePathKey(a) === workspacePathKey(b);
}
function sessionVisible(session, current, archived, recycled) {
  return session.origin !== "subagent" && !archived.has(session.id) && !(recycled?.has(session.id) ?? false) && (!session.blank || session.id === current);
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
  const recycled = view.recycled ?? EMPTY_IDS;
  const expanded = new Set(view.expandedGroups);
  const descendants = indexSubagentDescendants(list.byId);
  const currentFolders = (view.currentFolders ?? []).filter((folder) => folder !== "");
  const isCurrentFolder = (path) => path !== "" && currentFolders.some((folder) => sameWorkspacePath(path, folder));
  const groups = [];
  const accounted = /* @__PURE__ */ new Set();
  for (const workspace of workspaces) {
    const members = [];
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === void 0) continue;
      accounted.add(id);
      if (!sessionVisible(summary, list.current, archived, recycled)) continue;
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
      containsCurrent: isCurrentFolder(workspace.path),
      sessions: expanded.has(workspace.workspaceId) ? members.map((m) => sessionNode(m, descendants, pending)) : []
    });
  }
  const stray = list.ids.map((id) => list.byId[id]).filter(
    (s) => s !== void 0 && !accounted.has(s.id) && sessionVisible(s, list.current, archived, recycled)
  );
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
      // 未分组桶恒不是当前工作区：它没有工作区身份，也就没有可比的 `path`
      //（#112 之前这里跟着当前会话走，于是「当前会话是散会话」时整桶披上徽标）。
      containsCurrent: false,
      sessions: expanded.has(UNGROUPED_KEY) ? ordered.flatMap((id) => {
        const summary = list.byId[id];
        return summary === void 0 ? [] : [sessionNode(summary, descendants, pending)];
      }) : []
    });
  }
  return groups;
}
function currentWorkspaceFirst(groups) {
  const isCurrent = (group) => group.containsCurrent && group.workspaceId !== void 0;
  const current = groups.filter(isCurrent);
  if (current.length === 0) return [...groups];
  return [...current, ...groups.filter((group) => !isCurrent(group))];
}
function deriveFlat(list, archivedSessionIds, pending, recycled) {
  const archived = new Set(archivedSessionIds);
  const descendants = indexSubagentDescendants(list.byId);
  const visible = list.ids.map((id) => list.byId[id]).filter(
    (s) => s !== void 0 && sessionVisible(s, list.current, archived, recycled ?? EMPTY_IDS)
  );
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
  if (node.unread === true) return [{ state: "done", labelKey: "status.unread" }];
  return [{ state: "done", labelKey: "status.idle" }];
}
function showsStatusDot(statuses, completed) {
  return statuses[0]?.state !== "done" || completed;
}
function workspaceActivityCounts(list, workspaces, archivedSessionIds, pending, recycled = EMPTY_IDS, unread = EMPTY_IDS) {
  const archived = new Set(archivedSessionIds);
  const counts = /* @__PURE__ */ new Map();
  const bump = (key, running, waiting, isUnread) => {
    if (!running && !waiting && !isUnread) return;
    const current = counts.get(key) ?? { running: 0, waiting: 0, unread: 0 };
    if (waiting) current.waiting += 1;
    else if (running) current.running += 1;
    else current.unread += 1;
    counts.set(key, current);
  };
  const accounted = /* @__PURE__ */ new Set();
  for (const workspace of workspaces) {
    for (const id of workspace.sessionIds) {
      const summary = list.byId[id];
      if (summary === void 0) continue;
      accounted.add(id);
      if (!sessionVisible(summary, list.current, archived, recycled)) continue;
      const waiting = visiblePendingKind(pending.get(id)?.kind) !== void 0;
      bump(workspace.workspaceId, summary.running, waiting, unread.has(id));
    }
  }
  for (const id of list.ids) {
    const summary = list.byId[id];
    if (summary === void 0 || accounted.has(id)) continue;
    if (!sessionVisible(summary, list.current, archived, recycled)) continue;
    const waiting = visiblePendingKind(pending.get(id)?.kind) !== void 0;
    bump(UNGROUPED_KEY, summary.running, waiting, unread.has(id));
  }
  return counts;
}
function groupSessionNodes(list, workspaces, sessionIds) {
  const descendants = indexSubagentDescendants(list.byId);
  const byKey = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const id of sessionIds) {
    if (seen.has(id)) continue;
    const summary = list.byId[id];
    if (summary === void 0 || summary.origin === "subagent") continue;
    seen.add(id);
    const key = owningGroupKey(workspaces, id);
    const bucket = byKey.get(key);
    if (bucket === void 0) byKey.set(key, [summary]);
    else bucket.push(summary);
  }
  const blocks = [];
  for (const workspace of workspaces) {
    const members = byKey.get(workspace.workspaceId);
    if (members === void 0 || members.length === 0) continue;
    blocks.push({
      key: workspace.workspaceId,
      workspaceId: workspace.workspaceId,
      label: workspace.title,
      sessions: members.map((member) => sessionNode(member, descendants, EMPTY_PENDING))
    });
  }
  const stray = byKey.get(UNGROUPED_KEY);
  if (stray !== void 0 && stray.length > 0) {
    blocks.push({
      key: UNGROUPED_KEY,
      label: "",
      sessions: stray.map((member) => sessionNode(member, descendants, EMPTY_PENDING))
    });
  }
  return blocks;
}
function visibleRecycleIds(recycleIds, list, archivedSessionIds) {
  const archived = new Set(archivedSessionIds);
  return recycleIds.filter((id) => {
    const summary = list.byId[id];
    return summary !== void 0 && summary.origin !== "subagent" && !archived.has(id);
  });
}
function deriveRecycleGroups(list, workspaces, recycleIds) {
  return groupSessionNodes(list, workspaces, [...recycleIds].reverse());
}
function recycleCount(groups) {
  return groups.reduce((total, group) => total + group.sessions.length, 0);
}
var EMPTY_PENDING = /* @__PURE__ */ new Map();
var EMPTY_IDS = /* @__PURE__ */ new Set();

// src/ui/assembly/shell/workspaceTree/recycleDrawerStore.ts
var import_react2 = require("react");
var open = false;
var listeners2 = /* @__PURE__ */ new Set();
function publish2(next) {
  if (next === open) return;
  open = next;
  for (const listener of [...listeners2]) listener();
}
function setRecycleDrawerOpen(next) {
  publish2(next);
}
function subscribeRecycleDrawer(listener) {
  listeners2.add(listener);
  return () => {
    listeners2.delete(listener);
  };
}
function useRecycleDrawerOpen() {
  const [state, setState] = (0, import_react2.useState)(open);
  (0, import_react2.useEffect)(() => {
    setState(open);
    return subscribeRecycleDrawer(() => setState(open));
  }, []);
  return state;
}

// src/ui/assembly/shell/workspaceTree/recycleEntry.ts
var listeners3 = /* @__PURE__ */ new Set();
var recycleEntrySignal = {
  /** 入口行发请求（开 / 关抽屉、清空、全部还原）。 */
  request(request) {
    for (const listener of [...listeners3]) listener(request);
  },
  /** 树主组件挂载时订阅（返回退订）。 */
  subscribe(listener) {
    listeners3.add(listener);
    return () => {
      listeners3.delete(listener);
    };
  }
};
function RecycleEntry({ wide = true, t, useSessions, useWorkspaces }) {
  const tr = t;
  const list = useSessions((state) => state);
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
  const bin = useRecycleBin();
  const total = visibleRecycleIds(bin.ids, list, archivedSessionIds).length;
  const drawerOpen = useRecycleDrawerOpen();
  const action = (kind) => {
    const label = kind === "empty" ? tr("recycle.emptyAll") : tr("recycle.restoreAll");
    return (0, import_react3.createElement)(import_dsh_client_ui_primitives.Tooltip, {
      label,
      side: "top",
      delayMs: 500,
      children: (0, import_react3.createElement)(
        "button",
        {
          type: "button",
          className: `dshOneTree_footerIconButton${kind === "empty" ? " dshOneTree_footerIconDanger" : ""}`,
          "aria-label": label,
          "data-dshone-tree-action": kind === "empty" ? "recycle-empty-all" : "recycle-restore-all",
          // 计数 0（回收站空着）：两枚动作都禁用——没有东西可清、也没有东西可还原。
          disabled: total === 0,
          onClick: () => recycleEntrySignal.request(kind === "empty" ? "empty" : "restoreAll")
        },
        kind === "empty" ? (0, import_react3.createElement)(import_dsh_client_ui_primitives.IconTrashOutline16, { size: 14 }) : (0, import_react3.createElement)(import_dsh_client_ui_primitives.IconRefreshOutline16, { size: 14 })
      )
    });
  };
  return (0, import_react3.createElement)(
    "div",
    {
      className: `dshOneTree_footerRow${total === 0 ? " dshOneTree_footerRowEmpty" : ""}`,
      "data-dshone-tree": "recycle-entry",
      "data-dshone-tree-recycle-count": total,
      "data-rail": wide ? void 0 : ""
    },
    (0, import_react3.createElement)(
      "button",
      {
        type: "button",
        className: "dshOneTree_footerMain",
        "aria-label": `${tr("recycle.open")} (${String(total)})`,
        // 官方 primitives 里没有「展开态」原语，用标准 ARIA 属性表达开关状态
        // （`aria-expanded` = 受控区域是否展开）；`data-*` 那两条是自有契约，给验证套件读。
        "aria-expanded": drawerOpen,
        "data-dshone-tree-action": "recycle-toggle",
        "data-dshone-tree-recycle-count": total,
        "data-dshone-tree-recycle-expanded": drawerOpen ? "true" : "false",
        onClick: () => recycleEntrySignal.request(drawerOpen ? "close" : "open")
      },
      // 图标位带上用的哪一枚官方图标（自有契约，与 `data-dshone-tree-action` 同一做法：
      // 官方组件渲染出来的 DOM 里没有图标名，验证套件要认「组件」只能靠这个标记，
      // 再配上渲染结果的几何/位图指纹一起核）。
      (0, import_react3.createElement)(
        "span",
        { className: "dshOneTree_footerIcon", "data-dshone-tree-icon": "IconTrashOutline16" },
        (0, import_react3.createElement)(import_dsh_client_ui_primitives.IconTrashOutline16, { size: 16 })
      ),
      (0, import_react3.createElement)("span", { className: "dshOneTree_footerLabel" }, tr("recycle.open")),
      (0, import_react3.createElement)("span", { className: "dshOneTree_footerCount" }, String(total))
    ),
    action("empty"),
    action("restoreAll")
  );
}

// src/ui/assembly/shell/workspaceTree/sessionOwnedNotice.ts
var listeners4 = /* @__PURE__ */ new Set();
function reportSessionOwnedElsewhere(sessionId) {
  for (const listener of [...listeners4]) listener(sessionId);
}
function onSessionOwnedElsewhere(listener) {
  listeners4.add(listener);
  return () => {
    listeners4.delete(listener);
  };
}

// src/ui/assembly/shell/workspaceTree/tree.ts
var import_react13 = require("react");
var import_dsh_client_ui_primitives10 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/pure/tokenScan.ts
var AT_BOUNDARY_CHARS = "\\s\uFF0C\u3002\uFF1B\uFF1A\uFF01\uFF1F\u3001,;!?\uFF08\u300C\u300E\u300A\u3014\u3010";
var BOUNDARY_RE = new RegExp(`[${AT_BOUNDARY_CHARS}]`, "u");

// src/pure/fileReference.ts
var QUOTED_AT_END = new RegExp(`(?:^|[${AT_BOUNDARY_CHARS}])(@"([^"]*))$`);
function formatFileMention(candidate, preserveQuote = false) {
  const path = candidate.kind === "directory" ? `${candidate.path}/` : candidate.path;
  if (/["\u0000-\u001f\u007f-\u009f"]/u.test(path)) return void 0;
  if (!(preserveQuote || /\s/.test(path))) return `@${path}`;
  if (candidate.kind === "directory") return `@"${path}`;
  return `@"${path}"`;
}

// src/pure/sessionMention.ts
var SESSION_REFERENCE_SCHEME = "dsh-session:";
function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function encodeSessionReferenceUri(sessionId) {
  return SESSION_REFERENCE_SCHEME + b64urlEncode(JSON.stringify(sessionId));
}
function escapeLabel(label) {
  return label.replace(/[\\\]]/g, (m) => `\\${m}`);
}
function formatSessionMention(label, sessionId) {
  return `@[${escapeLabel(label)}](${encodeSessionReferenceUri(sessionId)})`;
}

// src/pure/workspaceTreePrefs.ts
var TREE_VIEW_PREF_KEY = "dsh.workspaceTree.view";
function defaultTreeViewPrefs() {
  return {
    activeGroupId: null,
    groupExpansion: {},
    recycleCollapsed: [],
    tagCollapsed: []
  };
}
function parseGroupExpansion(record) {
  const value = record.groupExpansion;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry) => typeof entry[1] === "boolean"
      )
    );
  }
  if (!Array.isArray(record.expandedGroups)) return {};
  return Object.fromEntries(
    [...new Set(record.expandedGroups.filter((key) => typeof key === "string"))].map((key) => [key, true])
  );
}
function parseTreeViewPrefs(raw) {
  const defaults = defaultTreeViewPrefs();
  if (typeof raw !== "object" || raw === null) return defaults;
  const record = raw;
  const keyList = (value) => Array.isArray(value) ? [...new Set(value.filter((key) => typeof key === "string"))] : [];
  return {
    activeGroupId: typeof record.activeGroupId === "string" && record.activeGroupId !== "" ? record.activeGroupId : null,
    groupExpansion: parseGroupExpansion(record),
    recycleCollapsed: keyList(record.recycleCollapsed),
    tagCollapsed: keyList(record.tagCollapsed)
  };
}
function expandedGroupKeys(prefs) {
  return Object.entries(prefs.groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key);
}
function autoExpandGroup(prefs, key) {
  if (Object.hasOwn(prefs.groupExpansion, key)) return prefs;
  return { ...prefs, groupExpansion: { ...prefs.groupExpansion, [key]: true } };
}
function setGroupExpansion(prefs, entries) {
  return { ...prefs, groupExpansion: { ...prefs.groupExpansion, ...entries } };
}
function toggleGroupExpansion(prefs, key) {
  return setGroupExpansion(prefs, { [key]: prefs.groupExpansion[key] !== true });
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

// src/ui/assembly/shell/workspaceTree/flash.ts
var import_react4 = require("react");
var FLASH_MS = 2200;
var listeners5 = /* @__PURE__ */ new Set();
function flashTip(message, ms = FLASH_MS) {
  for (const listener of [...listeners5]) listener({ message, ms });
}
function FlashHost() {
  const [state, setState] = (0, import_react4.useState)(null);
  (0, import_react4.useEffect)(() => {
    let seq = 0;
    const listener = (notice) => {
      seq += 1;
      setState({ notice, seq });
    };
    listeners5.add(listener);
    return () => {
      listeners5.delete(listener);
    };
  }, []);
  (0, import_react4.useEffect)(() => {
    if (state === null) return;
    const timer = setTimeout(() => setState(null), state.notice.ms);
    return () => clearTimeout(timer);
  }, [state?.seq]);
  if (state === null) return null;
  return (0, import_react4.createElement)(
    "div",
    {
      className: "dshOneTree_flash",
      role: "status",
      "data-dshone-tree": "flash"
    },
    state.notice.message
  );
}

// src/ui/assembly/shell/workspaceTree/format.ts
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
function timeLabel(updatedAt, now, tr) {
  const { unit, n } = (0, import_dsh_client_ui_primitives2.relativeTime)(updatedAt, now);
  return unit === "now" ? tr("time.now") : tr(`time.${unit}`, { n });
}
function hoverTimeLabel(updatedAt, now, tr) {
  const { unit, n } = (0, import_dsh_client_ui_primitives2.relativeTime)(updatedAt, now);
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

// src/ui/assembly/shell/workspaceTree/groups.ts
var GROUP_MENU_PREFIX = "group:";
var TAG_MENU_PREFIX = "tag:";
var GROUP_DRAG_MIME = "text/dsh-group";
function newTagGroupId() {
  const uuid = typeof crypto === "object" && crypto !== null && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `t-${uuid}`;
}
function newGroupId() {
  const uuid = typeof crypto === "object" && crypto !== null && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `g-${uuid}`;
}

// src/ui/assembly/shell/workspaceTree/hoverCard.ts
var import_react5 = require("react");
var HOVER_CARD_WIDTH = 244;
var HOVER_CARD_GAP = 8;
function useHoverCardRoom(rootRef) {
  const [room, setRoom] = (0, import_react5.useState)(false);
  (0, import_react5.useEffect)(() => {
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
var import_react8 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/ui/assembly/shell/workspaceTree/selection.ts
var import_react6 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");
var listeners6 = /* @__PURE__ */ new Set();
var selectionEntrySignal = {
  /** 进入多选（任何入口都调这一个；调用即清空上一轮勾选）。 */
  enter() {
    for (const listener of [...listeners6]) listener();
  },
  /** 树主组件挂载时订阅入口请求（返回退订）。 */
  subscribe(listener) {
    listeners6.add(listener);
    return () => {
      listeners6.delete(listener);
    };
  }
};
function SelectMark({
  on,
  partial,
  disabled
}) {
  const filled = on || partial === true;
  return (0, import_react6.createElement)(
    "span",
    {
      className: `dshOneTree_checkBox${filled ? " dshOneTree_checkOn" : ""}${disabled === true ? " dshOneTree_checkOff" : ""}`
    },
    on ? (0, import_react6.createElement)(import_dsh_client_ui_primitives3.IconCheckOutline16, { size: 12 }) : partial === true ? (0, import_react6.createElement)("span", { className: "dshOneTree_checkDash" }) : null
  );
}
function SelectionBar({
  count,
  busy,
  error,
  tr,
  onMoveToRecycleBin,
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
        "div",
        { className: "dshOneTree_selectionActions" },
        (0, import_react6.createElement)(import_dsh_client_ui_primitives3.Button, {
          variant: "outline",
          size: "sm",
          disabled: busy || count === 0,
          onClick: onMoveToRecycleBin,
          className: "dshOneTree_selectionArchive",
          "data-dshone-tree-action": "selection-recycle",
          children: tr("select.moveToRecycleBin")
        }),
        (0, import_react6.createElement)(import_dsh_client_ui_primitives3.Button, {
          variant: "outline",
          size: "sm",
          disabled: busy || count === 0,
          onClick: onArchive,
          "data-dshone-tree-action": "selection-archive",
          children: tr("select.archivePermanent")
        }),
        (0, import_react6.createElement)(import_dsh_client_ui_primitives3.Button, {
          variant: "outline",
          size: "sm",
          disabled: busy,
          onClick: onExit,
          "data-dshone-tree-action": "selection-exit",
          children: tr("select.exit")
        })
      )
    ),
    error === null ? null : (0, import_react6.createElement)("div", { className: "dshOneTree_selectionError", role: "alert" }, error)
  );
}

// src/ui/assembly/shell/workspaceTree/tagGroups.ts
var import_react7 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var SESSION_DRAG_MIME = "text/dsh-session";
var TAG_DRAG_MIME = "text/dsh-tag";
var TAG_COLOR_CSS = {
  yellow: "#e5c07b",
  blue: "#5686fe",
  green: "#89d185",
  orange: "#d18616",
  purple: "#b180d7",
  red: "#f14c4c"
};
var TAG_COLOR_LABEL = {
  yellow: "tag.color.yellow",
  blue: "tag.color.blue",
  green: "tag.color.green",
  orange: "tag.color.orange",
  purple: "tag.color.purple",
  red: "tag.color.red"
};
function tagCollapseKey(groupKey, tagId) {
  return `${groupKey}\0${tagId}`;
}
function tagGroupMenuItems(opts) {
  const { tr, name, total, archivable, recyclable } = opts;
  const label = (id, text) => (0, import_react7.createElement)("span", { "data-dshone-tree-item": id }, text);
  return [
    { type: "label", id: "tag-menu-title", text: tr("tag.menu.title", { name }) },
    { id: "tag-new-session", label: label("tag-new-session", tr("tag.newSession")), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconPlusOutline16, { size: 14 }) },
    {
      id: "tag-archive",
      label: label("tag-archive", tr("tag.archive", { n: total })),
      icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconArchiveOutline20, { size: 14 }),
      disabled: archivable === 0,
      ...archivable === 0 ? { title: tr("tag.archive.none") } : {}
    },
    {
      id: "tag-recycle",
      label: label("tag-recycle", tr("tag.recycle", { n: total })),
      icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconTrashOutline16, { size: 14 }),
      disabled: recyclable === 0,
      ...recyclable === 0 ? { title: tr("tag.recycle.blocked") } : {}
    },
    { id: "tag-ungroup", label: label("tag-ungroup", tr("tag.ungroup")) },
    { id: "tag-rename", label: label("tag-rename", tr("tag.rename")), icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconEditOutline16, { size: 14 }) },
    { type: "separator", id: "tag-color-separator" },
    { type: "label", id: "tag-color-label", text: tr("tag.color") },
    ...TAG_COLORS.map((candidate) => ({
      id: `tag-color-${candidate}`,
      label: label(`tag-color-${candidate}`, tr(TAG_COLOR_LABEL[candidate])),
      icon: (0, import_react7.createElement)(TagColorSwatch, { color: candidate })
    })),
    { type: "separator", id: "tag-delete-separator" },
    {
      id: "tag-delete",
      label: label("tag-delete", tr("tag.delete")),
      icon: (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconTrashOutline16, { size: 14 }),
      danger: true
    }
  ];
}
function leavingContainer(event) {
  const related = event.relatedTarget ?? null;
  return related === null || !event.currentTarget.contains(related);
}
function carries(event, mime) {
  return event.dataTransfer?.types.includes(mime) === true;
}
function sessionDragProps(sessionId) {
  return {
    draggable: true,
    onDragStart: (event) => {
      if (event.dataTransfer === null) return;
      event.dataTransfer.setData(SESSION_DRAG_MIME, sessionId);
      event.dataTransfer.effectAllowed = "move";
    }
  };
}
function ungroupDropZone(onDrop) {
  return {
    "data-dshone-tree-drop": "ungroup",
    onDragOver: (event) => {
      if (!carries(event, SESSION_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
    },
    onDrop: (event) => {
      if (!carries(event, SESSION_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      const sessionId = event.dataTransfer?.getData(SESSION_DRAG_MIME) ?? "";
      if (sessionId !== "") onDrop(sessionId);
    }
  };
}
function TagColorSwatch({ color }) {
  return (0, import_react7.createElement)("span", { className: "dshOneTree_tagSwatch", style: { background: TAG_COLOR_CSS[color] }, "aria-hidden": true });
}
function TagGroupBlock({
  groupKey,
  def,
  collapsed,
  sessions,
  isUnread,
  menuItems,
  menuSelectedIds,
  onMenuSelect,
  onToggleCollapse,
  onDropSession,
  onDropTag,
  tr,
  children
}) {
  const [menuOpen, setMenuOpen] = (0, import_react7.useState)(false);
  const [dropActive, setDropActive] = (0, import_react7.useState)(false);
  const [pillDrop, setPillDrop] = (0, import_react7.useState)(null);
  const counts = tagGroupCounts(sessions, isUnread);
  const hasCounts = counts.pending + counts.running + counts.unread > 0;
  const anchor = (0, import_react7.createElement)(
    "button",
    {
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": tr("actions.tag.aria", { name: def.name }),
      "data-dshone-tree-action": "tag-menu",
      "data-dshone-tree-tag-target": def.id,
      onClick: (event) => {
        event.stopPropagation();
        setMenuOpen((open2) => !open2);
      }
    },
    (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconEllipsisOutline16, {})
  );
  const head = (0, import_react7.createElement)(
    "div",
    { className: "dshOneTree_tagHead" },
    (0, import_react7.createElement)(
      "span",
      {
        className: "dshOneTree_tagPill",
        draggable: true,
        title: tr("tag.pill.aria", { name: def.name }),
        "data-dshone-tree-tag-pill": def.id,
        "data-dshone-tag-drop": pillDrop ?? "",
        onDragStart: (event) => {
          if (event.dataTransfer === null) return;
          event.dataTransfer.setData(TAG_DRAG_MIME, def.id);
          event.dataTransfer.effectAllowed = "move";
        },
        onDragEnd: () => setPillDrop(null),
        onDragOver: (event) => {
          if (!carries(event, TAG_DRAG_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          setPillDrop(event.clientY < rect.top + rect.height / 2 ? "before" : "after");
        },
        onDragLeave: (event) => {
          if (!carries(event, TAG_DRAG_MIME)) return;
          if (!leavingContainer(event)) return;
          setPillDrop(null);
        },
        onDrop: (event) => {
          if (!carries(event, TAG_DRAG_MIME)) return;
          event.preventDefault();
          event.stopPropagation();
          const sourceId = event.dataTransfer?.getData(TAG_DRAG_MIME) ?? "";
          const rect = event.currentTarget.getBoundingClientRect();
          const before = event.clientY < rect.top + rect.height / 2;
          setPillDrop(null);
          if (sourceId === "" || sourceId === def.id) return;
          onDropTag(sourceId, before);
        }
      },
      (0, import_react7.createElement)("span", { className: "dshOneTree_tagDot" }),
      (0, import_react7.createElement)("span", { className: "dshOneTree_tagName" }, def.name)
    ),
    (0, import_react7.createElement)(
      "button",
      {
        type: "button",
        className: "dshOneTree_tagToggle",
        "data-dshone-tree-action": "tag-toggle",
        "data-dshone-tree-tag-target": def.id,
        "aria-expanded": !collapsed,
        "aria-label": collapsed ? tr("tag.expand", { name: def.name }) : tr("tag.collapse", { name: def.name }),
        onClick: (event) => {
          event.stopPropagation();
          onToggleCollapse();
        }
      },
      (0, import_react7.createElement)(import_dsh_client_ui_primitives4.IconTriangleRightFill14, { className: `dshOneTree_tagArrow${collapsed ? "" : " dshOneTree_tagArrowOpen"}` })
    ),
    // 折叠态才出计数（展开时每行自己带状态点，再数一遍是噪音）。
    collapsed && hasCounts ? (0, import_react7.createElement)(
      "span",
      {
        className: "dshOneTree_tagCounts",
        "data-dshone-tree-tag-counts": `${String(counts.pending)}/${String(counts.running)}/${String(counts.unread)}`
      },
      counts.pending > 0 ? (0, import_react7.createElement)(
        "span",
        { className: "dshOneTree_tagCount", key: "pending", title: tr("tag.count.pending", { n: counts.pending }) },
        (0, import_react7.createElement)(import_dsh_client_ui_primitives4.StateDot, { state: "warning" }),
        String(counts.pending)
      ) : null,
      counts.running > 0 ? (0, import_react7.createElement)(
        "span",
        { className: "dshOneTree_tagCount", key: "running", title: tr("tag.count.running", { n: counts.running }) },
        (0, import_react7.createElement)(import_dsh_client_ui_primitives4.StateDot, { state: "ongoing" }),
        String(counts.running)
      ) : null,
      counts.unread > 0 ? (0, import_react7.createElement)(
        "span",
        { className: "dshOneTree_tagCount", key: "unread", title: tr("tag.count.unread", { n: counts.unread }) },
        (0, import_react7.createElement)(import_dsh_client_ui_primitives4.StateDot, { state: "done" }),
        String(counts.unread)
      ) : null
    ) : null,
    (0, import_react7.createElement)(
      "span",
      { className: "dshOneTree_rowActions" },
      (0, import_react7.createElement)(import_dsh_client_ui_primitives4.Menu, {
        open: menuOpen,
        onClose: () => setMenuOpen(false),
        items: menuItems,
        selectedIds: menuSelectedIds,
        onSelect: (id) => {
          setMenuOpen(false);
          onMenuSelect(id);
        },
        portal: true,
        closeOnPointerLeave: true,
        // #113：官方紧凑档（与行菜单、行内码右键菜单同一档）——分组菜单带 `separator`
        // 与两条分组标题，紧凑档下它们的间距由官方该档给（`._separator{margin:2px}`、
        // `._label{padding:4px 7px;font-size:11px;line-height:16px}`），我们不加样式。
        compact: true,
        anchor
      })
    )
  );
  return (0, import_react7.createElement)(
    "div",
    {
      className: `dshOneTree_tagBlock${dropActive ? " dshOneTree_tagDropActive" : ""}${collapsed ? " dshOneTree_tagCollapsed" : ""}${menuOpen ? " dshOneTree_menuOpen" : ""}`,
      // 组色经 CSS 变量下发到**组块**这一层，颜色的用法（pill 的底/边、竖线段、组内行缩进的
      // 参照）全在 styles.ts 里。挂在组块而不是 pill 上：#122 的竖线与组内行都是 pill 的
      // 兄弟节点，变量只有从共同的祖先把色值继承下去才到得了它们。
      style: { "--dshone-tag-color": TAG_COLOR_CSS[def.color] },
      "data-dshone-tree": "tag-block",
      "data-dshone-tree-tag": def.id,
      "data-dshone-tree-key": groupKey,
      "data-dshone-tag-collapsed": collapsed,
      // 会话拖到本块 = 归进本组（拖到块外的工作区行上才是移出分组）。
      onDragEnter: (event) => {
        if (!carries(event, SESSION_DRAG_MIME)) return;
        event.stopPropagation();
        setDropActive(true);
      },
      onDragOver: (event) => {
        if (!carries(event, SESSION_DRAG_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
        setDropActive(true);
      },
      onDragLeave: (event) => {
        if (!carries(event, SESSION_DRAG_MIME)) return;
        if (!leavingContainer(event)) return;
        setDropActive(false);
      },
      onDrop: (event) => {
        if (!carries(event, SESSION_DRAG_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropActive(false);
        const sessionId = event.dataTransfer?.getData(SESSION_DRAG_MIME) ?? "";
        if (sessionId !== "") onDropSession(sessionId);
      }
    },
    head,
    // 贯穿竖线（#122）：从 pill 下沿画到组块底部的一条组色细线，几何与颜色全在 styles.ts
    // 的那条规则里（本件只放元素与自描述标记）。折叠态由 CSS 隐藏——所以这里不按折叠条件
    // 决定渲染与否，态只有一处（`.dshOneTree_tagCollapsed .dshOneTree_tagLine`）。
    (0, import_react7.createElement)("div", { className: "dshOneTree_tagLine", "data-dshone-tree": "tag-line" }),
    collapsed ? null : (0, import_react7.createElement)("div", { className: "dshOneTree_tagRows", "data-dshone-tree-tag-rows": def.id }, children)
  );
}

// src/ui/assembly/shell/workspaceTree/modals.ts
var MODAL_CLASS = "dshOneTree_modal";
var HANDLE_DOTS = [1.5, 7, 12.5].flatMap((cy) => [2, 7].map((cx) => ({ cx, cy })));
function modalHead(title, closeLabel, onClose, leading) {
  return (0, import_react8.createElement)(
    "div",
    { className: "dshOneTree_modalHead" },
    leading ?? null,
    (0, import_react8.createElement)("h2", { className: "dshOneTree_modalTitle" }, title),
    (0, import_react8.createElement)(
      "button",
      { type: "button", className: "dshOneTree_modalClose", "aria-label": closeLabel, onClick: onClose },
      (0, import_react8.createElement)(import_dsh_client_ui_primitives5.IconCloseFill14, {})
    )
  );
}
var modalDesc = (text) => (0, import_react8.createElement)("div", { className: "dshOneTree_modalDesc" }, text);
var modalActions = (...children) => (0, import_react8.createElement)("div", { className: "dshOneTree_modalActions" }, ...children);
function GroupModal({
  dialog,
  groups,
  tr,
  error,
  onSubmit,
  onClose
}) {
  const [draft, setDraft] = (0, import_react8.useState)("");
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const open2 = dialog !== null;
  const kind = dialog?.kind ?? "create";
  const initialName = dialog === null || dialog.kind === "create" ? "" : dialog.name;
  const lastOpen = (0, import_react8.useRef)(false);
  (0, import_react8.useEffect)(() => {
    if (open2 && !lastOpen.current) {
      setDraft(initialName);
      setBusy(false);
    }
    lastOpen.current = open2;
  }, [open2, initialName]);
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
    return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
      open: open2,
      onClose,
      title: tr("group.delete"),
      className: MODAL_CLASS,
      headless: true,
      children: [
        modalHead(tr("group.delete"), tr("close"), onClose),
        ...dialog === null || dialog.kind === "create" ? [] : [modalDesc(tr("group.delete.desc", { name: dialog.name }))],
        ...error === null ? [] : [(0, import_react8.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)],
        modalActions(
          (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
          (0, import_react8.createElement)(
            import_dsh_client_ui_primitives5.Button,
            {
              size: "sm",
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
        )
      ]
    });
  }
  const title = kind === "create" ? tr("group.new") : tr("group.rename");
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: open2,
    onClose,
    title,
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(title, tr("close"), onClose),
      (0, import_react8.createElement)("input", {
        className: "dshOneTree_renameInput",
        value: draft,
        "aria-label": title,
        autoFocus: true,
        disabled: busy,
        onChange: (event) => setDraft(event.target.value),
        onKeyDown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (nameError === null) submit();
        }
      }),
      ...nameError === null && error === null ? [] : [(0, import_react8.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, nameError ?? error)],
      modalActions(
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
        (0, import_react8.createElement)(
          import_dsh_client_ui_primitives5.Button,
          { size: "sm", variant: "primary", disabled: busy || nameError !== null, onClick: submit },
          kind === "create" ? tr("group.new") : tr("rename")
        )
      )
    ]
  });
}
function ArchiveSessionsModal({
  target,
  tr,
  busy,
  error,
  onConfirm,
  onClose
}) {
  const total = target === null ? 0 : target.blocks.reduce((sum, block) => sum + block.sessions.length, 0);
  const title = target === null ? "" : target.kind === "emptyBin" ? tr("archive.title.empty", { n: total }) : total === 1 ? tr("archive.title.one") : tr("archive.title.many", { n: total });
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: target !== null,
    onClose,
    title,
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(title, tr("close"), onClose),
      modalDesc(tr("archive.desc")),
      ...target === null || target.skipped === 0 ? [] : [
        (0, import_react8.createElement)(
          "div",
          { className: "dshOneTree_deleteStatus", "data-dshone-archive-skipped": target.skipped },
          tr("archive.skipped", { n: target.skipped })
        )
      ],
      (0, import_react8.createElement)(
        "div",
        { className: "dshOneTree_modalBlocks", "data-dshone-archive-blocks": total },
        target === null ? null : target.blocks.map(
          (block) => (0, import_react8.createElement)(
            "div",
            { className: "dshOneTree_modalBlock", key: block.key, "data-dshone-archive-block": block.key },
            (0, import_react8.createElement)(
              "div",
              { className: "dshOneTree_modalBlockLabel" },
              block.workspaceId === void 0 ? tr("group.ungrouped") : block.label
            ),
            block.sessions.map(
              (node) => (0, import_react8.createElement)(
                "div",
                { className: "dshOneTree_modalRow", key: node.id, "data-dshone-archive-row": node.id },
                displayTitle(node, tr)
              )
            )
          )
        )
      ),
      ...error === null ? [] : [(0, import_react8.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)],
      modalActions(
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
        (0, import_react8.createElement)(
          import_dsh_client_ui_primitives5.Button,
          {
            size: "sm",
            variant: "outline",
            disabled: busy,
            className: "dshOneTree_deleteAction",
            onClick: onConfirm,
            // 验证套件按这个标记认「确认归档」这一枚（官方按钮类名是哈希）。
            "data-dshone-tree-action": "archive-confirm"
          },
          busy ? tr("archive.pending") : tr("archive.confirm")
        )
      )
    ]
  });
}
function TagGroupCreateModal({
  open: open2,
  tr,
  defaultColor,
  validate,
  onSubmit,
  onClose
}) {
  const [draft, setDraft] = (0, import_react8.useState)("");
  const [color, setColor] = (0, import_react8.useState)(defaultColor);
  const [idle, setIdle] = (0, import_react8.useState)(true);
  const lastOpen = (0, import_react8.useRef)(false);
  (0, import_react8.useEffect)(() => {
    if (open2 && !lastOpen.current) {
      setDraft("");
      setColor(defaultColor);
      setIdle(true);
    }
    lastOpen.current = open2;
  }, [open2, defaultColor]);
  const nameError = idle ? null : validate(draft);
  const blocked = idle || nameError !== null;
  const submit = () => {
    if (draft.trim() === "" || validate(draft) !== null) return;
    onSubmit(draft.trim(), color);
  };
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: open2,
    onClose,
    title: tr("tag.new"),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr("tag.new"), tr("close"), onClose),
      (0, import_react8.createElement)("input", {
        className: "dshOneTree_renameInput",
        "data-dshone-tree": "tag-name-input",
        value: draft,
        "aria-label": tr("tag.name.label"),
        placeholder: tr("tag.name.label"),
        autoFocus: true,
        onChange: (event) => {
          setDraft(event.target.value);
          setIdle(false);
        },
        onKeyDown: (event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submit();
        }
      }),
      // 6 色色板：一枚枚色块当按钮（官方 Button 装不下「色块」这种内容，这里按旧侧栏
      // 同一形态自绘，几何与选中态在 styles.ts 的 `dshOneTree_tagColorPick*`）。
      (0, import_react8.createElement)(
        "div",
        { className: "dshOneTree_tagColorPick", "data-dshone-tree": "tag-color-pick" },
        TAG_COLORS.map(
          (candidate) => (0, import_react8.createElement)(
            "button",
            {
              type: "button",
              key: candidate,
              className: `dshOneTree_tagColorPickItem${candidate === color ? " dshOneTree_tagColorPickOn" : ""}`,
              style: { background: TAG_COLOR_CSS[candidate] },
              title: tr(TAG_COLOR_LABEL[candidate]),
              "aria-label": tr(TAG_COLOR_LABEL[candidate]),
              "aria-pressed": candidate === color,
              "data-dshone-tag-color": candidate,
              onClick: () => setColor(candidate)
            },
            candidate === color ? (0, import_react8.createElement)(import_dsh_client_ui_primitives5.IconCheckOutline16, { size: 12 }) : null
          )
        )
      ),
      ...idle || nameError === null ? [] : [
        (0, import_react8.createElement)(
          "div",
          { className: "dshOneTree_renameError", role: "alert" },
          nameError === "empty" ? tr("tag.name.empty") : tr("tag.name.duplicate")
        )
      ],
      modalActions(
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", onClick: onClose }, tr("cancel")),
        (0, import_react8.createElement)(
          import_dsh_client_ui_primitives5.Button,
          {
            size: "sm",
            variant: "primary",
            disabled: blocked,
            onClick: submit,
            "data-dshone-tree-action": "tag-create-confirm"
          },
          tr("tag.new")
        )
      )
    ]
  });
}
function TagGroupDeleteModal({
  target,
  tr,
  onSubmit,
  onClose
}) {
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: target !== null,
    onClose,
    title: tr("tag.delete"),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr("tag.delete"), tr("close"), onClose),
      ...target === null ? [] : [modalDesc(tr("tag.delete.desc", { name: target.name }))],
      modalActions(
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", onClick: onClose }, tr("cancel")),
        (0, import_react8.createElement)(
          import_dsh_client_ui_primitives5.Button,
          {
            size: "sm",
            variant: "outline",
            className: "dshOneTree_deleteAction",
            "data-dshone-tree-action": "tag-delete-confirm",
            onClick: () => {
              if (target !== null) onSubmit(target.id);
            }
          },
          tr("tag.delete")
        )
      )
    ]
  });
}
function RenameModal({
  open: open2,
  titleKey,
  fieldKey,
  initial,
  tr,
  onSubmit,
  onClose
}) {
  const [draft, setDraft] = (0, import_react8.useState)(initial);
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const [error, setError] = (0, import_react8.useState)(null);
  const lastOpen = (0, import_react8.useRef)(false);
  (0, import_react8.useEffect)(() => {
    if (open2 && !lastOpen.current) {
      setDraft(initial);
      setError(null);
      setBusy(false);
    }
    lastOpen.current = open2;
  }, [open2, initial]);
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
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: open2,
    onClose,
    title: tr(titleKey),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr(titleKey), tr("close"), onClose),
      (0, import_react8.createElement)("input", {
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
      ...error === null ? [] : [(0, import_react8.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)],
      modalActions(
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
        (0, import_react8.createElement)(
          import_dsh_client_ui_primitives5.Button,
          { size: "sm", variant: "primary", disabled: busy || draft.trim() === "", onClick: commit },
          tr("rename")
        )
      )
    ]
  });
}
function DeleteWorkspaceModal({
  target,
  tr,
  onSubmit,
  onClose
}) {
  const [busy, setBusy] = (0, import_react8.useState)(false);
  const [error, setError] = (0, import_react8.useState)(null);
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
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: target !== null,
    onClose,
    title: tr("delete.workspace"),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr("delete.workspace"), tr("close"), onClose),
      ...target === null ? [] : [modalDesc(tr("delete.desc", { name: target.title }))],
      ...busy ? [(0, import_react8.createElement)("div", { className: "dshOneTree_deleteStatus", role: "status" }, tr("delete.pending"))] : [],
      ...error === null ? [] : [(0, import_react8.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)],
      modalActions(
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", disabled: busy, onClick: onClose }, tr("cancel")),
        (0, import_react8.createElement)(
          import_dsh_client_ui_primitives5.Button,
          { size: "sm", variant: "outline", disabled: busy, onClick: commit, className: "dshOneTree_deleteAction" },
          tr("delete.workspace")
        )
      )
    ]
  });
}
function ManageGroupsModal({
  open: open2,
  groups,
  counts,
  workspaces,
  groupMembers,
  tr,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onToggleMember,
  onSetMembers,
  onClose
}) {
  const [draft, setDraft] = (0, import_react8.useState)("");
  const [error, setError] = (0, import_react8.useState)(null);
  const [memberGroupId, setMemberGroupId] = (0, import_react8.useState)(null);
  const [memberQuery, setMemberQuery] = (0, import_react8.useState)("");
  const [dragGroupId, setDragGroupId] = (0, import_react8.useState)(null);
  const [dropAt, setDropAt] = (0, import_react8.useState)(null);
  const lastOpen = (0, import_react8.useRef)(false);
  (0, import_react8.useEffect)(() => {
    if (open2 && !lastOpen.current) {
      setDraft("");
      setError(null);
      setMemberGroupId(null);
      setMemberQuery("");
      setDragGroupId(null);
      setDropAt(null);
    }
    lastOpen.current = open2;
  }, [open2]);
  const memberGroup = memberGroupId === null ? null : groups.find((group) => group.id === memberGroupId) ?? null;
  (0, import_react8.useEffect)(() => {
    if (memberGroupId !== null && memberGroup === null) setMemberGroupId(null);
  }, [memberGroupId, memberGroup]);
  const submit = () => {
    const failure = onCreate(draft.trim());
    if (failure === null) {
      setDraft("");
      setError(null);
      return;
    }
    setError(failure === "empty" ? tr("group.name.empty") : tr("group.name.duplicate"));
  };
  const rowIcon = (groupId, name, action) => (0, import_react8.createElement)(
    "button",
    {
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": action === "rename" ? tr("group.rename") : tr("group.delete"),
      "data-dshone-tree-action": `group-${action}`,
      "data-dshone-group-target": groupId,
      onClick: () => action === "rename" ? onRename(groupId, name) : onDelete(groupId, name)
    },
    action === "rename" ? (0, import_react8.createElement)(import_dsh_client_ui_primitives5.IconEditOutline16, {}) : (0, import_react8.createElement)(import_dsh_client_ui_primitives5.IconTrashOutline16, {})
  );
  const dropBefore = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2;
  };
  const dropOnGroup = (sourceId, targetId, before) => {
    const ids = groups.map((group) => group.id);
    const from = ids.indexOf(sourceId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    ids.splice(ids.indexOf(targetId) + (before ? 0 : 1), 0, sourceId);
    onReorder(ids);
  };
  const dragHandle = (groupId) => (0, import_react8.createElement)(
    "span",
    {
      className: "dshOneTree_manageHandle",
      draggable: true,
      title: tr("group.drag"),
      "aria-label": tr("group.drag"),
      "data-dshone-tree-action": "group-drag",
      "data-dshone-group-target": groupId,
      onDragStart: (event) => {
        if (event.dataTransfer === null) return;
        event.dataTransfer.setData(GROUP_DRAG_MIME, groupId);
        event.dataTransfer.effectAllowed = "move";
        setDragGroupId(groupId);
      },
      onDragEnd: () => {
        setDragGroupId(null);
        setDropAt(null);
      }
    },
    (0, import_react8.createElement)(
      "svg",
      { width: 9, height: 14, viewBox: "0 0 9 14", fill: "currentColor", "aria-hidden": true },
      HANDLE_DOTS.map((dot) => (0, import_react8.createElement)("circle", { key: `${String(dot.cx)}-${String(dot.cy)}`, cx: dot.cx, cy: dot.cy, r: 1.4 }))
    )
  );
  const groupDropZone = (groupId) => ({
    onDragOver: (event) => {
      if (!carries(event, GROUP_DRAG_MIME)) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
      setDropAt({ id: groupId, before: dropBefore(event) });
    },
    onDragLeave: (event) => {
      if (!carries(event, GROUP_DRAG_MIME)) return;
      if (!leavingContainer(event)) return;
      setDropAt(null);
    },
    onDrop: (event) => {
      if (!carries(event, GROUP_DRAG_MIME)) return;
      event.preventDefault();
      const before = dropBefore(event);
      const sourceId = event.dataTransfer?.getData(GROUP_DRAG_MIME) ?? "";
      setDropAt(null);
      setDragGroupId(null);
      if (sourceId === "" || sourceId === groupId) return;
      dropOnGroup(sourceId, groupId, before);
    }
  });
  if (memberGroup !== null) {
    const memberIds = new Set(groupMembers(memberGroup.id));
    const query = memberQuery.trim().toLowerCase();
    const rows = workspaces.filter((workspace) => query === "" || workspace.label.toLowerCase().includes(query));
    const selected = rows.filter((row) => memberIds.has(row.id));
    const setMembers = (member) => onSetMembers(
      memberGroup.id,
      rows.map((row) => row.id),
      member
    );
    return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
      open: open2,
      onClose,
      title: memberGroup.name,
      className: MODAL_CLASS,
      headless: true,
      children: [
        modalHead(
          memberGroup.name,
          tr("close"),
          onClose,
          (0, import_react8.createElement)(
            "button",
            {
              type: "button",
              className: "dshOneTree_modalBack",
              "aria-label": tr("group.members.back"),
              title: tr("group.members.back"),
              "data-dshone-tree-action": "group-members-back",
              onClick: () => {
                setMemberGroupId(null);
                setMemberQuery("");
              }
            },
            (0, import_react8.createElement)(import_dsh_client_ui_primitives5.IconChevronLeftOutline14, { size: 14 })
          )
        ),
        (0, import_react8.createElement)(
          "div",
          { className: "dshOneTree_memberTools" },
          (0, import_react8.createElement)("input", {
            className: "dshOneTree_renameInput",
            "data-dshone-tree": "group-member-search",
            value: memberQuery,
            placeholder: tr("group.members.search"),
            "aria-label": tr("group.members.search"),
            onChange: (event) => setMemberQuery(event.target.value)
          }),
          (0, import_react8.createElement)(
            import_dsh_client_ui_primitives5.Button,
            {
              size: "sm",
              variant: "outline",
              disabled: rows.length === 0 || selected.length === rows.length,
              "data-dshone-tree-action": "group-member-all",
              onClick: () => setMembers(true)
            },
            tr("group.members.selectAll")
          ),
          (0, import_react8.createElement)(
            import_dsh_client_ui_primitives5.Button,
            {
              size: "sm",
              variant: "outline",
              disabled: selected.length === 0,
              "data-dshone-tree-action": "group-member-none",
              onClick: () => setMembers(false)
            },
            tr("group.members.clear")
          )
        ),
        (0, import_react8.createElement)(
          "div",
          { className: "dshOneTree_memberCount", role: "status", "data-dshone-tree": "group-member-count" },
          tr("group.members.count", { n: selected.length, m: rows.length })
        ),
        (0, import_react8.createElement)(
          "div",
          {
            className: "dshOneTree_memberList",
            "data-dshone-tree": "group-members",
            "data-dshone-group-target": memberGroup.id
          },
          rows.length === 0 ? (0, import_react8.createElement)(
            "div",
            { className: "dshOneTree_memberEmpty", "data-dshone-tree": "group-member-empty" },
            workspaces.length === 0 ? tr("group.members.none") : tr("group.members.noMatch")
          ) : rows.map((row) => {
            const on = memberIds.has(row.id);
            return (0, import_react8.createElement)(
              "button",
              {
                type: "button",
                key: row.id,
                className: "dshOneTree_memberRow",
                "data-dshone-member-row": row.id,
                "data-dshone-member-state": on ? "on" : "off",
                "aria-pressed": on,
                onClick: () => onToggleMember(memberGroup.id, row.id)
              },
              (0, import_react8.createElement)(SelectMark, { on }),
              (0, import_react8.createElement)("span", { className: "dshOneTree_memberName" }, row.label)
            );
          })
        ),
        // 第二层不放错误行：建组那一格的校核只发生在第一层（进第二层时那条错误已清掉）。
        modalActions((0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", onClick: onClose }, tr("close")))
      ]
    });
  }
  return (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Modal, {
    open: open2,
    onClose,
    title: tr("group.manage.title"),
    className: MODAL_CLASS,
    headless: true,
    children: [
      modalHead(tr("group.manage.title"), tr("close"), onClose),
      (0, import_react8.createElement)(
        "div",
        { className: "dshOneTree_manageList", "data-dshone-tree": "group-manage-list" },
        groups.length === 0 ? (0, import_react8.createElement)("div", { className: "dshOneTree_manageEmpty" }, tr("group.manage.none")) : groups.map(
          (group) => (0, import_react8.createElement)(
            "div",
            {
              className: `dshOneTree_manageRow${dragGroupId === group.id ? " dshOneTree_manageRowDragging" : ""}`,
              key: group.id,
              "data-dshone-manage-group": group.id,
              // 落点标记：指针停在行的上半 / 下半，标记值即插到它前 / 后（与 pill 拖拽
              // 的 `data-dshone-tag-drop` 同一形态，样式见 styles.ts）。
              "data-dshone-group-drop": dropAt !== null && dropAt.id === group.id ? dropAt.before ? "before" : "after" : "",
              ...groupDropZone(group.id)
            },
            // #155：抓手是这一行**唯一的**拖拽源（行里还有三个按钮，整行可拖会让它们
            // 既是点击目标又是拖拽源）。
            dragHandle(group.id),
            // 名字本身就是进成员清单的入口（Telegram 的文件夹行也是点一下进去）；
            // 行尾 ✎/🗑 仍是「关掉本框、开那一套对话框」，各点各的。
            (0, import_react8.createElement)(
              "button",
              {
                type: "button",
                className: "dshOneTree_manageName",
                "data-dshone-tree-action": "group-members",
                "data-dshone-group-target": group.id,
                title: tr("group.members.open", { name: group.name }),
                onClick: () => {
                  setMemberQuery("");
                  setError(null);
                  setMemberGroupId(group.id);
                }
              },
              group.name
            ),
            (0, import_react8.createElement)("span", { className: "dshOneTree_manageCount" }, String(counts.get(group.id) ?? 0)),
            rowIcon(group.id, group.name, "rename"),
            rowIcon(group.id, group.name, "delete")
          )
        )
      ),
      (0, import_react8.createElement)(
        "div",
        { className: "dshOneTree_manageCreate" },
        (0, import_react8.createElement)("input", {
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
        (0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "primary", disabled: draft.trim() === "", onClick: submit }, tr("group.new"))
      ),
      ...error === null ? [] : [(0, import_react8.createElement)("div", { className: "dshOneTree_renameError", role: "alert" }, error)],
      modalActions((0, import_react8.createElement)(import_dsh_client_ui_primitives5.Button, { size: "sm", variant: "outline", onClick: onClose }, tr("close")))
    ]
  });
}

// src/ui/assembly/shell/workspaceTree/recycleDrawer.ts
var import_react10 = require("react");
var import_dsh_client_ui_primitives7 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/ui/assembly/shell/workspaceTree/rows.ts
var import_react9 = require("react");
var import_dsh_client_ui_primitives6 = require("@deepseek-ai/dsh-client-ui-primitives");
var PIN_PATHS = ["M5.9 2.5h4.2l.6 3.8 1.8 1.7v1.5h-9V8l1.8-1.7.6-3.8z", "M8 9.5v4"];
var UNREAD_PATHS = ["M8 2.6a5.4 5.4 0 1 0 0 10.8 5.4 5.4 0 0 0 0-10.8z"];
function strokeIcon(paths) {
  return (0, import_react9.createElement)(
    "svg",
    { viewBox: "0 0 16 16", width: 14, height: 14, fill: "none", "aria-hidden": true },
    ...paths.map(
      (d, index) => (0, import_react9.createElement)("path", {
        key: String(index),
        d,
        stroke: "currentColor",
        "stroke-width": "1.3",
        "stroke-linecap": "round",
        "stroke-linejoin": "round"
      })
    )
  );
}
function PinMark({ sessionId }) {
  return (0, import_react9.createElement)("span", { className: "dshOneTree_pin", "data-dshone-tree-pin": sessionId, "aria-hidden": true }, strokeIcon(PIN_PATHS));
}
var TERMINAL_PATHS = [
  "M2 1.5h12A1.5 1.5 0 0 1 15.5 3v10A1.5 1.5 0 0 1 14 14.5H2A1.5 1.5 0 0 1 .5 13V3A1.5 1.5 0 0 1 2 1.5zm0 1.3a.2.2 0 0 0-.2.2v10c0 .11.09.2.2.2h12a.2.2 0 0 0 .2-.2V3a.2.2 0 0 0-.2-.2H2z",
  "M3.6 4.9l2.6 2.6-2.6 2.6.9.9 3.5-3.5L4.5 4z",
  "M7.2 10.6h4.6v1.3H7.2z"
];
function TerminalIcon() {
  return (0, import_react9.createElement)(
    "svg",
    { viewBox: "0 0 16 16", width: 16, height: 16, fill: "currentColor", "fill-rule": "evenodd", "aria-hidden": true },
    ...TERMINAL_PATHS.map((d, index) => (0, import_react9.createElement)("path", { key: String(index), d }))
  );
}
function submenuChild(options) {
  return {
    id: options.id,
    label: (0, import_react9.createElement)(
      "span",
      {
        "data-dshone-tree-item": options.marker,
        "data-dshone-group-target": options.target,
        "data-dshone-group-checked": options.checked ? "true" : "false"
      },
      options.name
    ),
    ...options.checked ? { icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconCheckOutline16, { size: 12 }) } : {}
  };
}
function indentSubmenuItem(item) {
  if (typeof item !== "object" || item === null) return item;
  const record = item;
  return {
    ...record,
    // 官方项的图标槽是 flex:none 的 14×14 盒子（紧凑档 `._itemIcon_1nxmc_144`）：
    // 空 span 塞进去不画东西、只占位。
    icon: record.icon ?? (0, import_react9.createElement)("span", { className: "dshOneTree_submenuIconGap", "aria-hidden": true }),
    label: (0, import_react9.createElement)("span", { className: "dshOneTree_submenuItem" }, record.label ?? null)
  };
}
function submenuParent(options) {
  return {
    id: options.id,
    label: (0, import_react9.createElement)(
      "span",
      { "data-dshone-tree-item": options.id },
      options.label,
      (0, import_react9.createElement)("span", { className: "dshOneTree_submenuArrow", "aria-hidden": true }, options.open ? "\u25BE" : "\u25B8")
    ),
    // 图标位取紧凑档的 14×14（官方 `._itemIcon_1nxmc_144`），见文件里各菜单项的同一处置。
    icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconFolderOpenOutline16, { size: 14 })
  };
}
function UnreadIcon() {
  return strokeIcon(UNREAD_PATHS);
}
function eligibilityOf(node, pinned, unread) {
  return {
    pinned,
    running: node.running,
    runningSubagentCount: node.runningSubagentCount,
    unread,
    ...node.pendingInteraction === void 0 ? {} : { pendingInteraction: node.pendingInteraction }
  };
}
function archiveBlockKey(reason) {
  return `protect.archive.${reason}`;
}
function SessionStatusDots({ statuses, tr }) {
  const labels = statuses.map(
    (status) => (0, import_react9.createElement)(
      "span",
      { className: "dshOneTree_visuallyHidden", key: status.labelKey },
      status.labelCount === void 0 ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount })
    )
  );
  return (0, import_react9.createElement)("span", { className: "dshOneTree_slot" }, (0, import_react9.createElement)(import_dsh_client_ui_primitives6.StateDot, { state: statuses[0].state, className: "dshOneTree_dot" }), labels);
}
function SessionHoverContent({
  node,
  now,
  tr,
  unread
}) {
  const statuses = sessionStatuses({ ...node, unread });
  return (0, import_react9.createElement)(
    "div",
    { className: "dshOneTree_hoverContent" },
    (0, import_react9.createElement)("div", { className: "dshOneTree_hoverTitle" }, displayTitle(node, tr)),
    node.blank ? null : (0, import_react9.createElement)("div", { className: "dshOneTree_hoverTime" }, hoverTimeLabel(node.updatedAt, now, tr)),
    statuses.map(
      (status) => (0, import_react9.createElement)(
        "div",
        { className: "dshOneTree_hoverStatus", key: status.labelKey },
        (0, import_react9.createElement)(import_dsh_client_ui_primitives6.StateDot, { state: status.state }),
        (0, import_react9.createElement)("span", null, status.labelCount === void 0 ? tr(status.labelKey) : tr(status.labelKey, { n: status.labelCount }))
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
  return (0, import_react9.createElement)(
    "div",
    { className: "dshOneTree_hoverContent" },
    (0, import_react9.createElement)("div", { className: "dshOneTree_hoverTitle" }, label),
    cwd === void 0 ? null : (0, import_react9.createElement)("div", { className: "dshOneTree_hoverPath" }, cwd),
    createdAt === void 0 ? null : (0, import_react9.createElement)("div", { className: "dshOneTree_hoverTime" }, createdLabel(createdAt, tr))
  );
}
function ActiveScheduleIndicator({ tr, search = false }) {
  const label = tr("schedule.active");
  return (0, import_react9.createElement)(
    "span",
    {
      className: `dshOneTree_scheduleIndicator${search ? " dshOneTree_searchScheduleIndicator" : ""}`,
      role: "img",
      "aria-label": label,
      title: label,
      "data-dshone-tree-schedule": ""
    },
    (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconAlarmClockOutline16, {})
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
  shellName,
  canArchiveAll,
  onToggle,
  onCreate,
  onOpenTerminal,
  onOpenFolder,
  onArchiveAll,
  onCopyFolderRef,
  onCopyPath,
  onRename,
  onDelete,
  onToggleGroup,
  selectMode,
  checkState,
  checkTip,
  checkDisabled,
  onToggleSelect
}) {
  const [menuOpen, setMenuOpen] = (0, import_react9.useState)(false);
  const [submenuOpen, setSubmenuOpen] = (0, import_react9.useState)(false);
  const [menuAt, setMenuAt] = (0, import_react9.useState)(null);
  const label = group.workspaceId === void 0 ? tr("group.ungrouped") : group.label;
  const active = expanded && group.containsCurrent;
  const state = checkState ?? "none";
  const checkLabel = state === "all" ? tr("select.group.all", { name: label }) : state === "some" ? tr("select.group.some", { name: label }) : tr("select.group.none", { name: label });
  const ungrouped = group.workspaceId === void 0;
  const hasPath = group.cwd !== void 0;
  const groupChildren = groups.map(
    (entry) => submenuChild({
      id: `${GROUP_MENU_PREFIX}${entry.id}`,
      target: entry.id,
      name: entry.name,
      checked: memberOf.includes(entry.id),
      marker: "workspace-group-item"
    })
  );
  const menuItems = [
    // 标题行：操作对象显式化（瞄错行时点下去之前就能发现）。
    {
      type: "label",
      id: "workspace-title",
      text: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "menu-title" }, tr("menu.workspaceTitle", { name: label }))
    },
    // 未分组桶没有路径与工作区身份，能做的只有它自己那两件（新建会话 / 整桶归档）。
    ...ungrouped ? [{ id: "new-session", label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "new-session" }, tr("menu.newSession")), icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconPlusOutline16, { size: 14 }) }] : [],
    ...hasPath ? [
      {
        id: "copy-folder-ref",
        label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "copy-folder-ref" }, tr("menu.copyFolderReference")),
        icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconCopyOutline16, { size: 14 })
      }
    ] : [],
    // 「分组…」二级菜单：父项点一下就地展开，子项紧跟在它后面（勾选态走 selectedIds 的 ✓）。
    ...groupChildren.length > 0 && !ungrouped ? [
      submenuParent({ id: "groups", label: tr("menu.groups"), open: submenuOpen }),
      ...submenuOpen ? groupChildren.map((item) => indentSubmenuItem(item)) : []
    ] : [],
    {
      id: "archive-all",
      label: (0, import_react9.createElement)(
        "span",
        {
          "data-dshone-tree-item": "archive-all",
          "data-dshone-disabled-reason": canArchiveAll ? "" : "no-eligible",
          ...canArchiveAll ? {} : { title: tr("menu.archiveBlocked") }
        },
        ungrouped ? tr("menu.archiveUngrouped") : tr("menu.archiveWorkspace")
      ),
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconArchiveOutline20, { size: 14 }),
      disabled: !canArchiveAll
    },
    ...hasPath && onOpenFolder !== void 0 ? [
      {
        id: "open-new-window",
        label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "open-new-window" }, tr("menu.openFolderInNewWindow")),
        icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconRightUpOutline16, { size: 14 })
      }
    ] : [],
    ...hasPath ? [
      {
        id: "copy-path",
        label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "copy-path" }, tr("menu.copyPath")),
        icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconCopyOutline16, { size: 14 })
      }
    ] : [],
    ...onRename === void 0 ? [] : [
      {
        id: "rename",
        label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "rename" }, tr("menu.renameWorkspace")),
        icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconEditOutline16, { size: 14 })
      }
    ],
    ...onDelete === void 0 ? [] : [
      {
        id: "remove",
        label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "remove" }, tr("menu.removeWorkspace")),
        icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconTrashOutline16, { size: 14 }),
        danger: true
      }
    ]
  ];
  const iconButton = (options) => (0, import_react9.createElement)(
    "button",
    {
      key: options.key,
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": options.aria,
      "data-dshone-tree-action": options.action,
      ...options.marker === void 0 ? {} : { "data-dshone-tree-item": options.marker },
      onClick: (event) => {
        event.stopPropagation();
        options.onClick();
      }
    },
    options.children
  );
  const actions = [
    iconButton({
      key: "new",
      action: "workspace-new-session",
      aria: tr("actions.newSession.aria", { name: label }),
      onClick: onCreate,
      marker: "new-session-button",
      children: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconPlusOutline16, {})
    }),
    ...hasPath && onOpenTerminal !== void 0 ? [
      iconButton({
        key: "terminal",
        action: "workspace-terminal",
        aria: tr("actions.workspace.terminal", { name: label }),
        onClick: onOpenTerminal,
        children: (0, import_react9.createElement)(TerminalIcon, {})
      })
    ] : [],
    // 「在 VS Code 打开」只在**非当前工作区**时出现（E1）：当前工作区本来就在编辑器里，
    // 再给一个「打开它」的按钮没有意义。
    ...hasPath && onOpenFolder !== void 0 && !group.containsCurrent ? [
      iconButton({
        key: "open",
        action: "workspace-open",
        aria: tr("actions.workspace.open", { name: label }),
        onClick: () => onOpenFolder({ newWindow: false }),
        children: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconFolderOpenOutline16, {})
      })
    ] : [],
    ...onDelete === void 0 ? [] : [
      iconButton({
        key: "remove",
        action: "workspace-remove",
        aria: tr("actions.workspace.remove", { name: label }),
        onClick: onDelete,
        children: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconTrashOutline16, {})
      })
    ]
  ];
  const anchor = (0, import_react9.createElement)("span", { className: "dshOneTree_menuAnchor", "aria-hidden": true });
  const row = (0, import_react9.createElement)(
    "div",
    {
      className: `dshOneTree_projectRow${menuOpen ? " dshOneTree_menuOpen" : ""}`,
      role: "treeitem",
      "aria-expanded": expanded,
      "data-dshone-tree-row": "workspace",
      "data-dshone-tree-key": group.key,
      "data-dshone-tree-count": group.sessionCount,
      // #108：组头三态的当前值写在行上（验证套件按行读，不认官方哈希类名）。
      ...selectMode === true ? { "data-dshone-tree-check": state } : {},
      ...group.containsCurrent ? { "data-dshone-tree-current": "true" } : {},
      onClick: onToggle,
      // 行右键开工作区菜单（#109 起工作区行有右键菜单；选择态由行本身的 onClick 接管，
      // 会话行的处置同此）。
      onContextMenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuAt({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      },
      children: [
        // #108：三态全选框（旧侧栏的处置：框在最前，文件夹与折叠箭头照常保留）。
        // 点框只勾选、不折叠（stopPropagation），所以我们自己做一枚可点元素而不是
        // 让整行承接——组头的整行点击仍是「展开/收起」。
        selectMode !== true ? null : (0, import_react9.createElement)(
          "span",
          {
            key: "check",
            className: "dshOneTree_check dshOneTree_groupCheck",
            role: "checkbox",
            "aria-checked": state === "all" ? "true" : state === "some" ? "mixed" : "false",
            "aria-label": checkLabel,
            "aria-disabled": checkDisabled === true,
            "data-dshone-tree-action": "group-select",
            "data-dshone-tree-check": state,
            // 提示挂在框上（行上挂会让整行都冒出原生气泡）。
            ...checkTip === void 0 ? {} : { title: checkTip },
            onClick: (event) => {
              event.stopPropagation();
              if (checkDisabled !== true) onToggleSelect?.();
            }
          },
          (0, import_react9.createElement)(SelectMark, {
            on: state === "all",
            partial: state === "some",
            disabled: checkDisabled === true
          })
        ),
        (0, import_react9.createElement)(
          "span",
          {
            key: "folder",
            className: `dshOneTree_slot dshOneTree_folder${active ? " dshOneTree_folderActive" : ""}`,
            children: expanded ? (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconFolderOpen16, {}) : (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconFolderClose16, {})
          }
        ),
        (0, import_react9.createElement)("span", {
          key: "chevron",
          className: "dshOneTree_slot dshOneTree_chevron",
          children: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconTriangleRightFill14, {
            className: `dshOneTree_arrow${expanded ? " dshOneTree_arrowOpen" : ""}`
          })
        }),
        (0, import_react9.createElement)("span", {
          key: "text",
          className: "dshOneTree_projectText",
          // #138：活状态计数**跟着标题文字走**（同一个标题盒里、文字之后），所以它装在
          // `.dshOneTree_title` 里面、文字的兄弟位上；文字自己包一层
          // `.dshOneTree_titleText`（省略号落在它身上，见 ActivityBadge 的说明）。
          // 标题盒本身仍是 projectText 撑出来的那个矩形（计数进的是盒里、不是行里），
          // F-04 PARITY 逐项比对标题矩形这一条因此不受影响。
          //
          // 行尾那一层（#109）也在标题盒里、贴着它的**右缘**（`margin-left:auto`）：
          // 这一层只剩「当前工作区」那枚胶囊，#138 起不再绝对定位叠在标题上——叠着时
          // 窄侧栏里胶囊会压住标题文字与计数（实测 260px 下压住计数右缘 4.6px），
          // 进流之后它自己占住那一格，标题文字用省略号让位，两者永不重叠（见它的样式规则
          // 与 ActivityBadge 的说明）。
          children: (0, import_react9.createElement)(
            "span",
            { className: "dshOneTree_title" },
            (0, import_react9.createElement)("span", { className: "dshOneTree_titleText" }, label),
            counts === void 0 ? null : (0, import_react9.createElement)(ActivityBadge, { counts, tr }),
            (0, import_react9.createElement)(
              "span",
              { key: "end", className: "dshOneTree_rowEnd" },
              group.containsCurrent ? (0, import_react9.createElement)("span", { className: "dshOneTree_workspaceBadge", "data-dshone-tree-badge": shellName, title: tr("badge.current") }, shellName) : null
            )
          )
        }),
        (0, import_react9.createElement)("span", {
          key: "actions",
          className: "dshOneTree_rowActions",
          children: [
            (0, import_react9.createElement)(import_dsh_client_ui_primitives6.Menu, {
              key: "menu",
              open: menuOpen,
              onClose: () => {
                setMenuAt(null);
                setMenuOpen(false);
              },
              items: menuItems,
              onSelect: (id) => {
                if (id === "groups") {
                  setSubmenuOpen((open2) => !open2);
                  return;
                }
                if (id.startsWith(GROUP_MENU_PREFIX)) {
                  onToggleGroup(id.slice(GROUP_MENU_PREFIX.length));
                  return;
                }
                setMenuAt(null);
                setMenuOpen(false);
                if (id === "new-session") onCreate();
                if (id === "copy-folder-ref") onCopyFolderRef();
                if (id === "archive-all") onArchiveAll();
                if (id === "open-new-window") onOpenFolder?.({ newWindow: true });
                if (id === "copy-path") onCopyPath();
                if (id === "rename") onRename?.();
                if (id === "remove") onDelete?.();
              },
              // #113：官方紧凑档（项 26px 高 / 5px 圆角 / 12px 字号 / 14×14 图标位），
              // 与行内码右键菜单（shell/contextMenuPlugin.ts）同一档——侧栏里的菜单密度一致。
              compact: true,
              portal: true,
              closeOnPointerLeave: true,
              anchor,
              ...menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }
            }),
            ...actions
          ]
        })
      ]
    }
  );
  if (group.createdAt === void 0 || !hoverCard || selectMode === true) return row;
  return (0, import_react9.createElement)(import_dsh_client_ui_primitives6.HoverCard, {
    anchor: row,
    content: (0, import_react9.createElement)(WorkspaceHoverContent, { label: group.label, cwd: group.cwd, createdAt: group.createdAt, tr }),
    disabled: menuOpen,
    copyText: group.cwd,
    copyLabel: tr("copy"),
    copiedLabel: tr("hover.copied")
  });
}
var rowDragActive = false;
function withDragGuard(dragProps, onDragging) {
  if (dragProps === void 0) return {};
  const wrapped = { ...dragProps };
  const start = wrapped.onDragStart;
  const end = wrapped.onDragEnd;
  wrapped.onDragStart = (event) => {
    rowDragActive = true;
    onDragging(true);
    if (typeof start === "function") start(event);
  };
  wrapped.onDragEnd = (event) => {
    rowDragActive = false;
    onDragging(false);
    if (typeof end === "function") end(event);
  };
  return wrapped;
}
var ROW_META_SELECTOR = ".dshOneTree_rowActions,.dshOneTree_time,.dshOneTree_slot,.dshOneTree_pin,.dshOneTree_schedule";
function SessionRow({
  node,
  currentId,
  now,
  hoverCard,
  tr,
  selectMode,
  selected,
  pinned,
  unread,
  onToggleSelect,
  onOpen,
  onRename,
  onFork,
  onMoveToRecycleBin,
  onArchive,
  onTogglePin,
  onToggleUnread,
  onSelectMultiple,
  onCopyReference,
  onOpenInNewTab,
  tagItems,
  tagSelectedIds,
  onTagSelect,
  dragProps,
  renaming,
  renameDraft,
  renameSelection,
  onCurrentRowClick,
  onRenameDraft,
  onRenameCommit,
  onRenameCancel
}) {
  const [menuOpen, setMenuOpen] = (0, import_react9.useState)(false);
  const [submenuOpen, setSubmenuOpen] = (0, import_react9.useState)(false);
  const [menuAt, setMenuAt] = (0, import_react9.useState)(null);
  const title = displayTitle(node, tr);
  const isCurrent = node.id === currentId;
  const [rowDragging, setRowDragging] = (0, import_react9.useState)(false);
  const renameInput = (0, import_react9.useRef)(null);
  (0, import_react9.useLayoutEffect)(() => {
    const input = renameInput.current;
    if (input === null || document.activeElement === input) return;
    input.focus();
    const selection = renameSelection ?? { start: 0, end: input.value.length };
    input.setSelectionRange(selection.start, selection.end);
  });
  (0, import_react9.useEffect)(() => {
    if (renaming !== true) return;
    setMenuAt(null);
    setMenuOpen(false);
    setSubmenuOpen(false);
  }, [renaming]);
  const composingRef = (0, import_react9.useRef)(false);
  (0, import_react9.useEffect)(() => {
    if (renaming !== true) return;
    const report = () => {
      const input = renameInput.current;
      if (input === null || document.activeElement !== input) return;
      reportDraft(input);
    };
    document.addEventListener("selectionchange", report);
    return () => document.removeEventListener("selectionchange", report);
  }, [renaming]);
  const reportDraft = (element) => {
    onRenameDraft?.(element.value, {
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length
    });
  };
  const renameInputEvents = {
    value: renameDraft ?? "",
    "aria-label": tr("field.sessionName"),
    "data-dshone-tree-rename": "input",
    autoComplete: "off",
    // 两个事件接同一个处理函数：官方种子表里的 react 实现把 onChange 派到哪个原生
    // 事件上不由我们决定，接全了才在两种实现下都对（重复到达时值相同，树层的
    // setState 按同值短路，不会多渲染）。
    onChange: (event) => reportDraft(event.target),
    onInput: (event) => reportDraft(event.target),
    // 鼠标拖选、Shift+方向键这类「选区变了但没打字」的动作用 select 事件补上（光标来回
    // 移动那一路由上面那条 selectionchange 订阅兜着）。
    onSelect: (event) => reportDraft(event.target),
    onCompositionStart: () => {
      composingRef.current = true;
    },
    onCompositionEnd: () => {
      composingRef.current = false;
    },
    onKeyDown: (event) => {
      if (event.key === "Enter") {
        if (event.isComposing === true || composingRef.current) return;
        event.preventDefault();
        onRenameCommit?.();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onRenameCancel?.();
      }
    },
    onBlur: (event) => {
      if (event.target.isConnected === false) return;
      onRenameCancel?.();
    }
  };
  const facts = eligibilityOf(node, pinned, unread);
  const selectable = canRecycle(facts);
  const archiveBlocked = cannotArchiveReason(facts);
  const unreadBlocked = sessionBusy(facts);
  const statuses = sessionStatuses({ ...node, unread });
  const showStatus = showsStatusDot(statuses, node.completed || unread);
  const openInNewTabItem = onOpenInNewTab === void 0 ? [] : [
    {
      id: "openInNewTab",
      // 标记属性（自有契约）：菜单项类名是官方哈希，验证套件与样式都不该认它，
      // 按这个属性取「我们那一项」（与 contextMenuPlugin 的图标项同一做法）。
      label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "openInNewTab" }, tr("menu.openInNewTab")),
      // 图标取官方 primitives 的 IconRightUpOutline16（向右上离开方框 = 到别处打开），
      // 同为 icon 槽位的次级色；尺寸按紧凑档的 14×14 图标位给（`{ size: 14 }`，
      // 官方 16 档图标塞进 14px 的盒子会溢出一圈）。
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconRightUpOutline16, { size: 14 })
    }
  ];
  const recycleBlocked = cannotRecycleReason(facts);
  const groupChildren = tagItems ?? [];
  const menuItems = [
    {
      type: "label",
      id: "session-title",
      text: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "menu-title" }, tr("menu.sessionTitle", { name: title }))
    },
    {
      id: "selectMultiple",
      label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "selectMultiple" }, tr("menu.selectMultiple")),
      // 图标取顶栏那个多选入口的同一枚（IconChecklistOutline14），两处是同一个动作。
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconChecklistOutline14, {})
    },
    ...openInNewTabItem,
    {
      id: "rename",
      label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "rename" }, tr("rename")),
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconEditOutline16, { size: 14 })
    },
    // #102 两项标记动作：文案随状态翻转，勾选态走官方 Menu 的 selectedIds（✓）。
    {
      id: "pin",
      label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "pin" }, pinned ? tr("menu.unpin") : tr("menu.pin")),
      icon: strokeIcon(PIN_PATHS)
    },
    {
      id: "unread",
      label: (0, import_react9.createElement)(
        "span",
        {
          "data-dshone-tree-item": "unread",
          ...unreadBlocked ? { title: tr("menu.unreadBlocked") } : {}
        },
        unread ? tr("menu.markRead") : tr("menu.markUnread")
      ),
      icon: (0, import_react9.createElement)(UnreadIcon, {}),
      disabled: unreadBlocked
    },
    ...groupChildren.length === 0 || onTagSelect === void 0 ? [] : [
      submenuParent({ id: "moveToGroup", label: tr("menu.moveToGroup"), open: submenuOpen }),
      // 子项就是树层拼好的那一份（组 / 不归入 / 新建），只加一层缩进。
      ...submenuOpen ? groupChildren.map((item) => indentSubmenuItem(item)) : []
    ],
    {
      id: "fork",
      // 空白的「新会话」占位没有一个完成的轮次，官方 `sessions.fork` 在那种会话上必然
      // 失败（服务端回退到最后一个 turn/end 切点）——按旧侧栏的处置禁用。**只能按
      // `blank` 判**：会话快照里没有「有没有完成过轮次」这个事实（`SessionSummaryLike`
      // 没有对应字段，旧侧栏吃的 `sessionStatsTurns` 是它自己 store 里的统计）。
      label: (0, import_react9.createElement)(
        "span",
        {
          "data-dshone-tree-item": "fork",
          ...node.blank ? { title: tr("menu.forkBlocked") } : {}
        },
        tr("menu.fork")
      ),
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconBranchOutline16, { size: 14 }),
      disabled: node.blank
    },
    {
      id: "copyReference",
      label: (0, import_react9.createElement)("span", { "data-dshone-tree-item": "copyReference" }, tr("menu.copyReference")),
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconCopyOutline16, { size: 14 })
    },
    // 「移入回收站」= 本地可逆的一层（#103）：只有置顶被拦；运行中 / 未读 / 待交互都能移进去
    // （进去还能还原），所以它的判定结果与下面「归档」分开算。
    {
      id: "move-to-recycle-bin",
      label: (0, import_react9.createElement)(
        "span",
        {
          "data-dshone-tree-item": "move-to-recycle-bin",
          "data-dshone-disabled-reason": recycleBlocked ?? "",
          ...recycleBlocked === null ? {} : { title: tr(`protect.recycle.${recycleBlocked}`) }
        },
        tr("menu.moveToRecycleBin")
      ),
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconTrashOutline16, { size: 14 }),
      disabled: recycleBlocked !== null
    },
    // 「归档会话」= 终点动作（#103 的归档 = 删除）：置顶与「状态还在动」的都不许归档。
    {
      id: "archive",
      label: (0, import_react9.createElement)(
        "span",
        {
          "data-dshone-tree-item": "archive",
          "data-dshone-disabled-reason": archiveBlocked ?? "",
          ...archiveBlocked === null ? {} : { title: tr(archiveBlockKey(archiveBlocked)) }
        },
        tr("menu.archiveSession")
      ),
      icon: (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconArchiveOutline20, { size: 14 }),
      disabled: archiveBlocked !== null
    }
  ];
  const anchor = (0, import_react9.createElement)(
    "button",
    {
      type: "button",
      className: "dshOneTree_rowIconButton",
      "aria-label": tr("actions.session.aria", { name: title }),
      "data-dshone-tree-action": "session-menu",
      onClick: (event) => {
        event.stopPropagation();
        setMenuAt(null);
        setMenuOpen((open2) => !open2);
      }
    },
    (0, import_react9.createElement)(import_dsh_client_ui_primitives6.IconEllipsisOutline16, {})
  );
  const renamingNow = renaming === true;
  const row = (0, import_react9.createElement)(
    "div",
    {
      className: `dshOneTree_sessionRow${(selectMode ? selected : isCurrent) ? " dshOneTree_selected" : ""}${menuOpen ? " dshOneTree_menuOpen" : ""}${rowDragging ? " dshOneTree_dragging" : ""}`,
      role: "treeitem",
      "aria-selected": selectMode ? selected : isCurrent,
      "data-dshone-tree-row": "session",
      // 行上带的会话 id（与工作区行的 `data-dshone-tree-key` 同一个用途：验证套件据此
      // 认行，不用去猜 DOM 顺序；#103 的回收站套件也用它把「挪走的那条」与抽屉里的
      // 行、与宿主状态存储里的 id 对上）。
      "data-dshone-tree-session": node.id,
      // 行上的活状态（供验证套件把「工作区行尾的计数」与「行内真实状态」对照）：
      // 等待交互 > 运行中 > 空闲，与状态点的优先级同源。
      "data-dshone-tree-status": node.pendingInteraction !== void 0 ? "waiting" : node.running ? "running" : "idle",
      // 置顶行不可勾选（#102）：选择态下点它不切换勾选（勾选框本身也带提示）。
      // `data-dshone-tree-check` 把资格写在行上（验证套件按行读），提示在勾选框上。
      ...selectMode ? { "data-dshone-tree-checked": selected, "data-dshone-tree-check": selectable ? "eligible" : "blocked" } : {},
      // 编辑态写在行上（验证套件与样式都按它认「这一行正在改名」）。
      ...renamingNow ? { "data-dshone-tree-renaming": "true" } : {},
      // #107：把这一行拖进/拖出标签组（拖拽属性由树层拼，见 dragProps 的说明）。
      // 选择态不给拖：那时候整行只有「勾选」一个动作；编辑态也不给拖（拖走正在改名的
      // 行只会把编辑态连同输入框一起晃没）。
      // #155：拖起来的这一行同时标成 `dshOneTree_dragging`（源行半透明，理由见 withDragGuard）。
      ...selectMode || renamingNow ? {} : withDragGuard(dragProps, setRowDragging),
      // #115/#121 情境化点击：**非当前会话** = 打开（原样）；**当前会话** = 报到树层
      // （由它问过宿主再定就地改名还是按打开处理，见 onCurrentRowClick 的说明）。
      // 行内互斥件（行尾状态点/图钉/定时标记/时间/⋯ 那一层）点上去不算「点行」，
      // 按原来的打开处置走——它们各有自己的含义，不该把改名触发了。拖拽窗口里到达的
      // 点击同样吞掉（见 withDragGuard）。选择态照旧整行只有勾选。
      onClick: selectMode ? selectable ? onToggleSelect : () => {
      } : renamingNow ? (
        // 编辑中：行内点哪儿都不再触发（点在输入框上是摆光标，由输入框自己处理）——
        // 这里若再走一遍「进入改名」，用户刚敲的字会被原样打回。
        () => {
        }
      ) : (event) => {
        const dragging = rowDragActive;
        rowDragActive = false;
        const meta = event.target instanceof Element && event.target.closest(ROW_META_SELECTOR) !== null;
        if (!meta && !dragging && isCurrent) onCurrentRowClick?.();
        else onOpen();
      },
      // 行右键开出同一份菜单（指针位置锚定）。**接管条件只剩「非选择态」**（#109）：
      // 以前还要「非空白会话 + 宿主有编辑器标签页」，于是多开不可用的宿主、空白会话行
      // 上右键都直接弹浏览器原生菜单——而这两类行**本来就有行菜单可给**（空白会话行
      // 只是官方不给显式的 ⋯ 按钮，菜单内容一样成立）。旧侧栏同样只按选择态让路。
      // 选择态下整行只有「勾选」一个动作（同上面 onClick 的处置）；编辑态下右键也让位
      //（同一份菜单，同一份互斥理由）。
      onContextMenu: selectMode || renamingNow ? void 0 : (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuAt({ x: event.clientX, y: event.clientY });
        setMenuOpen(true);
      },
      children: [
        // #133：选择态的勾选框**缩进一层**——它落在工作区行那枚文件夹图标的列上
        //（行内边距 7 + 框宽 16 + 行内间隙 6 = 29），左边那 22px 留空。这一段空由下面
        // 那个 22px 的占位元素给出，它**是刻意的**（= 工作区行的「框宽 16 + 行内间隙 6」
        // 这一层缩进本身），不是没人要的死空间：#124 当时以死空间为由把框放在行首，
        // 用户实测后明确要旧侧栏那个形态（组头的框在最左、行的框缩进一层，左侧留出
        // 那一段空），本条按用户口径改回来。
        // #124 立下的 δ 照旧：会话行的整段插入量仍是 22px（#108 起两行在选中态下插入
        // 同样的量），标题落点因此不变——7 + 22 + 16 + 4 = 49，与工作区名的 51 相差 2。
        selectMode ? (0, import_react9.createElement)("span", { key: "checkIndent", className: "dshOneTree_checkIndent" }) : null,
        selectMode ? (0, import_react9.createElement)(
          "span",
          {
            key: "check",
            className: "dshOneTree_check",
            // 置顶会话不可勾选（#102 保护规则）：勾选是「批量移入回收站」的前置，
            // 而置顶不允许进回收站也不允许归档——所以最满也只勾得上它以外的行。
            // 原因提示挂在勾选框上（行上挂会让整行都冒出原生气泡）。
            ...selectable ? {} : { title: tr("protect.recycle.pinned") }
          },
          (0, import_react9.createElement)(SelectMark, { on: selected, disabled: !selectable })
        ) : null,
        // #133：选择态下**状态槽不渲染**——框左边那 22px 缩进就是它让出来的位置。
        // 为什么让它让位，而不是「保留在框的右侧」或「缩进之后紧跟槽」：本条的两个硬
        // 约束是「标题仍落在 49」与「δ 仍是 2」，任何一处把 16px 的槽留在框前或框后都
        // 会多出 16 + 4 = 20px、标题当场越过 49，δ 随之断掉；而用户口径要的就是框左侧
        // 那一段空，槽留着也把这 22px 填掉 16px 了。旧侧栏进多选后同样是这个处置——
        // 它那一行的第一个子元素就是复选框（`renderSessionRow` 在多选态下先挂复选框、
        // 再挂主区），行首不留状态槽，活状态画在行尾。
        // 状态事实没有丢：活状态照旧写在行上（`data-dshone-tree-status`，与这枚点同源
        // 的判定），组头三态、归档跳过数、回收站保护这些判定也都不看这颗点。
        !selectMode ? showStatus ? (0, import_react9.createElement)(SessionStatusDots, { key: "status", statuses, tr }) : (0, import_react9.createElement)("span", { key: "status", className: "dshOneTree_slot" }) : null,
        pinned ? (0, import_react9.createElement)(PinMark, { key: "pin", sessionId: node.id }) : null,
        // #115 编辑态：标题位就地换成输入框（prefill + 全选由树层给初值与选区），
        // 行其余部分照旧——行结构与不编辑时完全一致，重绘才不会把输入框换掉。
        renamingNow ? (0, import_react9.createElement)("input", { key: "title", ref: renameInput, className: "dshOneTree_inlineRenameInput", ...renameInputEvents }) : (0, import_react9.createElement)("span", { key: "title", className: `dshOneTree_title${unread ? " dshOneTree_unread" : ""}` }, title),
        // 活跃定时任务标记（#110，官方 `row.hasActiveSchedule &&` 同位置：标题后、时间前）。
        node.hasActiveSchedule ? (0, import_react9.createElement)(ActiveScheduleIndicator, { key: "schedule", tr }) : null,
        node.blank || selectMode ? null : (0, import_react9.createElement)("span", {
          key: "time",
          className: "dshOneTree_time",
          children: timeLabel(node.updatedAt, now, tr)
        }),
        // 行菜单挂在 actions 里（选择态下整行让位）。**空白会话行也挂**（#109）：它的
        // ⋯ 按钮照官方不渲染（`node.blank` 那一支），但右键要能开出菜单——所以这里渲染
        // 的是一层「可能有按钮、一定有菜单」的容器，锚点按有没有按钮二选一。
        // #115 编辑中同样让位：编辑态与菜单互斥（菜单里也有「重命名」，两条路同时开着
        // 只会互相顶掉），要改名就先 Enter/Esc 收掉输入框。
        selectMode || renamingNow ? null : (0, import_react9.createElement)("span", {
          key: "actions",
          className: "dshOneTree_rowActions",
          children: [
            (0, import_react9.createElement)(import_dsh_client_ui_primitives6.Menu, {
              key: "menu",
              open: menuOpen,
              onClose: () => {
                setMenuAt(null);
                setMenuOpen(false);
                setSubmenuOpen(false);
              },
              items: menuItems,
              // 勾选态（官方 Menu 的 selectedIds：✓ 由官方渲染）：两项标记动作 +
              // 本行的标签组归属（#107，现在住在「移到分组…」的就地展开里）。
              selectedIds: [...pinned ? ["pin"] : [], ...unread ? ["unread"] : [], ...tagSelectedIds ?? []],
              onSelect: (id) => {
                if (id === "moveToGroup") {
                  setSubmenuOpen((open2) => !open2);
                  return;
                }
                if (id.startsWith(TAG_MENU_PREFIX)) {
                  if (id.endsWith("__new")) {
                    setMenuAt(null);
                    setMenuOpen(false);
                    setSubmenuOpen(false);
                  }
                  onTagSelect?.(id.slice(TAG_MENU_PREFIX.length));
                  return;
                }
                setMenuAt(null);
                setMenuOpen(false);
                if (id === "selectMultiple") onSelectMultiple();
                if (id === "rename") onRename(node.title);
                if (id === "pin") onTogglePin();
                if (id === "unread") onToggleUnread();
                if (id === "fork") onFork();
                if (id === "openInNewTab") onOpenInNewTab?.();
                if (id === "copyReference") onCopyReference();
                if (id === "move-to-recycle-bin") onMoveToRecycleBin();
                if (id === "archive") onArchive();
              },
              // #113：官方紧凑档（与工作区行那一份、行内码右键菜单同一档）。
              compact: true,
              portal: true,
              closeOnPointerLeave: true,
              // 锚点：非空白行是那一枚 ⋯ 按钮（Menu 自己会把它渲染在自己的根节点里，
              // 所以这里**只**传给 Menu、不再另渲染一份）；空白行没有按钮，给一个零尺寸
              // 占位（右键那一份用指针坐标，锚点只是在别的打开方式下当兜底）。
              anchor: node.blank ? (0, import_react9.createElement)("span", { className: "dshOneTree_menuAnchor", "aria-hidden": true }) : anchor,
              // 行右键开的那一份：菜单锚在指针处（官方 Menu 的 getAnchorRect
              // 优先于 anchor 的矩形，官方自己的右键菜单也是这么用的）。
              ...menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }
            })
          ]
        })
      ]
    }
  );
  if (!hoverCard || selectMode) return row;
  return (0, import_react9.createElement)(import_dsh_client_ui_primitives6.HoverCard, {
    anchor: row,
    content: (0, import_react9.createElement)(SessionHoverContent, { node, now, tr, unread }),
    // 改名编辑期间不出悬停卡（`disabled` 是官方 HoverCard 的既有口）：卡片会盖住输入框、
    // 也会在指针移动时重排行。**保留这层包装**（不改成直接返回 row）——结构与不编辑时
    // 一致，编辑态进出才不会把整行 DOM 换掉。
    disabled: menuOpen || renamingNow,
    copyText: node.blank ? void 0 : node.title,
    copyLabel: tr("copy"),
    copiedLabel: tr("hover.copied")
  });
}
function highlightMatches(text, query) {
  const needle = query.trim().toLowerCase();
  const index = needle === "" ? -1 : text.toLowerCase().indexOf(needle);
  if (index < 0) return [text];
  const head = text.slice(0, index);
  const tail = text.slice(index + needle.length);
  return [
    ...head === "" ? [] : [head],
    (0, import_react9.createElement)("mark", { key: "hit", className: "dshOneTree_searchMark" }, text.slice(index, index + needle.length)),
    ...tail === "" ? [] : [tail]
  ];
}
function SearchResultRow({
  node,
  workspaceLabel,
  snippet,
  query,
  selectMode,
  selected,
  pinned,
  unread,
  tr,
  onOpen,
  onToggleSelect
}) {
  const statuses = sessionStatuses({ ...node, unread });
  const showStatus = showsStatusDot(statuses, node.completed || unread);
  const selectable = canRecycle(eligibilityOf(node, pinned, unread));
  return (0, import_react9.createElement)(
    "button",
    {
      type: "button",
      className: `dshOneTree_searchRow${selected ? " dshOneTree_selected" : ""}`,
      role: "treeitem",
      // 行标记（自有契约）：验证套件按它数「结果里有几行」——与树里的会话行
      // `data-dshone-tree-row="session"` 同一个用途（F-12/F-18 都读它）。
      "data-dshone-tree-row": "search",
      "aria-selected": selected,
      // 行上带的会话 id 与勾选态（与树里的会话行同一套标记，验证套件据此认行）。
      "data-dshone-tree-session": node.id,
      ...selectMode ? { "data-dshone-tree-checked": selected, "data-dshone-tree-check": selectable ? "eligible" : "blocked" } : {},
      onClick: selectMode ? selectable ? onToggleSelect : () => {
      } : onOpen,
      children: [
        (0, import_react9.createElement)("span", {
          key: "heading",
          className: "dshOneTree_searchRowHeading",
          children: [
            selectMode ? (0, import_react9.createElement)(
              "span",
              {
                key: "check",
                className: "dshOneTree_check",
                ...selectable ? {} : { title: tr("protect.recycle.pinned") }
              },
              (0, import_react9.createElement)(SelectMark, { on: selected, disabled: !selectable })
            ) : showStatus ? (0, import_react9.createElement)(SessionStatusDots, { key: "status", statuses, tr }) : (0, import_react9.createElement)("span", { key: "status", className: "dshOneTree_slot" }),
            pinned ? (0, import_react9.createElement)(PinMark, { key: "pin", sessionId: node.id }) : null,
            (0, import_react9.createElement)(
              "span",
              { key: "title", className: `dshOneTree_searchRowTitle${unread ? " dshOneTree_unread" : ""}` },
              ...highlightMatches(displayTitle(node, tr), query)
            ),
            // 同样补上活跃定时任务标记（官方 `SearchResultItem` 的 `search: true` 变体）。
            node.hasActiveSchedule ? (0, import_react9.createElement)(ActiveScheduleIndicator, { key: "schedule", tr, search: true }) : null
          ]
        }),
        (0, import_react9.createElement)("span", {
          key: "meta",
          className: "dshOneTree_searchRowMeta",
          children: [
            (0, import_react9.createElement)(
              "span",
              { key: "ws", className: "dshOneTree_searchRowWorkspace" },
              ...highlightMatches(workspaceLabel || tr("group.ungrouped"), query)
            ),
            snippet === void 0 || snippet === "" ? null : (0, import_react9.createElement)("span", { key: "snip", className: "dshOneTree_searchRowSnippet" }, ...highlightMatches(snippet, query))
          ]
        })
      ]
    }
  );
}
function ActivityBadge({ counts, tr }) {
  return (0, import_react9.createElement)(
    "span",
    {
      className: "dshOneTree_activity",
      "data-dshone-tree-activity": `${String(counts.running)}/${String(counts.waiting)}/${String(counts.unread)}`
    },
    counts.running > 0 ? (0, import_react9.createElement)(
      "span",
      { className: "dshOneTree_activityItem", "data-dshone-tree-running": counts.running, title: tr("activity.running", { n: counts.running }) },
      (0, import_react9.createElement)(import_dsh_client_ui_primitives6.StateDot, { state: "ongoing" }),
      String(counts.running)
    ) : null,
    counts.waiting > 0 ? (0, import_react9.createElement)(
      "span",
      { className: "dshOneTree_activityItem", "data-dshone-tree-waiting": counts.waiting, title: tr("activity.waiting", { n: counts.waiting }) },
      (0, import_react9.createElement)(import_dsh_client_ui_primitives6.StateDot, { state: "warning" }),
      String(counts.waiting)
    ) : null,
    counts.unread > 0 ? (0, import_react9.createElement)(
      "span",
      { className: "dshOneTree_activityItem", "data-dshone-tree-unread": counts.unread, title: tr("activity.unread", { n: counts.unread }) },
      (0, import_react9.createElement)(import_dsh_client_ui_primitives6.StateDot, { state: "done" }),
      String(counts.unread)
    ) : null
  );
}

// src/ui/assembly/shell/workspaceTree/recycleDrawer.ts
var DRAWER_HEIGHT_DEFAULT = 0.5;
var DRAWER_HEIGHT_EXPANDED = 0.9;
var DRAWER_HEIGHT_MIN = 0.15;
var DRAWER_HEIGHT_MAX = 0.97;
var DRAWER_CLOSE_BELOW = 0.35;
var DRAWER_CLICK_SLOP = 4;
var DRAWER_EXIT_SLACK_MS = 60;
function transitionMsOf(element) {
  const parts = getComputedStyle(element).transitionDuration.split(",");
  let longest = 0;
  for (const part of parts) {
    const value = Number.parseFloat(part);
    if (!Number.isFinite(value)) continue;
    const ms = part.trim().endsWith("ms") ? value : value * 1e3;
    longest = Math.max(longest, ms);
  }
  return longest;
}
function RecycleDrawer({
  open: open2,
  groups,
  collapsed,
  now,
  tr,
  busy,
  error,
  pinned,
  unread,
  onClose,
  onToggleGroup,
  onOpen,
  onRestore,
  onArchive,
  onEmpty,
  onRestoreAll
}) {
  const drawerRef = (0, import_react10.useRef)(null);
  const [phase, setPhase] = (0, import_react10.useState)("closed");
  const [dragHeight, setDragHeight] = (0, import_react10.useState)(null);
  const [snapHeight, setSnapHeight] = (0, import_react10.useState)(null);
  (0, import_react10.useEffect)(() => {
    if (open2) {
      setPhase("entering");
      return;
    }
    setSnapHeight(null);
    setPhase((prev) => prev === "closed" ? "closed" : "leaving");
  }, [open2]);
  (0, import_react10.useEffect)(() => {
    if (phase !== "entering") return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPhase("open"));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [phase]);
  (0, import_react10.useEffect)(() => {
    if (phase !== "leaving") return;
    const drawer = drawerRef.current;
    const finish = () => setPhase((prev) => prev === "leaving" ? "closed" : prev);
    const onEnd = (event) => {
      if (event.target === drawer && event.propertyName === "transform") finish();
    };
    drawer?.addEventListener("transitionend", onEnd);
    const timer = setTimeout(finish, (drawer === null ? 0 : transitionMsOf(drawer)) + DRAWER_EXIT_SLACK_MS);
    return () => {
      drawer?.removeEventListener("transitionend", onEnd);
      clearTimeout(timer);
    };
  }, [phase]);
  (0, import_react10.useEffect)(() => {
    if (!open2) return;
    const onPointerDown = (event) => {
      const drawer = drawerRef.current;
      const root = drawer?.parentElement ?? null;
      const target = event.target;
      if (drawer === null || root === null || !(target instanceof Node)) return;
      if (drawer.contains(target) || !root.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [open2, onClose]);
  (0, import_react10.useEffect)(() => {
    if (!open2) return;
    const onKey = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open2, onClose]);
  const startDrag = (event) => {
    if (event.button !== 0) return;
    const drawer = drawerRef.current;
    const panel = drawer?.parentElement ?? null;
    if (drawer === null || panel === null) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startY = event.clientY;
    const panelHeight = Math.max(1, panel.offsetHeight);
    const baseRatio = drawer.offsetHeight / panelHeight;
    let maxDelta = 0;
    let lastRatio = baseRatio;
    try {
      handle?.setPointerCapture(event.pointerId);
    } catch {
    }
    const move = (ev) => {
      maxDelta = Math.max(maxDelta, Math.abs(startY - ev.clientY));
      const ratio = baseRatio + (startY - ev.clientY) / panelHeight;
      lastRatio = Math.min(DRAWER_HEIGHT_MAX, Math.max(DRAWER_HEIGHT_MIN, ratio));
      setDragHeight(lastRatio);
    };
    const up = () => {
      handle?.removeEventListener("pointermove", move);
      handle?.removeEventListener("pointerup", up);
      handle?.removeEventListener("pointercancel", up);
      setDragHeight(null);
      if (maxDelta < DRAWER_CLICK_SLOP || lastRatio < DRAWER_CLOSE_BELOW) {
        onClose();
        return;
      }
      setSnapHeight(
        lastRatio >= (DRAWER_HEIGHT_DEFAULT + DRAWER_HEIGHT_EXPANDED) / 2 ? DRAWER_HEIGHT_EXPANDED : DRAWER_HEIGHT_DEFAULT
      );
    };
    handle?.addEventListener("pointermove", move);
    handle?.addEventListener("pointerup", up);
    handle?.addEventListener("pointercancel", up);
  };
  if (phase === "closed") return null;
  const total = recycleCount(groups);
  const height = dragHeight ?? snapHeight ?? DRAWER_HEIGHT_DEFAULT;
  const headerAction = (kind) => {
    const label = kind === "empty" ? tr("recycle.emptyAll") : tr("recycle.restoreAll");
    return (0, import_react10.createElement)(import_dsh_client_ui_primitives7.Tooltip, {
      label,
      side: "top",
      delayMs: 500,
      children: (0, import_react10.createElement)(
        "button",
        {
          type: "button",
          className: `dshOneTree_drawerIconButton${kind === "empty" ? " dshOneTree_drawerIconDanger" : ""}`,
          "aria-label": label,
          "data-dshone-tree-action": kind === "empty" ? "recycle-drawer-empty-all" : "recycle-drawer-restore-all",
          disabled: total === 0,
          onClick: kind === "empty" ? onEmpty : onRestoreAll
        },
        kind === "empty" ? (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconTrashOutline16, { size: 14 }) : (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconRefreshOutline16, { size: 14 })
      )
    });
  };
  return (0, import_react10.createElement)(
    "div",
    {
      className: `dshOneTree_drawer${phase === "open" ? " dshOneTree_drawerOpen" : ""}${phase === "leaving" ? " dshOneTree_drawerLeaving" : ""}`,
      style: { height: `${String(height * 100)}%` },
      ref: drawerRef,
      "data-dshone-tree": "recycle-drawer",
      "data-dshone-recycle-height": String(Math.round(height * 100)),
      role: "region",
      "aria-label": tr("recycle.title")
    },
    (0, import_react10.createElement)(
      "div",
      {
        className: "dshOneTree_drawerHandle",
        "data-dshone-tree-action": "recycle-handle",
        title: tr("recycle.handle"),
        onPointerDown: startDrag
      },
      (0, import_react10.createElement)("span", { className: "dshOneTree_drawerGrip" })
    ),
    (0, import_react10.createElement)(
      "div",
      { className: "dshOneTree_drawerHeader" },
      // 返回（接手原来那枚 ✕）：同一个动作、同一个标记，见文件头 #154 那一节。
      (0, import_react10.createElement)(
        "button",
        {
          type: "button",
          className: "dshOneTree_iconButton",
          "aria-label": tr("recycle.back"),
          title: tr("recycle.back"),
          // 图标名（自有契约，与入口行主区那枚 `data-dshone-tree-icon` 同一做法）：
          // 官方组件渲染出来的 DOM 里没有图标名，验证套件要认「组件」只能靠标记 + 渲染指纹。
          "data-dshone-tree-icon": "IconChevronLeftOutline14",
          "data-dshone-tree-action": "recycle-close",
          onClick: onClose
        },
        (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconChevronLeftOutline14, {})
      ),
      (0, import_react10.createElement)(
        "span",
        { className: "dshOneTree_drawerHeading" },
        (0, import_react10.createElement)("span", { className: "dshOneTree_drawerTitle" }, tr("recycle.title")),
        (0, import_react10.createElement)("span", { className: "dshOneTree_drawerCount", "data-dshone-recycle-count": total }, String(total))
      ),
      headerAction("empty"),
      headerAction("restoreAll")
    ),
    total === 0 ? (0, import_react10.createElement)("div", { className: "dshOneTree_drawerStatus" }, tr("recycle.empty")) : (0, import_react10.createElement)(
      "div",
      { className: "dshOneTree_drawerList" },
      groups.map(
        (group) => (0, import_react10.createElement)(RecycleBlock, {
          key: group.key,
          group,
          collapsed: collapsed.includes(group.key),
          now,
          tr,
          busy,
          pinned,
          unread,
          onToggle: () => onToggleGroup(group.key),
          onOpen,
          onRestore,
          onArchive
        })
      )
    ),
    error === null ? null : (0, import_react10.createElement)("div", { className: "dshOneTree_selectionError", role: "alert" }, error)
  );
}
function RecycleBlock({
  group,
  collapsed,
  now,
  tr,
  busy,
  pinned,
  unread,
  onToggle,
  onOpen,
  onRestore,
  onArchive
}) {
  const label = group.workspaceId === void 0 ? tr("group.ungrouped") : group.label;
  return (0, import_react10.createElement)(
    "div",
    { className: "dshOneTree_drawerGroup", "data-dshone-recycle-group": group.key },
    (0, import_react10.createElement)(
      "button",
      {
        type: "button",
        className: "dshOneTree_drawerGroupLabel",
        "data-dshone-recycle-group-toggle": group.key,
        "data-dshone-recycle-collapsed": collapsed ? "true" : "false",
        "aria-expanded": !collapsed,
        onClick: onToggle
      },
      (0, import_react10.createElement)(
        "span",
        { className: "dshOneTree_drawerGroupArrow" },
        (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconTriangleRightFill14, { className: `dshOneTree_arrow${collapsed ? "" : " dshOneTree_arrowOpen"}` })
      ),
      (0, import_react10.createElement)("span", { className: "dshOneTree_drawerGroupLabelText" }, label),
      (0, import_react10.createElement)("span", { className: "dshOneTree_drawerGroupCount" }, String(group.sessions.length))
    ),
    collapsed ? null : group.sessions.map(
      (node) => (0, import_react10.createElement)(RecycleRow, {
        key: node.id,
        node,
        now,
        tr,
        busy,
        pinned: pinned.has(node.id),
        unread: unread.has(node.id),
        onOpen,
        onRestore,
        onArchive
      })
    )
  );
}
function RecycleRow({
  node,
  now,
  tr,
  busy,
  pinned,
  unread,
  onOpen,
  onRestore,
  onArchive
}) {
  const title = displayTitle(node, tr);
  const [menuAt, setMenuAt] = (0, import_react10.useState)(null);
  const statuses = sessionStatuses({ ...node, unread });
  const showStatus = showsStatusDot(statuses, node.completed || unread);
  const menuItems = [
    {
      id: "restore",
      label: (0, import_react10.createElement)("span", { "data-dshone-tree-item": "recycle-restore" }, tr("recycle.restore")),
      icon: (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconRefreshOutline16, { size: 14 }),
      disabled: busy
    },
    {
      id: "archive",
      label: (0, import_react10.createElement)("span", { "data-dshone-tree-item": "recycle-archive" }, tr("menu.archiveForever")),
      icon: (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconTrashOutline16, { size: 14 }),
      disabled: busy
    }
  ];
  return (0, import_react10.createElement)(
    "div",
    {
      className: `dshOneTree_drawerRow${menuAt === null ? "" : " dshOneTree_menuOpen"}`,
      role: "treeitem",
      "data-dshone-recycle-row": node.id,
      onClick: () => onOpen(node.id),
      // 右键开同一份菜单（主树会话行的处置：`preventDefault` 压掉原生菜单、锚在指针处）。
      onContextMenu: (event) => {
        event.preventDefault();
        event.stopPropagation();
        setMenuAt({ x: event.clientX, y: event.clientY });
      }
    },
    // 状态槽：与主树同一条规则——空闲档也留这一格（16×20），标题因此落在同一列上。
    showStatus ? (0, import_react10.createElement)(SessionStatusDots, { key: "status", statuses, tr }) : (0, import_react10.createElement)("span", { key: "status", className: "dshOneTree_slot" }),
    pinned ? (0, import_react10.createElement)(PinMark, { key: "pin", sessionId: node.id }) : null,
    (0, import_react10.createElement)("span", { key: "title", className: `dshOneTree_title${unread ? " dshOneTree_unread" : ""}` }, title),
    (0, import_react10.createElement)("span", { key: "time", className: "dshOneTree_time" }, timeLabel(node.updatedAt, now, tr)),
    // 右键菜单（锚点零尺寸、见组件说明）。
    (0, import_react10.createElement)(import_dsh_client_ui_primitives7.Menu, {
      key: "menu",
      open: menuAt !== null,
      onClose: () => setMenuAt(null),
      items: menuItems,
      onSelect: (id) => {
        setMenuAt(null);
        if (id === "restore") onRestore(node.id);
        if (id === "archive") onArchive(node.id);
      },
      // 与侧栏其它菜单同一档（#113 的紧凑档），项上带自有标记供验证套件认项。
      compact: true,
      portal: true,
      closeOnPointerLeave: true,
      anchor: (0, import_react10.createElement)("span", { className: "dshOneTree_menuAnchor", "aria-hidden": true }),
      ...menuAt === null ? {} : { getAnchorRect: () => new DOMRect(menuAt.x, menuAt.y, 0, 0) }
    }),
    (0, import_react10.createElement)(
      "span",
      { key: "actions", className: "dshOneTree_drawerActions" },
      (0, import_react10.createElement)(import_dsh_client_ui_primitives7.Tooltip, {
        label: tr("recycle.restore"),
        side: "top",
        delayMs: 500,
        children: (0, import_react10.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_drawerAction",
            disabled: busy,
            "aria-label": tr("recycle.restore.aria", { name: title }),
            "data-dshone-recycle-restore": node.id,
            onClick: (event) => {
              event.stopPropagation();
              onRestore(node.id);
            }
          },
          (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconRefreshOutline16, {})
        )
      }),
      (0, import_react10.createElement)(import_dsh_client_ui_primitives7.Tooltip, {
        label: tr("menu.archiveForever"),
        side: "top",
        delayMs: 500,
        children: (0, import_react10.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_drawerAction dshOneTree_drawerActionDanger",
            disabled: busy,
            "aria-label": tr("recycle.archive.aria", { name: title }),
            "data-dshone-recycle-archive": node.id,
            onClick: (event) => {
              event.stopPropagation();
              onArchive(node.id);
            }
          },
          (0, import_react10.createElement)(import_dsh_client_ui_primitives7.IconTrashOutline16, {})
        )
      })
    )
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
  '.dshOneTree_root{--dsh-session-list-edge-inset:var(--dsh-sidebar-inline-padding);--dsh-session-list-scrollbar-width:8px;--dsh-session-list-scrollbar-offset:2px;box-sizing:border-box;min-height:0;padding-right:var(--dsh-session-list-edge-inset);overflow:hidden;flex-direction:column;flex:1;display:flex;position:relative}.dshOneTree_iconButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_iconButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_sectionHeader{box-sizing:border-box;height:var(--dsh-one-density-section-header-height,36px);color:var(--dsw-alias-label-tertiary);border-radius:12px;flex:none;justify-content:flex-end;align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin-bottom:var(--dsh-one-density-section-header-gap,4px);padding-left:var(--dsh-one-density-section-padding-inline,4px);padding-right:calc(4px + var(--dsh-session-list-scrollbar-offset) + var(--dsh-session-list-scrollbar-width) + var(--dsh-one-density-row-padding-inline,8px));display:flex;overflow:hidden;margin-top:2px;margin-right:-4px}.dshOneTree_searchSlot{box-sizing:border-box;min-width:0;max-width:var(--dsh-one-density-icon-button-size,28px);transition:max-width .18s var(--ds-ease-in-out),padding-left .18s var(--ds-ease-in-out);flex:1 0 auto;align-items:center;margin-left:auto;padding-left:0;display:flex}.dshOneTree_searchSlotExpanded{max-width:100%;padding-left:calc(var(--dsh-one-density-row-padding-inline,8px) - var(--dsh-one-density-section-padding-inline,4px) + 2px)}.dshOneTree_headerActions{opacity:1;visibility:visible;max-width:100%;flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);transition:max-width .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),transform .18s var(--ds-ease-in-out),visibility 0s linear;display:flex;overflow:hidden}.dshOneTree_headerActionsHidden{opacity:0;pointer-events:none;visibility:hidden;max-width:0;transform:translate(4px);transition-delay:0s,0s,0s,.18s}.dshOneTree_search{box-sizing:border-box;cursor:text;width:100%;height:var(--dsh-one-density-search-height,28px);color:var(--dsw-alias-label-secondary);transition:width .18s var(--ds-ease-in-out),padding .18s var(--ds-ease-in-out),border-color .18s var(--ds-ease-in-out),background-color .18s var(--ds-ease-in-out);background:0 0;border:none;border-radius:50%;flex:none;align-items:center;gap:0;margin:0;padding:0;display:flex;overflow:hidden}.dshOneTree_searchExpanded{border:.5px solid var(--dsw-alias-border-l4);width:calc(100% + 4px);height:var(--dsh-one-density-search-expanded-height,30px);color:var(--dsw-alias-label-caption);background:0 0;border-radius:10px;margin-inline:-2px;padding:0 4px 0 0}.dshOneTree_searchButton{cursor:pointer;width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-icon-button-size,28px);color:inherit;background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_searchExpanded .dshOneTree_searchButton{width:var(--dsh-one-density-icon-button-size,28px);height:var(--dsh-one-density-search-expanded-height,30px)}.dshOneTree_searchButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_searchExpanded .dshOneTree_searchButton:hover{background:0 0}.dshOneTree_searchInput{opacity:0;pointer-events:none;width:0;min-width:0;color:var(--dsw-alias-label-primary);transition:opacity .12s var(--ds-ease-in-out);background:0 0;border:none;outline:none;flex:1;font-size:13px;line-height:18px}.dshOneTree_searchExpanded .dshOneTree_searchInput{opacity:1;pointer-events:auto;margin-left:-2px}.dshOneTree_searchInput::placeholder{color:var(--dsw-alias-label-tertiary)}.dshOneTree_clearButton{cursor:pointer;width:24px;height:24px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_clearButton:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_listArea{min-height:0;margin-left:-4px;margin-right:calc(-1 * var(--dsh-session-list-edge-inset));flex-direction:column;flex:1;padding-left:4px;display:flex;overflow:visible}.dshOneTree_list{min-height:0;margin-left:-4px;margin-right:var(--dsh-session-list-scrollbar-offset);padding-left:4px;padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset));scrollbar-gutter:stable;flex:1;padding-bottom:var(--dsh-one-density-list-padding-bottom,16px);overflow-y:auto}.dshOneTree_groupSection>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}.dshOneTree_groupSection{position:relative}.dshOneTree_groupSection+.dshOneTree_groupSection{margin-top:var(--dsh-one-density-group-gap,4px)}.dshOneTree_searchStatus,.dshOneTree_searchWarning{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:12px;line-height:18px}.dshOneTree_searchWarning{color:var(--dsw-alias-label-secondary)}.dshOneTree_empty{color:var(--dsw-alias-label-tertiary);padding:16px 12px;font-size:13px}.dshOneTree_emptyLine+.dshOneTree_emptyLine{margin-top:2px}.dshOneTree_emptyAction{cursor:pointer;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:5px;flex:none;align-items:center;margin-top:8px;padding:0 10px;font-family:inherit;font-size:12px;display:inline-flex}.dshOneTree_emptyAction:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_sessionOverflowButton{cursor:pointer;text-align:left;width:100%;height:var(--dsh-one-density-overflow-row-height,28px);color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);padding:0 12px 0 28px;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_sessionOverflowButton:hover{color:var(--dsw-alias-label-secondary);background:0 0}.dshOneTree_projectRow,.dshOneTree_sessionRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:var(--dsh-one-density-row-radius,8px);align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_projectRow:hover,.dshOneTree_sessionRow:hover,.dshOneTree_sessionRow.dshOneTree_selected,.dshOneTree_projectRow.dshOneTree_menuOpen,.dshOneTree_sessionRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_projectRow{box-sizing:border-box;align-items:center;height:var(--dsh-one-density-row-height,34px)}.dshOneTree_projectRow .dshOneTree_rowActions{height:20px}.dshOneTree_sessionRow{height:var(--dsh-one-density-session-row-height,32px);gap:0}.dshOneTree_dragging{opacity:.45}.dshOneTree_sessionRow .dshOneTree_title{flex:1;margin:0 6px 0 4px}.dshOneTree_inlineRenameInput{box-sizing:border-box;flex:1;min-width:0;height:var(--dsh-one-density-title-line-height,20px);margin:0 6px 0 4px;padding:0 4px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;outline:none;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);user-select:text}.dshOneTree_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}.dshOneTree_folderActive{color:var(--dsw-alias-state-business-primary)}.dshOneTree_projectRow .dshOneTree_chevron{display:none}.dshOneTree_projectRow:hover .dshOneTree_chevron{display:inline-flex}.dshOneTree_projectRow:hover .dshOneTree_folder{display:none}.dshOneTree_arrow{transition:transform .15s var(--ds-ease-in-out)}.dshOneTree_arrowOpen{transform:rotate(90deg)}.dshOneTree_projectText{flex-direction:column;flex:1;gap:2px;min-width:0;display:flex}.dshOneTree_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}.dshOneTree_projectRow .dshOneTree_title{display:flex;align-items:center}.dshOneTree_projectRow .dshOneTree_titleText{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.dshOneTree_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}.dshOneTree_scheduleIndicator{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;margin-right:6px;display:inline-flex}.dshOneTree_searchScheduleIndicator{margin-left:4px;margin-right:0}.dshOneTree_dot{flex:none}.dshOneTree_rowActions{flex:none;align-items:center;gap:12px;display:none}.dshOneTree_projectRow:hover .dshOneTree_rowActions,.dshOneTree_sessionRow:hover .dshOneTree_rowActions,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowActions,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}.dshOneTree_sessionRow:hover .dshOneTree_time,.dshOneTree_sessionRow.dshOneTree_menuOpen .dshOneTree_time{display:none}.dshOneTree_rowIconButton{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_rowIconButton:hover{color:var(--dsw-alias-label-primary)}.dshOneTree_chevron{color:var(--dsw-alias-label-caption)}.dshOneTree_searchRow{box-sizing:border-box;cursor:pointer;text-align:left;width:100%;min-height:var(--dsh-one-density-search-row-min-height,48px);color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);flex-direction:column;align-items:stretch;padding:4px var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_searchRow:hover,.dshOneTree_searchRow.dshOneTree_selected{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_searchRowHeading{align-items:center;min-width:0;display:flex}.dshOneTree_searchRowTitle{text-overflow:ellipsis;white-space:nowrap;flex:0 auto;min-width:0;margin-left:4px;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);overflow:hidden}.dshOneTree_searchRowMeta{align-items:center;gap:6px;min-width:0;margin-left:20px;display:flex}.dshOneTree_searchRowWorkspace,.dshOneTree_searchRowSnippet{text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:17px;overflow:hidden}.dshOneTree_searchRowWorkspace{max-width:40%;color:var(--dsw-alias-label-tertiary);flex:none}.dshOneTree_searchRowSnippet{min-width:0;color:var(--dsw-alias-label-secondary);flex:1}.dshOneTree_searchMark{font-weight:600;color:var(--dsw-alias-state-business-primary);background:none}.dshOneTree_hoverContent{flex-direction:column;gap:8px;display:flex}.dshOneTree_hoverTitle{color:#fff;overflow-wrap:break-word;font-size:14px;line-height:20px}.dshOneTree_hoverPath{color:#cfd3d6;word-break:break-all;font-size:12px;line-height:16px}.dshOneTree_hoverTime{color:#cfd3d6;font-size:12px;line-height:16px}.dshOneTree_hoverStatus{color:#adb2b8;align-items:center;gap:8px;font-size:12px;line-height:20px;display:flex}.dshOneTree_modal{box-sizing:border-box;gap:6px;padding:12px;border-radius:12px}.dshOneTree_modalHead{flex:none;align-items:center;gap:2px;height:26px;display:flex}.dshOneTree_modalTitle{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;font-size:14px;line-height:20px;font-weight:500;overflow:hidden}.dshOneTree_modalClose{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:5px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_modalClose:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_modalDesc{color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px}.dshOneTree_modalActions{flex:none;justify-content:flex-end;align-items:center;gap:6px;display:flex}.dshOneTree_renameInput{box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l4);width:100%;height:26px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:5px;outline:none;padding:0 7px;font-size:12px;font-weight:400;line-height:18px}.dshOneTree_renameInput::placeholder{color:var(--dsw-alias-label-tertiary)}.dshOneTree_renameError{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}.dshOneTree_deleteStatus{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}.dshOneTree_deleteAction:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dshOneTree_filterBar{align-items:center;box-sizing:border-box;min-width:0;max-width:100%;opacity:1;visibility:visible;gap:var(--dsh-one-density-section-gap,4px);margin:0 0 0 calc(-1 * var(--dsh-one-density-section-padding-inline,4px));padding-left:var(--dsh-one-density-row-padding-inline,8px);transition:max-width .18s var(--ds-ease-in-out),opacity .12s var(--ds-ease-in-out),transform .18s var(--ds-ease-in-out),visibility 0s linear;display:flex;overflow:hidden}.dshOneTree_filterBarHidden{opacity:0;pointer-events:none;visibility:hidden;box-sizing:border-box;max-width:0;margin-left:calc(-1 * var(--dsh-one-density-section-gap,4px));padding-left:0;transform:translate(-4px);transition-delay:0s,0s,0s,.18s}.dshOneTree_pillSlot{min-width:0;flex:1 1 auto}.dshOneTree_pill{cursor:pointer;height:var(--dsh-one-density-pill-height,28px);color:var(--dsw-alias-label-secondary);background:0 0;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;flex:1 1 auto;min-width:0;align-items:center;gap:var(--dsh-one-density-section-gap,4px);max-width:100%;padding:0 var(--dsh-one-density-pill-padding-end,4px) 0 var(--dsh-one-density-pill-padding-start,8px);font-size:var(--dsh-one-density-pill-font-size,13px);display:inline-flex;overflow:hidden}.dshOneTree_pill:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_pillActive{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l4);background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_pillTag{flex:none;align-items:center;color:var(--dsw-alias-label-tertiary);display:inline-flex}.dshOneTree_pillLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.dshOneTree_pillCount{color:var(--dsw-alias-label-tertiary);flex:none}.dshOneTree_pillChevron{color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;display:inline-flex}.dshOneTree_menuRow{align-items:center;gap:6px;min-width:0;width:100%;display:flex}.dshOneTree_menuRowLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}.dshOneTree_menuRowCount{color:var(--dsw-alias-label-tertiary);flex:none}[role="menuitem"]:has(.dshOneTree_submenuItem){padding-left:7px}.dshOneTree_footerRow{box-sizing:border-box;flex:none;width:100%;align-items:center;gap:2px;padding-right:8px;display:flex}.dshOneTree_footerRowEmpty{color:var(--dsw-alias-label-tertiary)}.dshOneTree_footerMain{cursor:pointer;min-width:0;line-height:var(--dsh-one-density-title-line-height,20px);color:inherit;background:0 0;border:0;border-radius:0;flex:1;align-items:center;gap:6px;padding:7px 4px 7px var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-title-font-size,14px);display:inline-flex;overflow:hidden}.dshOneTree_footerMain:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_footerIcon{flex:none;align-items:center;display:inline-flex}.dshOneTree_footerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}.dshOneTree_footerCount{color:var(--dsw-alias-label-tertiary);background:color-mix(in srgb,var(--dsw-alias-label-tertiary) 20%,transparent);border-radius:8px;flex:none;font-size:10px;line-height:16px;padding:0 5px}.dshOneTree_footerRowEmpty .dshOneTree_footerCount{background:0 0;padding:0}.dshOneTree_footerIconButton,.dshOneTree_drawerIconButton{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:50%;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_footerIconButton:disabled,.dshOneTree_drawerIconButton:disabled{cursor:default;opacity:.45}.dshOneTree_footerIconButton:not(:disabled):hover,.dshOneTree_drawerIconButton:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_manageList{max-height:240px;overflow-y:auto}.dshOneTree_manageRow{align-items:center;gap:6px;height:26px;display:flex}.dshOneTree_manageHandle{cursor:grab;width:16px;height:24px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_manageHandle:active{cursor:grabbing}.dshOneTree_manageRowDragging{opacity:.55}.dshOneTree_manageRow[data-dshone-group-drop="before"]{box-shadow:0 -2px 0 0 var(--dsw-alias-state-business-primary)}.dshOneTree_manageRow[data-dshone-group-drop="after"]{box-shadow:0 2px 0 0 var(--dsw-alias-state-business-primary)}.dshOneTree_manageName{cursor:pointer;text-align:left;color:inherit;background:0 0;border:none;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;padding:0;font-family:inherit;font-size:12px;line-height:18px;overflow:hidden}.dshOneTree_manageName:hover{color:var(--dsw-alias-label-secondary)}.dshOneTree_manageCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:18px}.dshOneTree_manageEmpty{color:var(--dsw-alias-label-tertiary);padding:4px 0;font-size:12px;line-height:18px}.dshOneTree_manageCreate{align-items:center;gap:6px;display:flex}.dshOneTree_manageCreate .dshOneTree_renameInput{flex:1;min-width:0}.dshOneTree_manageCreate button{white-space:nowrap;flex:none}.dshOneTree_modalBack{cursor:pointer;width:26px;height:26px;color:var(--dsw-alias-label-secondary);background:0 0;border:none;border-radius:5px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_modalBack:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_memberTools{flex-wrap:wrap;align-items:center;gap:6px;display:flex}.dshOneTree_memberTools .dshOneTree_renameInput{flex:1;min-width:0}.dshOneTree_memberTools button{white-space:nowrap;flex:none}.dshOneTree_memberCount{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dshOneTree_memberList{max-height:240px;overflow-y:auto}.dshOneTree_memberRow{cursor:pointer;text-align:left;width:100%;height:26px;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:5px;align-items:center;gap:6px;padding:0;font-family:inherit;font-size:12px;line-height:18px;display:flex}.dshOneTree_memberRow:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_memberName{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;overflow:hidden}.dshOneTree_memberEmpty{color:var(--dsw-alias-label-tertiary);padding:4px 0;font-size:12px;line-height:18px}.dshOneTree_rowEnd{pointer-events:none;flex:none;margin-left:auto;align-items:center;gap:6px;display:inline-flex}.dshOneTree_projectRow:hover .dshOneTree_rowEnd,.dshOneTree_projectRow.dshOneTree_menuOpen .dshOneTree_rowEnd{display:none}.dshOneTree_workspaceBadge{flex:none;height:16px;color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);border:.5px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);border-radius:10px;align-items:center;padding:0 4px;font-size:11px;line-height:16px;display:inline-flex}.dshOneTree_menuAnchor{display:none}.dshOneTree_activity{flex:none;margin-left:6px;align-items:center;gap:6px;display:inline-flex}.dshOneTree_activityItem{color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px);align-items:center;gap:4px;display:inline-flex}.dshOneTree_check{cursor:pointer;width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_checkBox{box-sizing:border-box;width:14px;height:14px;border:.5px solid var(--dsw-alias-border-l4);border-radius:4px;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_checkOn{background:var(--dsw-alias-state-business-primary);border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-label-inverse,#fff)}.dshOneTree_checkOff{opacity:.35;cursor:default}.dshOneTree_checkDash{width:8px;height:2px;background:currentColor;border-radius:1px}.dshOneTree_groupCheck{flex:none;cursor:pointer}.dshOneTree_checkIndent{width:22px;flex:none}.dshOneTree_pin{flex:none;width:14px;height:14px;margin-right:4px;color:var(--dsw-alias-label-tertiary);align-items:center;display:inline-flex}.dshOneTree_unread{font-weight:600}.dshOneTree_selectionBarWrap{flex:none;background:var(--dsw-alias-interactive-bg-hover);border-top:.5px solid var(--dsw-alias-border-l3);border-bottom:.5px solid var(--dsw-alias-border-l3);margin:0 0 var(--dsh-one-density-group-gap,4px);padding:var(--dsh-one-density-section-gap,4px) 0}.dshOneTree_selectionBar{box-sizing:border-box;flex-wrap:wrap;align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_selectionCount{color:var(--dsw-alias-label-secondary);flex:none;white-space:nowrap;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}.dshOneTree_selectionActions{flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:var(--dsh-one-density-section-gap,4px);margin-left:auto;display:flex}.dshOneTree_selectionActions button{flex:none;white-space:nowrap}.dshOneTree_selectionError{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-one-density-meta-font-size,12px);padding:0 var(--dsh-one-density-row-padding-inline,8px) var(--dsh-one-density-section-gap,4px)}.dshOneTree_drawer{z-index:10;box-sizing:border-box;background:var(--dsw-alias-bg-base);border-top:.5px solid var(--dsw-alias-border-l3);position:absolute;left:0;right:0;bottom:0;transform:translateY(100%);transition:transform var(--ds-transition-duration) var(--ds-ease-in-out);flex-direction:column;display:flex;overflow:hidden}.dshOneTree_drawerOpen{transform:none}.dshOneTree_drawerLeaving{pointer-events:none}@media (prefers-reduced-motion:reduce){.dshOneTree_drawer{transition:none}}.dshOneTree_drawerHandle{cursor:grab;height:12px;flex:none;justify-content:center;align-items:center;display:flex;touch-action:none}.dshOneTree_drawerHandle:active{cursor:grabbing}.dshOneTree_drawerGrip{width:32px;height:3px;background:var(--dsw-alias-border-l3);border-radius:2px}.dshOneTree_drawerHandle:hover .dshOneTree_drawerGrip{background:var(--dsw-alias-label-tertiary)}.dshOneTree_drawerHeader{height:var(--dsh-one-density-section-header-height,36px);flex:none;align-items:center;gap:var(--dsh-one-density-section-gap,4px);padding:0 var(--dsh-one-density-section-padding-inline,4px) 0 var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_drawerHeading{flex:1;min-width:0;align-items:center;gap:4px;display:inline-flex}.dshOneTree_drawerTitle{color:var(--dsw-alias-label-secondary);flex:0 1 auto;min-width:0;font-size:var(--dsh-one-density-title-font-size,14px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dshOneTree_drawerCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_drawerList{min-height:0;padding:0 var(--dsh-one-density-section-padding-inline,4px) var(--dsh-one-density-list-padding-bottom,16px) 0;flex:1;overflow-y:auto}.dshOneTree_drawerGroup+.dshOneTree_drawerGroup{margin-top:var(--dsh-one-density-group-gap,4px)}.dshOneTree_drawerGroupLabel{box-sizing:border-box;cursor:pointer;width:100%;color:var(--dsw-alias-label-primary);background:0 0;border:none;border-radius:var(--dsh-one-density-row-radius,8px);height:var(--dsh-one-density-row-height,34px);align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);font-family:inherit;font-size:var(--dsh-one-density-title-font-size,14px);line-height:var(--dsh-one-density-title-line-height,20px);display:flex}.dshOneTree_drawerGroupLabel:hover{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_drawerGroupArrow{width:16px;height:20px;color:var(--dsw-alias-label-caption);flex:none;justify-content:center;align-items:center;display:inline-flex}.dshOneTree_drawerGroupLabelText{text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1;text-align:left;overflow:hidden}.dshOneTree_drawerGroupCount{color:var(--dsw-alias-label-tertiary);flex:none;font-size:var(--dsh-one-density-meta-font-size,12px);line-height:var(--dsh-one-density-meta-line-height,20px)}.dshOneTree_drawerRow{cursor:pointer;height:var(--dsh-one-density-session-row-height,32px);color:var(--dsw-alias-label-primary);border-radius:var(--dsh-one-density-row-radius,8px);align-items:center;gap:6px;padding:0 var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_drawerRow:hover,.dshOneTree_drawerRow.dshOneTree_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}.dshOneTree_drawerRow .dshOneTree_title{flex:1;margin:0}.dshOneTree_drawerActions{flex:none;align-items:center;gap:12px;display:inline-flex}.dshOneTree_drawerRow:hover .dshOneTree_time,.dshOneTree_drawerRow.dshOneTree_menuOpen .dshOneTree_time{display:none}.dshOneTree_drawerAction{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_drawerAction:hover:not(:disabled){color:var(--dsw-alias-label-primary)}.dshOneTree_drawerAction:disabled{cursor:default;opacity:.45}.dshOneTree_drawerActionDanger:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dshOneTree_drawerStatus{color:var(--dsw-alias-label-tertiary);padding:10px 8px;font-size:var(--dsh-one-density-meta-font-size,12px)}.dshOneTree_modalBlocks{max-height:240px;overflow-y:auto}.dshOneTree_modalBlock+.dshOneTree_modalBlock{margin-top:6px}.dshOneTree_modalBlockLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dshOneTree_modalRow{box-sizing:border-box;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;height:26px;font-size:12px;line-height:18px;padding:4px 0 4px 16px;overflow:hidden}.dshOneTree_flash{z-index:20;max-width:90%;background:var(--dsw-alias-bg-elevated,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;padding:6px 10px;font-size:var(--dsh-one-density-meta-font-size,12px);position:absolute;bottom:8px;left:50%;transform:translateX(-50%)}.dshOneTree_footerIconDanger:not(:disabled),.dshOneTree_drawerIconDanger:not(:disabled){color:var(--dsw-alias-state-error-primary)}.dshOneTree_tagBlock{position:relative;border-radius:6px}.dshOneTree_tagHead{align-items:center;height:22px;padding-left:16px;padding-right:var(--dsh-one-density-row-padding-inline,8px);display:flex}.dshOneTree_tagPill{cursor:grab;color:var(--dshone-tag-color);background:color-mix(in srgb,var(--dshone-tag-color) 22%,transparent);border:1px solid color-mix(in srgb,var(--dshone-tag-color) 45%,transparent);border-radius:4px;align-items:center;gap:4px;height:16px;padding:0 7px;font-size:10px;font-weight:600;line-height:1;white-space:nowrap;display:inline-flex}.dshOneTree_tagPill:active{cursor:grabbing}.dshOneTree_tagDot{width:6px;height:6px;background:var(--dshone-tag-color);border-radius:2px;flex:none}.dshOneTree_tagName{text-overflow:ellipsis;white-space:nowrap;max-width:120px;overflow:hidden}.dshOneTree_tagPill[data-dshone-tag-drop="before"]{box-shadow:0 -2px 0 0 var(--dshone-tag-color)}.dshOneTree_tagPill[data-dshone-tag-drop="after"]{box-shadow:0 2px 0 0 var(--dshone-tag-color)}.dshOneTree_tagToggle{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;margin-left:2px;padding:0;display:inline-flex}.dshOneTree_tagToggle:hover{color:var(--dsw-alias-label-primary)}.dshOneTree_tagArrow{transition:transform .15s ease}.dshOneTree_tagArrowOpen{transform:rotate(90deg)}.dshOneTree_tagBlock:hover .dshOneTree_rowActions,.dshOneTree_tagBlock.dshOneTree_menuOpen .dshOneTree_rowActions{display:inline-flex}.dshOneTree_tagCounts{align-items:center;gap:6px;margin-left:auto;padding-right:2px;display:inline-flex}.dshOneTree_tagCount{color:var(--dsw-alias-label-tertiary);align-items:center;gap:4px;font-size:var(--dsh-one-density-meta-font-size,12px);display:inline-flex}.dshOneTree_tagLine{pointer-events:none;position:absolute;left:16px;top:19px;bottom:2px;width:2px;border-radius:1px;background:var(--dshone-tag-color)}.dshOneTree_tagCollapsed .dshOneTree_tagLine{display:none}.dshOneTree_tagRows>*+*{margin-top:var(--dsh-one-density-row-gap,2px)}.dshOneTree_tagRows .dshOneTree_sessionRow{padding-left:24px}.dshOneTree_tagDropActive{background:color-mix(in srgb,var(--dshone-tag-color) 14%,transparent)}.dshOneTree_tagSwatch{width:10px;height:10px;border-radius:3px;flex:none;display:block}.dshOneTree_tagColorPick{gap:6px;display:flex}.dshOneTree_tagColorPickItem{cursor:pointer;width:20px;height:20px;color:var(--dsw-alias-label-inverse,#fff);border:.5px solid var(--dsw-alias-border-l4);border-radius:5px;justify-content:center;align-items:center;padding:0;display:inline-flex}.dshOneTree_tagColorPickOn{box-shadow:0 0 0 2px var(--dsw-alias-label-secondary)}'
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
var import_react12 = require("react");
var import_dsh_client_ui_primitives9 = require("@deepseek-ai/dsh-client-ui-primitives");

// src/ui/assembly/shell/workspaceTree/collapseAllGlyph.ts
var COLLAPSE_ALL_BOX = "M4.5 2.5H11.5A2 2 0 0 1 13.5 4.5V11.5A2 2 0 0 1 11.5 13.5H4.5A2 2 0 0 1 2.5 11.5V4.5A2 2 0 0 1 4.5 2.5ZM4.5 3.7H11.5A0.8 0.8 0 0 1 12.3 4.5V11.5A0.8 0.8 0 0 1 11.5 12.3H4.5A0.8 0.8 0 0 1 3.7 11.5V4.5A0.8 0.8 0 0 1 4.5 3.7Z";
var COLLAPSE_ALL_MINUS = "M5.3 7.35H10.7V8.65H5.3Z";
var COLLAPSE_ALL_PLUS = "M8.65 5.3V7.35H10.7V8.65H8.65V10.7H7.35V8.65H5.3V7.35H7.35V5.3Z";
var COLLAPSE_ALL_GLYPHS = {
  minus: [COLLAPSE_ALL_BOX, COLLAPSE_ALL_MINUS],
  plus: [COLLAPSE_ALL_BOX, COLLAPSE_ALL_PLUS]
};
var COLLAPSE_ALL_GLYPH_SCALE = 1.25;
var COLLAPSE_ALL_GLYPH_TRANSFORM = `translate(8 8) scale(${String(COLLAPSE_ALL_GLYPH_SCALE)}) translate(-8 -8)`;

// src/ui/assembly/shell/workspaceTree/groupFilterBar.ts
var import_react11 = require("react");
var import_dsh_client_ui_primitives8 = require("@deepseek-ai/dsh-client-ui-primitives");
function menuRow(name, count) {
  return (0, import_react11.createElement)(
    "span",
    { className: "dshOneTree_menuRow" },
    (0, import_react11.createElement)("span", { className: "dshOneTree_menuRowLabel" }, name),
    (0, import_react11.createElement)("span", { className: "dshOneTree_menuRowCount" }, String(count))
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
  onManage,
  hidden = false
}) {
  const [open2, setOpen] = (0, import_react11.useState)(false);
  const active = activeGroupId === null ? null : groups.find((group) => group.id === activeGroupId) ?? null;
  const count = active === null ? totalCount : groupCounts.get(active.id) ?? 0;
  const label = active === null ? tr("group.allWorkspaces") : active.name;
  return (0, import_react11.createElement)(
    "div",
    {
      className: `dshOneTree_filterBar${hidden ? " dshOneTree_filterBarHidden" : ""}`,
      "data-dshone-tree": "group-filter",
      "data-dshone-tree-visible": hidden ? "false" : "true",
      role: "group",
      "aria-label": tr("group.filter.aria")
    },
    (0, import_react11.createElement)(import_dsh_client_ui_primitives8.Menu, {
      open: open2,
      onClose: () => setOpen(false),
      items: [
        {
          id: "all",
          label: (0, import_react11.createElement)(
            "span",
            { "data-dshone-tree-pill-item": "all" },
            menuRow(tr("group.allWorkspaces"), totalCount)
          )
        },
        ...groups.map((group) => ({
          id: group.id,
          label: (0, import_react11.createElement)(
            "span",
            { "data-dshone-tree-pill-item": group.id },
            menuRow(group.name, groupCounts.get(group.id) ?? 0)
          )
        })),
        { type: "separator", id: "group-menu-separator" },
        {
          id: "new",
          label: (0, import_react11.createElement)("span", { "data-dshone-tree-action": "group-new" }, tr("group.new")),
          icon: (0, import_react11.createElement)(import_dsh_client_ui_primitives8.IconPlusOutline16, { size: 14 })
        },
        {
          id: "manage",
          label: (0, import_react11.createElement)("span", { "data-dshone-tree-action": "group-manage" }, tr("group.manage")),
          icon: (0, import_react11.createElement)(import_dsh_client_ui_primitives8.IconSettingsOutline16, { size: 14 })
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
      // #113：官方紧凑档（菜单项 26px 高 / 12px 字号 / 图标位 14×14），与胶囊本身
      // （26px 高 / 12px 字号）同档；`separator` 与分组标题的间距也由官方该档给。
      compact: true,
      // #135：这一格是**胶囊在顶栏那一行里的落点**。官方 Menu 会把锚点包进它自己的根
      // `span`（`.bhn…` 那一层：官方 css-module `_root_1nxmc_1{position:relative;
      // display:inline-flex}`），所以真正作为那一行直接子元素的是那层 span，不是胶囊
      // 按钮——窄侧栏下要收得动胶囊，就得让这层收得动。走官方 Menu 公开的 `className`
      // prop（官方组件签名里有它，渲染时 `clsx(root, className)` 挂在根 span 上），
      // 不碰它的内部类名与哈希。
      className: "dshOneTree_pillSlot",
      portal: true,
      closeOnPointerLeave: true,
      anchor: (0, import_react11.createElement)(
        "button",
        {
          type: "button",
          className: `dshOneTree_pill${active === null ? "" : " dshOneTree_pillActive"}`,
          "aria-label": `${tr("group.filter.aria")} - ${label}`,
          "aria-haspopup": "menu",
          "aria-expanded": open2,
          "data-dshone-tree-action": "group-pill",
          "data-dshone-tree-group": active?.id ?? "all",
          "data-dshone-tree-group-count": count,
          onClick: () => setOpen((value) => !value)
        },
        (0, import_react11.createElement)("span", { className: "dshOneTree_pillTag" }, (0, import_react11.createElement)(import_dsh_client_ui_primitives8.IconFolderOpenOutline16, { size: 12 })),
        (0, import_react11.createElement)("span", { className: "dshOneTree_pillLabel" }, label),
        (0, import_react11.createElement)("span", { className: "dshOneTree_pillCount" }, String(count)),
        (0, import_react11.createElement)("span", { className: "dshOneTree_pillChevron" }, (0, import_react11.createElement)(import_dsh_client_ui_primitives8.IconChevronDownOutline14, {}))
      )
    })
  );
}

// src/ui/assembly/shell/workspaceTree/toolbar.ts
function CollapseAllIcon({ glyph }) {
  return (0, import_react12.createElement)(
    "svg",
    {
      viewBox: "0 0 16 16",
      width: 16,
      height: 16,
      fill: "none",
      "aria-hidden": true,
      "data-dshone-tree-icon": "collapse-all",
      "data-dshone-tree-icon-value": glyph
    },
    ...COLLAPSE_ALL_GLYPHS[glyph].map(
      (d, index) => (0, import_react12.createElement)("path", {
        key: String(index),
        d,
        fill: "currentColor",
        "fill-rule": "evenodd",
        "clip-rule": "evenodd",
        transform: COLLAPSE_ALL_GLYPH_TRANSFORM
      })
    )
  );
}
function TopBar(props) {
  const { tr, query, allCollapsed, selectMode } = props;
  const [addOpen, setAddOpen] = (0, import_react12.useState)(false);
  const [searchExpanded, setSearchExpanded] = (0, import_react12.useState)(false);
  const searchRoot = (0, import_react12.useRef)(null);
  const searchInput = (0, import_react12.useRef)(null);
  const trimmedQuery = query.trim();
  (0, import_react12.useEffect)(() => {
    if (searchExpanded) searchInput.current?.focus();
  }, [searchExpanded]);
  (0, import_react12.useEffect)(() => {
    if (!searchExpanded) return;
    const onClick = (event) => {
      const target = event.target;
      if (!(target instanceof Node) || searchRoot.current?.contains(target) === true) return;
      searchInput.current?.blur();
      if (trimmedQuery !== "") return;
      setSearchExpanded(false);
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
    };
  }, [searchExpanded, trimmedQuery]);
  const expandSearch = () => {
    setSearchExpanded(true);
  };
  const collapseSearch = () => {
    props.onQueryClear();
    setSearchExpanded(false);
  };
  const addItems = [
    {
      id: "pick-folder",
      label: (0, import_react12.createElement)("span", { "data-dshone-tree-item": "workspace-pick" }, tr("workspace.pickFolder")),
      // 图标位 14×14：紧凑档的项内图标盒就是 14×14（官方 `._itemIcon_1nxmc_144`），
      // 官方 16 档图标塞进去会溢出一圈，所以按官方给的显式尺寸参数打 14（官方自己也这么用）。
      icon: (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconFolderOpenOutline16, { size: 14 })
    },
    ...props.onCreateWorkspaceFolder === void 0 ? [] : [
      {
        id: "create-folder",
        label: (0, import_react12.createElement)("span", { "data-dshone-tree-item": "workspace-create" }, tr("workspace.create")),
        icon: (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconPlusOutline16, { size: 14 })
      }
    ]
  ];
  return (0, import_react12.createElement)(
    "div",
    { className: "dshOneTree_sectionHeader", "data-dshone-tree": "top-bar" },
    // 行首：分组过滤胶囊（#135 起并入这一行）。搜索展开时它让位（零宽收起，见文件头
    // 让位那一节）——组件照常挂载，`data-dshone-tree-visible` 让验证套件读得到这一刻。
    (0, import_react12.createElement)(GroupFilterBar, { ...props.filter, tr, hidden: searchExpanded }),
    // 官方搜索栏（#132：两态都在，默认折叠）——search / searchSlot 两层各带一个
    // Expanded 变体，与官方侧栏的 DOM 同构；折叠态就是那枚 28px 的圆放大镜。
    // `data-dshone-tree-state` 是自有标记，让验证套件能直接读「现在是哪一态」，不必
    // 解析类名（与折叠全部那枚的 `data-dshone-tree-icon-value` 同一做法）。
    (0, import_react12.createElement)(
      "div",
      {
        className: `dshOneTree_searchSlot${searchExpanded ? " dshOneTree_searchSlotExpanded" : ""}`,
        ref: searchRoot
      },
      (0, import_react12.createElement)(
        "div",
        {
          className: `dshOneTree_search${searchExpanded ? " dshOneTree_searchExpanded" : ""}`,
          "data-dshone-tree": "search-box",
          "data-dshone-tree-state": searchExpanded ? "expanded" : "collapsed",
          onClick: expandSearch
        },
        (0, import_react12.createElement)(import_dsh_client_ui_primitives9.Tooltip, {
          label: tr("search"),
          side: "bottom",
          delayMs: 500,
          // 官方：展开后不再出这一枚提示（`disabled: searchExpanded`）——这时按钮只是
          // 展开态图标位，提示没有意义。
          disabled: searchExpanded,
          children: (0, import_react12.createElement)(
            "button",
            {
              type: "button",
              className: "dshOneTree_searchButton",
              "aria-label": tr("search.sessions.aria"),
              "aria-expanded": searchExpanded,
              "data-dshone-tree-action": "search",
              onClick: expandSearch
            },
            // 官方两态的图标尺寸不同：折叠 14、展开 11（`size: searchExpanded ? 11 : 14`）。
            (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconSearchOutline16, { size: searchExpanded ? 11 : 14 })
          )
        }),
        searchExpanded ? (0, import_react12.createElement)("input", {
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
            collapseSearch();
          }
        }) : null,
        // 清除钮只在展开态渲染（官方也是 `searchExpanded && …`）。
        searchExpanded ? (0, import_react12.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_clearButton",
            "data-dshone-tree": "search-clear",
            "aria-label": tr("search.clear"),
            onClick: (event) => {
              event.stopPropagation();
              collapseSearch();
            }
          },
          (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconCloseFill14, {})
        ) : null
      )
    ),
    (0, import_react12.createElement)(
      "div",
      {
        // 搜索展开时让位（#135）：官方 `headerActionsHidden` 的同名同事——收成零宽、
        // 不可见也不接指针，收起搜索后原样回来（`data-dshone-tree-visible` 同胶囊那一枚）。
        className: `dshOneTree_headerActions${searchExpanded ? " dshOneTree_headerActionsHidden" : ""}`,
        "data-dshone-tree": "top-bar-actions",
        "data-dshone-tree-visible": searchExpanded ? "false" : "true"
      },
      // 折叠 / 展开全部（#99；图标 #118 起换成方框加减号）：图标与提示随当前态翻转，
      // 语义同旧侧栏——「还有展开着的」显示方框横杠（点了折叠全部），「全折叠了」
      // 显示方框十字（点了展开全部）。
      (0, import_react12.createElement)(import_dsh_client_ui_primitives9.Tooltip, {
        label: allCollapsed ? tr("toolbar.expandAll") : tr("toolbar.collapseAll"),
        side: "bottom",
        delayMs: 500,
        children: (0, import_react12.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_iconButton",
            "aria-label": allCollapsed ? tr("toolbar.expandAll") : tr("toolbar.collapseAll"),
            "data-dshone-tree-action": "collapse-all",
            "data-dshone-tree-collapsed": allCollapsed,
            onClick: props.onToggleCollapseAll
          },
          (0, import_react12.createElement)(CollapseAllIcon, { glyph: allCollapsed ? "plus" : "minus" })
        )
      }),
      // 添加工作区（＋）：两项菜单（选已有文件夹 / 创建新工作区目录）。
      (0, import_react12.createElement)(import_dsh_client_ui_primitives9.Menu, {
        open: addOpen,
        onClose: () => setAddOpen(false),
        items: addItems,
        onSelect: (id) => {
          setAddOpen(false);
          if (id === "pick-folder") props.onPickWorkspaceFolder();
          if (id === "create-folder") props.onCreateWorkspaceFolder?.();
        },
        align: "end",
        // #113：官方紧凑档（与右键菜单、分组胶囊菜单同档，侧栏里菜单密度一致）。
        compact: true,
        portal: true,
        closeOnPointerLeave: true,
        anchor: (0, import_react12.createElement)(import_dsh_client_ui_primitives9.Tooltip, {
          label: tr("workspace.add"),
          side: "bottom",
          delayMs: 500,
          children: (0, import_react12.createElement)(
            "button",
            {
              type: "button",
              className: "dshOneTree_iconButton",
              "aria-label": tr("workspace.add"),
              "data-dshone-tree-action": "add-workspace",
              onClick: () => setAddOpen((open2) => !open2)
            },
            (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconProjectAddOutline16, { size: 16 })
          )
        })
      }),
      // 设置齿轮（#99）：宿主有独立设置页时才有这一枚（官方 web 侧设置归官方底部行）。
      props.onOpenSettings === void 0 ? null : (0, import_react12.createElement)(import_dsh_client_ui_primitives9.Tooltip, {
        label: tr("toolbar.settings"),
        side: "bottom",
        delayMs: 500,
        children: (0, import_react12.createElement)(
          "button",
          {
            type: "button",
            className: "dshOneTree_iconButton",
            "aria-label": tr("toolbar.settings"),
            "data-dshone-tree-action": "settings",
            onClick: props.onOpenSettings
          },
          (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconSettingsOutline16, { size: 16 })
        )
      }),
      // #81 已有的多选入口（#131 起它前面那枚「视图选项」退役，这一枚位置不变）。
      (0, import_react12.createElement)(import_dsh_client_ui_primitives9.Tooltip, {
        label: selectMode ? tr("select.exit") : tr("select.enter"),
        side: "bottom",
        delayMs: 500,
        children: (0, import_react12.createElement)(
          "button",
          {
            type: "button",
            className: `dshOneTree_iconButton${selectMode ? " dshOneTree_menuOpen" : ""}`,
            "aria-label": selectMode ? tr("select.exit") : tr("select.enter"),
            "aria-pressed": selectMode,
            "data-dshone-tree-action": "select-mode",
            onClick: props.onToggleSelectMode
          },
          (0, import_react12.createElement)(import_dsh_client_ui_primitives9.IconChecklistOutline14, { size: 16 })
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
    renameWorkspace,
    deleteWorkspace,
    pickWorkspaceFolder,
    createWorkspaceFolder,
    openSettings,
    searchSessions,
    searchResultLimit,
    loadGroups,
    saveGroups,
    loadMarks,
    savePinned,
    saveUnread,
    loadTagGroups,
    saveTagGroups,
    openInNewTab,
    openWorkspaceFolder,
    openWorkspaceTerminal,
    shellName,
    loadCurrentFolders,
    isSessionInPanel,
    openSessionPanel
  } = props;
  const tr = t;
  const now = Date.now();
  const list = useSessions((state) => state);
  const workspaces = useWorkspaces((state) => state.items);
  const workspacePhase = useWorkspaces((state) => state.phase);
  const archivedSessionIds = useWorkspaces((state) => state.archivedSessionIds);
  const pending = useSessionPendingInteraction((state) => state);
  const [prefs, setPrefs] = (0, import_react13.useState)(readTreeViewPrefs(pageStorage()));
  const activeGroupId = prefs.activeGroupId;
  const groupExpansion = expandedGroupKeys(prefs);
  const [searchText, setSearchText] = (0, import_react13.useState)("");
  const [content, setContent] = (0, import_react13.useState)(EMPTY_SEARCH);
  const [renameTarget, setRenameTarget] = (0, import_react13.useState)(null);
  const [sessionRenameTarget, setSessionRenameTarget] = (0, import_react13.useState)(null);
  const [sessionEdit, setSessionEdit] = (0, import_react13.useState)(null);
  const editSelection = (0, import_react13.useRef)({ start: 0, end: 0 });
  const [deleteTarget, setDeleteTarget] = (0, import_react13.useState)(null);
  const [groupsFile, setGroupsFile] = (0, import_react13.useState)(emptyTreeGroups());
  const [groupDialog, setGroupDialog] = (0, import_react13.useState)(null);
  const [groupError, setGroupError] = (0, import_react13.useState)(null);
  const [marks, setMarks] = (0, import_react13.useState)(emptySessionMarks());
  const [manageGroupsOpen, setManageGroupsOpen] = (0, import_react13.useState)(false);
  const [selectMode, setSelectMode] = (0, import_react13.useState)(false);
  const [selection, setSelection] = (0, import_react13.useState)([]);
  const [busy, setBusy] = (0, import_react13.useState)(false);
  const [selectionError, setSelectionError] = (0, import_react13.useState)(null);
  const drawerOpen = useRecycleDrawerOpen();
  const [recycleError, setRecycleError] = (0, import_react13.useState)(null);
  const [archiveRequest, setArchiveRequest] = (0, import_react13.useState)(null);
  const [archiveBusy, setArchiveBusy] = (0, import_react13.useState)(false);
  const [archiveError, setArchiveError] = (0, import_react13.useState)(null);
  const [tagFile, setTagFile] = (0, import_react13.useState)(emptyTagGroups());
  const [currentFolders, setCurrentFolders] = (0, import_react13.useState)([]);
  const [tagCreate, setTagCreate] = (0, import_react13.useState)(null);
  const [tagRename, setTagRename] = (0, import_react13.useState)(null);
  const [tagDelete, setTagDelete] = (0, import_react13.useState)(null);
  const [tagNewSession, setTagNewSession] = (0, import_react13.useState)(null);
  const rootRef = (0, import_react13.useRef)(null);
  const hoverCard = useHoverCardRoom(rootRef);
  const bin = useRecycleBin();
  const archived = new Set(archivedSessionIds);
  const recycledIds = visibleRecycleIds(bin.ids, list, archivedSessionIds);
  const recycled = new Set(recycledIds);
  (0, import_react13.useEffect)(() => {
    writeTreeViewPrefs(pageStorage(), prefs);
  }, [prefs]);
  const groupsLoaded = (0, import_react13.useRef)(false);
  (0, import_react13.useEffect)(() => {
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
  const marksLoaded = (0, import_react13.useRef)(false);
  (0, import_react13.useEffect)(() => {
    if (marksLoaded.current) return;
    marksLoaded.current = true;
    let cancelled = false;
    loadMarks().then(
      (state) => {
        if (!cancelled) setMarks(state);
      },
      (reason) => {
        if (!cancelled) console.warn("[dsh-one] session marks unavailable:", reason);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loadMarks]);
  const tagsLoaded = (0, import_react13.useRef)(false);
  (0, import_react13.useEffect)(() => {
    if (tagsLoaded.current) return;
    tagsLoaded.current = true;
    let cancelled = false;
    loadTagGroups().then(
      (file) => {
        if (!cancelled) setTagFile(file);
      },
      (reason) => {
        if (!cancelled) console.warn("[dsh-one] session tag groups unavailable:", reason);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loadTagGroups]);
  const foldersLoaded = (0, import_react13.useRef)(false);
  (0, import_react13.useEffect)(() => {
    if (foldersLoaded.current) return;
    foldersLoaded.current = true;
    let cancelled = false;
    loadCurrentFolders().then(
      (folders) => {
        if (!cancelled) setCurrentFolders(folders);
      },
      (reason) => {
        if (!cancelled) console.warn("[dsh-one] workspace folders unavailable:", reason);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [loadCurrentFolders]);
  const writeTags = (next) => {
    setTagFile(next);
    saveTagGroups(next);
  };
  const tagBucket = (groupKey) => tagBucketOf(tagFile, groupKey);
  const applyTagBucket = (groupKey, next) => {
    if (next === null) return;
    writeTags(withTagBucket(tagFile, groupKey, next));
  };
  const groupKeyOfSession = (sessionId) => workspaces.find((workspace) => workspace.sessionIds.includes(sessionId))?.workspaceId ?? UNGROUPED_KEY;
  const pinnedIds = new Set(marks.pinned);
  const unreadIds = new Set(marks.unread);
  const persistPinned = (ids) => {
    setMarks((prev) => ({ ...prev, pinned: ids }));
    savePinned(ids);
  };
  const persistUnread = (ids) => {
    setMarks((prev) => ({ ...prev, unread: ids }));
    saveUnread(ids);
  };
  const togglePin = (sessionId) => {
    persistPinned(toggleMarkId(marks.pinned, sessionId, !pinnedIds.has(sessionId)));
  };
  const toggleUnread = (sessionId) => {
    persistUnread(toggleMarkId(marks.unread, sessionId, !unreadIds.has(sessionId)));
  };
  const openSessionClearingUnread = (sessionId) => {
    if (unreadIds.has(sessionId)) persistUnread(toggleMarkId(marks.unread, sessionId, false));
    openSession(sessionId);
  };
  const startRowRename = (row) => {
    editSelection.current = { start: 0, end: row.title.length };
    setSessionEdit({ id: row.id, draft: row.title, title: row.title });
    setSessionRenameTarget(null);
  };
  const updateRowRenameDraft = (draft, selection2) => {
    editSelection.current = selection2;
    setSessionEdit((prev) => prev === null || prev.draft === draft ? prev : { ...prev, draft });
  };
  const commitRowRename = () => {
    const edit = sessionEdit;
    if (edit === null) return;
    setSessionEdit(null);
    const title = edit.draft.trim();
    if (title === "" || title === edit.title) return;
    void renameSession(edit.id, title).catch((reason) => reportFailure("rename.failed", reason));
  };
  const cancelRowRename = () => {
    setSessionEdit(null);
  };
  const sessionOpenInPanel = async (sessionId) => {
    try {
      return await isSessionInPanel(sessionId);
    } catch (reason) {
      console.warn("[dsh-one] session panel state failed:", reason);
      return false;
    }
  };
  const activateSessionRow = (row) => {
    void sessionOpenInPanel(row.id).then((openInPanel) => {
      if (openInPanel) {
        startRowRename(row);
        return;
      }
      openSessionClearingUnread(row.id);
      void openSessionPanel(row.id).catch((reason) => {
        console.warn("[dsh-one] show session panel failed:", reason);
      });
    });
  };
  (0, import_react13.useEffect)(() => {
    if (sessionEdit === null || list.ids.length === 0) return;
    if (!list.ids.includes(sessionEdit.id)) setSessionEdit(null);
  }, [sessionEdit, list.ids]);
  (0, import_react13.useEffect)(() => {
    if (list.current === void 0 || workspacePhase !== "ready") return;
    const key = owningGroupKey(workspaces, list.current);
    setPrefs((prev) => autoExpandGroup(prev, key));
  }, [list.current, workspaces, workspacePhase]);
  (0, import_react13.useEffect)(() => {
    const known = new Set(list.ids.filter((id) => !archived.has(id)));
    const baselineReady = workspacePhase === "ready" && list.ids.length > 0;
    if (!baselineReady) return;
    void pruneRecycleBin(known, true);
  }, [bin.ids, list.ids, workspacePhase, archivedSessionIds]);
  const trimmedQuery = searchText.trim();
  (0, import_react13.useEffect)(() => {
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
  (0, import_react13.useEffect)(() => {
    if (tagNewSession === null) return;
    const current = list.current;
    if (current === void 0) return;
    if (groupKeyOfSession(current) !== tagNewSession.groupKey) return;
    applyTagBucket(tagNewSession.groupKey, setSessionTagGroup(tagBucket(tagNewSession.groupKey), current, tagNewSession.tagId));
    setTagNewSession(null);
  }, [tagNewSession, list.current, workspaces, tagFile]);
  (0, import_react13.useEffect)(() => {
    const baselineReady = workspacePhase === "ready" && list.ids.length > 0;
    if (!baselineReady) return;
    const alive = new Set(list.ids.filter((id) => !archived.has(id)));
    let next = null;
    for (const [workspaceId, bucket] of Object.entries(tagFile.workspaces)) {
      const pruned = pruneTagGroups(bucket, (sessionId) => alive.has(sessionId));
      if (pruned !== null) next = withTagBucket(next ?? tagFile, workspaceId, pruned);
    }
    if (next !== null) {
      setTagFile(next);
      saveTagGroups(next);
    }
  }, [tagFile, list.ids, workspacePhase, archivedSessionIds]);
  const withOrder = (sessions) => pinnedFirst(sessions, (node) => pinnedIds.has(node.id));
  const filterActive = activeGroupId !== null && hasTreeGroup(groupsFile, activeGroupId);
  const groups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: groupExpansion,
    recycled,
    currentFolders,
    ...filterActive && activeGroupId !== null ? { workspaceFilter: (workspaceId) => workspaceMatchesGroup(groupsFile, workspaceId, activeGroupId) } : {}
  });
  const activity = workspaceActivityCounts(list, workspaces, archivedSessionIds, pending, recycled, unreadIds);
  const visibleNodes = deriveFlat(list, archivedSessionIds, pending, recycled);
  const recycleGroups = deriveRecycleGroups(list, workspaces, recycledIds);
  const selectedSet = new Set(selection);
  const orderedGroups = currentWorkspaceFirst(groups);
  const flatGroups = deriveGroups(list, workspaces, archivedSessionIds, pending, {
    expandedGroups: [...workspaces.map((workspace) => workspace.workspaceId), UNGROUPED_KEY],
    recycled,
    currentFolders
  });
  const expandableKeys = flatGroups.filter((group) => group.sessionCount > 0).map((group) => group.key);
  const groupMembers = new Map(flatGroups.map((group) => [group.key, group.sessions]));
  const sessionsOfGroup = (key) => groupMembers.get(key) ?? [];
  const allCollapsed = trimmedQuery === "" && expandableKeys.length > 0 && expandableKeys.every((key) => !groupExpansion.includes(key));
  const toggleCollapseAll = () => {
    setPrefs(
      (prev) => allCollapsed ? (
        // 展开全部：有会话的分组一并展开；用户自己展开过的空分组照旧留在展开态
        //（旧写法的 `[...expandedGroups, ...expandableKeys]` 就是这个意思）。
        setGroupExpansion(prev, Object.fromEntries(expandableKeys.map((key) => [key, true])))
      ) : (
        // 收起全部：整棵树的每一个分组都写成「显式收起」——不留旧记录（已消失的分组下次
        // 回来不该自己展开），也不给首开规则留把当前会话那一组重新展开的余地。
        { ...prev, groupExpansion: Object.fromEntries(flatGroups.map((group) => [group.key, false])) }
      )
    );
  };
  const groupDefs = treeGroupDefs(groupsFile);
  const groupCounts = new Map(
    groupDefs.map((def) => [def.id, workspaces.filter((workspace) => workspaceMatchesGroup(groupsFile, workspace.workspaceId, def.id)).length])
  );
  const memberRows = currentWorkspaceFirst(flatGroups).filter((group) => group.workspaceId !== void 0).map((group) => ({ id: group.workspaceId, label: group.label }));
  const groupMemberIds = (groupId) => memberRows.filter((row) => workspaceMatchesGroup(groupsFile, row.id, groupId)).map((row) => row.id);
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
  const applyGroupReorder = (groupIds) => {
    const next = reorderTreeGroups(groupsFile, groupIds);
    if (next !== null) writeGroups(next);
  };
  const toggleWorkspaceInGroup = (workspaceId, groupId) => {
    writeGroups(toggleWorkspaceGroup(groupsFile, workspaceId, groupId));
  };
  const setWorkspacesInGroup = (groupId, workspaceIds, member) => {
    const next = setWorkspacesGroupMembership(groupsFile, workspaceIds, groupId, member);
    if (next !== null) writeGroups(next);
  };
  const toggleSelected = (sessionId) => {
    setSelectionError(null);
    setSelection(
      (prev) => prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };
  const enterSelection = () => {
    setSessionEdit(null);
    setSelectMode(true);
    setSelection([]);
    setSelectionError(null);
  };
  const exitSelection = () => {
    setSelectMode(false);
    setSelection([]);
    setSelectionError(null);
  };
  (0, import_react13.useEffect)(() => selectionEntrySignal.subscribe(() => enterSelection()), []);
  (0, import_react13.useEffect)(() => onSessionOwnedElsewhere(() => flashTip(tr("session.ownedElsewhere"), 6e3)), [tr]);
  const errorText = (reason) => reason instanceof Error ? reason.message : String(reason);
  const reportFailure = (key, reason) => {
    flashTip(tr(key, { message: errorText(reason) }));
  };
  const forkRow = (sessionId) => {
    void forkSession(sessionId).catch((reason) => reportFailure("fork.failed", reason));
  };
  const openRowInNewTab = openInNewTab === void 0 ? void 0 : (sessionId) => {
    void openInNewTab(sessionId).catch((reason) => reportFailure("openInNewTab.failed", reason));
  };
  const copyText = (text, done) => {
    (0, import_dsh_client_ui_primitives10.writeClipboard)(text).then(
      (ok) => flashTip(ok ? done : tr("copy.failed")),
      () => flashTip(tr("copy.failed"))
    );
  };
  const copySessionReference = (node) => {
    copyText(formatSessionMention(displayTitle(node, tr), node.id), tr("copied.sessionRef"));
  };
  const copyWorkspacePath = (group) => {
    if (group.cwd === void 0) return;
    copyText(group.cwd, tr("copied.path"));
  };
  const copyWorkspaceFolderReference = (group) => {
    if (group.cwd === void 0) return;
    const text = formatFileMention({ path: group.cwd, kind: "directory" });
    if (text === void 0) return;
    copyText(text, tr("copied.folderRef"));
  };
  const openWorkspaceInEditor = (group, newWindow) => {
    if (group.cwd === void 0) return;
    openWorkspaceFolder?.(group.cwd, { newWindow });
  };
  const openWorkspaceInTerminal = (group) => {
    if (group.cwd === void 0) return;
    openWorkspaceTerminal?.(group.cwd);
  };
  const eligibilityOf2 = (node) => ({
    pinned: pinnedIds.has(node.id),
    unread: unreadIds.has(node.id),
    running: node.running,
    runningSubagentCount: node.runningSubagentCount,
    ...node.pendingInteraction === void 0 ? {} : { pendingInteraction: node.pendingInteraction }
  });
  const isSelectableNode = (node) => canRecycle(eligibilityOf2(node));
  const isSelectedNode = (node) => selectedSet.has(node.id);
  const groupStateOf = (members) => groupSelectionState(members, isSelectableNode, isSelectedNode);
  const groupCheck = (key, fallback) => {
    const members = groupMembers.get(key) ?? fallback;
    return {
      state: groupStateOf(members),
      tip: groupCheckTip(members),
      // 一条都勾不上（整组都是置顶）：框画灰，点了也不动。
      disabled: members.every((node) => !isSelectableNode(node)),
      onToggleSelect: () => toggleGroupSelected(members)
    };
  };
  const toggleGroupSelected = (members) => {
    if (busy) return;
    const next = groupSelectionToggle(members, isSelectableNode, isSelectedNode, (node) => node.id);
    if (next.ids.length === 0) return;
    setSelectionError(null);
    setSelection((prev) => {
      const chosen = new Set(prev);
      for (const id of next.ids) {
        if (next.select) chosen.add(id);
        else chosen.delete(id);
      }
      return [...chosen];
    });
  };
  const groupCheckTip = (members) => {
    const blocked = members.filter((node) => !isSelectableNode(node)).length;
    return blocked === 0 ? void 0 : tr("select.group.pinned", { n: blocked });
  };
  const moveToRecycleBin = (sessionIds, options = {}) => {
    if (busy || sessionIds.length === 0) return;
    setBusy(true);
    setSelectionError(null);
    setRecycleError(null);
    recycleBinActions.move(sessionIds).then(
      (outcome) => {
        setBusy(false);
        if (outcome.failed.length > 0) {
          setSelectionError(tr("recycle.moveFailed", { n: outcome.failed.length }));
          flashTip(tr("recycle.moveFailed", { n: outcome.failed.length }));
          return;
        }
        flashTip(tr("recycle.moved", { n: outcome.done.length }));
        if (options.exitSelection === true) exitSelection();
      },
      (reason) => {
        setBusy(false);
        setSelectionError(errorText(reason));
        flashTip(errorText(reason));
      }
    );
  };
  const restoreFromRecycle = (sessionIds) => {
    if (busy || sessionIds.length === 0) return;
    setBusy(true);
    setRecycleError(null);
    recycleBinActions.restore(sessionIds).then(
      (outcome) => {
        setBusy(false);
        if (outcome.failed.length > 0) setRecycleError(tr("recycle.restoreFailed", { n: outcome.failed.length }));
        else flashTip(tr("recycle.restored", { n: outcome.done.length }));
      },
      (reason) => {
        setBusy(false);
        setRecycleError(tr("recycle.failed", { message: errorText(reason) }));
      }
    );
  };
  const openArchive = (request) => {
    setArchiveError(null);
    setArchiveRequest(request);
  };
  const confirmArchive = () => {
    const target = archiveRequest;
    if (target === null || archiveBusy) return;
    const sessionIds = target.blocks.flatMap((block) => block.sessions.map((node) => node.id));
    setArchiveBusy(true);
    setArchiveError(null);
    recycleBinActions.archive(sessionIds).then(
      (outcome) => {
        setArchiveBusy(false);
        const done = new Set(outcome.done);
        if (done.size > 0) setSelection((prev) => prev.filter((id) => !done.has(id)));
        if (outcome.failed.length > 0) {
          const message = tr("archive.failed", { n: outcome.failed.length });
          setArchiveError(message);
          flashTip(message);
          return;
        }
        setArchiveRequest(null);
        flashTip(tr("archive.done", { n: outcome.done.length }));
      },
      (reason) => {
        setArchiveBusy(false);
        setArchiveError(errorText(reason));
        reportFailure("archive.failed.reason", reason);
      }
    );
  };
  const requestArchiveSession = (node) => {
    if (cannotArchiveReason(eligibilityOf2(node)) !== null) return;
    openArchive({ blocks: groupSessionNodes(list, workspaces, [node.id]), skipped: 0, kind: "archive" });
  };
  const requestArchiveFromBin = (sessionId) => {
    openArchive({ blocks: groupSessionNodes(list, workspaces, [sessionId]), skipped: 0, kind: "archive" });
  };
  const requestArchiveGroup = (key) => {
    const nodes = sessionsOfGroup(key);
    const partition = partitionArchivable(nodes.map((node) => ({ node, ...eligibilityOf2(node) })));
    if (partition.ready.length === 0) return;
    openArchive({
      blocks: groupSessionNodes(list, workspaces, partition.ready.map((entry) => entry.node.id)),
      skipped: partition.skipped.length,
      kind: "archive"
    });
  };
  const hasArchivable = (key) => sessionsOfGroup(key).some((node) => cannotArchiveReason(eligibilityOf2(node)) === null);
  const requestEmptyBin = () => {
    if (recycledIds.length === 0) return;
    openArchive({ blocks: recycleGroups, skipped: 0, kind: "emptyBin" });
  };
  const requestArchiveNodes = (nodes) => {
    if (nodes.length === 0) return;
    const partition = partitionArchivable(nodes.map((node) => ({ node, ...eligibilityOf2(node) })));
    if (partition.ready.length === 0) return;
    openArchive({
      blocks: groupSessionNodes(list, workspaces, partition.ready.map((entry) => entry.node.id)),
      skipped: partition.skipped.length,
      kind: "archive"
    });
  };
  const requestArchiveSelection = () => {
    if (selection.length === 0) return;
    requestArchiveNodes(
      selection.flatMap((id) => {
        const node = visibleNodes.find((candidate) => candidate.id === id);
        return node === void 0 ? [] : [node];
      })
    );
  };
  const toggleTagCollapsed = (groupKey, tagId) => {
    const key = tagCollapseKey(groupKey, tagId);
    setPrefs((prev) => ({
      ...prev,
      tagCollapsed: prev.tagCollapsed.includes(key) ? prev.tagCollapsed.filter((candidate) => candidate !== key) : [...prev.tagCollapsed, key]
    }));
  };
  const expandTag = (groupKey, tagId) => {
    const key = tagCollapseKey(groupKey, tagId);
    setPrefs(
      (prev) => prev.tagCollapsed.includes(key) ? { ...prev, tagCollapsed: prev.tagCollapsed.filter((candidate) => candidate !== key) } : prev
    );
  };
  const assignTagGroup = (groupKey, sessionId, tagId) => {
    if (groupKeyOfSession(sessionId) !== groupKey) return;
    applyTagBucket(groupKey, setSessionTagGroup(tagBucket(groupKey), sessionId, tagId));
    expandTag(groupKey, tagId);
  };
  const moveOutOfTag = (groupKey, sessionId) => {
    const bucket = tagBucket(groupKey);
    if (bucket.sessionTags[sessionId] === void 0) return;
    applyTagBucket(groupKey, setSessionTagGroup(bucket, sessionId, null));
  };
  const reorderTag = (groupKey, sourceId, targetId, before) => {
    const bucket = tagBucket(groupKey);
    const ids = bucket.tags.map((tag) => tag.id);
    if (!ids.includes(sourceId) || !ids.includes(targetId)) return;
    ids.splice(ids.indexOf(sourceId), 1);
    ids.splice(ids.indexOf(targetId) + (before ? 0 : 1), 0, sourceId);
    applyTagBucket(groupKey, reorderTagGroups(bucket, ids));
  };
  const onTagMenuSelect = (groupKey, def, members, id) => {
    if (id === "tag-new-session") {
      if (groupKey === UNGROUPED_KEY) return;
      setTagNewSession({ groupKey, tagId: def.id });
      startSession(groupKey);
      return;
    }
    if (id === "tag-archive") {
      requestArchiveNodes(members);
      return;
    }
    if (id === "tag-recycle") {
      const eligible = members.filter((node) => cannotRecycleReason(eligibilityOf2(node)) === null).map((node) => node.id);
      moveToRecycleBin(eligible);
      return;
    }
    if (id === "tag-ungroup") {
      applyTagBucket(groupKey, setSessionsTagGroup(tagBucket(groupKey), members.map((node) => node.id), null));
      return;
    }
    if (id === "tag-rename") {
      setTagRename({ groupKey, id: def.id, name: def.name });
      return;
    }
    if (id === "tag-delete") {
      setTagDelete({ groupKey, id: def.id, name: def.name });
      return;
    }
    if (id.startsWith("tag-color-")) {
      applyTagBucket(groupKey, updateTagGroup(tagBucket(groupKey), def.id, { color: id.slice("tag-color-".length) }));
    }
  };
  const tagItemsFor = (sessionId) => {
    const groupKey = groupKeyOfSession(sessionId);
    const bucket = tagBucket(groupKey);
    const current = bucket.sessionTags[sessionId];
    const label = (suffix, text) => (0, import_react13.createElement)("span", { "data-dshone-tree-item": `${TAG_MENU_PREFIX}${suffix}` }, text);
    return {
      items: [
        ...bucket.tags.map((tag) => ({
          id: `${TAG_MENU_PREFIX}${tag.id}`,
          label: label(tag.id, tag.name),
          icon: (0, import_react13.createElement)(TagColorSwatch, { color: tag.color })
        })),
        { id: `${TAG_MENU_PREFIX}__none`, label: label("__none", tr("tag.none")) },
        { id: `${TAG_MENU_PREFIX}__new`, label: label("__new", tr("tag.new")) }
      ],
      selectedIds: [current === void 0 ? `${TAG_MENU_PREFIX}__none` : `${TAG_MENU_PREFIX}${current}`]
    };
  };
  const onRowTagSelect = (sessionId, id) => {
    const groupKey = groupKeyOfSession(sessionId);
    if (id === "__new") {
      setTagCreate({ groupKey, sessionId });
      return;
    }
    applyTagBucket(groupKey, setSessionTagGroup(tagBucket(groupKey), sessionId, id === "__none" ? null : id));
  };
  const createTagFrom = (target, name, color) => {
    const created = createTagGroup(tagBucket(target.groupKey), name, newTagGroupId(), color);
    if (!created.ok) return;
    const assigned = setSessionTagGroup(created.bucket, target.sessionId, created.id) ?? created.bucket;
    writeTags(withTagBucket(tagFile, target.groupKey, assigned));
    setTagCreate(null);
    flashTip(tr("tag.created", { name: name.trim() }));
  };
  (0, import_react13.useEffect)(() => {
    return recycleEntrySignal.subscribe((request) => {
      if (request === "open") {
        setRecycleDrawerOpen(true);
        setRecycleError(null);
        return;
      }
      if (request === "close") {
        setRecycleDrawerOpen(false);
        return;
      }
      if (request === "restoreAll") {
        restoreFromRecycle(recycledIds);
        return;
      }
      requestEmptyBin();
    });
  }, [recycledIds, recycleGroups, busy]);
  const moveSelectedToRecycleBin = () => moveToRecycleBin(selection, { exitSelection: true });
  const workspaceLabelOf = (sessionId) => {
    const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
    return owner === void 0 ? "" : owner.title;
  };
  const searchRows = (() => {
    if (trimmedQuery === "") return [];
    const needle = trimmedQuery.toLowerCase();
    const searchDescendants = indexSubagentDescendants(list.byId);
    const nodeOf = (id) => {
      const summary = list.byId[id];
      return summary === void 0 ? void 0 : sessionNode(summary, searchDescendants, pending);
    };
    const local = list.ids.flatMap((id) => {
      const summary = list.byId[id];
      if (summary === void 0 || summary.origin === "subagent" || archived.has(id)) return [];
      if (summary.blank && id !== list.current) return [];
      const matches = `${summary.displayTitle ?? summary.title ?? ""} ${workspaceLabelOf(id)}`.toLowerCase().includes(needle);
      const node = matches ? nodeOf(id) : void 0;
      return node === void 0 ? [] : [node];
    }).sort((a, b) => b.updatedAt - a.updatedAt);
    const seen = new Set(local.map((row) => row.id));
    const extra = [];
    for (const item of content.items) {
      if (seen.has(item.id)) continue;
      const node = nodeOf(item.id);
      if (node === void 0) continue;
      seen.add(item.id);
      extra.push(node);
    }
    return [...local, ...extra].slice(0, searchResultLimit);
  })();
  const snippetOf = (sessionId) => content.items.find((item) => item.id === sessionId)?.snippet;
  const emptyNotice = (kind, lines, action) => (0, import_react13.createElement)(
    "div",
    { className: "dshOneTree_empty", "data-dshone-tree": "empty", "data-dshone-tree-empty": kind },
    ...lines.map((line, index) => (0, import_react13.createElement)("div", { className: "dshOneTree_emptyLine", key: `line-${String(index)}` }, line)),
    ...action === void 0 ? [] : [action]
  );
  const noWorkspacesNotice = emptyNotice("no-workspaces", [tr("empty.noWorkspaces")]);
  const groupMembersNotice = emptyNotice(
    "group-members",
    [tr("empty.groupMembers"), tr("empty.groupMembers.hint")],
    (0, import_react13.createElement)(
      "button",
      {
        type: "button",
        className: "dshOneTree_emptyAction",
        "data-dshone-tree-action": "group-manage-empty",
        onClick: () => setManageGroupsOpen(true)
      },
      tr("group.manage")
    )
  );
  const rowRenameProps = (row) => sessionEdit !== null && sessionEdit.id === row.id ? {
    renaming: true,
    renameDraft: sessionEdit.draft,
    renameSelection: editSelection.current,
    onRenameDraft: updateRowRenameDraft,
    onRenameCommit: commitRowRename,
    onRenameCancel: cancelRowRename
  } : {};
  const groupedRowProps = (row) => {
    const section = tagItemsFor(row.id);
    return {
      node: row,
      ...list.current === void 0 ? {} : { currentId: list.current },
      now,
      hoverCard,
      tr,
      selectMode,
      selected: selectedSet.has(row.id),
      pinned: pinnedIds.has(row.id),
      unread: unreadIds.has(row.id),
      tagItems: section.items,
      tagSelectedIds: section.selectedIds,
      onTagSelect: (id) => onRowTagSelect(row.id, id),
      dragProps: sessionDragProps(row.id),
      onToggleSelect: () => toggleSelected(row.id),
      onOpen: () => openSessionClearingUnread(row.id),
      // #115/#121：点「当前会话」那一行 = 请求就地改名；树层先问宿主这条会话是不是真的
      // 开在面板里（开着就地改名，没开按打开处理，见 activateSessionRow）。
      onCurrentRowClick: () => activateSessionRow(row),
      ...rowRenameProps(row),
      onRename: (title) => setSessionRenameTarget({ id: row.id, title }),
      onFork: () => forkRow(row.id),
      onMoveToRecycleBin: () => moveToRecycleBin([row.id]),
      onArchive: () => requestArchiveSession(row),
      onTogglePin: () => togglePin(row.id),
      onToggleUnread: () => toggleUnread(row.id),
      // #109：菜单里的「选择多个」与「复制引用」（两枚都只在这一层接线，动作本体在树层）。
      onSelectMultiple: enterSelection,
      onCopyReference: () => copySessionReference(row),
      onOpenInNewTab: openRowInNewTab === void 0 ? void 0 : () => openRowInNewTab(row.id)
    };
  };
  const treeBody = trimmedQuery !== "" ? searchRows.length > 0 ? (0, import_react13.createElement)(
    "div",
    { className: "dshOneTree_searchTree", role: "tree", "aria-label": tr("search.results.aria"), "data-dshone-tree": "search" },
    searchRows.map(
      (row) => (0, import_react13.createElement)(SearchResultRow, {
        key: row.id,
        node: row,
        workspaceLabel: workspaceLabelOf(row.id),
        ...snippetOf(row.id) === void 0 ? {} : { snippet: snippetOf(row.id) },
        // #152：命中高亮按当前查询串标（标题 / 工作区名 / 片段三处）。
        query: trimmedQuery,
        // #108（C8）：选择态下搜索结果行同样可勾选——`selected` 随态换义
        //（非选择态 = 当前会话，选择态 = 已勾选），与树里的会话行同一口径。
        selectMode,
        selected: selectMode ? selectedSet.has(row.id) : row.id === list.current,
        pinned: pinnedIds.has(row.id),
        unread: unreadIds.has(row.id),
        tr,
        onOpen: () => openSessionClearingUnread(row.id),
        onToggleSelect: () => toggleSelected(row.id)
      })
    )
  ) : content.pending ? (0, import_react13.createElement)("div", { className: "dshOneTree_searchStatus" }, tr("search.pending")) : (0, import_react13.createElement)(
    "div",
    { className: "dshOneTree_searchStatus" },
    content.failed ? tr("search.unavailable") : tr("search.noMatches")
  ) : (0, import_react13.createElement)(
    "div",
    { role: "tree", "data-dshone-tree": "groups" },
    orderedGroups.map((group) => {
      const split = splitByTagGroups(
        group.sessions,
        tagBucket(group.key),
        (node) => pinnedIds.has(node.id)
      );
      const check = groupCheck(group.key, group.sessions);
      return (0, import_react13.createElement)(
        "div",
        {
          className: "dshOneTree_groupSection",
          key: group.key,
          "data-dshone-group-key": group.key,
          // #107：拖到组外（工作区行 / 未归组的空处）= 移出标签组。
          ...ungroupDropZone((sessionId) => moveOutOfTag(group.key, sessionId))
        },
        (0, import_react13.createElement)(ProjectRow, {
          group,
          tr,
          expanded: groupExpansion.includes(group.key),
          hoverCard,
          ...activity.get(group.key) === void 0 ? {} : { counts: activity.get(group.key) },
          groups: treeGroupDefs(groupsFile),
          memberOf: group.workspaceId === void 0 ? [] : workspaceGroupIds(groupsFile, group.workspaceId),
          selectMode,
          checkState: check.state,
          ...check.tip === void 0 ? {} : { checkTip: check.tip },
          checkDisabled: check.disabled,
          onToggleSelect: check.onToggleSelect,
          shellName,
          canArchiveAll: hasArchivable(group.key),
          onToggle: () => setPrefs((prev) => toggleGroupExpansion(prev, group.key)),
          onCreate: () => startSession(group.workspaceId),
          // #109 工作区行的三个宿主动作（能力口缺哪条哪枚按钮/菜单项就不出现）。
          onOpenTerminal: openWorkspaceTerminal === void 0 ? void 0 : () => openWorkspaceInTerminal(group),
          onOpenFolder: openWorkspaceFolder === void 0 ? void 0 : (options) => openWorkspaceInEditor(group, options.newWindow),
          onArchiveAll: () => requestArchiveGroup(group.key),
          onCopyFolderRef: () => copyWorkspaceFolderReference(group),
          onCopyPath: () => copyWorkspacePath(group),
          onToggleGroup: (groupId) => {
            if (group.workspaceId === void 0) return;
            toggleWorkspaceInGroup(group.workspaceId, groupId);
          },
          ...group.workspaceId === void 0 ? {} : {
            onRename: () => setRenameTarget({ workspaceId: group.workspaceId, title: group.label }),
            onDelete: () => setDeleteTarget({ workspaceId: group.workspaceId, title: group.label })
          }
        }),
        ...split.blocks.map(
          (block) => (0, import_react13.createElement)(TagGroupBlock, {
            key: `tag:${block.def.id}`,
            groupKey: group.key,
            def: block.def,
            collapsed: prefs.tagCollapsed.includes(tagCollapseKey(group.key, block.def.id)),
            // 折叠计数按组内全部会话数（折叠时行不渲染，但计数还得准）。
            sessions: block.sessions,
            isUnread: (sessionId) => unreadIds.has(sessionId),
            menuItems: tagGroupMenuItems({
              name: block.def.name,
              color: block.def.color,
              total: block.sessions.length,
              archivable: block.sessions.filter((node) => cannotArchiveReason(eligibilityOf2(node)) === null).length,
              recyclable: block.sessions.filter((node) => cannotRecycleReason(eligibilityOf2(node)) === null).length,
              tr
            }),
            menuSelectedIds: [`tag-color-${block.def.color}`],
            onMenuSelect: (id) => onTagMenuSelect(group.key, block.def, block.sessions, id),
            onToggleCollapse: () => toggleTagCollapsed(group.key, block.def.id),
            onDropSession: (sessionId) => assignTagGroup(group.key, sessionId, block.def.id),
            onDropTag: (sourceId, before) => reorderTag(group.key, sourceId, block.def.id, before),
            tr,
            children: block.sessions.map((row) => (0, import_react13.createElement)(SessionRow, { key: row.id, ...groupedRowProps(row) }))
          })
        ),
        ...split.ungrouped.map((row) => (0, import_react13.createElement)(SessionRow, { key: row.id, ...groupedRowProps(row) }))
      );
    })
  );
  const listChildren = (() => {
    if (workspacePhase !== "ready") return [emptyNotice("loading", [tr("empty.loading")])];
    if (trimmedQuery !== "") {
      return content.hasMore ? [
        treeBody,
        (0, import_react13.createElement)(
          "div",
          { className: "dshOneTree_searchStatus", key: "search-more", role: "status", "data-dshone-tree": "search-more" },
          tr("search.hasMore", { n: searchResultLimit })
        )
      ] : [treeBody];
    }
    if (filterActive && groups.length === 0) return [groupMembersNotice];
    if (workspaces.length > 0) return groups.length === 0 ? [emptyNotice("none", [tr("empty.none")])] : [treeBody];
    return groups.length === 0 ? [noWorkspacesNotice] : [noWorkspacesNotice, treeBody];
  })();
  return (0, import_react13.createElement)(
    "div",
    { className: "dshOneTree_root", ref: rootRef, "data-shell": "dsh-one-tree", "data-dshone-tree": "root" },
    // 顶部工具栏（#99 B 段；#135 起**一行五件**）：行首是分组过滤胶囊（原来自己在列表区
    // 占一行），右边依次是官方搜索栏（#132 起默认折叠，点开才展开）+ 折叠/展开全部 +
    // 添加工作区 + 设置齿轮 + 多选入口（#131 起搜索栏之后只有这四件，视图选项已退役）。
    // 搜索展开时除输入框外一律让位，让位规则与官方出处见 toolbar.ts 文件头。
    //
    // 分组胶囊的状态与回调仍由这里拥有（分组定义、计数、选择态、建组/管理对话框都在
    // 这个组件里），只是交给顶栏渲染——它现在是那一行的行首那一件。
    // #108 起它**选择态下不收起**：那一刻操作条要在它下方接着出现（#98 的布局规范），
    // 收起它一切换状态就跳一下，且「先按分组过滤、再整组勾选」正是常用路径；#135 之后
    // 它在搜索态下也不再从 DOM 里摘掉，而是由顶栏按搜索展开与否给它让位（零宽收起）。
    (0, import_react13.createElement)(TopBar, {
      tr,
      query: searchText,
      onQueryChange: (value) => setSearchText(sanitizeQuery(value)),
      onQueryClear: () => setSearchText(""),
      allCollapsed,
      onToggleCollapseAll: toggleCollapseAll,
      onPickWorkspaceFolder: pickWorkspaceFolder,
      ...createWorkspaceFolder === void 0 ? {} : { onCreateWorkspaceFolder: createWorkspaceFolder },
      ...openSettings === void 0 ? {} : { onOpenSettings: openSettings },
      selectMode,
      onToggleSelectMode: () => selectMode ? exitSelection() : selectionEntrySignal.enter(),
      filter: {
        groups: groupDefs,
        activeGroupId: filterActive ? activeGroupId : null,
        groupCounts,
        totalCount: workspaces.length,
        onPick: (groupId) => setPrefs((prev) => ({ ...prev, activeGroupId: groupId })),
        onCreate: () => {
          setGroupError(null);
          setGroupDialog({ kind: "create" });
        },
        onManage: () => setManageGroupsOpen(true)
      }
    }),
    (0, import_react13.createElement)(
      "div",
      { className: "dshOneTree_listArea" },
      // #81 功能 4 的选择态动作条，动作按 #103 的两层语义接线：移入回收站（本地可逆，
      // 立即执行 + 飘提示 + 结束选择态）与批量归档（不可逆，先过确认弹窗）。
      selectMode ? (0, import_react13.createElement)(SelectionBar, {
        count: selection.length,
        busy,
        error: selectionError,
        tr,
        onMoveToRecycleBin: moveSelectedToRecycleBin,
        onArchive: requestArchiveSelection,
        onExit: exitSelection
      }) : null,
      (0, import_react13.createElement)(
        "div",
        { className: "dshOneTree_list" },
        ...listChildren
      )
    ),
    // 回收站抽屉（#103）：本地可逆那一层。块头折叠态是纯视图态，随视图偏好一起落
    // 客户端存储（`recycleCollapsed`）。
    (0, import_react13.createElement)(RecycleDrawer, {
      open: drawerOpen,
      groups: recycleGroups,
      collapsed: prefs.recycleCollapsed,
      now,
      tr,
      busy,
      error: recycleError,
      pinned: pinnedIds,
      unread: unreadIds,
      onClose: () => {
        setRecycleDrawerOpen(false);
        setRecycleError(null);
      },
      onToggleGroup: (key) => setPrefs((prev) => ({
        ...prev,
        recycleCollapsed: prev.recycleCollapsed.includes(key) ? prev.recycleCollapsed.filter((candidate) => candidate !== key) : [...prev.recycleCollapsed, key]
      })),
      onOpen: (sessionId) => openSessionClearingUnread(sessionId),
      onRestore: (sessionId) => restoreFromRecycle([sessionId]),
      onArchive: requestArchiveFromBin,
      // 抽屉头的两枚动作回到**既有的那两个函数**（#154）：清空 = 既有的归档确认弹窗路径，
      // 恢复全部 = 既有的全部还原路径——与底部入口行发来的那两个请求同一个去处，不另起一条。
      onEmpty: requestEmptyBin,
      onRestoreAll: () => restoreFromRecycle(recycledIds)
    }),
    (0, import_react13.createElement)(RenameModal, {
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
    (0, import_react13.createElement)(RenameModal, {
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
    (0, import_react13.createElement)(GroupModal, {
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
    //（校核复用），建新组则内联走同一份 `applyGroupCreate`。#139 起多一层：点分组名
    // 进它的成员清单（全部工作区 + 勾选），勾选与批量都回到上面那一条唯一的写路径。
    (0, import_react13.createElement)(ManageGroupsModal, {
      open: manageGroupsOpen,
      groups: groupDefs,
      counts: groupCounts,
      workspaces: memberRows,
      groupMembers: groupMemberIds,
      tr,
      onCreate: applyGroupCreate,
      // 成员清单的回调是**组在前**（与 onRename / onDelete / onSetMembers 同一序），
      // 这里翻到纯函数那一序（工作区在前，与 `toggleWorkspaceGroup` 一致）。
      onToggleMember: (groupId, workspaceId) => toggleWorkspaceInGroup(workspaceId, groupId),
      onSetMembers: setWorkspacesInGroup,
      onRename: (groupId, name) => {
        setManageGroupsOpen(false);
        setGroupError(null);
        setGroupDialog({ kind: "rename", id: groupId, name });
      },
      onReorder: applyGroupReorder,
      onDelete: (groupId, name) => {
        setManageGroupsOpen(false);
        setGroupError(null);
        setGroupDialog({ kind: "delete", id: groupId, name });
      },
      onClose: () => setManageGroupsOpen(false)
    }),
    (0, import_react13.createElement)(DeleteWorkspaceModal, {
      target: deleteTarget,
      tr,
      onClose: () => setDeleteTarget(null),
      onSubmit: (workspaceId) => deleteWorkspace(workspaceId)
    }),
    // 归档确认弹窗（#103，可复用件）：会话行菜单「归档会话」、回收站行菜单「永久归档」、
    // 入口行「清空」、选择态「批量归档」四个入口共用它——归档 = 删除，一律先确认。
    (0, import_react13.createElement)(ArchiveSessionsModal, {
      target: archiveRequest,
      tr,
      busy: archiveBusy,
      error: archiveError,
      onConfirm: confirmArchive,
      onClose: () => {
        if (archiveBusy) return;
        setArchiveRequest(null);
        setArchiveError(null);
      }
    }),
    // #107 标签组：重命名（复用工作区/会话重命名那一枚通用对话框）、删除确认、
    // 新建（名字 + 颜色）。三个都只开在有明确目标时。
    (0, import_react13.createElement)(RenameModal, {
      open: tagRename !== null,
      titleKey: "tag.rename.title",
      fieldKey: "tag.name.label",
      initial: tagRename?.name ?? "",
      tr,
      onClose: () => setTagRename(null),
      onSubmit: async (value) => {
        const target = tagRename;
        if (target === null) return;
        const bucket = tagBucket(target.groupKey);
        if (tagGroupNameError(bucket, value, target.id) !== null) throw new Error(tr("tag.name.duplicate"));
        applyTagBucket(target.groupKey, updateTagGroup(bucket, target.id, { name: value }));
      }
    }),
    (0, import_react13.createElement)(TagGroupDeleteModal, {
      target: tagDelete === null ? null : { id: tagDelete.id, name: tagDelete.name },
      tr,
      onClose: () => setTagDelete(null),
      onSubmit: (id) => {
        const target = tagDelete;
        if (target === null) return;
        applyTagBucket(target.groupKey, deleteTagGroup(tagBucket(target.groupKey), id));
        setTagDelete(null);
      }
    }),
    (0, import_react13.createElement)(TagGroupCreateModal, {
      open: tagCreate !== null,
      tr,
      defaultColor: nextTagColor(tagCreate === null ? emptyTagBucket() : tagBucket(tagCreate.groupKey)),
      validate: (name) => tagGroupNameError(tagCreate === null ? emptyTagBucket() : tagBucket(tagCreate.groupKey), name),
      onClose: () => setTagCreate(null),
      onSubmit: (name, color) => {
        if (tagCreate === null) return;
        createTagFrom(tagCreate, name, color);
      }
    }),
    // 飘提示宿主（移入/还原/归档的回执）。
    (0, import_react13.createElement)(FlashHost, {})
  );
}

// src/ui/assembly/shell/workspaceTreePlugin.ts
var inject = ["slots", "locale", "sessions", "workspaces"];
function apply(ctx) {
  const sessions = ctx.get("sessions");
  const workspaces = ctx.get("workspaces");
  const caps = hostCapabilities(ctx);
  const uiWorkspace = () => ctx.get("uiWorkspace");
  ctx.effect(() => {
    const remote = ctx.get("remote");
    const off = remote?.$on?.("api-session/error", (sessionId, message) => {
      if (typeof sessionId !== "string" || sessionId === "") return;
      if (!isSessionAlreadyOwnedError(message)) return;
      reportSessionOwnedElsewhere(sessionId);
    });
    return () => {
      off?.();
    };
  }, "dsh-one workspace tree: session write-handle conflicts");
  configureRecycleBin({
    capabilities: caps,
    archiveSession: async (sessionId) => {
      const service = uiWorkspace();
      if (service === void 0) await workspaces.archiveSession(sessionId);
      else await service.archiveSession(sessionId);
    }
  });
  const startSessionIn = async (workspaceId) => {
    const snapshot2 = workspaces.list.getSnapshot();
    const workspace = snapshot2.items.find((item) => item.workspaceId === workspaceId);
    if (workspace === void 0) throw new Error(`workspace tree: unknown workspace ${workspaceId}`);
    const list = sessions.list.getSnapshot();
    for (const id of list.ids) {
      const summary = list.byId[id];
      if (summary !== void 0 && summary.blank && summary.cwd === workspace.path && workspace.sessionIds.includes(summary.id) && !snapshot2.archivedSessionIds.includes(summary.id)) {
        return summary.id;
      }
    }
    return await sessions.create({ workspaceId });
  };
  const buildInjected = () => {
    return {
      // 「在新标签页打开」（#72 多开通道）：走宿主能力口（抽象口，插件不碰宿主 API）。
      // 能力口如实上报 `editorTabs`：没有编辑器标签页的宿主（官方 web 形态）不注入
      // 这个动作，菜单项与行右键都不出现——那是同一份插件在另一端的正确形态。
      // 失败不再在这里吞掉（#110）：把 Promise 交回树组件，由界面给一行可见反馈。
      ...caps.editorTabs ? {
        openInNewTab: (sessionId) => caps.openSessionInNewTab(sessionId)
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
      // #109 工作区行的工作区动作（hover 的「在 VS Code 打开」与右键的「在新窗口打开
      // 文件夹」共用这一条）：能力口如实上报，官方 web 形态没有编辑器窗口 → 不注入 =
      // 两个入口都不出现。
      ...caps.workspaceOpen ? {
        openWorkspaceFolder: (path, options) => {
          caps.openWorkspaceFolder(path, { newWindow: options.newWindow }).catch((reason) => {
            console.warn("[dsh-one] open workspace folder failed:", reason);
          });
        }
      } : {},
      // #109 hover 的「终端打开」：同样是宿主能力（VS Code 侧是集成终端），官方 web 形态
      // 没有 → 不注入 = 那一枚按钮不渲染。
      ...caps.workspaceTerminal ? {
        openWorkspaceTerminal: (path) => {
          caps.openWorkspaceTerminal(path).catch((reason) => {
            console.warn("[dsh-one] open workspace terminal failed:", reason);
          });
        }
      } : {},
      // #109 当前工作区那枚胶囊上的容器名（读时判定，与 editorTabs 同一形态）。
      shellName: caps.shellName,
      // #112「当前工作区」判定的输入：VS Code 当前打开的文件夹路径表（宿主能力口）。
      // 官方 web 侧能力口如实回空表 → 树按「没有当前工作区」渲染（不显示徽标、不置顶），
      // 插件不做任何宿主判断（可移植件：两端同一份代码）。
      loadCurrentFolders: () => caps.currentWorkspaceFolders(),
      // #121 会话行点击的两条（都走宿主能力口，插件不碰宿主 API）：查询某会话是否正开在
      // 宿主面板里（改名判据的真条件），以及请宿主把面板亮到某会话（会话已是 current 时
      // 官方 sessions.open 不会让它变化、选择桥也就不会上报，必须单独请一次）。
      // 官方 web 侧：前者恒 false、后者静默空操作——那一端没有「宿主面板」这个概念，
      // 插件的点击逻辑照常跑（一律按打开处理），两端同一份代码。
      isSessionInPanel: (sessionId) => caps.isSessionInPanel(sessionId),
      openSessionPanel: (sessionId) => caps.openSessionPanel(sessionId),
      // 官方 sessions 服务：选中会话（镜像官方 ui-workspace 的 openSession，
      // 不调 layout.selectPanel——自有侧栏树没有主面板概念）。
      open: (sessionId) => {
        sessions.open(sessionId);
      },
      // 工作区行的「+」：官方 uiWorkspace.startSession 的语义（它依赖 layout 服务的
      // beginNavigation/selectPanel，自有 layout 桩没有这两件，故按同一语义直接
      // 用 sessions 服务实现）。
      // #109：未分组桶的 ＋ 也走这里（`workspaceId === undefined`）——建一条**不属于
      // 任何工作区**的会话。旧侧栏的 `sessionNewUngrouped` 就是这条语义；官方
      // `sessions.create` 的 workspaceId 是可选的，省略即散会话（它会落在未分组桶里）。
      startSession: (workspaceId) => {
        void (workspaceId === void 0 ? sessions.create({}) : startSessionIn(workspaceId)).then((id) => sessions.open(id)).catch((reason) => console.warn("[dsh-one] new session failed:", reason));
      },
      // 官方 ui-workspace 的 renameSession：binding → session.rename。
      renameSession: async (sessionId, title) => {
        const session = sessions.binding(sessionId)?.session;
        if (session === void 0) throw new Error(`unknown session "${sessionId}"`);
        const result = await session.rename(title);
        if (!result.ok) throw new Error(result.error?.message ?? "rename failed");
      },
      // 官方 uiWorkspace.forkSession：sessions.fork(increaseTitle) 后打开子会话。
      // 失败不再静默吞掉（#110）：Promise 交回树组件，由界面给一行可见反馈。
      forkSession: (sessionId) => sessions.fork({ sessionId, increaseTitle: true }).then((childId) => sessions.open(childId)),
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
      // #102：置顶与手动未读两份 id 集合——与分组同一条路（宿主能力口的
      // `stateRead/stateWrite`），键名 `pinned` / `unread` **就是旧侧栏的文件名**
      // （`~/.dsh/dsh-one/pinned.json` / `unread.json`），所以旧数据开箱即用：读到的
      // 若是规范形状直接采用；若是更早的裸 id 数组或坏值，采用清洗后的 id 并按规范
      // 形状写回一次（`migrateSessionMarks` 的 `rewrite`）——那次写回就是「迁入落定」，
      // 此后只有能力口读写，插件自己不碰任何文件（它本来也没有文件 IO 的能力）。
      loadMarks: async () => {
        const port2 = hostCapabilities(ctx);
        const loaded = migrateSessionMarks({
          pinned: await port2.stateRead(SESSION_PINNED_STATE_KEY),
          unread: await port2.stateRead(SESSION_UNREAD_STATE_KEY)
        });
        for (const key of loaded.rewrite) {
          const ids = key === "pinned" ? loaded.marks.pinned : loaded.marks.unread;
          void port2.stateWrite(key === "pinned" ? SESSION_PINNED_STATE_KEY : SESSION_UNREAD_STATE_KEY, markStateFile(ids)).then(
            () => console.warn(`[dsh-one] session marks[${key}]: migrated legacy shape, rewritten in canonical form`),
            (reason) => console.warn(`[dsh-one] session marks[${key}] migation not persisted:`, reason)
          );
        }
        return loaded.marks;
      },
      savePinned: (ids) => {
        void hostCapabilities(ctx).stateWrite(SESSION_PINNED_STATE_KEY, markStateFile(ids)).catch((reason) => {
          console.warn("[dsh-one] pinned sessions not persisted:", reason);
        });
      },
      saveUnread: (ids) => {
        void hostCapabilities(ctx).stateWrite(SESSION_UNREAD_STATE_KEY, markStateFile(ids)).catch((reason) => {
          console.warn("[dsh-one] unread sessions not persisted:", reason);
        });
      },
      // #107：会话标签组——与分组、置顶/未读同一条路（宿主能力口的 `stateRead/stateWrite`），
      // 键名 `tags` **就是旧侧栏的文件名**（`~/.dsh/dsh-one/tags.json`），所以旧数据
      // 开箱即用；要「迁」的只有形状：不再算组的旧内置组（Todo/Doing/Done）与折叠字段
      // 在 `parseTagGroups` 里读一次就丢掉（理由写在 pure/sessionTagGroups.ts 的文件头）。
      loadTagGroups: async () => {
        const value = await hostCapabilities(ctx).stateRead(TAG_GROUPS_STATE_KEY);
        return parseTagGroups(value) ?? emptyTagGroups();
      },
      saveTagGroups: (file) => {
        void hostCapabilities(ctx).stateWrite(TAG_GROUPS_STATE_KEY, JSON.parse(serializeTagGroups(file))).catch((reason) => {
          console.warn("[dsh-one] session tag groups not persisted:", reason);
        });
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

