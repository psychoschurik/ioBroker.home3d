// Entry of the page: connects the 3D frontend to ioBroker over the socket of the web adapter.
// Values come as push (subscribeState) and only for the datapoints that are mapped to devices.
import { element as $ } from './dom.js';
import type { Hass, CallWS, Mapping, ProtocolMessage, ProtocolRecord, StateObject, StateValue } from './types.js';
import './mdi-icon.js';
import './vendor/home3d.js';
import { historyDuringPeriod, historyEnabled, statisticsDuringPeriod, timeTravelHistory } from './history.js';
import { parsePosition, sunState } from './sun.js';
import { setupMoreInfo } from './more-info.js';
import { joinBars } from './shell.js';
import { setupDeviceDialog } from './device-dialog.js';
import { pickDatapoint, setupDatapoints } from './datapoint.js';
import { IoBroker, NAMESPACE } from './iobroker.js';
import { Store, mappedIds, DATA_FILE } from './store.js';
import { entities } from './entities.js';
import { findHealth, healthAttributes, healthStateIds, type HealthIds } from './health.js';
import { lang, setLanguage, t, translatePage } from './lang.js';
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
// the objects read for the health datapoints, per device (kept: a device is read once)
const healthCache = new Map<string, Record<string, StateObject>>();
let objects: Record<string, StateObject> = {},
    areas: Record<string, { area_id: string; name: string }> = {},
    subscribed = new Set<string>(),
    // the battery, reachability and adapter datapoints of the mapped devices (see health.ts)
    health = new Map<string, HealthIds>(),
    language = 'de',
    // the user may not write the project (a demo page), or ?readonly: view only, as in the kiosk, no editor
    readOnly = false,
    systemPosition: { lat: number; lon: number } | null = null,
    historyInstances: string[] = [],
    // the first running recorder: preferred for its datapoints unless an instance is chosen in the editor
    recorderInstance: string | null = null,
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
/** The frame in the page's language; the help in it too (German: help.html). */
function showLanguage(): void {
    translatePage();
    $('help-link').setAttribute('href', lang() === 'de' ? 'help.html' : `help-${lang()}.html`);
}
// until the system's language is known: the one of the last visit, else the browser's
let lastLanguage: string | null = null;
try {
    lastLanguage = localStorage.getItem('home3d-lang');
} catch {
    // no storage: the browser's language
}
setLanguage(lastLanguage || navigator.language);
showLanguage();
const io = new IoBroker();
const store = new Store(io, io, () => io.legacy());
io.conn.registerConnectionHandler(connected => {
    if (!connected) {
        setStatus(t('offline'));
    } else if (hass) {
        render();
        void store.sync().catch(() => {});
    }
});
/**
 * The history instance preferred for the datapoints it records: the one chosen in the editor, else the first running
 * recorder (it selects its datapoints itself); null: each datapoint from the instance that logs it.
 */
function preferredHistory(): string | null {
    return store.data.timetravel_instance ?? recorderInstance;
}
// The history is read beside the store: Store.call() serializes, a long query would hold up saving.
const callWS: CallWS = msg => {
    if (msg?.type === 'history/history_during_period') {
        return historyDuringPeriod(io, store.data.mappings, msg, preferredHistory());
    }
    if (msg?.type === 'home3d/iobroker/history_enabled') {
        return historyEnabled(io, store.data.mappings, msg as { entity_ids?: unknown }, preferredHistory());
    }
    if (msg?.type === 'recorder/statistics_during_period') {
        return statisticsDuringPeriod(io, store.data.mappings, msg, preferredHistory());
    }
    if (msg?.type === 'energy/get_prefs') {
        // ioBroker has no energy dashboard: the editor's proposals find nothing, the sensors are chosen by hand
        return Promise.resolve({ energy_sources: [] });
    }
    if (msg?.type === 'home3d/timetravel/history') {
        return timeTravelHistory(io, store.data.mappings, msg, place(), preferredHistory());
    }
    return store.call(msg);
};

