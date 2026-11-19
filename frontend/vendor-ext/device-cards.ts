// Glass cards with controls for robot vacuums, robot mowers and coffee machines: a module built into this page
// (registered in modules.ts beside the pool's, see poolMore in tasks.ts). What a card shows and what its buttons
// switch are datapoints linked at the device in the editor; a link left empty is looked for below the same ioBroker
// device as the device's own datapoint, then by name. The buttons write only through the mappings' actions
// (callService → execute()).
import { mowerPhase } from './home-data';

interface StateLike {
    state: string;
    attributes: Record<string, unknown>;
    last_changed?: string;
}
interface HassLike {
    states: Record<string, StateLike | undefined>;
}
export interface DeviceItem {
    id: string;
    type: string;
    name?: string;
    entity?: string | null;
    device_links?: Partial<Record<DeviceRole, string>> | null;
    device_card?: boolean;
}
interface FloorLike {
    id: string;
    furniture: DeviceItem[];
}
interface BuildingLike {
    floors: FloorLike[];
}
export interface DeviceHost {
    hass(): HassLike;
    building(): BuildingLike | null;
    language(): string;
    updateBuilding?(mutate: (next: BuildingLike) => void): void;
    callService?(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
}

export type DeviceKind = 'vacuum' | 'mower' | 'coffee';
export type DeviceRole =
    | 'battery'
    | 'start'
    | 'pause'
    | 'home'
    | 'power'
    | 'water'
    | 'beans'
    | 'descale'
    | 'cups'
    | 'drink1'
    | 'drink2'
    | 'drink3';

export const DEVICE_ROLES: Record<DeviceKind, DeviceRole[]> = {
    vacuum: ['battery', 'start', 'pause', 'home'],
    mower: ['battery', 'start', 'pause', 'home'],
    coffee: ['power', 'water', 'beans', 'descale', 'cups', 'drink1', 'drink2', 'drink3'],
};

/** Which card a piece of furniture gets. */
export function deviceKind(type: string): DeviceKind | null {
    if (type === 'robot_vacuum' || /robot_?vacuum|vacuum_dock/.test(type)) {
        return 'vacuum';
    }
    if (type === 'robot_mower' || /robot_?mower/.test(type)) {
        return 'mower';
    }
    if (type === 'coffee_machine' || /coffee_machine|espresso_machine/.test(type)) {
        return 'coffee';
    }
    return null;
}

const TEXTS: Record<string, Record<string, string>> = {
    de: {
        vacuum: 'Saugroboter',
        mower: 'Mähroboter',
        coffee: 'Kaffeemaschine',
        heading: 'Glaskarte: Steuerung',
        show: 'Glaskarte über dem Gerät zeigen',
        hint: 'Leer gelassen wird ein Datenpunkt unter demselben Gerät oder nach dem Namen gesucht. Die Knöpfe schalten nur verbundene Datenpunkte (Geräte verbinden).',
        battery: 'Akku',
        start: 'Start',
        pause: 'Pause',
        home: 'Zur Station',
        power: 'Leistung (W)',
        water: 'Wassertank',
        beans: 'Bohnen',
        descale: 'Entkalken',
        cups: 'Bezüge',
        drink1: 'Getränk 1',
        drink2: 'Getränk 2',
        drink3: 'Getränk 3',
        drinks: 'Getränk',
        cleaning: 'saugt',
        mowing: 'mäht',
        returning: 'fährt zur Station',
        docked: 'in der Station',
        paused: 'pausiert',
        idle: 'bereit',
        error: 'Störung',
        unknown: 'unbekannt',
        off: 'aus',
        heating: 'heizt',
        ready: 'bereit',
        on: 'Ein',
        off_btn: 'Aus',
        since: 'seit {time}',
        water_empty: 'Wassertank auffüllen',
        beans_empty: 'Bohnen nachfüllen',
        descale_due: 'Entkalken fällig',
        empty: 'leer',
        ok: 'ok',
        due: 'fällig',
    },
    en: {
        vacuum: 'Robot vacuum',
        mower: 'Robot mower',
        coffee: 'Coffee machine',
        heading: 'Glass card: controls',
        show: 'Show a glass card over the device',
        hint: 'Left empty, a datapoint below the same device or by its name is used. The buttons only switch connected datapoints (Connect devices).',
        battery: 'Battery',
        start: 'Start',
        pause: 'Pause',
        home: 'Dock',
        power: 'Power (W)',
        water: 'Water tank',
        beans: 'Beans',
        descale: 'Descaling',
        cups: 'Drinks made',
        drink1: 'Drink 1',
        drink2: 'Drink 2',
        drink3: 'Drink 3',
        drinks: 'Drink',
        cleaning: 'cleaning',
        mowing: 'mowing',
        returning: 'returning to dock',
        docked: 'docked',
        paused: 'paused',
        idle: 'ready',
        error: 'error',
        unknown: 'unknown',
        off: 'off',
        heating: 'heating',
        ready: 'ready',
        on: 'On',
        off_btn: 'Off',
        since: 'since {time}',
        water_empty: 'Refill the water tank',
        beans_empty: 'Refill the beans',
        descale_due: 'Descaling due',
        empty: 'empty',
        ok: 'ok',
        due: 'due',
    },
    ru: {
        vacuum: 'Робот-пылесос',
        mower: 'Робот-газонокосилка',
        coffee: 'Кофемашина',
        heading: 'Стеклянная карточка: управление',
        show: 'Показывать стеклянную карточку над устройством',
        hint: 'Если поле пустое, точка данных ищется у того же устройства или по имени. Кнопки переключают только подключённые точки данных (Подключить устройства).',
        battery: 'Аккумулятор',
        start: 'Старт',
        pause: 'Пауза',
        home: 'На базу',
        power: 'Мощность (Вт)',
        water: 'Бак для воды',
        beans: 'Зёрна',
        descale: 'Удаление накипи',
        cups: 'Приготовлено',
        drink1: 'Напиток 1',
        drink2: 'Напиток 2',
        drink3: 'Напиток 3',
        drinks: 'Напиток',
        cleaning: 'убирает',
        mowing: 'косит',
        returning: 'едет на базу',
        docked: 'на базе',
        paused: 'пауза',
        idle: 'готов',
        error: 'ошибка',
        unknown: 'неизвестно',
        off: 'выкл.',
        heating: 'нагревается',
        ready: 'готова',
        on: 'Вкл.',
        off_btn: 'Выкл.',
        since: 'с {time}',
        water_empty: 'Долейте воду',
        beans_empty: 'Досыпьте зёрна',
        descale_due: 'Пора удалить накипь',
        empty: 'пусто',
        ok: 'ок',
        due: 'пора',
    },
};

function text(lang: string, key: string, vars: Record<string, string> = {}): string {
    const l = lang.slice(0, 2);
    const s = TEXTS[l]?.[key] ?? TEXTS.en[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

const DEAD = /^(unavailable|unknown|)$/i;
const str = (v: unknown): string =>
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '';
const domain = (id: string): string => id.slice(0, id.indexOf('.'));
const nameOf = (id: string, st: StateLike | undefined): string =>
    typeof st?.attributes.friendly_name === 'string' ? st.attributes.friendly_name : id;
const roleOf = (st: StateLike | undefined): string =>
    typeof st?.attributes.iobroker_role === 'string' ? st.attributes.iobroker_role : '';

function num(st: StateLike | undefined | null): number | null {
    if (!st || DEAD.test(st.state)) {
        return null;
    }
    const n = Number(st.state);
    return Number.isFinite(n) ? n : null;
}

const ON = /^(on|true|1|an|ein|running|läuft)$/i;
const WRITABLE = /^(switch|button|input_boolean|input_button|script|scene)$/;

/** What a robot vacuum's state says (Home Assistant words, the codes of Xiaomi/Roborock, plain words). */
export type VacuumPhase = 'cleaning' | 'returning' | 'docked' | 'paused' | 'idle' | 'error' | 'unknown';
const ROBOROCK: Record<number, VacuumPhase> = {
    1: 'idle',
    2: 'idle',
    3: 'idle',
    5: 'cleaning',
    6: 'returning',
    7: 'cleaning',
    8: 'docked',
    9: 'error',
    10: 'paused',
    11: 'cleaning',
    12: 'error',
    13: 'idle',
    14: 'idle',
    15: 'returning',
    16: 'cleaning',
    17: 'cleaning',
    18: 'cleaning',
    100: 'docked',
};
export function vacuumPhase(value: unknown): VacuumPhase {
    if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim()))) {
        return ROBOROCK[Number(value)] ?? 'unknown';
    }
    const t = (typeof value === 'string' ? value : str(value)).toLowerCase().trim();
    if (DEAD.test(t)) {
        return 'unknown';
    }
    if (/error|fehler|stuck|trapped|blocked|lifted|alarm|ошибк/.test(t)) {
        return 'error';
    }
    if (/return|going home|back|heim|zurück|docking|возвращ/.test(t)) {
        return 'returning';
    }
    if (/paus|пауз/.test(t)) {
        return 'paused';
    }
    if (
        /clean|saug|wisch|sweep|mop|reinig|working|zone|segment|spot|уборк|убира/.test(t) ||
        t === 'on' ||
        t === 'true'
    ) {
        return 'cleaning';
    }
    if (/charg|lädt|laden|dock|station|base|full|заряж|баз/.test(t) || t === 'off' || t === 'false') {
        return 'docked';
    }
    if (/idle|bereit|ready|standby|sleep|wait|готов/.test(t)) {
        return 'idle';
    }
    return 'unknown';
}

