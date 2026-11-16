// Entry of the page: connects the 3D frontend to ioBroker over the socket of the web adapter.
// Values come as push (subscribeState) and only for the datapoints that are mapped to devices.
import { element as $ } from './dom.js';
import type { Hass, CallWS, ProtocolMessage, ProtocolRecord, StateObject, StateValue } from './types.js';
import './vendor/home3d.js';
import { setupDeviceDialog } from './device-dialog.js';
import { IoBroker, NAMESPACE } from './iobroker.js';
import { Store, mappedIds, DATA_FILE } from './store.js';
import { entities } from './entities.js';
// Shop onboarding and telemetry are not supported in ioBroker.
try {
    localStorage.setItem('home3d.news.fun_gifts_2026', 'never');
    localStorage.setItem('home3d.diagInvite', '0');
} catch {
    // no storage (private window): the hints are shown then
}

const subscriptions = new Set<{
    callback: (payload: unknown) => void;
    msg: ProtocolMessage;
}>();
const states: Record<string, StateValue> = {};
let objects: Record<string, StateObject> = {},
    areas: Record<string, { area_id: string; name: string }> = {},
    subscribed = new Set<string>(),
    language = 'de',
    hass: Hass | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    element:
        | (HTMLElement & {
              hass?: Hass;
              setConfig?: (config: ProtocolRecord) => void;
          })
        | undefined;

function setStatus(text: string): void {
    $('status').textContent = text;
}
const io = new IoBroker();
const store = new Store(io, io, () => io.legacy());
io.conn.registerConnectionHandler(connected => {
    if (!connected) {
        setStatus('Offline · Verbindung zu ioBroker getrennt');
    } else if (hass) {
        render();
        void store.sync().catch(() => {});
    }
});
const callWS: CallWS = msg => store.call(msg);

function onState(id: string, state: StateValue | null | undefined): void {
    if (state) {
        states[id] = state;
    } else {
        delete states[id];
    }
    schedule();
}
/** Subscribes exactly the datapoints of the mappings; values arrive as push. */
async function follow(): Promise<void> {
    const ids = mappedIds(store.data.mappings);
    objects = await io.getObjects(ids);
    const next = new Set(ids);
    const added = ids.filter(id => !subscribed.has(id));
    const removed = [...subscribed].filter(id => !next.has(id));
    subscribed = next;
    if (removed.length) {
        io.conn.unsubscribeState(removed, onState);
        for (const id of removed) {
            delete states[id];
        }
    }
    // subscribeState also delivers the current values to onState.
    if (added.length) {
        await io.conn.subscribeState(added, onState);
    }
    schedule();
}
function schedule(): void {
    timer ??= setTimeout(() => {
        timer = undefined;
        render();
    }, 50);
}
function render(): void {
    hass = {
        language,
        user: { is_admin: true, name: 'ioBroker' },
        states: entities(store.data.mappings, states, objects),
        areas,
        floors: {},
        devices: {},
        entities: store.entities(),
        config: {
            unit_system: { temperature: '°C', length: 'm' },
            time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        callWS,
        callService: (domain: string, service: string, data: unknown) =>
            callWS({ type: 'iobroker/service', domain, service, data }),
        connection: {
            subscribeMessage: (
                callback: (payload: unknown) => void,
                msg: ProtocolMessage,
            ): Promise<() => Promise<void>> => {
                const s = { callback, msg };
                subscriptions.add(s);
                return Promise.resolve(() => {
                    subscriptions.delete(s);
                    return Promise.resolve();
                });
            },
        },
        localize: (key: string) => key,
    };
    if (!element) {
        const params = new URLSearchParams(location.search);
        element = document.createElement(params.get('view') === 'card' ? 'home3d-card' : 'home3d-panel');
        if (element.setConfig) {
            element.setConfig({
                type: 'custom:home3d-card',
                ...(params.get('plan') ? { plan: params.get('plan') } : {}),
                ...(params.get('template') ? { template: params.get('template') } : {}),
            });
        }
        $('app').append(element);
    }
    element.hass = hass;
    setStatus(`Verbunden · ${Object.keys(hass.states).length} Geräte`);
}
store.onEvent((type, payload) => {
    if (type === 'iobroker/mappings') {
        void follow().catch(e => setStatus(`Fehler · ${e.message}`));
        return;
    }
    for (const s of subscriptions) {
        if (s.msg.type !== type) {
            continue;
        }
        if (type === 'home3d/building/subscribe') {
            const plan = (payload as { plan: string }).plan;
            if (s.msg.plan !== '*' && (s.msg.plan || 'main') !== plan) {
                continue;
            }
        }
        s.callback(payload);
    }
});
async function start(): Promise<void> {
    await io.ready();
    language = await io.language();
    await store.load();
    areas = await store.areas();
    await follow();
    // Changes from other browsers: data.json is written on every save.
    let pending: ReturnType<typeof setTimeout> | undefined;
    await io.conn
        .subscribeFiles(NAMESPACE, DATA_FILE, () => {
            clearTimeout(pending);
            pending = setTimeout(() => void store.sync().catch(() => {}), 300);
        })
        .catch(e => console.warn('[home3d] subscribeFiles', e));
    render();
}
setupDeviceDialog({
    callWS,
    refresh: follow,
    getHass: () => hass,
    getStates: ids => io.getStates(ids),
    reload: () => io.forget(),
    socket: io.conn,
    getLanguage: () => language,
});
// Projekte: export and import of floor plans with pictures and devices (React, loaded on demand)
$('project-open').onclick = async () => {
    try {
        const { openProjects } = await import('./react/index.js');
        await openProjects({ callWS, socket: io.conn, language, namespace: NAMESPACE });
    } catch (e) {
        setStatus(`Fehler · ${(e as Error).message}`);
    }
};
// The icon component of the original host is not available here. Use local accessible symbols as fallback.
if (!customElements.get('ha-icon')) {
    customElements.define(
        'ha-icon',
        class extends HTMLElement {
            static observedAttributes = ['icon'];
            connectedCallback(): void {
                this.update();
            }
            attributeChangedCallback(): void {
                this.update();
            }
            update(): void {
                const name = this.getAttribute('icon') || '';
                this.textContent = /light|lamp/.test(name)
                    ? '◉'
                    : /thermometer/.test(name)
                      ? '♨'
                      : /window|door/.test(name)
                        ? '▣'
                        : /play/.test(name)
                          ? '▶'
                          : /pause/.test(name)
                            ? 'Ⅱ'
                            : '◇';
                this.setAttribute('aria-label', name.replace('mdi:', ''));
            }
        },
    );
}
start().catch(e => setStatus(`Fehler · ${e?.message || e}`));
