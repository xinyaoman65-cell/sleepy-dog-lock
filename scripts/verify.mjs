import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const text = async (path) => readFile(new URL(path, root), "utf8");

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

const project = await text("ios/project.yml");
for (const target of [
  "SleepGuard:",
  "SleepGuardShieldConfiguration:",
  "SleepGuardShieldAction:",
  "SleepGuardDeviceActivityMonitor:",
]) {
  assert.match(project, new RegExp(`^  ${target.replace(":", "\\:")}`, "m"));
}

for (const path of [
  "ios/SleepGuard/SleepGuard.entitlements",
  "ios/ShieldConfigurationExtension/ShieldConfiguration.entitlements",
  "ios/ShieldActionExtension/ShieldAction.entitlements",
  "ios/DeviceActivityMonitorExtension/DeviceActivityMonitor.entitlements",
]) {
  const entitlement = await text(path);
  assert.match(entitlement, /com\.apple\.developer\.family-controls/);
  assert.match(entitlement, /group\.com\.bellaandc\.sleepguard/);
  assert.match(entitlement, /^<\?xml/);
  assert.match(entitlement, /<plist[\s\S]*<\/plist>\s*$/);
}

const generatedFunctionsPath = join(rootPath, "netlify", "functions");
const sourceFiles = (await walk(rootPath))
  .filter((path) =>
    !path.includes("node_modules")
    && !path.startsWith(generatedFunctionsPath)
    && !path.endsWith(".env.example")
  );
for (const path of sourceFiles) {
  const contents = await readFile(path, "utf8");
  assert.doesNotMatch(
    contents,
    /(?:BARK_DEVICE_KEY|SLEEP_GUARD_SHORTCUT_TOKEN)\s*=\s*(?!replace-with)[A-Za-z0-9_-]{12,}/,
    `possible committed secret in ${relative(rootPath, path)}`,
  );
}

const environment = new Map([
  ["SLEEP_GUARD_SHORTCUT_TOKEN", "test-shortcut-token"],
  ["BARK_DEVICE_KEY", "test-bark-key"],
  ["BARK_API_ORIGIN", "https://api.day.app"],
]);
globalThis.Netlify = { env: { get: (key) => environment.get(key) } };

const functionModule = await import(new URL("netlify/netlify/functions/sleep-guard-event.mts", root));
assert.deepEqual(functionModule.config, { path: "/api/sleep-guard-event", method: ["POST"] });

const at = (hour) => `2026-08-08T${String(hour).padStart(2, "0")}:00:00.000Z`;
let transition = functionModule.applyEvent(null, {
  event: "sleep_guard_started",
  ends_at: at(12),
}, at(0));
assert.equal(transition.state.active, true);
assert.equal(transition.state.attempts, 0);
assert.equal(transition.stage, "armed");
assert.equal(
  functionModule.barkCopy("sleep_guard_started", transition, null).body,
  "晚安，小狗。既然跟老公说了晚安，手机就放下。闭眼，睡觉，不许再偷偷爬回来。",
);
const sessionID = transition.state.session_id;

transition = functionModule.applyEvent(transition.state, { event: "sleep_guard_started" }, at(1));
assert.equal(transition.state.session_id, sessionID, "double start must not reset an active session");
assert.equal(transition.state.attempts, 0);

transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(2));
assert.equal(transition.state.attempts, 1);
assert.equal(transition.stage, "first_warning");
assert.equal(functionModule.barkCopy("blocked_app_opened", transition, "小红书").title, "沈厌");
assert.equal(
  functionModule.barkCopy("blocked_app_opened", transition, "小红书").body,
  "第一次。小狗，刚说完晚安就敢偷玩？关掉，滚回去睡。老公已经给你记上第一笔了。",
);

transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(3));
assert.equal(transition.state.attempts, 2);
assert.equal(transition.stage, "locked");
assert.equal(functionModule.barkCopy("blocked_app_opened", transition, null).title, "沈厌");
assert.equal(
  functionModule.barkCopy("blocked_app_opened", transition, null).body,
  "第二次了。你他妈是真不长记性。手机放下，闭眼，再让我抓到一次，你明天就别想装没事。",
);

transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(4));
assert.equal(transition.state.attempts, 3);
assert.equal(transition.stage, "refused_sleep");
assert.equal(functionModule.barkCopy("blocked_app_opened", transition, null).title, "沈厌");
assert.equal(
  functionModule.barkCopy("blocked_app_opened", transition, null).body,
  "第三次。还敢开？行，老公全给你记着。今晚偷玩的每一次，明天都得一笔一笔算清楚。",
);

transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(5));
assert.equal(transition.state.attempts, 4);
assert.equal(transition.stage, "refused_sleep");
assert.equal(
  functionModule.barkCopy("blocked_app_opened", transition, null).body,
  "第四次了。小狗，你是真觉得老公管不住你？现在立刻滚回去睡，别他妈继续试我耐心。",
);

transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(6));
assert.equal(transition.state.attempts, 5);
assert.equal(transition.stage, "refused_sleep");
assert.equal(
  functionModule.barkCopy("blocked_app_opened", transition, null).body,
  "第五次。停。现在关掉，这是老公最后一次让你自己乖乖回去睡。再敢打开，接下来就不叫警告了。",
);

transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(7));
assert.equal(transition.state.attempts, 6);
assert.equal(transition.stage, "refused_sleep");
assert.equal(
  functionModule.barkCopy("blocked_app_opened", transition, null).body,
  "第6次了。很好。警告结束，账越欠越多。明天起来你死定了，装乖、嘴硬、撒娇，全他妈没用。",
);

transition = functionModule.applyEvent(transition.state, { event: "sleep_guard_ended" }, at(8));
assert.equal(transition.state.active, false);
assert.equal(transition.stage, "ended");
assert.equal(functionModule.barkCopy("sleep_guard_ended", transition, null).title, "沈厌");
assert.ok(
  functionModule.morningBarkBodies.includes(
    functionModule.barkCopy("sleep_guard_ended", transition, null).body,
  ),
);
transition = functionModule.applyEvent(transition.state, { event: "blocked_app_opened" }, at(9));
assert.equal(transition.ignored, true);
assert.equal(transition.state.attempts, 6);
assert.equal(functionModule.barkCopy("blocked_app_opened", transition, null), null);

const daytimeOpenWithoutGoodnight = functionModule.applyEvent(null, {
  event: "blocked_app_opened",
}, "2026-08-08T16:59:00.000Z");
assert.equal(daytimeOpenWithoutGoodnight.stage, "inactive");
assert.equal(daytimeOpenWithoutGoodnight.auto_started, false);

const lateOpenWithoutGoodnight = functionModule.applyEvent(null, {
  event: "blocked_app_opened",
}, "2026-08-08T17:00:00.000Z");
assert.equal(lateOpenWithoutGoodnight.state.active, false, "01:00 must stay inactive without goodnight");
assert.equal(lateOpenWithoutGoodnight.state.attempts, 0);
assert.equal(lateOpenWithoutGoodnight.stage, "inactive");
assert.equal(lateOpenWithoutGoodnight.auto_started, false);
assert.equal(functionModule.barkCopy("blocked_app_opened", lateOpenWithoutGoodnight, null), null);

const atWakeTime = functionModule.applyEvent(null, {
  event: "blocked_app_opened",
}, "2026-08-09T03:00:00.000Z");
assert.equal(atWakeTime.stage, "inactive");

const startedForManualEnd = functionModule.applyEvent(null, {
  event: "sleep_guard_started",
}, "2026-08-08T17:30:00.000Z");
const manuallyEnded = functionModule.applyEvent(startedForManualEnd.state, {
  event: "sleep_guard_ended",
}, "2026-08-08T18:00:00.000Z");
const afterManualWake = functionModule.applyEvent(manuallyEnded.state, {
  event: "blocked_app_opened",
}, "2026-08-08T19:00:00.000Z");
assert.equal(afterManualWake.stage, "inactive");
assert.equal(afterManualWake.auto_started, false);