/** A robot vacuum's state in the words the 3D view's robot drives by (cleaning, returning, error, docked, idle). */
export function robotState(state: string | undefined): string | undefined {
    if (state === undefined) {
        return undefined;
    }
    const p = vacuumPhase(state);
    return p === 'unknown' ? state : p === 'paused' ? 'idle' : p;
}

/** The words that name a device of a kind (for links found by name). */
const KIND_WORD: Record<DeviceKind, RegExp> = {
    vacuum: /saug|vacuum|robo|roborock|deebot|ecovacs|roomba|valetudo|dreame|xiaomi|пылесос/i,
    mower: /mäh|mower|landroid|worx|automower|husqvarna|gardena|indego|navimow|segway|газонокос/i,
    coffee: /kaffee|coffee|espresso|jura|melitta|delonghi|de'longhi|nespresso|siemens eq|кофе/i,
};

/** Whether an entity may serve a role (its domain, then its ioBroker role or name). */
function fits(role: DeviceRole, id: string, st: StateLike): boolean {
    const d = domain(id);
    const r = roleOf(st);
    // the name and the datapoint's own last part (not its path: "mihome-vacuum" is no "home")
    const n = `${nameOf(id, st)} ${str(st.attributes.iobroker_id).split('.').pop() ?? ''}`.toLowerCase();
    const unit = str(st.attributes.unit_of_measurement);
    switch (role) {
        case 'battery':
            return (
                d === 'sensor' && (/battery/.test(r) || /akku|batter|заряд/.test(n)) && !/low|niedrig|schwach/.test(n)
            );
        case 'start':
            return (
                WRITABLE.test(d) &&
                (/start|clean/.test(r) || /start|clean|saugen|reinig|mähen|mow|старт/.test(n)) &&
                !/pause|stop|home|dock|station|heim/.test(n)
            );
        case 'pause':
            return WRITABLE.test(d) && (/pause|stop/.test(r) || /pause|stop|anhalten|пауз/.test(n));
        case 'home':
            return (
                WRITABLE.test(d) &&
                (/home|dock|return/.test(r) || /home|dock|charge|return|heim|station|basis|zurück|park|баз/.test(n))
            );
        case 'power':
            return d === 'sensor' && (/power/.test(r) || /^k?W$/.test(unit)) && !/kWh/.test(unit);
        case 'water':
            return (
                /^(sensor|binary_sensor)$/.test(d) && /wasser|water|tank|вод/.test(n) && !/temp|härte|hardness/.test(n)
            );
        case 'beans':
            return /^(sensor|binary_sensor)$/.test(d) && /bohne|bean|зерн/.test(n);
        case 'descale':
            return /^(sensor|binary_sensor)$/.test(d) && /entkalk|descal|kalk|накип/.test(n);
        case 'cups':
            return d === 'sensor' && /tasse|cup|bezug|bezüge|getränke|counter|zähler|drinks|чаш|напит/.test(n);
        default:
            // a drink: a button or switch named after one
            return (
                WRITABLE.test(d) &&
                /espresso|cappuccino|latte|lungo|ristretto|americano|macchiato|flat.?white|kaffee|coffee|кофе|капучино|эспрессо/.test(
                    n,
                ) &&
                !/power|strom|\bein\b|\baus\b|\bon\b|\boff\b|standby/.test(n)
            );
    }
}

