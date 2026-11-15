import { element as $ } from "./dom.js";
import type { Hass, CallWS, ProtocolMessage, ProtocolRecord } from "./types.js";
import "./vendor/home3d.js";
import { setupDeviceDialog } from "./device-dialog.js";
// Shop onboarding and telemetry are not supported by the ioBroker port.
try {
  localStorage.setItem("home3d.news.fun_gifts_2026", "never");
  localStorage.setItem("home3d.diagInvite", "0");
} catch {}

const subscriptions = new Set<{
  callback: (payload: unknown) => void;
  msg: ProtocolMessage;
}>();
let hass: Hass | undefined,
  element:
    | (HTMLElement & {
        hass?: Hass;
        setConfig?: (config: ProtocolRecord) => void;
      })
    | undefined,
  previous: Hass | undefined,
  lastSeq = 0;
async function request(path: string, data?: unknown): Promise<any> {
  const response = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const value = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !$("login").open) $("login").showModal();
    throw Object.assign(new Error(value.message || response.statusText), value);
  }
  return value;
}
const callWS: CallWS = (msg) => request("/api/call", msg);
async function refresh() {
  const snapshot: Hass = await request("/api/bootstrap");
  hass = {
    ...snapshot,
    callWS,
    callService: (domain: string, service: string, data: unknown) =>
      callWS({ type: "iobroker/service", domain, service, data }),
    connection: {
      subscribeMessage: async (
        callback: (payload: unknown) => void,
        msg: ProtocolMessage,
      ) => {
        const s = { callback, msg };
        subscriptions.add(s);
        return async () => {
          subscriptions.delete(s);
        };
      },
    },
    localize: (key: string) => key,
  };
  if (!element) {
    const params = new URLSearchParams(location.search);
    element = document.createElement(
      params.get("view") === "card" ? "home3d-card" : "home3d-panel",
    );
    if (element.setConfig)
      element.setConfig({
        type: "custom:home3d-card",
        ...(params.get("plan") ? { plan: params.get("plan") } : {}),
        ...(params.get("template") ? { template: params.get("template") } : {}),
      });
    element.hass = hass;
    $("app").append(element);
  } else if (
    JSON.stringify(snapshot.states) !== JSON.stringify(previous?.states) ||
    JSON.stringify(snapshot.entities) !== JSON.stringify(previous?.entities) ||
    JSON.stringify(snapshot.areas) !== JSON.stringify(previous?.areas)
  )
    element.hass = hass;
  for (const s of subscriptions) {
    if (s.msg.type === "home3d/building/subscribe" && previous) {
      for (const [plan, revision] of Object.entries(snapshot.revisions))
        if (
          revision !== previous.revisions[plan] &&
          (s.msg.plan === "*" || (s.msg.plan || "main") === plan)
        )
          s.callback({ plan, revision });
    } else if (
      s.msg.type === "home3d/plans/subscribe" &&
      previous &&
      JSON.stringify(snapshot.plans) !== JSON.stringify(previous.plans)
    )
      s.callback(snapshot.plans);
    else if (
      !["home3d/building/subscribe", "home3d/plans/subscribe"].includes(
        s.msg.type,
      )
    )
      for (const event of snapshot.events)
        if (event.seq > lastSeq && event.type === s.msg.type)
          s.callback(event.payload);
  }
  previous = snapshot;
  lastSeq = snapshot.seq;
  $("status").textContent =
    `Verbunden · ${Object.keys(snapshot.states).length} Geräte`;
}
async function tick() {
  try {
    await refresh();
  } catch (e) {
    $("status").textContent = `Offline · ${e.message}`;
  } finally {
    setTimeout(tick, 2000);
  }
}
$("login-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    await request("/api/login", { token: $("token").value });
    $("token").value = "";
    $("login").close();
    await refresh();
  } catch (e) {
    $("login-error").textContent = e.message;
  }
};
$("login").addEventListener("cancel", (event) => event.preventDefault());
setupDeviceDialog({ callWS, refresh, getHass: () => hass });
// HA's icon component is not available outside HA. Use local accessible symbols as fallback.
if (!customElements.get("ha-icon"))
  customElements.define(
    "ha-icon",
    class extends HTMLElement {
      static observedAttributes = ["icon"];
      connectedCallback() {
        this.update();
      }
      attributeChangedCallback() {
        this.update();
      }
      update() {
        const name = this.getAttribute("icon") || "";
        this.textContent = /light|lamp/.test(name)
          ? "◉"
          : /thermometer/.test(name)
            ? "♨"
            : /window|door/.test(name)
              ? "▣"
              : /play/.test(name)
                ? "▶"
                : /pause/.test(name)
                  ? "Ⅱ"
                  : "◇";
        this.setAttribute("aria-label", name.replace("mdi:", ""));
      }
    },
  );
tick();