function onState(id: string, state: StateValue | null | undefined): void {
    if (state) {
        states[id] = state;
    } else {
        delete states[id];
    }
    schedule();
}
/** Where the system is: the GPS datapoint chosen in the editor (a boat), else the position of the system settings. */
function place(): { lat: number; lon: number } | null {
    const id = store.data.position_id;
    return (id ? parsePosition(states[id]?.val) : null) ?? systemPosition;
}
/** Subscribes exactly the datapoints of the mappings (and of the position); values arrive as push. */
async function follow(): Promise<void> {
    const mapped = [
        ...new Set([...mappedIds(store.data.mappings), ...(store.data.position_id ? [store.data.position_id] : [])]),
    ];
    objects = await io.getObjects(mapped);
    health = await findHealth(
        store.data.mappings.map(m => m.state),
        objects,
        prefix => io.statesUnder(prefix),
        list => io.getObjects(list),
        healthCache,
        new Map(store.data.mappings.filter(m => m.battery).map(m => [m.state, m.battery as string])),
    ).catch(() => new Map<string, HealthIds>());
    const ids = [...new Set([...mapped, ...healthStateIds(health)])];
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
/** The device health (battery, reachability, adapter) as attributes of the entities; mapped attributes win. */
function withHealth(list: ReturnType<typeof entities>): ReturnType<typeof entities> {
    const house = store.data.health_stale_min ?? null;
    // with "unreachable after X minutes": every mapped datapoint of a device is a sign of its life
    const own = new Map<string, string[]>();
    // a device's own setting ("nicht erreichbar" at one of its datapoints) counts for all of its datapoints
    const chosen = new Map<string, Mapping>();
    const set = (m: Mapping): boolean => m.reach !== undefined || !!m.reach_connected;
    for (const m of store.data.mappings) {
        const h = health.get(m.state);
        if (h) {
            own.set(h.device, [...(own.get(h.device) ?? []), m.state]);
            if (set(m) && !chosen.has(h.device)) {
                chosen.set(h.device, m);
            }
        }
    }
    const now = Date.now();
    for (const m of store.data.mappings) {
        const e = list[m.entity_id];
        // without health datapoints of its own a device is judged by its updates when its setting asks for it
        const h =
            health.get(m.state) ?? (m.reach === 'never' || typeof m.reach === 'number' ? { device: m.state } : null);
        if (!h || !e) {
            continue;
        }
        const setting = set(m) ? m : chosen.get(h.device);
        const reach = setting?.reach;
        const minutes = reach === undefined ? house : typeof reach === 'number' ? reach : null;
        const a = healthAttributes(h, states, now, {
            staleMs: minutes ? minutes * 60_000 : null,
            own: own.get(h.device) ?? [m.state],
        });
        // a player that is off is just not connected (a TV's cast session); "never": a device switched off on purpose
        // (12 V), also when its adapter loses the connection then
        if (reach === 'never' || m.entity_id.startsWith('media_player.')) {
            delete a.unreachable;
        }
        if (reach === 'never') {
            delete a.iobroker_adapter;
        }
        // checked only while its adapter is connected: switched off with the boat, its values are not stale then
        if (setting?.reach_connected && a.iobroker_adapter === 'disconnected') {
            delete a.iobroker_adapter;
            delete a.unreachable;
        }
        // the editor shows which battery counts and where it came from
        a.iobroker_battery_id = h.battery ?? h.lowbat ?? null;
        if (h.detected) {
            a.iobroker_battery_from = h.detected;
        }
        e.attributes = { ...a, ...e.attributes };
    }
    return list;
}
function schedule(): void {
    timer ??= setTimeout(() => {
        timer = undefined;
        render();
    }, 50);
}
function render(): void {
    const position = place();
    hass = {
        language,
        // not an admin: the 3D frontend shows no editor and saves nothing
        user: { is_admin: !readOnly, name: 'ioBroker' },
        // the sun lights the rooms; ioBroker has none, it is calculated from the position of the system
        states: {
            ...withHealth(entities(store.data.mappings, states, objects)),
            ...(position ? { 'sun.sun': sunState(position.lat, position.lon) } : {}),
        },
        areas,
        floors: {},
        devices: {},
        entities: store.entities(),
        config: {
            unit_system: { temperature: '°C', length: 'm' },
            time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...(position ? { latitude: position.lat, longitude: position.lon } : {}),
            position_id: store.data.position_id ?? null,
            // the editor's house settings: where the time travel reads the past
            timetravel_instance: store.data.timetravel_instance ?? null,
            // and after how many minutes without an update a device counts as unreachable (null: as it reports)
            health_stale_min: store.data.health_stale_min ?? null,
            history_instances: historyInstances,
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
                // the card fills the page (an iframe in VIS) down to the bottom edge, not a fixed 420 px
                fill: true,
                ...(params.get('plan') ? { plan: params.get('plan') } : {}),
                ...(params.get('template') ? { template: params.get('template') } : {}),
            });
        }
        if (element.localName === 'home3d-panel') {
            joinBars(element);
        }
        $('app').append(element);
    }
    element.hass = hass;
    setStatus(t('connected', { n: Object.keys(hass.states).length }));
}
store.onEvent((type, payload) => {
    if (type === 'iobroker/mappings') {
        void follow().catch(e => setStatus(t('error', { error: e.message })));
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
    setLanguage(language);
    showLanguage();
    readOnly = new URLSearchParams(location.search).has('readonly') || !(await io.canWrite(DATA_FILE));
    store.readOnly = readOnly;
    if (readOnly) {
        document.documentElement.classList.add('kiosk', 'read-only');
    }
    systemPosition = await io.location();
    historyInstances = await io.historyInstances();
    recorderInstance = await io.recorderInstance();
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
    // the sun moves on
    setInterval(schedule, 60_000);
}
const datapoints = {
    callWS,
    io,
    socket: io.conn,
    getLanguage: () => language,
    refresh: follow,
    setStatus,
    getPositionId: () => store.data.position_id ?? null,
};
setupDatapoints(datapoints);
setupDeviceDialog({
    callWS,
    refresh: follow,
    pickDatapoint: m => pickDatapoint(datapoints, m),
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
        setStatus(t('error', { error: (e as Error).message }));
    }
};
setupMoreInfo({ callWS, getHass: () => hass });
start().catch(e => {
    const text = t('error', { error: e?.message || e });
    setStatus(text);
    // in the kiosk the status line is hidden: the page says it itself (e.g. a demo user who may not read the project)
    if (!element && document.documentElement.classList.contains('kiosk')) {
        const p = document.createElement('p');
        p.setAttribute('role', 'alert');
        p.className = 'start-error';
        p.textContent = text;
        $('app').replaceChildren(p);
    }
});