/** The datapoint that tells a device's state (linked by hand, else one of its kind found by name). */
export function mainEntity(hass: HassLike, f: DeviceItem): string | null {
    if (f.entity === 'none') {
        return null;
    }
    if (f.entity) {
        return f.entity;
    }
    const kind = deviceKind(f.type);
    if (!kind) {
        return null;
    }
    const ids = Object.keys(hass.states).sort();
    const named = (id: string): boolean => KIND_WORD[kind].test(nameOf(id, hass.states[id]));
    if (kind === 'coffee') {
        const switches = ids.filter(
            id => /^(switch|input_boolean)$/.test(domain(id)) && named(id) && !fits('drink1', id, hass.states[id]!),
        );
        return switches.find(id => /power/.test(roleOf(hass.states[id]))) ?? switches[0] ?? null;
    }
    const own = kind === 'vacuum' ? 'vacuum' : 'lawn_mower';
    return (
        ids.find(id => domain(id) === own) ??
        ids.find(
            id =>
                /^(sensor|select)$/.test(domain(id)) &&
                named(id) &&
                /state|status|zustand|состоян/i.test(`${nameOf(id, hass.states[id])} ${roleOf(hass.states[id])}`),
        ) ??
        null
    );
}

/** The ioBroker device of an entity: its datapoint's id without the last part, `levels` deep (adapter.instance.device…). */
function baseOf(st: StateLike | undefined, levels: number): string | null {
    const id = st?.attributes.iobroker_id;
    if (typeof id !== 'string') {
        return null;
    }
    const parts = id.split('.');
    return parts.length > levels ? `${parts.slice(0, levels).join('.')}.` : null;
}

