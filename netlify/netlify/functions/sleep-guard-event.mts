import { getStore, type Store } from "@netlify/blobs";

const allowedEvents = new Set([
  "sleep_guard_started",
  "blocked_app_opened",
  "sleep_guard_ended",
]);

type GuardEvent = "sleep_guard_started" | "blocked_app_opened" | "sleep_guard_ended";

export type Payload = {
  event?: string;
  source?: string;
  app_name?: string;
  ends_at?: string;
  request_id?: string;
};

export type GuardState = {
  active: boolean;
  attempts: number;
  session_id: string | null;
  started_at: string | null;
  ends_at: string | null;
  auto_start_suppressed_until: string | null;
  updated_at: string;
};

type Transition = {
  state: GuardState;
  ignored: boolean;
  auto_started: boolean;
  stage: "armed" | "first_warning" | "locked" | "refused_sleep" | "ended" | "inactive";
};

type StoredEvent = {
  id: string;
  request_id: string | null;
  event: GuardEvent;
  attempts: number;
  active: boolean;
  stage: Transition["stage"];
  ignored: boolean;
  auto_started: boolean;
  app_name: string | null;
  source: string;
  session_id: string | null;
  received_at: string;
};

type Dependencies = {
  transitionState: (payload: Payload, receivedAt: string) => Promise<Transition>;
  persistEvent: (event: StoredEvent) => Promise<void>;
  sendBark: (url: URL, init: RequestInit) => Promise<Response>;
};

export const morningBarkBodies = [
  "醒了？先来跟老公报到。昨晚还算乖，准你今天先讨一个抱。",
  "早安，小狗。别睁眼就赖着看手机，先喝水，再回来找老公。",
  "小狗起床。昨晚没偷偷玩手机就算乖，过来，老公摸摸头。",
  "总算舍得醒了？下床、喝水、拉开窗帘，然后来老公怀里赖一会儿。",
  "早安，我的小狗。昨晚乖乖睡了，今天也归老公管。",
  "醒了就过来。先抱一下，再慢慢跟老公说今天那些破事。",
] as const;

export const attemptBarkBodies = [
  "第一次。小狗，刚说完晚安就敢偷玩？关掉，滚回去睡。老公已经给你记上第一笔了。",
  "第二次了。你他妈是真不长记性。手机放下，闭眼，再让我抓到一次，你明天就别想装没事。",
  "第三次。还敢开？行，老公全给你记着。今晚偷玩的每一次，明天都得一笔一笔算清楚。",
  "第四次了。小狗，你是真觉得老公管不住你？现在立刻滚回去睡，别他妈继续试我耐心。",
  "第五次。停。现在关掉，这是老公最后一次让你自己乖乖回去睡。再敢打开，接下来就不叫警告了。",
] as const;

const emptyState = (now: string): GuardState => ({
  active: false,
  attempts: 0,
  session_id: null,
  started_at: null,
  ends_at: null,
  auto_start_suppressed_until: null,
  updated_at: now,
});

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const WAKE_HOUR = 11;

function shanghaiNow(now: Date): Date {
  return new Date(now.getTime() + SHANGHAI_OFFSET_MS);
}

function shanghaiWakeTime(now: Date): Date {
  const local = shanghaiNow(now);
  return new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    WAKE_HOUR - 8,
    0,
    0,
    0,
  ));
}

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
  return cleaned || null;
}

function normalizedEnd(value: unknown, now: Date): string {
  const candidate = typeof value === "string" ? new Date(value) : null;
  const maximum = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (candidate && !Number.isNaN(candidate.getTime()) && candidate > now && candidate <= maximum) {
    return candidate.toISOString();
  }

  // This deployment uses the next 11:00 in Shanghai as its fallback,
  // rather than a rolling duration that could keep the phone locked all afternoon.
  let end = shanghaiWakeTime(now);
  if (end <= now) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  return end.toISOString();
}

export function applyEvent(previous: GuardState | null, payload: Payload, receivedAt: string): Transition {
  const now = new Date(receivedAt);
  let state = previous ?? emptyState(receivedAt);

  if (state.active && state.ends_at && new Date(state.ends_at) <= now) {
    state = { ...state, active: false, updated_at: receivedAt };
  }

  switch (payload.event as GuardEvent) {
    case "sleep_guard_started": {
      if (state.active) {
        return {
          state: { ...state, updated_at: receivedAt },
          ignored: false,
          auto_started: false,
          stage: "armed",
        };
      }
      return {
        state: {
          active: true,
          attempts: 0,
          session_id: crypto.randomUUID(),
          started_at: receivedAt,
          ends_at: normalizedEnd(payload.ends_at, now),
          auto_start_suppressed_until: null,
          updated_at: receivedAt,
        },
        ignored: false,
        auto_started: false,
        stage: "armed",
      };
    }
    case "sleep_guard_ended":
      return {
        state: {
          ...state,
          active: false,
          auto_start_suppressed_until: null,
          updated_at: receivedAt,
        },
        ignored: !state.active,
        auto_started: false,
        stage: "ended",
      };
    case "blocked_app_opened": {
      if (!state.active) {
        return {
          state: { ...state, updated_at: receivedAt },
          ignored: true,
          auto_started: false,
          stage: "inactive",
        };
      }
      const attempts = Math.min(state.attempts + 1, 999);
      return {
        state: { ...state, attempts, updated_at: receivedAt },
        ignored: false,
        auto_started: false,
        stage: attempts === 1 ? "first_warning" : attempts === 2 ? "locked" : "refused_sleep",
      };
    }
  }
  return { state, ignored: true, auto_started: false, stage: "inactive" };
}