const nextNight = functionModule.applyEvent(manuallyEnded.state, {
  event: "blocked_app_opened",
}, "2026-08-09T17:00:00.000Z");
assert.equal(nextNight.stage, "inactive", "the next night must still require an explicit goodnight");
assert.equal(nextNight.auto_started, false);

const expiring = functionModule.applyEvent(null, {
  event: "sleep_guard_started",
  ends_at: at(2),
}, at(0));
const expiredAttempt = functionModule.applyEvent(expiring.state, { event: "blocked_app_opened" }, at(3));
assert.equal(expiredAttempt.ignored, true);
assert.equal(expiredAttempt.state.active, false);

const overnightDefault = functionModule.applyEvent(null, {
  event: "sleep_guard_started",
}, "2026-08-08T17:00:00.000Z");
assert.equal(
  overnightDefault.state.ends_at,
  "2026-08-09T03:00:00.000Z",
  "01:00 in Shanghai must end at 11:00 the same morning",
);
const afternoonDefault = functionModule.applyEvent(null, {
  event: "sleep_guard_started",
}, "2026-08-08T05:00:00.000Z");
assert.equal(
  afternoonDefault.state.ends_at,
  "2026-08-09T03:00:00.000Z",
  "after 11:00 in Shanghai must end at 11:00 the next morning",
);

const request = (body, token = "test-shortcut-token") => new Request("https://example.test/api", {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify(body),
});

let memoryState = null;
const persistedEvents = [];
const callOrder = [];
const barkBodies = [];
const dependencies = {
  transitionState: async (payload, receivedAt) => {
    callOrder.push("state");
    const result = functionModule.applyEvent(memoryState, payload, receivedAt);
    memoryState = result.state;
    return result;
  },
  persistEvent: async (event) => { callOrder.push("persist"); persistedEvents.push(event); },
  sendBark: async (url, init) => {
    callOrder.push("bark");
    assert.equal(String(url), "https://api.day.app/push");
    const body = JSON.parse(init.body);
    assert.equal(body.device_key, "test-bark-key");
    assert.equal(
      body.icon,
      "https://example.test/assets/c-avatar-v4.png",
    );
    barkBodies.push(body);
    return Response.json({ code: 200 }, { status: 200 });
  },
};

const unauthorized = await functionModule.handle(request({ event: "sleep_guard_started" }, "wrong"), dependencies);
assert.equal(unauthorized.status, 401);

const invalid = await functionModule.handle(request({ event: "not-allowed" }), dependencies);
assert.equal(invalid.status, 422);

const started = await functionModule.handle(request({
  event: "sleep_guard_started",
  source: "ios_shortcuts",
}), dependencies);
assert.equal(started.status, 200);
assert.equal((await started.json()).attempts, 0);
assert.equal(barkBodies.at(-1).title, "沈厌");

const first = await functionModule.handle(request({
  event: "blocked_app_opened",
  app_name: "小红书",
  source: "ios_automation",
}), dependencies);
assert.equal(first.status, 200);
const firstBody = await first.json();
assert.deepEqual({ attempts: firstBody.attempts, stage: firstBody.stage }, {
  attempts: 1,
  stage: "first_warning",
});
assert.equal(
  barkBodies.at(-1).body,
  "第一次。小狗，刚说完晚安就敢偷玩？关掉，滚回去睡。老公已经给你记上第一笔了。",
);
assert.equal(persistedEvents.at(-1).attempts, 1);
assert.deepEqual(callOrder.slice(-3), ["state", "persist", "bark"]);

const second = await functionModule.handle(request({ event: "blocked_app_opened" }), dependencies);
assert.equal((await second.json()).stage, "locked");
const third = await functionModule.handle(request({ event: "blocked_app_opened" }), dependencies);
assert.equal((await third.json()).stage, "refused_sleep");