/** A role's datapoint found by itself: below the main datapoint's device first, then any with the device's word in its name. */
export function autoRole(hass: HassLike, f: DeviceItem, role: DeviceRole): string | null {
    const kind = deviceKind(f.type);
    if (!kind) {
        return null;
    }
    const main = mainEntity(hass, f);
    const mainSt = main ? hass.states[main] : undefined;
    const ids = Object.keys(hass.states)
        .sort()
        .filter(id => id !== main && fits(role, id, hass.states[id]!));
    const drinkIndex = role === 'drink1' ? 0 : role === 'drink2' ? 1 : role === 'drink3' ? 2 : -1;
    const pick = (list: string[]): string | null => (drinkIndex >= 0 ? (list[drinkIndex] ?? null) : (list[0] ?? null));
    for (const levels of [3, 2]) {
        const base = baseOf(mainSt, levels);
        if (!base) {
            continue;
        }
        const below = ids.filter(id => str(hass.states[id]!.attributes.iobroker_id).startsWith(base));
        if (below.length) {
            return pick(below);
        }
    }
    // a Home Assistant style vacuum knows its battery itself
    if (role === 'battery' && typeof mainSt?.attributes.battery_level === 'number') {
        return null;
    }
    return pick(ids.filter(id => KIND_WORD[kind].test(nameOf(id, hass.states[id]))));
}

/** The datapoint of a role: chosen by hand ("none" switches it off), else found by itself. */
export function deviceLink(hass: HassLike, f: DeviceItem, role: DeviceRole): string | null {
    const v = f.device_links?.[role];
    if (v === 'none') {
        return null;
    }
    return v || autoRole(hass, f, role);
}

