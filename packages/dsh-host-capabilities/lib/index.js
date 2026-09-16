var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __decoratorStart = (base) => [, , , __create(base?.[__knownSymbol("metadata")] ?? null)];
var __decoratorStrings = ["class", "method", "getter", "setter", "accessor", "field", "value", "get", "set"];
var __expectFn = (fn) => fn !== void 0 && typeof fn !== "function" ? __typeError("Function expected") : fn;
var __decoratorContext = (kind, name2, done, metadata, fns) => ({ kind: __decoratorStrings[kind], name: name2, metadata, addInitializer: (fn) => done._ ? __typeError("Already initialized") : fns.push(__expectFn(fn || null)) });
var __decoratorMetadata = (array, target) => __defNormalProp(target, __knownSymbol("metadata"), array[3]);
var __runInitializers = (array, flags, self, value) => {
  for (var i = 0, fns = array[flags >> 1], n = fns && fns.length; i < n; i++) flags & 1 ? fns[i].call(self) : value = fns[i].call(self, value);
  return value;
};
var __decorateElement = (array, flags, name2, decorators, target, extra) => {
  var fn, it, done, ctx, access, k = flags & 7, s = !!(flags & 8), p = !!(flags & 16);
  var j = k > 3 ? array.length + 1 : k ? s ? 1 : 2 : 0, key = __decoratorStrings[k + 5];
  var initializers = k > 3 && (array[j - 1] = []), extraInitializers = array[j] || (array[j] = []);
  var desc = k && (!p && !s && (target = target.prototype), k < 5 && (k > 3 || !p) && __getOwnPropDesc(k < 4 ? target : { get [name2]() {
    return __privateGet(this, extra);
  }, set [name2](x) {
    return __privateSet(this, extra, x);
  } }, name2));
  k ? p && k < 4 && __name(extra, (k > 2 ? "set " : k > 1 ? "get " : "") + name2) : __name(target, name2);
  for (var i = decorators.length - 1; i >= 0; i--) {
    ctx = __decoratorContext(k, name2, done = {}, array[3], extraInitializers);
    if (k) {
      ctx.static = s, ctx.private = p, access = ctx.access = { has: p ? (x) => __privateIn(target, x) : (x) => name2 in x };
      if (k ^ 3) access.get = p ? (x) => (k ^ 1 ? __privateGet : __privateMethod)(x, target, k ^ 4 ? extra : desc.get) : (x) => x[name2];
      if (k > 2) access.set = p ? (x, y) => __privateSet(x, target, y, k ^ 4 ? extra : desc.set) : (x, y) => x[name2] = y;
    }
    it = (0, decorators[i])(k ? k < 4 ? p ? extra : desc[key] : k > 4 ? void 0 : { get: desc.get, set: desc.set } : target, ctx), done._ = 1;
    if (k ^ 4 || it === void 0) __expectFn(it) && (k > 4 ? initializers.unshift(it) : k ? p ? extra = it : desc[key] = it : target = it);
    else if (typeof it !== "object" || it === null) __typeError("Object expected");
    else __expectFn(fn = it.get) && (desc.get = fn), __expectFn(fn = it.set) && (desc.set = fn), __expectFn(fn = it.init) && initializers.unshift(fn);
  }
  return k || __decoratorMetadata(array, target), desc && __defProp(target, name2, desc), p ? k ^ 4 ? extra : desc : target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
var __privateIn = (member, obj) => Object(obj) !== obj ? __typeError('Cannot use the "in" operator on this value') : member.has(obj);
var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);
var __privateMethod = (obj, member, method) => (__accessCheck(obj, member, "access private method"), method);

// packages/dsh-host-capabilities/src/index.ts
import { bindTypertRemote, Remote } from "@deepseek-ai/dsh-typert-protocol";

// src/pure/hostCallError.ts
function isHostCallError(value) {
  return typeof value === "object" && value !== null && typeof value.code === "string" && typeof value.message === "string";
}
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}