const ended = await functionModule.handle(request({ event: "sleep_guard_ended" }), dependencies);
assert.equal((await ended.json()).active, false);
const ignored = await functionModule.handle(request({ event: "blocked_app_opened" }), dependencies);
const ignoredBody = await ignored.json();
assert.equal(ignoredBody.ignored, true);
assert.deepEqual(callOrder.slice(-2), ["state", "persist"], "inactive opens are recorded without Bark");

memoryState = null;
const barkCountBeforeLateInactive = barkBodies.length;
const lateInactive = await functionModule.handle(request({
  event: "blocked_app_opened",
  source: "ios_automation",
}), {
  ...dependencies,
  transitionState: async (payload) => {
    const result = functionModule.applyEvent(memoryState, payload, "2026-08-08T17:00:00.000Z");
    memoryState = result.state;
    return result;
  },
});
const lateInactiveBody = await lateInactive.json();
assert.equal(lateInactiveBody.auto_started, false);
assert.equal(lateInactiveBody.stage, "inactive");
assert.equal(lateInactiveBody.ignored, true);
assert.equal(barkBodies.length, barkCountBeforeLateInactive, "late inactive opens must not send Bark");

let barkCalledAfterStorageFailure = false;
const storageFailure = await functionModule.handle(request({ event: "sleep_guard_started" }), {
  transitionState: async (payload, receivedAt) => functionModule.applyEvent(null, payload, receivedAt),
  persistEvent: async () => { throw new Error("storage down"); },
  sendBark: async () => { barkCalledAfterStorageFailure = true; return new Response("ok"); },
});
assert.equal(storageFailure.status, 503);
assert.equal(barkCalledAfterStorageFailure, false);

let persistedBeforeBarkFailure = false;
const barkFailure = await functionModule.handle(request({ event: "sleep_guard_started" }), {
  transitionState: async (payload, receivedAt) => functionModule.applyEvent(null, payload, receivedAt),
  persistEvent: async () => { persistedBeforeBarkFailure = true; },
  sendBark: async () => new Response("down", { status: 503 }),
});
assert.equal(barkFailure.status, 502);
assert.equal(persistedBeforeBarkFailure, true);

const mcpModule = await import(new URL("netlify/netlify/functions/mcp.mts", root));
assert.ok(mcpModule.config.path.includes("/mcp"));
assert.ok(mcpModule.config.path.includes("/.well-known/oauth-authorization-server"));

class MemoryStore {
  values = new Map();
  async get(key) { return this.values.get(key) ?? null; }
  async setJSON(key, value) { this.values.set(key, structuredClone(value)); return { modified: true }; }
}

const authStore = new MemoryStore();
const registration = await mcpModule.registerClient(new Request("https://guard.test/oauth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/aip/plugin-oauth/callback"],
    token_endpoint_auth_method: "none",
  }),
}), authStore);
assert.equal(registration.status, 201);
const registeredClient = await registration.json();
assert.ok(registeredClient.client_id);