function since(lang: string, st: StateLike | undefined): string | undefined {
    const t = Date.parse(st?.last_changed ?? '');
    if (!Number.isFinite(t) || t <= 0) {
        return undefined;
    }
    const d = new Date(t);
    const sameDay = new Date().toDateString() === d.toDateString();
    const time = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    return text(lang, 'since', {
        time: sameDay ? time : `${d.toLocaleDateString(lang, { day: 'numeric', month: 'short' })} ${time}`,
    });
}

function batteryOf(hass: HassLike, f: DeviceItem, main: string | null): number | null {
    const id = deviceLink(hass, f, 'battery');
    const v = id ? num(hass.states[id]) : null;
    if (v !== null) {
        return Math.max(0, Math.min(100, v));
    }
    const own = main ? hass.states[main]?.attributes.battery_level : undefined;
    return typeof own === 'number' ? own : null;
}

const batteryColor = (v: number): string => (v < 15 ? '#ff5d5d' : v < 35 ? '#ffb347' : '#4cd97b');

const PHASE_COLOR: Record<string, string> = {
    cleaning: '#37e0ff',
    mowing: '#4cd97b',
    returning: '#ffb347',
    docked: '#9fb3c8',
    paused: '#ffd166',
    idle: '#9fb3c8',
    error: '#ff5d5d',
    unknown: '#9fb3c8',
    off: '#9fb3c8',
    heating: '#ff8a3d',
    ready: '#4cd97b',
};
const PHASE_ICON: Record<string, string> = {
    cleaning: '▶',
    mowing: '▶',
    returning: '↩',
    docked: '⌂',
    paused: '⏸',
    idle: '•',
    error: '⚠',
    unknown: '?',
    off: '○',
    heating: '♨',
    ready: '✓',
};

/** Switches a datapoint: a button is pressed, a switch turned on; a device's own entity gets its own service. */
function press(host: DeviceHost, id: string, service = 'turn_on'): void {
    const d = domain(id);
    const s = d === 'button' || d === 'input_button' ? 'press' : service;
    void Promise.resolve(host.callService?.(d, s, { entity_id: id })).catch((e: unknown) =>
        console.warn(`home3d: ${d}.${s}`, e),
    );
}

/** A coffee machine's sensor that is either a level (%) or a flag (empty / due): its state in words and whether it wants a look. */
function levelOrFlag(
    lang: string,
    st: StateLike | undefined,
    id: string,
    bad: 'empty' | 'due',
): { value: string; at: number | null; bad: boolean } | null {
    if (!st || DEAD.test(st.state)) {
        return null;
    }
    const n = num(st);
    const name = nameOf(id, st).toLowerCase();
    if (n !== null && !/^(0|1)$/.test(st.state)) {
        const unit = str(st.attributes.unit_of_measurement);
        if (unit === '%') {
            return { value: `${Math.round(n)} %`, at: Math.max(0, Math.min(100, n)), bad: n < 15 };
        }
        return { value: `${Math.round(n)}${unit ? ` ${unit}` : ''}`, at: null, bad: bad === 'due' ? n <= 0 : false };
    }
    const on = ON.test(st.state);
    // "Wassertank leer" on = empty; "Wassertank" on = in place / ok; "Entkalken" on = due
    const flagged = bad === 'due' || /leer|empty|low|fehlt|missing|refill|nachfüll|пуст/.test(name) ? on : !on;
    return { value: text(lang, flagged ? bad : 'ok'), at: null, bad: flagged };
}