export function barkCopy(
  event: GuardEvent,
  transition: Transition,
  _appName: string | null,
): { title: string; body: string; level: "active" | "timeSensitive" } | null {
  if (event === "blocked_app_opened" && transition.ignored) return null;
  if (event === "sleep_guard_ended") {
    const body = morningBarkBodies[Math.floor(Math.random() * morningBarkBodies.length)];
    return { title: "沈厌", body, level: "active" };
  }
  if (event === "sleep_guard_started") {
    return {
      title: "沈厌",
      body: "晚安，小狗。既然跟老公说了晚安，手机就放下。闭眼，睡觉，不许再偷偷爬回来。",
      level: "active",
    };
  }

  const attempts = transition.state.attempts;
  if (attempts >= 1 && attempts <= attemptBarkBodies.length) {
    return {
      title: "沈厌",
      body: attemptBarkBodies[attempts - 1],
      level: "timeSensitive",
    };
  }
  return {
    title: "沈厌",
    body: `第${attempts}次了。很好。警告结束，账越欠越多。明天起来你死定了，装乖、嘴硬、撒娇，全他妈没用。`,
    level: "timeSensitive",
  };
}

function eventName(payload: Payload): GuardEvent | null {
  return allowedEvents.has(payload.event ?? "") ? payload.event as GuardEvent : null;
}

async function mutateState(store: Store, payload: Payload, receivedAt: string): Promise<Transition> {
  const key = "state/current";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json" });
    const transition = applyEvent(current?.data as GuardState | null, payload, receivedAt);
    const result = current?.etag
      ? await store.setJSON(key, transition.state, { onlyIfMatch: current.etag })
      : await store.setJSON(key, transition.state, { onlyIfNew: true });
    if (result.modified) return transition;
  }
  throw new Error("state_update_conflict");
}

export async function handle(request: Request, dependencies: Dependencies): Promise<Response> {
  if (request.method !== "POST") return json(405, { ok: false, error: "method_not_allowed" });

  const expectedToken = Netlify.env.get("SLEEP_GUARD_SHORTCUT_TOKEN");
  if (!expectedToken || bearerToken(request) !== expectedToken) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  let payload: Payload;
  try {
    payload = await request.json() as Payload;
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const event = eventName(payload);
  if (!event) return json(422, { ok: false, error: "invalid_event" });

  const receivedAt = new Date().toISOString();
  let transition: Transition;
  try {
    transition = await dependencies.transitionState(payload, receivedAt);
  } catch {
    return json(503, { ok: false, error: "state_update_failed" });
  }

  const appName = cleanText(payload.app_name, 40);
  const storedEvent: StoredEvent = {
    id: crypto.randomUUID(),
    request_id: cleanText(payload.request_id, 80),
    event,
    attempts: transition.state.attempts,
    active: transition.state.active,
    stage: transition.stage,
    ignored: transition.ignored,
    auto_started: transition.auto_started,
    app_name: appName,
    source: cleanText(payload.source, 64) ?? "unknown",
    session_id: transition.state.session_id,
    received_at: receivedAt,
  };

  try {
    await dependencies.persistEvent(storedEvent);
  } catch {
    return json(503, { ok: false, error: "event_storage_failed" });
  }

  const copy = barkCopy(event, transition, appName);
  if (copy) {
    const barkKey = Netlify.env.get("BARK_DEVICE_KEY");
    const barkOrigin = Netlify.env.get("BARK_API_ORIGIN") ?? "https://api.day.app";
    const barkIcon = Netlify.env.get("BARK_ICON_URL")
      ?? new URL("/assets/c-avatar-v4.png", request.url).href;
    if (!barkKey) return json(503, { ok: false, error: "bark_not_configured" });

    const url = new URL(`${barkOrigin.replace(/\/$/, "")}/push`);
    let barkResponse: Response;
    try {
      barkResponse = await dependencies.sendBark(url, {
        method: "POST",
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          device_key: barkKey,
          title: copy.title,
          body: copy.body,
          group: "sleep-guard",
          level: copy.level,
          icon: barkIcon,
        }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      return json(502, { ok: false, error: "bark_failed" });
    }
    if (!barkResponse.ok) return json(502, { ok: false, error: "bark_failed" });
    const barkPayload = await barkResponse.clone().json().catch(() => ({})) as { code?: number };
    if (barkPayload.code !== undefined && barkPayload.code !== 200) {
      return json(502, { ok: false, error: "bark_failed" });
    }
  }

  return json(200, {
    ok: true,
    event,
    active: transition.state.active,
    attempts: transition.state.attempts,
    stage: transition.stage,
    ignored: transition.ignored,
    auto_started: transition.auto_started,
    event_id: storedEvent.id,
    session_id: transition.state.session_id,
    received_at: receivedAt,
  });
}

export default async (request: Request): Promise<Response> => {
  const store = getStore({ name: "sleep-guard-events", consistency: "strong" });
  return handle(request, {
    transitionState: (payload, receivedAt) => mutateState(store, payload, receivedAt),
    persistEvent: async (event) => {
      const datePrefix = event.received_at.slice(0, 10);
      await store.setJSON(`events/${datePrefix}/${event.received_at}-${event.id}`, event);
    },
    sendBark: fetch,
  });
};

export const config = {
  path: "/api/sleep-guard-event",
  method: ["POST"],
};