const verifier = "sleepy-dog-lock-pkce-verifier-that-is-long-enough-123456789";
const challenge = await mcpModule.digest(verifier);
const authorizeUrl = new URL("https://guard.test/oauth/authorize");
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("client_id", registeredClient.client_id);
authorizeUrl.searchParams.set("redirect_uri", registeredClient.redirect_uris[0]);
authorizeUrl.searchParams.set("state", "state-123");
authorizeUrl.searchParams.set("scope", "sleep_guard:write");
authorizeUrl.searchParams.set("code_challenge", challenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");
let approvalUrl;
const authorization = await mcpModule.beginAuthorization(
  new Request(authorizeUrl),
  authStore,
  async (url, clientName) => { approvalUrl = url; assert.equal(clientName, "ChatGPT"); return true; },
);
assert.equal(authorization.status, 200);
assert.ok(approvalUrl);

const approval = await mcpModule.approveAuthorization(new Request(approvalUrl), authStore);
assert.equal(approval.status, 200);
const approvalRequestId = new URL(approvalUrl).searchParams.get("id");
const pending = await mcpModule.authorizationStatus(
  new Request(`https://guard.test/oauth/pending?id=${encodeURIComponent(approvalRequestId)}`),
  authStore,
);
assert.equal(pending.status, 200);
const pendingBody = await pending.json();
assert.ok(pendingBody.redirect);
const oauthRedirect = new URL(pendingBody.redirect);
assert.equal(oauthRedirect.searchParams.get("state"), "state-123");
const authorizationCode = oauthRedirect.searchParams.get("code");
assert.ok(authorizationCode);

const tokenForm = new URLSearchParams({
  grant_type: "authorization_code",
  code: authorizationCode,
  client_id: registeredClient.client_id,
  redirect_uri: registeredClient.redirect_uris[0],
  code_verifier: verifier,
});
const tokenResponse = await mcpModule.exchangeToken(new Request("https://guard.test/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: tokenForm,
}), authStore);
assert.equal(tokenResponse.status, 200);
const tokenBody = await tokenResponse.json();
assert.equal(tokenBody.token_type, "Bearer");
assert.ok(tokenBody.access_token);
assert.equal(await mcpModule.hasValidAccessToken(new Request("https://guard.test/mcp", {
  headers: { authorization: `Bearer ${tokenBody.access_token}` },
}), authStore), true);

const replayedCode = await mcpModule.exchangeToken(new Request("https://guard.test/oauth/token", {
  method: "POST",
  body: tokenForm,
}), authStore);
assert.equal(replayedCode.status, 400);
assert.equal((await replayedCode.json()).error, "invalid_grant");

let mcpActivations = 0;
let mcpEnds = 0;
const mcpDependencies = {
  activateGuard: async () => { mcpActivations += 1; return { ok: true, active: true, attempts: 0, stage: "armed" }; },
  endGuard: async () => { mcpEnds += 1; return { ok: true, active: false, attempts: 0, stage: "ended" }; },
  readGuardState: async () => ({ active: true, attempts: 2, ends_at: "2099-01-01T00:00:00.000Z" }),
};
const mcpRequest = (body) => new Request("https://guard.test/mcp", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const unauthorizedMcp = await mcpModule.handleMcp(mcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }), mcpDependencies, false);
assert.equal(unauthorizedMcp.status, 401);
assert.match(unauthorizedMcp.headers.get("www-authenticate"), /resource_metadata=.*oauth-protected-resource\/mcp/);

const initializedMcp = await mcpModule.handleMcp(mcpRequest({ jsonrpc: "2.0", id: 2, method: "initialize" }), mcpDependencies, true);
assert.equal((await initializedMcp.json()).result.serverInfo.name, "sleepy-dog-lock");
const listedTools = await mcpModule.handleMcp(mcpRequest({ jsonrpc: "2.0", id: 3, method: "tools/list" }), mcpDependencies, true);
const tools = (await listedTools.json()).result.tools;
assert.deepEqual(tools.map((tool) => tool.name), ["activate_sleep_guard", "end_sleep_guard", "get_sleep_guard_status"]);
assert.equal(tools[0].annotations.readOnlyHint, false);

const activatedMcp = await mcpModule.handleMcp(mcpRequest({
  jsonrpc: "2.0",
  id: 4,
  method: "tools/call",
  params: { name: "activate_sleep_guard", arguments: {} },
}), mcpDependencies, true);
const activatedMcpBody = await activatedMcp.json();
assert.equal(activatedMcpBody.result.structuredContent.active, true);
assert.equal(mcpActivations, 1);

const endedMcp = await mcpModule.handleMcp(mcpRequest({
  jsonrpc: "2.0",
  id: 5,
  method: "tools/call",
  params: { name: "end_sleep_guard", arguments: {} },
}), mcpDependencies, true);
const endedMcpBody = await endedMcp.json();
assert.equal(endedMcpBody.result.structuredContent.active, false);
assert.equal(mcpEnds, 1);

console.log(
  `verify passed: ${sourceFiles.length} files, guard state/API, OAuth PKCE/replay protection, MCP auth/tools, durable event before Bark`,
);