/** The glass card of one device. */
export function deviceCard(host: DeviceHost, floorId: string, f: DeviceItem): Record<string, unknown> | null {
    const kind = deviceKind(f.type);
    if (!kind || f.device_card === false) {
        return null;
    }
    const hass = host.hass();
    const lang = host.language();
    const main = mainEntity(hass, f);
    const mainSt = main ? hass.states[main] : undefined;
    const links = Object.fromEntries(DEVICE_ROLES[kind].map(r => [r, deviceLink(hass, f, r)])) as Partial<
        Record<DeviceRole, string | null>
    >;
    if (!mainSt && !Object.values(links).some(Boolean)) {
        return null;
    }
    const base = {
        id: `devices:${f.id}`,
        anchor: { floorId, furnitureId: f.id },
        icon: kind === 'vacuum' ? '🧹' : kind === 'mower' ? '🌱' : '☕',
        title: f.name || text(lang, kind),
    };
    if (kind === 'coffee') {
        const watts = links.power ? num(hass.states[links.power]) : null;
        const switched = mainSt && !DEAD.test(mainSt.state) ? ON.test(mainSt.state) : null;
        const on = switched ?? (watts !== null ? watts > 5 : null);
        const phase = on === null ? 'unknown' : !on ? 'off' : watts !== null && watts >= 300 ? 'heating' : 'ready';
        const rows: Record<string, unknown>[] = [];
        const hints: string[] = [];
        for (const [role, bad, warn] of [
            ['water', 'empty', 'water_empty'],
            ['beans', 'empty', 'beans_empty'],
            ['descale', 'due', 'descale_due'],
        ] as const) {
            const id = links[role];
            const v = id ? levelOrFlag(lang, hass.states[id], id, bad) : null;
            if (!v) {
                continue;
            }
            rows.push({
                label: text(lang, role),
                value: v.value,
                ...(v.bad ? { color: '#ffb347' } : {}),
                ...(v.at !== null ? { at: v.at, fill: true } : {}),
            });
            if (v.bad) {
                hints.push(text(lang, warn));
            }
        }
        const cups = links.cups ? num(hass.states[links.cups]) : null;
        const drinks = (['drink1', 'drink2', 'drink3'] as const).map(r => links[r]).filter((id): id is string => !!id);
        return {
            ...base,
            live: text(lang, phase),
            liveColor: PHASE_COLOR[phase],
            status: {
                icon: PHASE_ICON[phase],
                text: text(lang, phase),
                since: since(lang, mainSt),
                color: PHASE_COLOR[phase],
            },
            ...(cups !== null ? { main: { text: cups.toLocaleString(lang), sub: text(lang, 'cups') } } : {}),
            ...(watts !== null && watts >= 1
                ? { cells: [{ label: text(lang, 'power').replace(/\s*\(.*\)/, ''), value: `${Math.round(watts)} W` }] }
                : {}),
            rows,
            ...(hints.length ? { hint: { text: hints.join(' · '), color: '#ffb347' } } : {}),
            ...(drinks.length && on !== false
                ? {
                      chips: [
                          {
                              title: text(lang, 'drinks'),
                              items: drinks.map(id => ({
                                  label:
                                      nameOf(id, hass.states[id])
                                          .replace(KIND_WORD.coffee, '')
                                          .replace(/^[\s:·-]+|[\s:·-]+$/g, '') || nameOf(id, hass.states[id]),
                                  onTap: () => press(host, id),
                              })),
                          },
                      ],
                  }
                : {}),
            buttons: main
                ? [
                      {
                          label: '⏻',
                          title: text(lang, on ? 'off_btn' : 'on'),
                          on: !!on,
                          onTap: () => press(host, main, 'toggle'),
                      },
                  ]
                : [],
        };
    }
    const phase: string = kind === 'vacuum' ? vacuumPhase(mainSt?.state) : mowerPhase(mainSt?.state);
    const word = phase === 'cleaning' && kind === 'mower' ? 'mowing' : phase;
    const battery = batteryOf(hass, f, main);
    const own = main ? domain(main) : '';
    const services: Record<string, string> =
        own === 'vacuum'
            ? { start: 'start', pause: 'pause', home: 'return_to_base' }
            : own === 'lawn_mower'
              ? { start: 'start_mowing', pause: 'pause', home: 'dock' }
              : {};
    // the card's round buttons hold a symbol; the word is their tooltip
    const button = (role: 'start' | 'pause' | 'home', label: string, on: boolean): Record<string, unknown> | null => {
        const id = links[role];
        const title = text(lang, role);
        if (id) {
            return { label, title, on, onTap: () => press(host, id) };
        }
        return main && services[role] ? { label, title, on, onTap: () => press(host, main, services[role]) } : null;
    };
    const working = phase === 'cleaning' || phase === 'mowing';
    const buttons = [
        button('start', '▶', working),
        button('pause', '⏸', phase === 'paused'),
        button('home', '⌂', phase === 'returning' || phase === 'docked'),
    ].filter(Boolean);
    const error = phase === 'error' && mainSt && !/^\d+$/.test(mainSt.state) ? mainSt.state : null;
    return {
        ...base,
        live: text(lang, word),
        liveColor: PHASE_COLOR[word],
        status: {
            icon: PHASE_ICON[word],
            text: text(lang, word),
            since: since(lang, mainSt),
            color: PHASE_COLOR[word],
        },
        rows:
            battery !== null
                ? [
                      {
                          label: text(lang, 'battery'),
                          value: `${Math.round(battery)} %`,
                          at: battery,
                          fill: true,
                          color: batteryColor(battery),
                      },
                  ]
                : [],
        ...(error ? { hint: { text: error, color: '#ff5d5d' } } : {}),
        buttons,
    };
}