// src/pure/hostCapabilities.ts
var HOST_CAPABILITY_SERVICE = "dshOneHostCapabilities";
function failure(code, message) {
  return { ok: false, error: { code, message } };
}
var STATE_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
function parseStateKey(value) {
  if (typeof value !== "string" || !STATE_KEY_RE.test(value) || value.includes("..")) {
    return { code: "invalid-args", message: "expected a state key matching [a-z0-9][a-z0-9._-]{0,63}" };
  }
  return value;
}
function parseStateValue(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return { code: "invalid-value", message: "the state value is not JSON-serializable" };
  }
  if (text === void 0) return { code: "invalid-value", message: "the state value is not JSON-serializable" };
  return text;
}
function parseSuggestedName(value) {
  if (typeof value !== "string" || value === "" || value.length > 128) {
    return { code: "invalid-args", message: "expected a file name of 1-128 characters" };
  }
  if (value.includes("/") || value.includes("\\") || value.includes("\0") || value === "." || value.includes("..")) {
    return { code: "invalid-args", message: 'the file name must not contain a path separator or ".."' };
  }
  return value;
}
var SAVE_CONTENT_MAX_BASE64 = 64 * 1024 * 1024;
var BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
function parseBase64(value) {
  if (typeof value !== "string") return { code: "invalid-args", message: "expected base64 text" };
  if (value.length === 0 || value.length > SAVE_CONTENT_MAX_BASE64 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    return { code: "invalid-args", message: "expected non-empty base64 text within the size cap" };
  }
  return value;
}

// src/pure/hostCalls.ts
import * as fsp from "node:fs/promises";
import * as path from "node:path";
var COMMIT_SHA_ARG_RE = /^[0-9a-fA-F]{7,40}$/;
async function realPathOrNull(target) {
  try {
    return await fsp.realpath(target);
  } catch {
    return null;
  }
}
function isInside(child, root) {
  if (child === root) return true;
  return child.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}
async function resolveAllowedDir(dir, allowedRoots) {
  if (!path.isAbsolute(dir) || dir.includes("\0")) return null;
  const real = await realPathOrNull(dir);
  if (real === null) return null;
  for (const root of allowedRoots) {
    const realRoot = await realPathOrNull(root);
    if (realRoot !== null && isInside(real, realRoot)) return real;
  }
  return null;
}
async function resolveQueryDir(requested, fallback, allowedRoots) {
  if (requested !== void 0) {
    const resolved = await resolveAllowedDir(requested, allowedRoots);
    if (resolved !== null) return { dir: resolved, usedRequested: true };
  }
  if (fallback === void 0) return null;
  const fallbackDir = await resolveAllowedDir(fallback, allowedRoots);
  return fallbackDir === null ? null : { dir: fallbackDir, usedRequested: false };
}
function parseGitShowArgs(args) {
  const record = asRecord(args);
  if (record === void 0) return { code: "invalid-args", message: "git.show expects an object argument" };
  const hash = record.hash;
  if (typeof hash !== "string" || !COMMIT_SHA_ARG_RE.test(hash)) {
    return { code: "invalid-args", message: "git.show expects a 7-40 hex char commit hash" };
  }
  const cwd = record.cwd;
  if (cwd !== void 0 && typeof cwd !== "string") {
    return { code: "invalid-args", message: "git.show expects cwd to be a string when present" };
  }
  return cwd === void 0 ? { hash } : { hash, cwd };
}

// src/pure/gitWorkspaceQuery.ts
import * as path3 from "node:path";

