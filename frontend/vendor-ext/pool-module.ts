// Pool: the built-in module of the pools (the 3D frontend draws the water, the pipes and the pool's equipment; what the
// datapoints mean is a module's business). Registered by the patched modules.ts in every bundle, it never loads code
// from elsewhere. It gives a pool's form its datapoints (water temperature, heater, filter pump, light, pH, chlorine,
// salt, cover; an empty one is found by name), the water its colour (the light's, else clear blue, greenish while the
// water is out of balance), its movement while the pump runs, a warm shimmer while it heats and the cover as far as
// it is closed, a label with temperature, pH and chlorine, the glow of the pump and the heat pump, the water in the
// drawn pipes (from the skimmer and the drain through pump, filter and heat pump or bypass to the inlets, brown to
// the waste drain while the filter backwashes) and warnings when pH or chlorine leave their range. No three.js here.

export type Rgb = [number, number, number];

interface StateLike {
    state: string;
    attributes: Record<string, unknown>;
}
interface HassLike {
    states: Record<string, StateLike | undefined>;
}
export interface PoolPortLike {
    id: string;
    kind: string;
    x: number;
    z: number;
}
export interface PoolPipeLike {
    id: string;
    from: string;
    to: string;
    points: [number, number][];
    heights?: (number | null)[] | null;
    fittings?: { kind: string; open?: boolean }[] | null;
}
export interface PoolJointLike {
    id: string;
    kind?: string | null;
    name?: string | null;
}
export type PoolRole = 'temperature' | 'heater' | 'pump' | 'light' | 'ph' | 'chlorine' | 'salt' | 'cover';
export type PoolLinksLike = Partial<Record<PoolRole, string | null>> & {
    ports?: PoolPortLike[];
    pipes?: PoolPipeLike[];
    joints?: PoolJointLike[];
};
export interface PoolAreaLike {
    id: string;
    type: string;
    points: [number, number][];
    pool?: PoolLinksLike | null;
}
interface FurnitureLike {
    id: string;
    type: string;
    valve_open?: boolean | null;
    valve_position?: string | null;
}
interface FloorLike {
    id: string;
    outdoor?: PoolAreaLike[];
    furniture: FurnitureLike[];
}
interface BuildingLike {
    floors: FloorLike[];
}
export interface PoolHost {
    hass(): HassLike;
    building(): BuildingLike | null;
    language(): string;
    waterLevel?(floorId: string, areaId: string): { y: number; floorY: number | null } | null;
    updateBuilding?(mutate: (next: BuildingLike) => void): void;
}

/** The equipment of a pool's technical room. */
export const POOL_DEVICE_TYPES = ['pool_pump', 'pool_filter', 'pool_heat_pump', 'pool_dosing', 'pool_valve'];

export const POOL_ROLES: PoolRole[] = ['temperature', 'heater', 'pump', 'light', 'ph', 'chlorine', 'salt', 'cover'];

// ---------------------------------------------------------------- texts (the module's own, de/en/ru)