function devicesOf(b: BuildingLike | null): { floorId: string; f: DeviceItem }[] {
    return (b?.floors ?? []).flatMap(fl =>
        fl.furniture.filter(f => deviceKind(f.type)).map(f => ({ floorId: fl.id, f })),
    );
}

export function deviceCards(host: DeviceHost): unknown[] {
    return devicesOf(host.building())
        .map(({ floorId, f }) => deviceCard(host, floorId, f))
        .filter(Boolean);
}

export function deviceWatched(host: DeviceHost): string[] {
    const hass = host.hass();
    const out = new Set<string>();
    for (const { f } of devicesOf(host.building())) {
        const kind = deviceKind(f.type)!;
        const main = mainEntity(hass, f);
        if (main) {
            out.add(main);
        }
        for (const r of DEVICE_ROLES[kind]) {
            const id = deviceLink(hass, f, r);
            if (id) {
                out.add(id);
            }
        }
    }
    return [...out];
}

const ROLE_DOMAIN: Record<DeviceRole, RegExp> = {
    battery: /^sensor$/,
    start: WRITABLE,
    pause: WRITABLE,
    home: WRITABLE,
    power: /^sensor$/,
    water: /^(sensor|binary_sensor)$/,
    beans: /^(sensor|binary_sensor)$/,
    descale: /^(sensor|binary_sensor)$/,
    cups: /^sensor$/,
    drink1: WRITABLE,
    drink2: WRITABLE,
    drink3: WRITABLE,
};

/** The device's form in the editor: whether it has a card, and a field per datapoint. */
export function deviceFields(host: DeviceHost, item: DeviceItem): unknown[] {
    const kind = deviceKind(item.type);
    if (!kind) {
        return [];
    }
    const hass = host.hass();
    const lang = host.language();
    const update = (mutate: (f: DeviceItem) => void): void =>
        host.updateBuilding?.(b => {
            const f = b.floors.flatMap(fl => fl.furniture).find(x => x.id === item.id);
            if (f) {
                mutate(f);
            }
        });
    return [
        { kind: 'heading', text: text(lang, 'heading') },
        {
            kind: 'check',
            label: text(lang, 'show'),
            value: item.device_card !== false,
            set: (v: boolean) =>
                update(f => {
                    if (v) {
                        delete f.device_card;
                    } else {
                        f.device_card = false;
                    }
                }),
        },
        ...DEVICE_ROLES[kind].map(role => ({
            kind: 'entity',
            label: text(lang, role),
            value: item.device_links?.[role] ?? null,
            auto: autoRole(hass, item, role),
            filter: (id: string) => ROLE_DOMAIN[role].test(domain(id)),
            set: (v: string | null) =>
                update(f => {
                    const links = { ...(f.device_links ?? {}) };
                    if (v === null) {
                        delete links[role];
                    } else {
                        links[role] = v;
                    }
                    if (Object.keys(links).length) {
                        f.device_links = links;
                    } else {
                        delete f.device_links;
                    }
                }),
        })),
        { kind: 'text', text: text(lang, 'hint') },
    ];
}

/** The module as the 3D frontend's module interface wants it. */
export const deviceModule = {
    api: 1,
    id: 'home3d.devices',
    watched: deviceWatched,
    cards: deviceCards,
    furnitureFields: deviceFields,
};