// src/pure/gitShow.ts
var GIT_INFO_FORMAT = "%H%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00";
function parseGitShowOutput(stdout) {
  const records = [];
  const recordRe = /([0-9a-f]{40})\x00([^\x00]*)\x00([^\x00]*)\x00([^\x00]*)\x00([^\x00]*)\x00([^\x00]*)\x00/g;
  let lastEnd = 0;
  for (const m of stdout.matchAll(recordRe)) {
    if (records.length > 0) {
      records[records.length - 1].shortStat = parseShortStatText(stdout.slice(lastEnd, m.index));
    }
    records.push({
      hash: m[1],
      authorName: m[2],
      authorEmail: m[3],
      isoDate: m[4],
      subject: m[5],
      body: m[6]
    });
    lastEnd = m.index + m[0].length;
  }
  if (records.length > 0) {
    records[records.length - 1].shortStat = parseShortStatText(stdout.slice(lastEnd));
  }
  return records;
}
function parseShortStatText(text) {
  const m = text.match(
    /([\d,]+) files? changed(?:,\s*([\d,]+) insertions?\(\+\))?(?:,\s*([\d,]+) deletions?\(-\))?/
  );
  if (!m) return void 0;
  const num = (s) => s ? Number(s.replace(/,/g, "")) : void 0;
  return { files: num(m[1]) ?? 0, insertions: num(m[2]), deletions: num(m[3]) };
}
function githubUrlFromRemoteUrl(fetchUrl, sha) {
  const url = (fetchUrl ?? "").trim();
  const m = url.match(/(?:https?:\/\/|git@)github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!m) return void 0;
  return `https://github.com/${m[1]}/${m[2]}/commit/${sha}`;
}
function formatCommitDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}
function commitInfoFromShowRecord(sha, rec, githubUrl) {
  const subject = rec.subject.trim();
  const body = rec.body.trim();
  return {
    sha,
    commitHash: rec.hash,
    found: true,
    message: subject,
    fullMessage: body.length > 0 ? `${subject}
${body}` : subject,
    authorName: rec.authorName,
    authorEmail: rec.authorEmail.length > 0 ? rec.authorEmail : void 0,
    commitDate: formatCommitDate(new Date(rec.isoDate)),
    files: rec.shortStat?.files,
    insertions: rec.shortStat?.insertions,
    deletions: rec.shortStat?.deletions,
    githubUrl
  };
}
function commitNotFound(sha) {
  return { sha, found: false };
}