const TEXTS: Record<string, Record<string, string>> = {
    de: {
        heading: 'Pool: Datenpunkte',
        temperature: 'Wassertemperatur',
        heater: 'Heizung / Wärmepumpe',
        pump: 'Filterpumpe (Schalter oder Leistung)',
        light: 'Poolbeleuchtung',
        ph: 'pH-Wert',
        chlorine: 'Chlor (Redox mV oder mg/l)',
        salt: 'Salz (mg/l)',
        cover: 'Abdeckung',
        hint: 'Leer gelassen sucht der Pool einen Datenpunkt mit „Pool“ im Namen (pH, Redox, Chlor und Salz auch ohne). Das Wasser leuchtet in der Farbe der Poolbeleuchtung, sonst klar blau und grünlich, solange pH oder Chlor nicht stimmen; es bewegt sich, solange die Pumpe läuft, flimmert warm beim Heizen, und die Abdeckung schließt so weit wie ihre Stellung. Gezeichnete Rohre zeigen, wo das Wasser fließt.',
        ph_warn: 'Pool: pH {v} (gut 6,8–7,8)',
        cl_warn_mv: 'Pool: Redox {v} mV (gut ab 600)',
        cl_warn: 'Pool: Chlor {v} mg/l (gut 0,3–3)',
    },
    en: {
        heading: 'Pool: datapoints',
        temperature: 'Water temperature',
        heater: 'Heater / heat pump',
        pump: 'Filter pump (switch or power)',
        light: 'Pool light',
        ph: 'pH value',
        chlorine: 'Chlorine (redox mV or mg/l)',
        salt: 'Salt (mg/l)',
        cover: 'Cover',
        hint: 'Left empty, the pool looks for a datapoint with "pool" in its name (pH, redox, chlorine and salt also without). The water glows in the pool light’s colour, else clear blue, and greenish while pH or chlorine are off; it moves while the pump runs, shimmers warm while it heats, and the cover closes as far as it stands. Drawn pipes show where the water flows.',
        ph_warn: 'Pool: pH {v} (good 6.8–7.8)',
        cl_warn_mv: 'Pool: redox {v} mV (good from 600)',
        cl_warn: 'Pool: chlorine {v} mg/l (good 0.3–3)',
    },
    ru: {
        heading: 'Бассейн: точки данных',
        temperature: 'Температура воды',
        heater: 'Нагрев / тепловой насос',
        pump: 'Фильтрующий насос (выключатель или мощность)',
        light: 'Подсветка бассейна',
        ph: 'Значение pH',
        chlorine: 'Хлор (редокс мВ или мг/л)',
        salt: 'Соль (мг/л)',
        cover: 'Покрытие',
        hint: 'Если поле пустое, бассейн ищет точку данных со словом «pool» в названии (pH, редокс, хлор и соль – и без него). Вода светится цветом подсветки, иначе прозрачно-голубая и зеленоватая, пока pH или хлор не в норме; она движется, пока работает насос, тёпло мерцает при нагреве, а покрытие закрывается настолько, насколько оно закрыто. Нарисованные трубы показывают, где течёт вода.',
        ph_warn: 'Бассейн: pH {v} (норма 6,8–7,8)',
        cl_warn_mv: 'Бассейн: редокс {v} мВ (норма от 600)',
        cl_warn: 'Бассейн: хлор {v} мг/л (норма 0,3–3)',
    },
};

