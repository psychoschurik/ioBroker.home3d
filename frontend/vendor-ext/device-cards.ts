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
    /** Wallbox: its power and status sensors as the plan already knows them, the car's battery (kWh). */
    power?: string | null;
    status?: string | null;
    device_capacity?: number | null;
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

export type DeviceKind = 'vacuum' | 'mower' | 'coffee' | 'wallbox' | 'climate';
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
    | 'drink3'
    | 'charge'
    | 'current'
    | 'mode'
    | 'soc'
    | 'target'
    | 'range'
    | 'energy'
    | 'setpoint'
    | 'actual'
    | 'humidity'
    | 'valve'
    | 'boost'
    | 'window'
    | 'onoff';

export const DEVICE_ROLES: Record<DeviceKind, DeviceRole[]> = {
    vacuum: ['battery', 'start', 'pause', 'home'],
    mower: ['battery', 'start', 'pause', 'home'],
    coffee: ['power', 'water', 'beans', 'descale', 'cups', 'drink1', 'drink2', 'drink3'],
    wallbox: ['power', 'charge', 'current', 'mode', 'soc', 'target', 'range', 'energy'],
    climate: ['setpoint', 'actual', 'humidity', 'valve', 'mode', 'boost', 'window', 'onoff'],
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
    if (type === 'wallbox' || /wallbox|ev_charger/.test(type)) {
        return 'wallbox';
    }
    if (type === 'radiator' || type === 'ac_unit' || /radiator|ac_unit|thermostat/.test(type)) {
        return 'climate';
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
        climate: 'Heizung / Klima',
        climate_mode: 'Betriebsart',
        setpoint: 'Solltemperatur',
        actual: 'Raumtemperatur',
        humidity: 'Luftfeuchte',
        valve: 'Ventil',
        boost: 'Boost',
        window: 'Fenster',
        onoff: 'Ein/Aus',
        heats: 'heizt',
        cools: 'kühlt',
        holds: 'hält',
        climate_off: 'aus',
        room: 'Raum',
        target_short: 'Soll',
        window_open: 'Fenster offen',
        warmer: 'Wärmer',
        cooler: 'Kühler',
        hvac_heat: 'Heizen',
        hvac_cool: 'Kühlen',
        hvac_auto: 'Auto',
        hvac_off: 'Aus',
        hvac_dry: 'Entfeuchten',
        hvac_fan_only: 'Lüften',
        hvac_heat_cool: 'Heizen/Kühlen',
        wallbox: 'Wallbox',
        charge: 'Laden (Start/Stop)',
        current: 'Ladestrom (A)',
        mode: 'Lademodus',
        soc: 'Ladestand des Autos',
        target: 'Ladeziel',
        range: 'Reichweite',
        energy: 'Geladen (Ladevorgang)',
        capacity: 'Akku des Autos (kWh)',
        capacity_hint: 'Für „voll um“; leer: keine Uhrzeit',
        charging: 'lädt',
        plugged: 'angesteckt',
        full: 'Laden beendet',
        free: 'kein Auto',
        charge_start: 'Laden starten',
        charge_stop: 'Laden stoppen',
        full_at: 'Voll um',
        power_now: 'Ladeleistung',
        charged: 'Geladen',
        amps: 'Ladestrom',
        soc_short: 'Ladestand',
        mode_off: 'Aus',
        mode_now: 'Sofort',
        mode_minpv: 'Min+PV',
        mode_pv: 'PV',
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
        climate: 'Heating / AC',
        climate_mode: 'Mode',
        setpoint: 'Target temperature',
        actual: 'Room temperature',
        humidity: 'Humidity',
        valve: 'Valve',
        boost: 'Boost',
        window: 'Window',
        onoff: 'On/off',
        heats: 'heating',
        cools: 'cooling',
        holds: 'holding',
        climate_off: 'off',
        room: 'Room',
        target_short: 'Target',
        window_open: 'Window open',
        warmer: 'Warmer',
        cooler: 'Cooler',
        hvac_heat: 'Heat',
        hvac_cool: 'Cool',
        hvac_auto: 'Auto',
        hvac_off: 'Off',
        hvac_dry: 'Dry',
        hvac_fan_only: 'Fan',
        hvac_heat_cool: 'Heat/cool',
        wallbox: 'Wallbox',
        charge: 'Charging (start/stop)',
        current: 'Charging current (A)',
        mode: 'Charging mode',
        soc: "Car's state of charge",
        target: 'Charge target',
        range: 'Range',
        energy: 'Charged (session)',
        capacity: "Car's battery (kWh)",
        capacity_hint: 'For "full at"; empty: no time',
        charging: 'charging',
        plugged: 'plugged in',
        full: 'charging done',
        free: 'no car',
        charge_start: 'Start charging',
        charge_stop: 'Stop charging',
        full_at: 'Full at',
        power_now: 'Charging power',
        charged: 'Charged',
        amps: 'Current',
        soc_short: 'Charge',
        mode_off: 'Off',
        mode_now: 'Now',
        mode_minpv: 'Min+PV',
        mode_pv: 'PV',
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
        climate: 'Отопление / климат',
        climate_mode: 'Режим работы',
        setpoint: 'Заданная температура',
        actual: 'Температура в комнате',
        humidity: 'Влажность',
        valve: 'Клапан',
        boost: 'Буст',
        window: 'Окно',
        onoff: 'Вкл./выкл.',
        heats: 'греет',
        cools: 'охлаждает',
        holds: 'держит',
        climate_off: 'выкл.',
        room: 'Комната',
        target_short: 'Цель',
        window_open: 'Окно открыто',
        warmer: 'Теплее',
        cooler: 'Холоднее',
        hvac_heat: 'Нагрев',
        hvac_cool: 'Охлаждение',
        hvac_auto: 'Авто',
        hvac_off: 'Выкл.',
        hvac_dry: 'Осушение',
        hvac_fan_only: 'Вентиляция',
        hvac_heat_cool: 'Нагрев/охл.',
        wallbox: 'Зарядная станция',
        charge: 'Зарядка (старт/стоп)',
        current: 'Ток зарядки (А)',
        mode: 'Режим зарядки',
        soc: 'Заряд автомобиля',
        target: 'Цель зарядки',
        range: 'Запас хода',
        energy: 'Заряжено (сеанс)',
        capacity: 'Батарея автомобиля (кВт·ч)',
        capacity_hint: 'Для «полностью в»; пусто: без времени',
        charging: 'заряжает',
        plugged: 'подключён',
        full: 'зарядка завершена',
        free: 'нет автомобиля',
        charge_start: 'Начать зарядку',
        charge_stop: 'Остановить зарядку',
        full_at: 'Полностью в',
        power_now: 'Мощность зарядки',
        charged: 'Заряжено',
        amps: 'Ток',
        soc_short: 'Заряд',
        mode_off: 'Выкл.',
        mode_now: 'Сейчас',
        mode_minpv: 'Мин+СЭС',
        mode_pv: 'СЭС',
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
    wallbox:
        /wallbox|wall box|evcc|go-?e|keba|easee|wallbe|openwb|charger|ladestation|ladepunkt|loadpoint|ladesäule|зарядн/i,
    // a radiator's or air conditioner's datapoints only below its own linked datapoint (a name would fit every room)
    climate: /(?!)/,
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
        case 'charge':
            return (
                WRITABLE.test(d) &&
                /charg|laden|lade|enable|freigabe|allow|start|заряд/.test(n) &&
                !/strom|current|amp|mode|modus|stop/.test(n)
            );
        case 'current':
            return (
                (d === 'number' || (d === 'sensor' && st.attributes.iobroker_write === true)) &&
                (unit === 'A' || /strom|current|ampere|\bamp|ток/.test(n))
            );
        case 'mode':
            return (
                (/^(select|input_select)$/.test(d) || st.attributes.iobroker_write === true) &&
                /mode|modus|режим/.test(n) &&
                !/[^a-z]?power|temp/.test(n)
            );
        case 'soc':
            return (
                d === 'sensor' &&
                (unit === '%' || /soc/.test(n)) &&
                /soc|ladestand|state.?of.?charge|akku|batter|заряд/.test(n) &&
                !/target|ziel|limit|min/.test(n)
            );
        case 'target':
            return /^(sensor|number)$/.test(d) && /target|ziel|limit/.test(n) && (unit === '%' || /soc/.test(n));
        case 'range':
            return d === 'sensor' && (unit === 'km' || unit === 'mi' || /reichweite|range|запас/.test(n));
        case 'energy':
            return d === 'sensor' && /^k?Wh$/.test(unit) && /session|sitzung|geladen|charged|ladevorgang|сесси/.test(n);
        case 'setpoint':
            return (
                (d === 'number' || st.attributes.iobroker_write === true) &&
                (/^°[CF]$/.test(unit) || /level\.temperature/.test(r))
            );
        case 'actual':
            return (
                d === 'sensor' &&
                st.attributes.iobroker_write !== true &&
                (/^°[CF]$/.test(unit) || /value\.temperature/.test(r)) &&
                !/soll|target|setpoint|set_point|ziel/.test(n)
            );
        case 'humidity':
            return d === 'sensor' && (/humidity/.test(r) || (unit === '%' && /humid|feucht|влажн/.test(n)));
        case 'valve':
            return d === 'sensor' && unit === '%' && /valve|ventil|stellgr|клапан/.test(n);
        case 'boost':
            return WRITABLE.test(d) && /boost|turbo|party/.test(n);
        case 'window':
            return /^(sensor|binary_sensor)$/.test(d) && /window|fenster|окн/.test(n);
        case 'onoff':
            return WRITABLE.test(d) && (/switch\.power/.test(r) || /power|ein\/aus|an\/aus|on\/off|питан/.test(n));
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
    const kind = deviceKind(f.type);
    // a wallbox's state is its status sensor (the plan's own field), else its linked entity
    if (kind === 'wallbox' && f.status && f.status !== 'none') {
        return f.status;
    }
    if (f.entity === 'none') {
        return null;
    }
    if (f.entity) {
        return f.entity;
    }
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
    if (kind === 'wallbox') {
        return (
            ids.find(
                id =>
                    /^(sensor|binary_sensor)$/.test(domain(id)) &&
                    named(id) &&
                    /status|state|zustand|connected|angesteckt|plug|состоян/i.test(
                        `${nameOf(id, hass.states[id])} ${roleOf(hass.states[id])}`,
                    ),
            ) ?? null
        );
    }
    // a radiator or air conditioner only by its own link (an entity found by name would belong to any room)
    if (kind === 'climate') {
        return null;
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
    // a wallbox's power sensor as the plan already knows it
    if (!v && role === 'power' && deviceKind(f.type) === 'wallbox' && f.power && f.power !== 'none') {
        return f.power;
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
        icon:
            kind === 'vacuum'
                ? '🧹'
                : kind === 'mower'
                  ? '🌱'
                  : kind === 'wallbox'
                    ? '🔌'
                    : kind === 'climate'
                      ? f.type === 'ac_unit'
                          ? '❄️'
                          : '🌡️'
                      : '☕',
        title: f.name || text(lang, kind),
    };
    if (kind === 'wallbox') {
        return wallboxCard(host, f, base, main, links);
    }
    if (kind === 'climate') {
        return mainSt ? climateCard(host, f, base, main!, links) : null;
    }
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

/** What a wallbox's status says (go-e's car state 1–5, words of evcc, OCPP and others, a plugged-in flag). */
export type WallboxPhase = 'charging' | 'plugged' | 'full' | 'free' | 'error' | 'unknown';
const GO_E: Record<number, WallboxPhase> = { 0: 'free', 1: 'free', 2: 'charging', 3: 'plugged', 4: 'full', 5: 'error' };
export function wallboxPhase(st: StateLike | undefined, id: string | null, watts: number | null): WallboxPhase {
    const raw = st && !DEAD.test(st.state) ? st.state.trim() : '';
    const t = raw.toLowerCase();
    if (/error|fehler|fault|störung|faulted|ошибк/.test(t)) {
        return 'error';
    }
    if (watts !== null && watts > 50) {
        return 'charging';
    }
    if (/^\d+$/.test(t) && !(id && domain(id) === 'binary_sensor')) {
        return GO_E[Number(t)] ?? 'unknown';
    }
    if (id && domain(id) === 'binary_sensor') {
        // a flag "charging" or "plugged in"
        const on = ON.test(t);
        return !t ? 'unknown' : on ? (/charg|lädt|laden/.test(nameOf(id, st)) ? 'charging' : 'plugged') : 'free';
    }
    if (!t) {
        return 'unknown';
    }
    if (/disconnect|not.?connected|nicht.?verbunden|available|frei|kein|no.?car|unplugged|^a$|отключ/.test(t)) {
        return 'free';
    }
    if (/complete|beendet|finish|voll|full|done|заверш/.test(t)) {
        return 'full';
    }
    if (/^c\d?$|charg|lädt|laden|заряж/.test(t) && !/not|nicht|kein/.test(t)) {
        return 'charging';
    }
    if (/^b\d?$|connect|plug|ready|angesteckt|verbunden|wait|paused|suspend|bereit|подключ/.test(t)) {
        return 'plugged';
    }
    return 'unknown';
}

/** The time a car is full at: what is missing of its battery at today's charging power. */
export function fullAt(
    soc: number | null,
    target: number | null,
    capacity: number | null,
    watts: number | null,
    now = Date.now(),
): Date | null {
    const goal = target ?? 100;
    if (soc === null || !capacity || !watts || watts < 500 || soc >= goal) {
        return null;
    }
    const hours = (((goal - soc) / 100) * capacity) / (watts / 1000);
    return hours > 0 && hours < 72 ? new Date(now + hours * 3600000) : null;
}

const EVCC_MODES = ['off', 'now', 'minpv', 'pv'];

function setValue(host: DeviceHost, id: string, value: number | string): void {
    const d = domain(id);
    void Promise.resolve(host.callService?.(d, 'set_value', { entity_id: id, value })).catch((e: unknown) =>
        console.warn(`home3d: ${d}.set_value`, e),
    );
}

function wallboxCard(
    host: DeviceHost,
    f: DeviceItem,
    base: Record<string, unknown>,
    main: string | null,
    links: Partial<Record<DeviceRole, string | null>>,
): Record<string, unknown> {
    const hass = host.hass();
    const lang = host.language();
    const mainSt = main ? hass.states[main] : undefined;
    const val = (role: DeviceRole): number | null => {
        const id = links[role];
        return id ? num(hass.states[id]) : null;
    };
    const fmt = (n: number, digits = 0): string =>
        n.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    const watts = val('power');
    const phase = wallboxPhase(mainSt, main, watts);
    const color = {
        charging: '#4cd97b',
        plugged: '#ffd166',
        full: '#4cd97b',
        free: '#9fb3c8',
        error: '#ff5d5d',
        unknown: '#9fb3c8',
    }[phase];
    const icon = { charging: '⚡', plugged: '🔌', full: '✓', free: '○', error: '⚠', unknown: '?' }[phase];
    const soc = val('soc');
    const target = val('target');
    const amps = val('current');
    const power =
        watts !== null && watts >= 50 ? (watts >= 1000 ? `${fmt(watts / 1000, 1)} kW` : `${fmt(watts)} W`) : null;
    const cells: Record<string, unknown>[] = [];
    const range = val('range');
    if (range !== null) {
        const rangeId = links.range!;
        cells.push({
            label: text(lang, 'range'),
            value: `${fmt(range)} ${str(hass.states[rangeId]?.attributes.unit_of_measurement) || 'km'}`,
        });
    }
    const energy = val('energy');
    if (energy !== null) {
        const kwh = str(hass.states[links.energy!]?.attributes.unit_of_measurement) === 'Wh' ? energy / 1000 : energy;
        cells.push({ label: text(lang, 'charged'), value: `${fmt(kwh, 1)} kWh` });
    }
    if (amps !== null) {
        cells.push({ label: text(lang, 'amps'), value: `${fmt(amps)} A`, minor: true });
    }
    const full = phase === 'charging' ? fullAt(soc, target, f.device_capacity ?? null, watts) : null;
    if (full) {
        cells.push({
            label: text(lang, 'full_at'),
            value: full.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }),
            color: '#4cd97b',
        });
    }
    const chips: { title: string; items: Record<string, unknown>[] }[] = [];
    const currentId = links.current;
    if (currentId) {
        const steps = [6, 8, 10, 13, 16];
        if (amps !== null && amps > 16) {
            steps.push(Math.round(amps));
        }
        chips.push({
            title: text(lang, 'amps'),
            items: [...new Set(steps)].map(a => ({
                label: `${a} A`,
                on: amps === a,
                onTap: () => setValue(host, currentId, a),
            })),
        });
    }
    const modeId = links.mode;
    const mode = modeId ? str(hass.states[modeId]?.state).toLowerCase() : '';
    if (modeId && EVCC_MODES.includes(mode)) {
        chips.push({
            title: text(lang, 'mode'),
            items: EVCC_MODES.map(m => ({
                label: text(lang, `mode_${m}`),
                on: mode === m,
                onTap: () => setValue(host, modeId, m),
            })),
        });
    }
    const chargeId = links.charge;
    const enabled = chargeId ? ON.test(str(hass.states[chargeId]?.state)) : false;
    const charging = phase === 'charging';
    const buttons = chargeId
        ? [
              {
                  label: '⚡',
                  title: text(lang, charging || enabled ? 'charge_stop' : 'charge_start'),
                  on: charging || enabled,
                  onTap: () => {
                      const d = domain(chargeId);
                      press(
                          host,
                          chargeId,
                          d === 'button' || d === 'input_button'
                              ? 'press'
                              : charging || enabled
                                ? 'turn_off'
                                : 'turn_on',
                      );
                  },
              },
          ]
        : [];
    return {
        ...base,
        live:
            power && charging
                ? `${text(lang, 'charging')} · ${power}`
                : text(lang, phase === 'unknown' ? 'unknown' : phase),
        liveColor: color,
        status: { icon, text: text(lang, phase === 'unknown' ? 'unknown' : phase), since: since(lang, mainSt), color },
        ...(soc !== null
            ? {
                  main: {
                      text: `${fmt(soc)} %`,
                      sub: text(lang, 'soc_short'),
                      color: batteryColor(soc),
                      ...(power ? { side: { text: power, sub: text(lang, 'power_now'), color: '#4cd97b' } } : {}),
                  },
                  rows: [
                      {
                          label: text(lang, 'soc_short'),
                          value: target !== null ? `${fmt(soc)} → ${fmt(target)} %` : `${fmt(soc)} %`,
                          at: Math.max(0, Math.min(100, soc)),
                          fill: true,
                          color: batteryColor(soc),
                      },
                  ],
              }
            : power
              ? { main: { text: power, sub: text(lang, 'power_now'), color: '#4cd97b' } }
              : {}),
        ...(cells.length ? { cells } : {}),
        ...(chips.length ? { chips } : {}),
        buttons,
    };
}

/** A value as the datapoint wants it: a number for a number datapoint, a boolean for a boolean one. */
function typed(st: StateLike | undefined, key: string): number | string | boolean {
    const type = str(st?.attributes.iobroker_type);
    return type === 'number' && Number.isFinite(Number(key)) ? Number(key) : type === 'boolean' ? key === 'true' : key;
}

function climateCard(
    host: DeviceHost,
    f: DeviceItem,
    base: Record<string, unknown>,
    main: string,
    links: Partial<Record<DeviceRole, string | null>>,
): Record<string, unknown> {
    const hass = host.hass();
    const lang = host.language();
    const mainSt = hass.states[main]!;
    const own = domain(main) === 'climate';
    const a = mainSt.attributes;
    // the linked datapoint itself may be the target or the room temperature
    const setId = links.setpoint ?? (!own && fits('setpoint', main, mainSt) ? main : null);
    const actualId = links.actual ?? (!own && fits('actual', main, mainSt) ? main : null);
    const setSt = setId ? hass.states[setId] : undefined;
    const target = own ? (typeof a.temperature === 'number' ? a.temperature : null) : num(setSt);
    const actual = own
        ? typeof a.current_temperature === 'number'
            ? a.current_temperature
            : null
        : actualId
          ? num(hass.states[actualId])
          : null;
    const valve = links.valve ? num(hass.states[links.valve]) : null;
    const humidity = links.humidity
        ? num(hass.states[links.humidity])
        : typeof a.current_humidity === 'number'
          ? a.current_humidity
          : null;
    const onoffId = links.onoff;
    const switchedOff = onoffId ? !ON.test(str(hass.states[onoffId]?.state)) : own && mainSt.state === 'off';
    const ac = f.type === 'ac_unit';
    const action = str(a.hvac_action);
    const phase = switchedOff
        ? 'climate_off'
        : action === 'heating' ||
            (valve !== null ? valve > 5 : !ac && !own && target !== null && actual !== null && target > actual + 0.3)
          ? 'heats'
          : action === 'cooling' || (ac && !own && target !== null && actual !== null && target < actual - 0.3)
            ? 'cools'
            : 'holds';
    const color = { heats: '#ff8a3d', cools: '#37b6ff', holds: '#4cd97b', climate_off: '#9fb3c8' }[phase];
    const icon = { heats: '♨', cools: '❄', holds: '✓', climate_off: '○' }[phase];
    const unit = str(own ? '°C' : hass.states[actualId ?? setId ?? main]?.attributes.unit_of_measurement) || '°C';
    const fmt = (n: number, digits = 1): string =>
        n.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    const rows: Record<string, unknown>[] = [];
    if (valve !== null) {
        rows.push({
            label: text(lang, 'valve'),
            value: `${Math.round(valve)} %`,
            at: Math.max(0, Math.min(100, valve)),
            fill: true,
            color: '#ff8a3d',
        });
    }
    if (humidity !== null) {
        rows.push({
            label: text(lang, 'humidity'),
            value: `${Math.round(humidity)} %`,
            at: Math.max(0, Math.min(100, humidity)),
            minor: true,
        });
    }
    const windowSt = links.window ? hass.states[links.window] : undefined;
    const windowOpen =
        !!windowSt &&
        !DEAD.test(windowSt.state) &&
        (ON.test(windowSt.state) || /open|offen|tilt|kipp|открыт/i.test(windowSt.state) || (num(windowSt) ?? 0) > 0);
    // − and +: half a degree (or the climate's own step), within its range
    const step = typeof a.target_temp_step === 'number' ? a.target_temp_step : 0.5;
    const min =
        typeof (own ? a.min_temp : setSt?.attributes.iobroker_min) === 'number'
            ? ((own ? a.min_temp : setSt?.attributes.iobroker_min) as number)
            : 5;
    const max =
        typeof (own ? a.max_temp : setSt?.attributes.iobroker_max) === 'number'
            ? ((own ? a.max_temp : setSt?.attributes.iobroker_max) as number)
            : 30;
    const setTo = (v: number): void => {
        const next = Math.min(max, Math.max(min, Math.round(v / step) * step));
        if (own) {
            void Promise.resolve(
                host.callService?.('climate', 'set_temperature', { entity_id: main, temperature: next }),
            ).catch((e: unknown) => console.warn('home3d: climate.set_temperature', e));
        } else if (setId) {
            setValue(host, setId, next);
        }
    };
    const buttons: Record<string, unknown>[] = [];
    if (target !== null && (own || setId)) {
        buttons.push({ label: '−', title: text(lang, 'cooler'), onTap: () => setTo(target - step) });
        buttons.push({ label: '+', title: text(lang, 'warmer'), onTap: () => setTo(target + step) });
    }
    const boostId = links.boost;
    if (boostId) {
        const on = ON.test(str(hass.states[boostId]?.state));
        buttons.push({
            label: '🔥',
            title: text(lang, 'boost'),
            on,
            onTap: () => press(host, boostId, on ? 'turn_off' : 'turn_on'),
        });
    }
    if (onoffId) {
        buttons.push({
            label: '⏻',
            title: text(lang, switchedOff ? 'on' : 'off_btn'),
            on: !switchedOff,
            onTap: () => press(host, onoffId, switchedOff ? 'turn_on' : 'turn_off'),
        });
    }
    const chips: { title: string; items: Record<string, unknown>[] }[] = [];
    if (own && Array.isArray(a.hvac_modes) && a.hvac_modes.length > 1) {
        chips.push({
            title: text(lang, 'climate_mode'),
            items: (a.hvac_modes as unknown[])
                .map(str)
                .filter(Boolean)
                .map(m => ({
                    label: TEXTS[lang.slice(0, 2)]?.[`hvac_${m}`] ?? TEXTS.en[`hvac_${m}`] ?? m,
                    on: mainSt.state === m,
                    onTap: () =>
                        void Promise.resolve(
                            host.callService?.('climate', 'set_hvac_mode', { entity_id: main, hvac_mode: m }),
                        ).catch((e: unknown) => console.warn('home3d: climate.set_hvac_mode', e)),
                })),
        });
    } else if (links.mode) {
        const modeId = links.mode;
        const modeSt = hass.states[modeId];
        const texts = modeSt?.attributes.iobroker_states;
        if (texts && typeof texts === 'object') {
            chips.push({
                title: text(lang, 'climate_mode'),
                items: Object.entries(texts as Record<string, string>).map(([key, label]) => ({
                    label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
                    on: modeSt?.state === key || modeSt?.state === label,
                    onTap: () => setValue(host, modeId, typed(modeSt, key) as number | string),
                })),
            });
        }
    }
    return {
        ...base,
        title: f.name || text(lang, 'climate'),
        live:
            target !== null && phase !== 'climate_off'
                ? `${text(lang, phase)} · ${fmt(target)} ${unit}`
                : text(lang, phase),
        liveColor: color,
        status: { icon, text: text(lang, phase), since: since(lang, mainSt), color },
        ...(actual !== null || target !== null
            ? {
                  main: {
                      text: actual !== null ? `${fmt(actual)} ${unit}` : `${fmt(target!)} ${unit}`,
                      sub: text(lang, actual !== null ? 'room' : 'target_short'),
                      ...(actual !== null && target !== null
                          ? { side: { text: `${fmt(target)} ${unit}`, sub: text(lang, 'target_short'), color } }
                          : {}),
                  },
              }
            : {}),
        ...(rows.length ? { rows } : {}),
        ...(windowOpen ? { hint: { text: text(lang, 'window_open'), color: '#37b6ff' } } : {}),
        ...(chips.length ? { chips } : {}),
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
    setpoint: /^(sensor|number)$/,
    actual: /^sensor$/,
    humidity: /^sensor$/,
    valve: /^sensor$/,
    boost: WRITABLE,
    window: /^(sensor|binary_sensor)$/,
    onoff: WRITABLE,
    charge: WRITABLE,
    current: /^(sensor|number)$/,
    mode: /^(sensor|select|input_select)$/,
    soc: /^sensor$/,
    target: /^(sensor|number)$/,
    range: /^sensor$/,
    energy: /^sensor$/,
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
            label: text(lang, kind === 'climate' && role === 'mode' ? 'climate_mode' : role),
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
        ...(kind === 'wallbox'
            ? [
                  {
                      kind: 'number',
                      label: text(lang, 'capacity'),
                      value: item.device_capacity ?? null,
                      step: 1,
                      min: 5,
                      max: 250,
                      hint: text(lang, 'capacity_hint'),
                      set: (v: number | null) =>
                          update(f => {
                              if (v === null) {
                                  delete f.device_capacity;
                              } else {
                                  f.device_capacity = v;
                              }
                          }),
                  },
              ]
            : []),
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