// src/pure/gitShowCommand.ts
import { execFile } from "node:child_process";
var DEFAULT_GIT_TIMEOUT_MS = 1e4;
function runGit(gitPath, args, cwd, timeoutMs) {
  return new Promise((resolve) => {
    execFile(gitPath, [...args], { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      const rawCode = error?.code;
      const spawnFailed = error !== null && typeof rawCode === "string";
      const code = error === null ? 0 : typeof rawCode === "number" ? rawCode : 1;
      resolve({ code, spawnFailed, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
async function runGitShow(hash, dir, options = {}) {
  const gitPath = options.gitPath ?? "git";
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const log = await runGit(
    gitPath,
    ["log", "--no-walk", `--format=${GIT_INFO_FORMAT}`, "--shortstat", `${hash}^{commit}`],
    dir,
    timeoutMs
  );
  if (log.spawnFailed) return void 0;
  if (log.code !== 0) return commitNotFound(hash);
  const record = parseGitShowOutput(log.stdout)[0];
  if (record === void 0) return commitNotFound(hash);
  const remote = await runGit(gitPath, ["config", "--get", "remote.origin.url"], dir, timeoutMs);
  const remoteUrl = remote.code === 0 ? remote.stdout.trim() : "";
  const githubUrl = githubUrlFromRemoteUrl(remoteUrl, record.hash);
  const pushedToRemote = remoteUrl === "" ? void 0 : await remoteContainsCommit(dir, record.hash, { gitPath, timeoutMs });
  return {
    ...commitInfoFromShowRecord(hash, record, githubUrl),
    ...pushedToRemote === void 0 ? {} : { pushedToRemote }
  };
}
async function remoteContainsCommit(dir, sha, options = {}) {
  const gitPath = options.gitPath ?? "git";
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const branches = await runGit(gitPath, ["branch", "-r", "--contains", sha], dir, timeoutMs);
  if (branches.spawnFailed) return false;
  return branches.stdout.trim() !== "";
}

// src/pure/gitRepoDiscovery.ts
import * as fsp2 from "node:fs/promises";
import * as path2 from "node:path";
var DEFAULT_SKIP_DIRS = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "coverage",
  "__pycache__",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  ".idea",
  ".vscode-test"
];
var DEFAULT_MAX_DEPTH = 3;
var DEFAULT_MAX_REPOS = 24;
var DEFAULT_DISCOVERY_BUDGET_MS = 1500;
async function hasGitMarker(dir) {
  try {
    await fsp2.stat(path2.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}
async function discoverGitRepos(root, options = {}) {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const skip = new Set((options.skipDirNames ?? DEFAULT_SKIP_DIRS).map((name2) => name2.toLowerCase()));
  const maxRepos = options.maxRepos ?? DEFAULT_MAX_REPOS;
  const budgetMs = options.budgetMs ?? DEFAULT_DISCOVERY_BUDGET_MS;
  const isRepo = options.isRepo ?? hasGitMarker;
  const now = options.now ?? (() => Date.now());
  const deadline = now() + budgetMs;
  const repos = [];
  let truncated = false;
  let frontier = [root];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next = [];
    for (const parent of frontier) {
      if (now() > deadline) {
        truncated = true;
        break;
      }
      let entries;
      try {
        entries = await fsp2.readdir(parent, { withFileTypes: true });
      } catch {
        continue;
      }
      const names = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).map((entry) => entry.name).filter((name2) => !skip.has(name2.toLowerCase())).sort();
      for (const name2 of names) {
        if (now() > deadline) {
          truncated = true;
          break;
        }
        const child = path2.join(parent, name2);
        if (await isRepo(child)) {
          repos.push(child);
          if (repos.length >= maxRepos) {
            truncated = true;
            break;
          }
          continue;
        }
        next.push(child);
      }
      if (truncated) break;
    }
    if (truncated) break;
    frontier = next;
  }
  return { repos, truncated };
}

// src/pure/ttlCache.ts
var DEFAULT_TTL_MS = 5 * 60 * 1e3;
function createTtlCache(options = {}) {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => Date.now());
  const entries = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Map();
  return {
    get(key) {
      const entry = entries.get(key);
      if (entry === void 0) return void 0;
      if (now() - entry.at >= ttlMs) {
        entries.delete(key);
        return void 0;
      }
      return entry.value;
    },
    set(key, value) {
      entries.set(key, { at: now(), value });
    },
    async load(key, loader) {
      const cached = this.get(key);
      if (cached !== void 0) return cached;
      const pending = inflight.get(key);
      if (pending !== void 0) return pending;
      const started = loader().then((value) => {
        this.set(key, value);
        return value;
      }).finally(() => {
        if (inflight.get(key) === started) inflight.delete(key);
      });
      inflight.set(key, started);
      return started;
    },
    clear() {
      entries.clear();
      inflight.clear();
    }
  };
}

// src/pure/gitWorkspaceQuery.ts
var DEFAULT_QUERY_BUDGET_MS = 2e3;
var QUERY_CACHE_TTL_MS = 5 * 60 * 1e3;
var defaultRepoCache = createTtlCache({ ttlMs: QUERY_CACHE_TTL_MS });
var defaultCommitCache = createTtlCache({ ttlMs: QUERY_CACHE_TTL_MS });
var cacheKey = (dir, hash) => `${dir}\0${hash}`;
function stampRepo(info, repoPath, queryRoot) {
  const relative2 = path3.relative(queryRoot, repoPath);
  return {
    ...info,
    repoPath,
    ...relative2 === "" || relative2 === "." ? {} : { repoRelative: relative2 }
  };
}
async function queryCommitInWorkspace(hash, queryRoot, options = {}) {
  const budgetMs = options.budgetMs ?? DEFAULT_QUERY_BUDGET_MS;
  const now = options.now ?? (() => Date.now());
  const started = now();
  const deadline = started + budgetMs;
  const elapsed = () => now() - started;
  const repoCache = options.repoCache ?? defaultRepoCache;
  const commitCache = options.commitCache ?? defaultCommitCache;
  const remaining = () => Math.max(0, deadline - now());
  const gitOptions = {
    ...options.gitPath === void 0 ? {} : { gitPath: options.gitPath },
    ...options.timeoutMs === void 0 ? {} : { timeoutMs: options.timeoutMs }
  };
  const direct = await runGitShow(hash, queryRoot, { ...gitOptions, timeoutMs: Math.min(remaining() || budgetMs, gitOptions.timeoutMs ?? budgetMs) });
  if (direct === void 0) return void 0;
  if (direct.found) {
    options.log?.(`[assembly] git.show hit at query root in ${String(elapsed())}ms`);
    return { ...direct, scannedRoots: 1 };
  }
  const discovery = await repoCache.load(
    queryRoot,
    () => discoverGitRepos(queryRoot, {
      ...options.maxDepth === void 0 ? {} : { maxDepth: options.maxDepth },
      ...options.skipDirNames === void 0 ? {} : { skipDirNames: options.skipDirNames },
      ...options.maxRepos === void 0 ? {} : { maxRepos: options.maxRepos },
      ...options.isRepo === void 0 ? {} : { isRepo: options.isRepo },
      budgetMs: Math.max(1, remaining()),
      now
    })
  );
  let truncated = discovery.truncated;
  let scanned = 1;
  for (const repo of discovery.repos) {
    if (remaining() === 0) {
      truncated = true;
      break;
    }
    const cached = commitCache.get(cacheKey(repo, hash));
    if (cached !== void 0) {
      scanned += 1;
      if (cached.found) return { ...stampRepo(cached, repo, queryRoot), scannedRoots: scanned, truncated };
      continue;
    }
    const info = await runGitShow(hash, repo, { ...gitOptions, timeoutMs: Math.max(1, Math.min(remaining() || 1, gitOptions.timeoutMs ?? budgetMs)) });
    if (info === void 0) return void 0;
    const stamped = { ...info };
    commitCache.set(cacheKey(repo, hash), stamped);
    scanned += 1;
    if (info.found) {
      options.log?.(
        `[assembly] git.show hit in ${path3.relative(queryRoot, repo) || "."} after ${String(scanned)} roots in ${String(elapsed())}ms`
      );
      return { ...stampRepo(stamped, repo, queryRoot), scannedRoots: scanned, truncated };
    }
  }
  options.log?.(
    `[assembly] git.show miss: scanned ${String(scanned)} roots (${String(discovery.repos.length)} repos) in ${String(elapsed())}ms${truncated ? " (truncated)" : ""}`
  );
  return { ...commitNotFound(hash), scannedRoots: scanned, truncated };
}

// packages/dsh-host-capabilities/src/stateStore.ts
import * as fsp3 from "node:fs/promises";
import * as os from "node:os";
import * as path4 from "node:path";
function dshHomeDir(env = process.env) {
  const override = env.DSH_HOME;
  return override !== void 0 && override !== "" ? override : path4.join(os.homedir(), ".dsh");
}
function stateDir(home = dshHomeDir()) {
  return path4.join(home, "dsh-one");
}
function stateFilePath(key, home = dshHomeDir()) {
  if (key.includes("/") || key.includes("\\") || key.includes("..")) {
    throw new Error(`refusing to build a state path from key ${JSON.stringify(key)}`);
  }
  return path4.join(stateDir(home), `${key}.json`);
}
async function readState(key, home = dshHomeDir()) {
  let raw;
  try {
    raw = await fsp3.readFile(stateFilePath(key, home), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
async function writeState(key, serialized, home = dshHomeDir()) {
  const target = stateFilePath(key, home);
  await fsp3.mkdir(path4.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fsp3.writeFile(tmp, serialized, "utf8");
  await fsp3.rename(tmp, target);
}
async function deleteState(key, home = dshHomeDir()) {
  try {
    await fsp3.unlink(stateFilePath(key, home));
    return true;
  } catch (err) {
    if (err.code === "ENOENT") return false;
    throw err;
  }
}

// packages/dsh-host-capabilities/src/gitShow.ts
async function gitShowInHost(args, deps, log) {
  const registered = await deps.allowedRoots();
  const home = deps.home ?? dshHomeDir();
  const allowedRoots = [...registered, home];
  const resolved = await resolveQueryDir(args.cwd, registered[0] ?? home, allowedRoots);
  if (resolved === null) {
    return { code: "no-workspace", message: "no usable directory: no dsh workspace is registered and the dsh home is unavailable" };
  }
  if (!resolved.usedRequested && args.cwd !== void 0 && args.cwd !== "") {
    log?.(`[host-capabilities] gitShow: ${args.cwd} is not inside a registered workspace; querying ${resolved.dir}`);
  }
  const info = await queryCommitInWorkspace(args.hash, resolved.dir, {
    ...deps.gitPath === void 0 ? {} : { gitPath: deps.gitPath },
    ...deps.budgetMs === void 0 ? {} : { budgetMs: deps.budgetMs },
    ...log === void 0 ? {} : { log }
  });
  if (info === void 0) return { code: "git-missing", message: "the git executable could not be started" };
  return info;
}

// packages/dsh-host-capabilities/src/saveContent.ts
import * as fsp4 from "node:fs/promises";
import * as os2 from "node:os";
import * as path5 from "node:path";
function defaultSaveLocation(home = dshHomeDir()) {
  return { preferred: path5.join(os2.homedir(), "Downloads"), fallback: path5.join(home, "exports") };
}
async function usableDir(dir) {
  try {
    const stat3 = await fsp4.stat(dir);
    return stat3.isDirectory();
  } catch {
    return false;
  }
}
async function resolveSaveDir(location) {
  if (await usableDir(location.preferred)) return location.preferred;
  await fsp4.mkdir(location.fallback, { recursive: true });
  return location.fallback;
}
async function uniqueFileName(dir, suggestedName) {
  const base = path5.basename(suggestedName);
  const ext = path5.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  for (let index = 0; index < 1e3; index += 1) {
    const candidate = index === 0 ? base : `${stem}-${index}${ext}`;
    const exists = await fsp4.stat(path5.join(dir, candidate)).then(() => true).catch(() => false);
    if (!exists) return candidate;
  }
  throw new Error(`no unused file name available for ${base}`);
}
async function saveContentFile(suggestedName, base64, location = defaultSaveLocation()) {
  const dir = await resolveSaveDir(location);
  const name2 = await uniqueFileName(dir, path5.basename(suggestedName));
  const target = path5.join(dir, name2);
  const bytes = Buffer.from(base64, "base64");
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fsp4.writeFile(tmp, bytes);
  await fsp4.rename(tmp, target);
  return target;
}

// packages/dsh-host-capabilities/src/index.ts
var name = "dsh-one-host-capabilities";
var _saveContent_dec, _gitShow_dec, _stateDelete_dec, _stateWrite_dec, _stateRead_dec, _init;
_stateRead_dec = [Remote("stateRead")], _stateWrite_dec = [Remote("stateWrite")], _stateDelete_dec = [Remote("stateDelete")], _gitShow_dec = [Remote("gitShow")], _saveContent_dec = [Remote("saveContent")];
var HostCapabilitiesService = class {
  constructor(serviceKey, config, deps) {
    __runInitializers(_init, 5, this);
    /** 官方协议要求的可见绑定（网关 SRC 发现据此认领端点）。 */
    __publicField(this, "typertRemote");
    __publicField(this, "config");
    __publicField(this, "deps");
    this.typertRemote = bindTypertRemote(this, serviceKey);
    this.config = config;
    this.deps = deps;
  }
  home() {
    return this.config.home ?? dshHomeDir();
  }
  async stateRead(key) {
    const parsed = parseStateKey(key);
    if (typeof parsed !== "string") return failure(parsed.code, parsed.message);
    return { ok: true, value: await readState(parsed, this.home()) };
  }
  async stateWrite(key, value) {
    const parsedKey = parseStateKey(key);
    if (typeof parsedKey !== "string") return failure(parsedKey.code, parsedKey.message);
    const parsedValue = parseStateValue(value);
    if (typeof parsedValue !== "string") return failure(parsedValue.code, parsedValue.message);
    await writeState(parsedKey, parsedValue, this.home());
    return { ok: true };
  }
  async stateDelete(key) {
    const parsed = parseStateKey(key);
    if (typeof parsed !== "string") return failure(parsed.code, parsed.message);
    return { ok: true, deleted: await deleteState(parsed, this.home()) };
  }
  async gitShow(hash, cwd) {
    const parsed = parseGitShowArgs(cwd === void 0 ? { hash } : { hash, cwd });
    if (isHostCallError(parsed)) return failure(parsed.code, parsed.message);
    const result = await gitShowInHost(
      parsed,
      {
        allowedRoots: this.deps.allowedRoots,
        home: this.home(),
        ...this.config.gitPath === void 0 ? {} : { gitPath: this.config.gitPath },
        ...this.config.gitBudgetMs === void 0 ? {} : { budgetMs: this.config.gitBudgetMs }
      },
      this.deps.log
    );
    if (result === null) return failure("not-found", `no repository in the queried roots holds ${hash}`);
    if (isHostCallError(result)) return failure(result.code, result.message);
    return { ok: true, ...result };
  }
  async saveContent(suggestedName, base64) {
    const parsedName = parseSuggestedName(suggestedName);
    if (typeof parsedName !== "string") return failure(parsedName.code, parsedName.message);
    const parsedBody = parseBase64(base64);
    if (typeof parsedBody !== "string") return failure(parsedBody.code, parsedBody.message);
    const location = this.config.saveLocation ?? defaultSaveLocation(this.home());
    return { ok: true, path: await saveContentFile(parsedName, parsedBody, location) };
  }
};
_init = __decoratorStart(null);
__decorateElement(_init, 1, "stateRead", _stateRead_dec, HostCapabilitiesService);
__decorateElement(_init, 1, "stateWrite", _stateWrite_dec, HostCapabilitiesService);
__decorateElement(_init, 1, "stateDelete", _stateDelete_dec, HostCapabilitiesService);
__decorateElement(_init, 1, "gitShow", _gitShow_dec, HostCapabilitiesService);
__decorateElement(_init, 1, "saveContent", _saveContent_dec, HostCapabilitiesService);
__decoratorMetadata(_init, HostCapabilitiesService);
function hostHalfDeps(ctx) {
  const logger = ctx.get("logger");
  return {
    allowedRoots: async () => {
      const registry = ctx.get("workspaceRegistry");
      const rows = registry?.list?.() ?? [];
      return rows.map((row) => row.path).filter((entry) => typeof entry === "string");
    },
    log: (line) => logger?.info?.(line)
  };
}
function apply(ctx, config) {
  const deps = hostHalfDeps(ctx);
  ctx.provide(HOST_CAPABILITY_SERVICE, new HostCapabilitiesService(HOST_CAPABILITY_SERVICE, config ?? {}, deps));
  deps.log(`[dsh-one-host-capabilities] host half ready (service ${HOST_CAPABILITY_SERVICE})`);
}
export {
  HostCapabilitiesService,
  apply,
  hostHalfDeps,
  name
};