function text(lang: string, key: string, vars: Record<string, string> = {}): string {
    const l = lang.split('-')[0];
    const s = TEXTS[l]?.[key] ?? TEXTS.en[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

function fmt(lang: string, n: number, digits: number): string {
    const s = n.toFixed(digits);
    return /^(de|ru)/.test(lang) ? s.replace('.', ',') : s;
}

// ---------------------------------------------------------------- reading datapoints

const DEAD = /^(unavailable|unknown|)$/i;

function num(st: StateLike | undefined | null): number | null {
    if (!st || DEAD.test(String(st.state).trim())) {
        return null;
    }
    const n = Number(String(st.state).replace(',', '.').trim());
    return Number.isFinite(n) ? n : null;
}

function unitOf(st: StateLike | undefined): string {
    const u = st?.attributes.unit_of_measurement;
    return typeof u === 'string' ? u.trim() : '';
}

function nameOf(id: string, st: StateLike | undefined): string {
    const n = st?.attributes.friendly_name;
    return `${id} ${typeof n === 'string' ? n : ''}`;
}

const domain = (id: string): string => id.slice(0, id.indexOf('.'));

/** Which entities fit a role: the picker's filter. */
export const ROLE_DOMAINS: Record<PoolRole, RegExp> = {
    temperature: /^(sensor|climate|water_heater|input_number|number)$/,
    heater: /^(climate|water_heater|switch|input_boolean|binary_sensor|sensor)$/,
    pump: /^(switch|binary_sensor|sensor|fan|input_boolean)$/,
    light: /^(light|switch)$/,
    ph: /^(sensor|input_number|number)$/,
    chlorine: /^(sensor|input_number|number)$/,
    salt: /^(sensor|input_number|number)$/,
    cover: /^(cover|sensor|binary_sensor)$/,
};

const POOL_WORD = /pool|schwimmbad|бассейн/i;

/** Whether an entity is the one of a role, found by its name. */
function autoFits(role: PoolRole, id: string, st: StateLike): boolean {
    const d = domain(id);
    const name = nameOf(id, st);
    const pool = POOL_WORD.test(name);
    switch (role) {
        case 'temperature':
            return (
                pool &&
                ((d === 'sensor' && (/°[CF]$/.test(unitOf(st)) || st.attributes.device_class === 'temperature')) ||
                    d === 'climate' ||
                    d === 'water_heater')
            );
        case 'heater':
            return (
                pool &&
                (d === 'climate' || d === 'water_heater' || (d === 'switch' && /heiz|heat|wärme|warm/i.test(name)))
            );
        case 'pump':
            return pool && /pump|pumpe|filter/i.test(name) && ROLE_DOMAINS.pump.test(d);
        case 'light':
            return pool && d === 'light';
        case 'ph':
            return d === 'sensor' && /(^|[^a-z])ph([^a-z]|$)/i.test(name);
        case 'chlorine':
            return d === 'sensor' && /redox|orp|chlor/i.test(name);
        case 'salt':
            return d === 'sensor' && /salt|salz|соль/i.test(name);
        case 'cover':
            return pool && d === 'cover';
    }
}

/** The entity found for a role by name (the picker's "automatic"), null: none. */
export function autoLink(hass: HassLike, role: PoolRole): string | null {
    const found = Object.keys(hass.states)
        .sort()
        .filter(id => {
            const st = hass.states[id];
            return !!st && autoFits(role, id, st);
        });
    // the water's own sensor before a heater that reports the temperature too
    return (role === 'temperature' ? found.find(id => domain(id) === 'sensor') : undefined) ?? found[0] ?? null;
}

/** The entity of a role: the chosen one, "none": none, missing: found by name. */
export function poolLink(hass: HassLike, area: PoolAreaLike, role: PoolRole): string | null {
    const v = area.pool?.[role];
    if (v === 'none') {
        return null;
    }
    return typeof v === 'string' && v ? v : autoLink(hass, role);
}

/** The water temperature: a sensor, or the current temperature of a climate or water heater. */
export function poolTemp(st: StateLike | undefined): number | null {
    if (!st) {
        return null;
    }
    const cur = Number(st.attributes.current_temperature);
    if (Number.isFinite(cur) && st.attributes.current_temperature !== null) {
        return cur;
    }
    const n = num(st);
    if (n === null) {
        return null;
    }
    return /°?F$/.test(unitOf(st)) ? ((n - 32) * 5) / 9 : n;
}

const ON = /^(on|true|1|running|läuft|an|heat|heating|auto)$/i;

/** Whether the filter pump runs: a switch on, a power from 20 W; null: unknown or none. */
export function pumpRuns(st: StateLike | undefined): boolean | null {
    if (!st || DEAD.test(String(st.state).trim())) {
        return null;
    }
    const u = unitOf(st);
    if (/^k?W$/i.test(u) || st.attributes.device_class === 'power') {
        const n = num(st);
        return n === null ? null : (/^kW$/i.test(u) ? n * 1000 : n) >= 20;
    }
    const n = num(st);
    return n !== null ? n > 0 : ON.test(String(st.state).trim());
}

/** Whether the heater is switched on: a climate or water heater not off, else a switch on or a power from 20 W. */
export function heaterOn(st: StateLike | undefined, dom: string): boolean | null {
    if (!st || DEAD.test(String(st.state).trim())) {
        return null;
    }
    if (dom === 'climate' || dom === 'water_heater') {
        const mode = st.attributes.hvac_mode;
        return !/^(off|false|0|aus)$/i.test((typeof mode === 'string' ? mode : st.state).trim());
    }
    return pumpRuns(st) === true;
}

/** Whether it heats right now: a climate's action, a target above the water, a switch on, a power from 20 W. */
export function heats(st: StateLike | undefined, water: number | null): boolean {
    if (!st || DEAD.test(String(st.state).trim())) {
        return false;
    }
    const action = st.attributes.hvac_action;
    if (typeof action === 'string') {
        return action === 'heating';
    }
    const target = Number(st.attributes.temperature ?? st.attributes.target_temperature);
    if (Number.isFinite(target) && st.attributes.temperature !== null && water !== null) {
        return !/^(off|false|0)$/i.test(String(st.state)) && target > water + 0.2;
    }
    return pumpRuns(st) === true;
}

/** How far the cover is closed, 0 open … 1 closed. */
export function coverClosed(st: StateLike | undefined): number {
    if (!st || DEAD.test(String(st.state).trim())) {
        return 0;
    }
    const p = Number(st.attributes.current_position);
    if (Number.isFinite(p) && st.attributes.current_position !== null) {
        return Math.max(0, Math.min(1, 1 - p / 100));
    }
    const s = String(st.state).trim().toLowerCase();
    if (/^(closed|true|on|1|zu|geschlossen)$/.test(s)) {
        return 1;
    }
    if (/^(opening|closing)$/.test(s)) {
        return 0.5;
    }
    return 0;
}

/** The pool light: off (null) or its colour and brightness. */
export function poolLight(st: StateLike | undefined): { color: Rgb; level: number } | null {
    if (!st || !ON.test(String(st.state).trim())) {
        return null;
    }
    const rgb = st.attributes.rgb_color;
    const color: Rgb =
        Array.isArray(rgb) && rgb.length >= 3 && rgb.slice(0, 3).every(v => Number.isFinite(Number(v)))
            ? [Number(rgb[0]) / 255, Number(rgb[1]) / 255, Number(rgb[2]) / 255]
            : [0.62, 0.86, 1];
    const b = Number(st.attributes.brightness);
    const level = Number.isFinite(b) && st.attributes.brightness !== null ? Math.max(0.15, Math.min(1, b / 255)) : 1;
    return { color, level };
}

/** Whether a pH is fine (6.8 … 7.8). */
export const phOk = (v: number): boolean => v >= 6.8 && v <= 7.8;

/** Chlorine: redox in mV (a value above 50, or the unit mV) fine from 600; free chlorine fine at 0.3 … 3 mg/l. */
export function chlorine(st: StateLike | undefined): { value: number; mv: boolean; ok: boolean } | null {
    const v = num(st);
    if (v === null) {
        return null;
    }
    const mv = /mv/i.test(unitOf(st)) || v > 50;
    return { value: v, mv, ok: mv ? v >= 600 : v >= 0.3 && v <= 3 };
}

const CLEAR: Rgb = [0.12, 0.62, 0.92];
const GREENISH: Rgb = [0.24, 0.62, 0.42];
const PUMP_GLOW: Rgb = [0.3, 0.75, 1];
const HEAT_GLOW: Rgb = [1, 0.55, 0.2];

/** Everything known about a pool right now. */
export interface PoolNow {
    links: Partial<Record<PoolRole, string>>;
    temp: number | null;
    pumpOn: boolean | null;
    heaterOn: boolean | null;
    heating: boolean;
    light: { color: Rgb; level: number } | null;
    cover: number;
    ph: number | null;
    chlorine: { value: number; mv: boolean; ok: boolean } | null;
    salt: number | null;
}

export function poolNow(hass: HassLike, area: PoolAreaLike): PoolNow {
    const links: Partial<Record<PoolRole, string>> = {};
    for (const r of POOL_ROLES) {
        const id = poolLink(hass, area, r);
        if (id) {
            links[r] = id;
        }
    }
    const st = (r: PoolRole): StateLike | undefined => (links[r] ? hass.states[links[r]] : undefined);
    const temp = poolTemp(st('temperature')) ?? poolTemp(st('heater'));
    const heaterSt = st('heater');
    return {
        links,
        temp,
        pumpOn: pumpRuns(st('pump')),
        heaterOn: heaterOn(heaterSt, domain(links.heater ?? '')),
        heating: heats(heaterSt, temp),
        light: poolLight(st('light')),
        cover: coverClosed(st('cover')),
        ph: num(st('ph')),
        chlorine: chlorine(st('chlorine')),
        salt: num(st('salt')),
    };
}

/** The colour and glow of the water: the light's, else clear, greenish while the chemistry is off. */
export function waterLook(now: PoolNow): { color: Rgb; level: number } {
    if (now.light) {
        return { color: now.light.color, level: 0.55 + 0.45 * now.light.level };
    }
    const off = (now.ph !== null && !phOk(now.ph)) || (now.chlorine !== null && !now.chlorine.ok);
    return { color: off ? GREENISH : CLEAR, level: 0.35 };
}

// ---------------------------------------------------------------- pipes

/** A node split into its kind ("port", "dev", "joint"), id and connection. */
export function splitNode(node: string): { kind: string; id: string; port: string | null } {
    const [kind = '', id = '', port] = node.split(':');
    return { kind, id, port: port || null };
}

/** The connections of a pool device (none: pipes join it as a whole). */
export function devicePorts(type: string): string[] {
    if (type === 'pool_pump') {
        return ['suction', 'pressure'];
    }
    if (type === 'pool_filter') {
        return ['pump', 'return', 'waste'];
    }
    if (type === 'pool_heat_pump') {
        return ['in', 'out'];
    }
    return [];
}

const INPUT: Record<string, string> = { pool_pump: 'suction', pool_filter: 'pump', pool_heat_pump: 'in' };

export interface FlowDevice {
    id: string;
    type: string;
    open?: boolean;
    valve?: string | null;
}
export interface FlowState {
    active: boolean;
    warm: boolean;
    waste: boolean;
}

/** Which way water goes at a node for a new line: "source" out of it, "sink" into it, null unknown. */
export function nodeFlow(
    node: string,
    area: Pick<PoolAreaLike, 'pool'>,
    devices: readonly { id: string; type: string }[],
): 'source' | 'sink' | null {
    const { kind, id, port } = splitNode(node);
    if (kind === 'port') {
        const k = area.pool?.ports?.find(p => p.id === id)?.kind;
        return k === 'skimmer' || k === 'drain' ? 'source' : k === 'inlet' || k === 'waste' ? 'sink' : null;
    }
    if (kind === 'dev') {
        const type = devices.find(d => d.id === id)?.type ?? '';
        if (!port) {
            return null;
        }
        return port === INPUT[type] ? 'sink' : devicePorts(type).includes(port) ? 'source' : null;
    }
    if (kind === 'joint') {
        return port === 'in' ? 'sink' : port === 'out1' || port === 'out2' ? 'source' : null;
    }
    return null;
}

/** The connection of a device a line to the device as a whole belongs to. */
export function autoPort(
    type: string,
    other: 'source' | 'sink' | null,
    toWaste: boolean,
    taken: readonly string[],
): string | null {
    const ports = devicePorts(type);
    if (!ports.length) {
        return null;
    }
    let want: string | undefined;
    if (other === 'source') {
        want = INPUT[type];
    } else if (other === 'sink') {
        want = type === 'pool_filter' ? (toWaste ? 'waste' : 'return') : ports.find(p => p !== INPUT[type]);
    }
    if (want && !taken.includes(want)) {
        return want;
    }
    return ports.find(p => !taken.includes(p)) ?? want ?? ports[0];
}

/** A pipe turned so the water runs from its source end to its sink end. */
export function orientPipe<P extends PoolPipeLike>(
    p: P,
    fromFlow: 'source' | 'sink' | null,
    toFlow: 'source' | 'sink' | null,
): P {
    const wrong = (fromFlow === 'sink' && toFlow !== 'sink') || (toFlow === 'source' && fromFlow !== 'source');
    if (!wrong) {
        return p;
    }
    return {
        ...p,
        from: p.to,
        to: p.from,
        points: [...p.points].reverse(),
        ...(p.heights ? { heights: [...p.heights].reverse() } : {}),
    };
}

const touches = (pipes: readonly PoolPipeLike[], node: string): boolean =>
    pipes.some(p => p.from === node || p.to === node);

/** Whether a pool line ("skimmer", "drain", "inlet", "waste") is brought in: a pipe at one of its ports. */
export function feedDone(area: Pick<PoolAreaLike, 'pool'>, kind: string): boolean {
    const pipes = area.pool?.pipes ?? [];
    return (area.pool?.ports ?? []).some(p => p.kind === kind && touches(pipes, `port:${p.id}`));
}

/** What the drawing still lacks: loose ends, connections without a pipe, pool lines not brought in. */
export function pipeIssues(
    area: Pick<PoolAreaLike, 'pool'>,
    devices: readonly { id: string; type: string }[],
): { kind: 'loose' | 'port' | 'feed'; node: string }[] {
    const pipes = area.pool?.pipes ?? [];
    const ports = area.pool?.ports ?? [];
    const out: { kind: 'loose' | 'port' | 'feed'; node: string }[] = [];
    for (const p of pipes) {
        if (!p.from || !p.to) {
            out.push({ kind: 'loose', node: p.id });
        }
    }
    const waste = ports.some(p => p.kind === 'waste');
    for (const d of devices) {
        for (const q of devicePorts(d.type)) {
            // the filter's waste connection only once there is a waste drain to bring it to
            if (q === 'waste' && !waste) {
                continue;
            }
            const node = `dev:${d.id}:${q}`;
            if (!touches(pipes, node)) {
                out.push({ kind: 'port', node });
            }
        }
    }
    for (const k of ['skimmer', 'drain', 'inlet', 'waste']) {
        if (ports.some(p => p.kind === k) && !feedDone(area, k)) {
            out.push({ kind: 'feed', node: k });
        }
    }
    return out;
}

/**
 * Where the water flows: out of the skimmer and the drain while the pump runs, through the pump (from its suction
 * side), the filter (by its multiport valve: filtering and recirculating to the return, backwashing, rinsing and
 * waste to the waste drain, closed: nowhere), the heat pump (warm after it while it heats), an open ball valve and
 * the dosing; at a T- or Y-piece whose branch leads to the heat pump the water takes that branch while the heater is
 * on, else the bypass; a closed valve in a pipe stops it.
 */
export function pipeFlow(input: {
    pipes: readonly PoolPipeLike[];
    ports: readonly PoolPortLike[];
    devices: readonly FlowDevice[];
    pumpOn: boolean;
    heaterOn: boolean;
    heating: boolean;
}): Map<string, FlowState> {
    const { pipes, ports, devices } = input;
    const out = new Map<string, FlowState>(pipes.map(p => [p.id, { active: false, warm: false, waste: false }]));
    if (!input.pumpOn) {
        return out;
    }
    const dev = (id: string): FlowDevice | undefined => devices.find(d => d.id === id);
    const blocked = (p: PoolPipeLike): boolean => (p.fittings ?? []).some(f => f.kind === 'valve' && f.open === false);
    /** The water arriving at a part (through which connection), from the pipes that carry it. */
    const arriving = (kind: string, id: string): { port: string | null; f: FlowState }[] =>
        pipes
            .filter(p => out.get(p.id)?.active)
            .map(p => ({ n: splitNode(p.to), f: out.get(p.id)! }))
            .filter(x => x.n.kind === kind && x.n.id === id)
            .map(x => ({ port: x.n.port, f: x.f }));
    const merge = (list: { f: FlowState }[]): FlowState | null =>
        list.length ? { active: true, warm: list.some(x => x.f.warm), waste: list.some(x => x.f.waste) } : null;
    /** Whether a pipe leads to the heat pump (directly, or on through valves, holes and dosing). */
    const toHeatPump = (p: PoolPipeLike, depth = 0): boolean => {
        const { kind, id } = splitNode(p.to);
        if (kind === 'dev' && dev(id)?.type === 'pool_heat_pump') {
            return true;
        }
        if (depth > 6 || (kind === 'dev' && !['pool_valve', 'pool_dosing'].includes(dev(id)?.type ?? ''))) {
            return false;
        }
        if (kind !== 'dev' && kind !== 'joint') {
            return false;
        }
        const next = pipes.filter(q => splitNode(q.from).kind === kind && splitNode(q.from).id === id);
        return next.length === 1 && toHeatPump(next[0], depth + 1);
    };
    /** The water a pipe takes at its start, null: none. */
    const source = (p: PoolPipeLike): FlowState | null => {
        const { kind, id, port } = splitNode(p.from);
        if (kind === 'port') {
            const k = ports.find(q => q.id === id)?.kind;
            return k === 'skimmer' || k === 'drain' ? { active: true, warm: false, waste: false } : null;
        }
        if (kind === 'joint') {
            const inn = merge(arriving('joint', id));
            if (!inn) {
                return null;
            }
            const outs = pipes.filter(q => splitNode(q.from).kind === 'joint' && splitNode(q.from).id === id);
            if (outs.length > 1 && outs.some(q => toHeatPump(q))) {
                return toHeatPump(p) === input.heaterOn ? inn : null;
            }
            return inn;
        }
        if (kind !== 'dev') {
            return null;
        }
        const d = dev(id);
        if (!d) {
            return null;
        }
        const all = arriving('dev', id);
        const at = (q: string): { f: FlowState }[] => all.filter(x => x.port === q || x.port === null);
        switch (d.type) {
            case 'pool_pump':
                return port === 'suction' ? null : merge(at('suction'));
            case 'pool_heat_pump': {
                const inn = port === 'in' ? null : merge(at('in'));
                return inn && { ...inn, warm: inn.warm || input.heating };
            }
            case 'pool_filter': {
                if (port === 'pump') {
                    return null;
                }
                const inn = merge(at('pump'));
                const valve = d.valve ?? 'filter';
                if (!inn || valve === 'closed') {
                    return null;
                }
                const toWaste = valve === 'backwash' || valve === 'rinse' || valve === 'waste';
                if (port === 'waste') {
                    return toWaste ? { ...inn, waste: true } : null;
                }
                return toWaste ? null : inn;
            }
            case 'pool_valve':
                return d.open === false ? null : merge(all);
            default:
                return merge(all);
        }
    };
    for (let pass = 0; pass <= pipes.length + 1; pass++) {
        let changed = false;
        for (const p of pipes) {
            const now = out.get(p.id)!;
            if (now.active || blocked(p)) {
                continue;
            }
            const s = source(p);
            if (s) {
                out.set(p.id, s);
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
    }
    return out;
}

/** The colour of the water in a pipe: blue, warm after a heating heat pump, brown to the waste drain. */
export function pipeColor(f: FlowState | undefined): Rgb {
    if (!f?.active) {
        return [0.25, 0.7, 1];
    }
    return f.waste ? [0.62, 0.42, 0.2] : f.warm ? [1, 0.5, 0.2] : [0.15, 0.6, 1];
}

// ---------------------------------------------------------------- the module

interface PoolAt {
    floor: FloorLike;
    area: PoolAreaLike;
}

function poolsOf(b: BuildingLike | null): PoolAt[] {
    return (b?.floors ?? []).flatMap(floor =>
        (floor.outdoor ?? []).filter(a => a.type === 'pool' && a.points.length >= 3).map(area => ({ floor, area })),
    );
}

function devicesOf(b: BuildingLike | null): (FurnitureLike & { floorId: string })[] {
    return (b?.floors ?? []).flatMap(f =>
        f.furniture.filter(x => POOL_DEVICE_TYPES.includes(x.type)).map(x => ({ ...x, floorId: f.id })),
    );
}

function middle(points: [number, number][]): [number, number] {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

/** The pieces a pool adds to the 3D view. */
export function poolScene(host: PoolHost): unknown[] {
    const hass = host.hass();
    const b = host.building();
    const lang = host.language();
    const devs = devicesOf(b);
    const out: unknown[] = [];
    let pumping = false;
    let heating = false;
    for (const { floor, area } of poolsOf(b)) {
        const now = poolNow(hass, area);
        pumping ||= now.pumpOn === true;
        heating ||= now.heating;
        const wl = host.waterLevel?.(floor.id, area.id);
        if (wl) {
            const look = waterLook(now);
            out.push({
                kind: 'water',
                id: `pool:${area.id}`,
                floorId: floor.id,
                points: area.points,
                y: wl.y,
                floorY: wl.floorY,
                color: look.color,
                level: look.level,
                flow: now.pumpOn === true,
                heat: now.heating,
                cover: now.cover,
            });
            const sub = [
                ...(now.ph !== null ? [`pH ${fmt(lang, now.ph, 1)}`] : []),
                ...(now.chlorine
                    ? [
                          now.chlorine.mv
                              ? `${Math.round(now.chlorine.value)} mV`
                              : `Cl ${fmt(lang, now.chlorine.value, 1)}`,
                      ]
                    : []),
            ];
            if (now.temp !== null || sub.length) {
                const [x, z] = middle(area.points);
                const ok = (now.ph === null || phOk(now.ph)) && (now.chlorine?.ok ?? true);
                out.push({
                    kind: 'tag',
                    id: `pool:${area.id}`,
                    floorId: floor.id,
                    at: [x, wl.y + 0.6, z],
                    text: now.temp !== null ? `${fmt(lang, now.temp, 1)} °C` : sub.shift(),
                    ...(sub.length ? { sub: sub.join(' · ') } : {}),
                    color: ok ? '#3fb6ff' : '#ff8a3d',
                });
            }
        }
        const pipes = area.pool?.pipes ?? [];
        if (pipes.length) {
            const flows = pipeFlow({
                pipes,
                ports: area.pool?.ports ?? [],
                devices: devs.map(d => ({
                    id: d.id,
                    type: d.type,
                    open: d.valve_open !== false,
                    valve: d.valve_position ?? null,
                })),
                pumpOn: now.pumpOn === true,
                heaterOn: now.heaterOn === true,
                heating: now.heating,
            });
            out.push({
                kind: 'pipeflow',
                floorId: floor.id,
                areaId: area.id,
                flows: Object.fromEntries([...flows].map(([id, f]) => [id, { active: f.active, color: pipeColor(f) }])),
            });
        }
    }
    // the technical room: the pump and the filter glow while the pump runs, the heat pump while it heats
    for (const d of devs) {
        if ((d.type === 'pool_pump' || d.type === 'pool_filter') && pumping) {
            out.push({ kind: 'glow', furnitureId: d.id, color: PUMP_GLOW, level: 0.8, band: true });
        } else if (d.type === 'pool_heat_pump' && heating) {
            out.push({ kind: 'glow', furnitureId: d.id, color: HEAT_GLOW, level: 0.9, band: true });
        }
    }
    return out;
}

/** The datapoints the pools follow. */
export function poolWatched(host: PoolHost): string[] {
    const hass = host.hass();
    return [...new Set(poolsOf(host.building()).flatMap(({ area }) => Object.values(poolNow(hass, area).links)))];
}

/** Warnings: pH or chlorine out of their range. */
export function poolAlerts(host: PoolHost): unknown[] {
    const hass = host.hass();
    const lang = host.language();
    const out: unknown[] = [];
    for (const { floor, area } of poolsOf(host.building())) {
        const now = poolNow(hass, area);
        if (now.ph !== null && !phOk(now.ph) && now.links.ph) {
            out.push({
                kind: 'pool_ph',
                entity: now.links.ph,
                text: text(lang, 'ph_warn', { v: fmt(lang, now.ph, 1) }),
                color: [1, 0.55, 0.2],
                floorId: floor.id,
                roomId: null,
            });
        }
        if (now.chlorine && !now.chlorine.ok && now.links.chlorine) {
            const c = now.chlorine;
            out.push({
                kind: 'pool_chlorine',
                entity: now.links.chlorine,
                text: text(lang, c.mv ? 'cl_warn_mv' : 'cl_warn', {
                    v: c.mv ? String(Math.round(c.value)) : fmt(lang, c.value, 1),
                }),
                color: [1, 0.55, 0.2],
                floorId: floor.id,
                roomId: null,
            });
        }
    }
    return out;
}

/** The pools as the voice asks for them. */
export function poolsSpoken(host: PoolHost): unknown[] {
    const hass = host.hass();
    return poolsOf(host.building()).map(({ floor, area }, i, all) => {
        const now = poolNow(hass, area);
        return {
            name: all.length > 1 ? `Pool ${i + 1}` : 'Pool',
            floorId: floor.id,
            areaId: area.id,
            temp: now.temp,
            unit: '°C',
            pumpOn: now.pumpOn,
            heating: now.heaterOn === null ? null : now.heating,
            ph: now.ph === null ? null : { value: now.ph, ok: phOk(now.ph) },
            chlorine: now.chlorine
                ? { value: now.chlorine.value, unit: now.chlorine.mv ? 'mV' : 'mg/l', ok: now.chlorine.ok }
                : null,
        };
    });
}

/** The pool's datapoints in its form in the editor. */
export function poolFields(host: PoolHost, area: PoolAreaLike): unknown[] {
    if (area.type !== 'pool') {
        return [];
    }
    const hass = host.hass();
    const lang = host.language();
    const set = (role: PoolRole, v: string | null): void =>
        host.updateBuilding?.(b => {
            const a = b.floors.flatMap(f => f.outdoor ?? []).find(x => x.id === area.id);
            if (!a) {
                return;
            }
            const links: PoolLinksLike = { ...(a.pool ?? {}) };
            if (v === null) {
                delete links[role];
            } else {
                links[role] = v;
            }
            a.pool = links;
        });
    return [
        { kind: 'heading', text: text(lang, 'heading') },
        ...POOL_ROLES.map(role => ({
            kind: 'entity',
            label: text(lang, role),
            value: area.pool?.[role] ?? null,
            auto: autoLink(hass, role),
            filter: (id: string) => ROLE_DOMAINS[role].test(domain(id)),
            set: (v: string | null) => set(role, v),
        })),
        { kind: 'text', text: text(lang, 'hint') },
    ];
}

/** The module as the 3D frontend's module interface wants it. */
export const poolModule = {
    api: 1,
    id: 'home3d.pool',
    watched: poolWatched,
    scene: poolScene,
    alerts: poolAlerts,
    areaFields: poolFields,
    pools: poolsSpoken,
    pipes: {
        nodeFlow,
        autoPort,
        orientPipe,
        issues: pipeIssues,
        feedDone,
        flow: pipeFlow,
        waterColor: pipeColor,
    },
};
