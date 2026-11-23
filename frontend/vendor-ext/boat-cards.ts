// Glass cards of a boat's gear, shown by the module home3d.devices beside the device cards: the anchor (chain,
// depth, scope, distance to the anchor against the alarm radius, the alarm) and the tanks (one card over the first
// tank with a bar per tank). Their datapoints are the ones of the furniture (anchor_*, gear_entity, gear_liters).

import { tankFill, tankWarn } from './boat-kinds';
import { beaufort, compassPoint, fresh, speedMs, windOf, type States } from './weather-data';

interface StateLike {
    state: string;
    attributes: Record<string, unknown>;
    last_changed?: string;
    last_updated?: string;
}
/** The house's wind sensors and weather (the settings of the plan). */
interface WindSettings {
    wind_speed?: string | null;
    wind_dir?: string | null;
    wind_gust?: string | null;
    weather_entity?: string | null;
    pressure_entity?: string | null;
    sea_level?: number | null;
}
/** The plan's energy sensors: the battery's power (positive = discharging, unless inverted) and charge, the grid. */
interface EnergyLike {
    battery?: string | null;
    battery_invert?: boolean;
    battery_soc?: string | null;
    grid?: string | null;
}
interface HassLike {
    states: Record<string, StateLike | undefined>;
}
export interface BoatItem {
    id: string;
    type: string;
    name?: string | null;
    device_card?: boolean;
    anchor_chain?: string | null;
    anchor_depth?: string | null;
    anchor_distance?: string | null;
    anchor_radius?: string | null;
    anchor_alarm?: string | null;
    gear_kind?: string | null;
    gear_entity?: string | null;
    gear_liters?: string | null;
    /** Wind indicator: the apparent wind's speed and its angle to the bow (− port, + starboard). */
    wind_apparent_speed?: string | null;
    wind_apparent_angle?: string | null;
    /** Home battery: its state of charge and power (the plan's own fields), and the datapoints of its card. */
    soc?: string | null;
    power?: string | null;
    /** A separate sensor of the charging power (then `power` reports only the discharging). */
    charge?: string | null;
    battery_voltage?: string | null;
    battery_current?: string | null;
    battery_remaining?: string | null;
    battery_capacity?: string | null;
    battery_temp?: string | null;
    /** Shore power: the power it brings (a charger's, an inverter's AC input) and whether it is plugged in. */
    shore_power?: string | null;
    shore_connected?: string | null;
}
interface BoatHost {
    hass(): HassLike;
    building():
        | { floors: { id: string; furniture: BoatItem[] }[]; settings?: WindSettings; energy?: EnergyLike }
        | null
        | undefined;
    language(): string;
}

const TEXTS: Record<string, Record<string, string>> = {
    de: {
        anchor: 'Anker',
        anchored: 'vor Anker',
        stowed: 'eingeholt',
        alarm: 'Ankeralarm',
        distance: 'Abstand',
        radius: 'Alarmradius',
        chain: 'Kette',
        depth: 'Tiefe',
        scope: 'Kettenlänge : Tiefe',
        scope_short: 'zu wenig Kette',
        tanks: 'Tanks',
        low: 'fast leer',
        full: 'fast voll',
        tanks_ok: 'ok',
        water: 'Wasser',
        fuel: 'Kraftstoff',
        oil: 'Heizöl',
        gas: 'Gas',
        grey: 'Grauwasser',
        black: 'Schwarzwasser',
        battery: 'Batterie',
        soc: 'Ladestand',
        charging: 'lädt',
        discharging: 'entlädt',
        bat_full: 'voll',
        idle: 'Ruhe',
        battery_low: 'Batterie fast leer',
        voltage: 'Spannung',
        current: 'Strom',
        capacity: 'Kapazität',
        runtime: 'reicht noch',
        until_full: 'voll in',
        temperature: 'Temperatur',
        shore: 'Landstrom',
        shore_on: 'verbunden',
        shore_off: 'nicht verbunden',
        battery_hint:
            'Ladestand und Leistung kommen aus dem Möbel bzw. aus ⚙ → Energie (Batterie). Die übrigen Datenpunkte werden neben dem Ladestand gesucht (Spannung, Strom, Rest- und Gesamtkapazität in Ah, Temperatur). Strom: positiv = laden. Landstrom: die Leistung, die er bringt (Ladegerät, AC-Eingang) – auf einem Boot sonst das Netz aus ⚙ → Energie – und ob er angesteckt ist.',
        battery_voltage: 'Spannung',
        battery_current: 'Strom (A, + = laden)',
        battery_remaining: 'Restkapazität (Ah)',
        battery_capacity: 'Gesamtkapazität (Ah)',
        battery_temp: 'Temperatur',
        shore_power: 'Landstrom: Leistung',
        shore_connected: 'Landstrom: verbunden',
        wind: 'Wind',
        wind_true: 'wahrer Wind',
        wind_weather: 'laut Wetterdienst',
        wind_from: 'aus',
        bft: 'Windstärke',
        gusts: 'Böen',
        apparent: 'scheinbarer Wind',
        port: 'Bb',
        starboard: 'Stb',
        pressure: 'Luftdruck',
        calm: 'ruhig',
        breeze: 'Brise',
        strong: 'Starkwind',
        gale: 'Sturm',
        wind_hint:
            'Der wahre Wind kommt aus den Wind-Sensoren des Hauses (Editor → ⚙ → Wetter). Scheinbarer Wind: Geschwindigkeit und Winkel zum Bug (negativ: Backbord), z. B. nmea.0.windData.windSpeedApparent und windAngleApparent.',
    },
    en: {
        anchor: 'Anchor',
        anchored: 'at anchor',
        stowed: 'stowed',
        alarm: 'Anchor alarm',
        distance: 'Distance',
        radius: 'Alarm radius',
        chain: 'Chain',
        depth: 'Depth',
        scope: 'Scope',
        scope_short: 'too little chain',
        tanks: 'Tanks',
        low: 'nearly empty',
        full: 'nearly full',
        tanks_ok: 'ok',
        water: 'Water',
        fuel: 'Fuel',
        oil: 'Heating oil',
        gas: 'Gas',
        grey: 'Grey water',
        black: 'Black water',
        battery: 'Battery',
        soc: 'Charge',
        charging: 'charging',
        discharging: 'discharging',
        bat_full: 'full',
        idle: 'idle',
        battery_low: 'Battery nearly empty',
        voltage: 'Voltage',
        current: 'Current',
        capacity: 'Capacity',
        runtime: 'lasts',
        until_full: 'full in',
        temperature: 'Temperature',
        shore: 'Shore power',
        shore_on: 'connected',
        shore_off: 'not connected',
        battery_hint:
            'Charge and power come from the furniture or from ⚙ → Energy (battery). The other datapoints are looked for beside the charge (voltage, current, remaining and total capacity in Ah, temperature). Current: positive = charging. Shore power: the power it brings (a charger, an AC input) – on a boat else the grid of ⚙ → Energy – and whether it is plugged in.',
        battery_voltage: 'Voltage',
        battery_current: 'Current (A, + = charging)',
        battery_remaining: 'Remaining capacity (Ah)',
        battery_capacity: 'Total capacity (Ah)',
        battery_temp: 'Temperature',
        shore_power: 'Shore power: power',
        shore_connected: 'Shore power: connected',
        wind: 'Wind',
        wind_true: 'true wind',
        wind_weather: 'weather service',
        wind_from: 'from',
        bft: 'Force',
        gusts: 'Gusts',
        apparent: 'apparent wind',
        port: 'port',
        starboard: 'stbd',
        pressure: 'Pressure',
        calm: 'calm',
        breeze: 'breeze',
        strong: 'strong wind',
        gale: 'gale',
        wind_hint:
            'The true wind comes from the wind sensors of the house (editor → ⚙ → weather). Apparent wind: speed and angle to the bow (negative: port), e.g. nmea.0.windData.windSpeedApparent and windAngleApparent.',
    },
    ru: {
        anchor: 'Якорь',
        anchored: 'на якоре',
        stowed: 'поднят',
        alarm: 'Якорная тревога',
        distance: 'Расстояние',
        radius: 'Радиус тревоги',
        chain: 'Цепь',
        depth: 'Глубина',
        scope: 'Цепь : глубина',
        scope_short: 'мало цепи',
        tanks: 'Баки',
        low: 'почти пуст',
        full: 'почти полон',
        tanks_ok: 'в норме',
        water: 'Вода',
        fuel: 'Топливо',
        oil: 'Печное топливо',
        gas: 'Газ',
        grey: 'Серые воды',
        black: 'Чёрные воды',
        battery: 'Аккумулятор',
        soc: 'Заряд',
        charging: 'заряжается',
        discharging: 'разряжается',
        bat_full: 'полный',
        idle: 'покой',
        battery_low: 'Аккумулятор почти разряжен',
        voltage: 'Напряжение',
        current: 'Ток',
        capacity: 'Ёмкость',
        runtime: 'хватит на',
        until_full: 'полный через',
        temperature: 'Температура',
        shore: 'Береговое питание',
        shore_on: 'подключено',
        shore_off: 'не подключено',
        battery_hint:
            'Заряд и мощность берутся из предмета или из ⚙ → Энергия (аккумулятор). Остальные точки данных ищутся рядом с зарядом (напряжение, ток, остаточная и полная ёмкость в Ач, температура). Ток: положительный = заряд. Береговое питание: мощность, которую оно даёт (зарядное устройство, вход AC) – на лодке иначе сеть из ⚙ → Энергия – и подключено ли оно.',
        battery_voltage: 'Напряжение',
        battery_current: 'Ток (А, + = заряд)',
        battery_remaining: 'Остаточная ёмкость (Ач)',
        battery_capacity: 'Полная ёмкость (Ач)',
        battery_temp: 'Температура',
        shore_power: 'Береговое питание: мощность',
        shore_connected: 'Береговое питание: подключено',
        wind: 'Ветер',
        wind_true: 'истинный ветер',
        wind_weather: 'по прогнозу погоды',
        wind_from: 'с',
        bft: 'Сила ветра',
        gusts: 'Порывы',
        apparent: 'вымпельный ветер',
        port: 'лев.',
        starboard: 'пр.',
        pressure: 'Давление',
        calm: 'тихо',
        breeze: 'бриз',
        strong: 'сильный ветер',
        gale: 'шторм',
        wind_hint:
            'Истинный ветер берётся из датчиков ветра дома (редактор → ⚙ → погода). Вымпельный ветер: скорость и угол к носу (отрицательный: левый борт), например nmea.0.windData.windSpeedApparent и windAngleApparent.',
    },
};

function text(lang: string, key: string): string {
    return TEXTS[lang.slice(0, 2)]?.[key] ?? TEXTS.en[key] ?? key;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const DEAD = /^(unavailable|unknown|none|null|)$/i;
const linked = (id: string | null | undefined): id is string => !!id && id !== 'none';

function num(hass: HassLike, id: string | null | undefined): number | null {
    const st = linked(id) ? hass.states[id] : undefined;
    if (!st || DEAD.test(st.state)) {
        return null;
    }
    const n = Number(st.state);
    return Number.isFinite(n) ? n : null;
}

/** Below this much chain the anchor counts as stowed (as in anchor.ts). */
const STOWED = 0.3;
const RED = '#ff5d5d';
const ORANGE = '#ffb347';
const GREEN = '#4cd97b';
const BLUE = '#37b6ff';

/** The anchor's card: what it says, from its chain, depth, distance, radius and alarm (null: nothing linked). */
export function anchorCard(host: BoatHost, floorId: string, f: BoatItem): Record<string, unknown> | null {
    const hass = host.hass();
    const lang = host.language();
    const chain = num(hass, f.anchor_chain);
    const depth = num(hass, f.anchor_depth);
    const distance = num(hass, f.anchor_distance);
    const radius = num(hass, f.anchor_radius);
    const alarmSt = linked(f.anchor_alarm) ? hass.states[f.anchor_alarm] : undefined;
    if (chain === null && depth === null && distance === null && !alarmSt) {
        return null;
    }
    const alarm = alarmSt?.state === 'on' || alarmSt?.state === 'true';
    const stowed = chain !== null && chain < STOWED;
    const m = (v: number, digits = 1): string =>
        `${v.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits })} m`;
    // the scope: chain out per depth (5 : 1 and more holds, below 3 : 1 it drags)
    const scope = !stowed && chain !== null && depth !== null && depth > 0.3 ? chain / depth : null;
    const scopeColor = scope === null ? undefined : scope < 3 ? RED : scope < 5 ? ORANGE : GREEN;
    const near = distance !== null && radius !== null && radius > 0 ? distance / radius : null;
    const word = alarm ? 'alarm' : stowed ? 'stowed' : 'anchored';
    const color = alarm ? RED : stowed ? '#9fb3c8' : near !== null && near > 0.8 ? ORANGE : GREEN;
    const rows: Record<string, unknown>[] = [];
    if (!stowed && near !== null) {
        rows.push({
            label: text(lang, 'distance'),
            value: `${m(distance!, 0)} / ${m(radius!, 0)}`,
            at: Math.min(100, near * 100),
            fill: true,
            color: near >= 1 ? RED : near > 0.8 ? ORANGE : GREEN,
        });
    }
    if (chain !== null) {
        rows.push({ label: text(lang, 'chain'), value: m(chain) });
    }
    if (depth !== null) {
        rows.push({ label: text(lang, 'depth'), value: m(depth) });
    }
    if (scope !== null) {
        rows.push({
            label: text(lang, 'scope'),
            value: `${scope.toLocaleString(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 })} : 1`,
            color: scopeColor,
        });
    }
    return {
        id: `boat:${f.id}`,
        anchor: { floorId, furnitureId: f.id },
        icon: '⚓',
        title: f.name || text(lang, 'anchor'),
        live: text(lang, word),
        liveColor: color,
        status: { icon: alarm ? '⚠' : stowed ? '⌂' : '⚓', text: text(lang, word), color },
        ...(!stowed && distance !== null
            ? {
                  main: {
                      text: m(distance, 0),
                      sub: text(lang, 'distance'),
                      ...(radius !== null ? { side: { text: m(radius, 0), sub: text(lang, 'radius'), color } } : {}),
                  },
              }
            : {}),
        ...(rows.length ? { rows } : {}),
        ...(scope !== null && scope < 3 ? { hint: { text: text(lang, 'scope_short'), color: RED } } : {}),
    };
}

/** The tanks' card: over the first tank with a datapoint, a bar per tank (its fill, its litres). */
export function tanksCard(host: BoatHost, floorId: string, tanks: BoatItem[]): Record<string, unknown> | null {
    const hass = host.hass();
    const lang = host.language();
    const rows: Record<string, unknown>[] = [];
    let warn = 0;
    for (const t of tanks) {
        const v = num(hass, t.gear_entity);
        if (v === null) {
            continue;
        }
        const unit = str(hass.states[t.gear_entity!]?.attributes.unit_of_measurement);
        const fill = tankFill(v, unit);
        const bad = tankWarn(t.gear_kind, fill);
        warn += bad ? 1 : 0;
        // the contents in litres, or in kg (a gas bottle on a scale): as its datapoint says
        const amount = num(hass, t.gear_liters);
        const amountUnit =
            (linked(t.gear_liters) ? str(hass.states[t.gear_liters]?.attributes.unit_of_measurement) : '').trim() ||
            'l';
        const digits = amountUnit === 'kg' && amount !== null && amount < 100 ? 1 : 0;
        const kind = t.gear_kind ?? 'water';
        rows.push({
            label: t.name || text(lang, kind),
            value: `${Math.round(fill * 100)} %${amount !== null ? ` · ${amount.toLocaleString(lang, { maximumFractionDigits: digits })} ${amountUnit}` : ''}`,
            at: fill * 100,
            fill: true,
            color: bad ? RED : kind === 'fuel' || kind === 'oil' ? ORANGE : kind === 'water' ? BLUE : '#a98bff',
        });
    }
    if (!rows.length) {
        return null;
    }
    const first = tanks.find(t => num(hass, t.gear_entity) !== null)!;
    const color = warn ? RED : GREEN;
    const state = warn
        ? tanks.some(t => (t.gear_kind === 'grey' || t.gear_kind === 'black') && num(hass, t.gear_entity) !== null)
            ? `${text(lang, 'low')} / ${text(lang, 'full')}`
            : text(lang, 'low')
        : text(lang, 'tanks_ok');
    return {
        id: `boat:tanks:${floorId}`,
        anchor: { floorId, furnitureId: first.id },
        icon: '⛽',
        title: text(lang, 'tanks'),
        live: state,
        liveColor: color,
        status: { icon: warn ? '⚠' : '✓', text: state, color },
        rows,
    };
}

/** The compass points in the language's letters (N, NE … NW). */
function points(lang: string): string[] {
    const l = lang.slice(0, 2);
    const [n, e, s, w] = l === 'de' ? ['N', 'O', 'S', 'W'] : l === 'ru' ? ['С', 'В', 'Ю', 'З'] : ['N', 'E', 'S', 'W'];
    return [n, n + e, e, s + e, s, s + w, w, n + w];
}

/** The weather entity of the plan, else the first one there is (as the 3D view takes it). */
function weatherOf(states: Record<string, unknown>, chosen: string | null | undefined): string | null {
    return linked(chosen)
        ? chosen
        : (Object.keys(states)
              .sort()
              .find(id => id.startsWith('weather.')) ?? null);
}

/** The wind's card over a wind indicator: speed (knots on a boat), Beaufort, where from, gusts, apparent wind, pressure. */
export function windCard(
    host: BoatHost,
    floorId: string,
    f: BoatItem,
    now = Date.now(),
): Record<string, unknown> | null {
    const hass = host.hass();
    const lang = host.language();
    const set = host.building()?.settings ?? {};
    const states = hass.states as unknown as States;
    const wind = windOf(
        states,
        {
            speed: set.wind_speed,
            dir: set.wind_dir,
            gust: set.wind_gust,
            weather: weatherOf(states, set.weather_entity),
        },
        now,
    );
    if (!wind) {
        return null;
    }
    const boat = typeof set.sea_level === 'number';
    const speed = (ms: number): string =>
        `${Math.round(boat ? ms / 0.514444 : ms * 3.6).toLocaleString(lang)} ${boat ? 'kn' : 'km/h'}`;
    const bft = beaufort(wind.speed);
    const word = bft >= 8 ? 'gale' : bft >= 6 ? 'strong' : bft >= 3 ? 'breeze' : 'calm';
    const color = bft >= 8 ? RED : bft >= 6 ? ORANGE : bft >= 3 ? GREEN : BLUE;
    const from = wind.from === null ? '' : `${compassPoint(wind.from, points(lang))} ${Math.round(wind.from)}°`;
    const rows: Record<string, unknown>[] = [
        { label: text(lang, 'bft'), value: `${bft} Bft`, at: (bft / 12) * 100, fill: true, color },
    ];
    if (wind.gust !== null && wind.gust - wind.speed >= 1) {
        rows.push({
            label: text(lang, 'gusts'),
            value: speed(wind.gust),
            color: beaufort(wind.gust) >= 7 ? RED : undefined,
        });
    }
    // the apparent wind: what the sails feel, its angle to the bow
    const aSt = linked(f.wind_apparent_speed) ? states[f.wind_apparent_speed] : undefined;
    // (instruments switched off: their last values are old, they are left out as the true wind's are)
    const aAngle =
        linked(f.wind_apparent_angle) && fresh(states[f.wind_apparent_angle], now)
            ? num(hass, f.wind_apparent_angle)
            : null;
    const aSpeed =
        fresh(aSt, now) && Number.isFinite(Number(aSt.state))
            ? speedMs(Number(aSt.state), str(aSt.attributes.unit_of_measurement))
            : null;
    if (aSpeed !== null || aAngle !== null) {
        const a = aAngle === null ? null : ((((aAngle + 180) % 360) + 360) % 360) - 180;
        const side = a === null ? '' : `${Math.round(Math.abs(a))}° ${text(lang, a < 0 ? 'port' : 'starboard')}`;
        rows.push({
            label: text(lang, 'apparent'),
            value: [aSpeed !== null ? speed(aSpeed) : '', side].filter(Boolean).join(' · '),
        });
    }
    const press = num(hass, set.pressure_entity);
    if (press !== null) {
        rows.push({
            label: text(lang, 'pressure'),
            value: `${Math.round(press).toLocaleString(lang)} hPa`,
            minor: true,
        });
    }
    return {
        id: `boat:wind:${f.id}`,
        anchor: { floorId, furnitureId: f.id },
        icon: '🌬',
        title: f.name || text(lang, 'wind'),
        live: [speed(wind.speed), from].filter(Boolean).join(' · '),
        liveColor: color,
        status: { icon: bft >= 6 ? '⚠' : '🌬', text: text(lang, word), color },
        main: {
            text: speed(wind.speed),
            // the own sensors while they report, else the weather service's wind
            sub: text(
                lang,
                linked(set.wind_speed) && fresh(states[set.wind_speed], now) ? 'wind_true' : 'wind_weather',
            ),
            ...(from ? { side: { text: from, sub: text(lang, 'wind_from'), color } } : {}),
        },
        rows,
        ...(bft >= 6 ? { hint: { text: `${text(lang, word)}: ${bft} Bft`, color } } : {}),
    };
}

/** The datapoint of a battery's value beside its state of charge (the same device of the adapter), else none. */
const BATTERY_FIELDS = {
    battery_voltage: (id: string, a: Record<string, unknown>): boolean =>
        /voltage/.test(str(a.iobroker_role)) && !/max|min|cell/i.test(id),
    battery_current: (id: string, a: Record<string, unknown>): boolean =>
        /current/.test(str(a.iobroker_role)) && !/max|min/i.test(id),
    battery_remaining: (id: string): boolean => /remain|rest/i.test(id) && /ah|capacity|kapaz/i.test(id),
    battery_capacity: (id: string): boolean => /total_?ah|full_?capacity|capacity_?ah|nominal/i.test(id),
    battery_temp: (id: string, a: Record<string, unknown>): boolean =>
        /temperature/.test(str(a.iobroker_role)) && !/mos|pcb|cpu|board/i.test(id),
} as const;
type BatteryField = keyof typeof BATTERY_FIELDS;

/** A value of the battery: chosen at the furniture ("none": off), else found beside its state of charge. */
export function batteryLink(hass: HassLike, f: BoatItem, socId: string | null, key: BatteryField): string | null {
    const own = f[key];
    if (own === 'none') {
        return null;
    }
    if (own) {
        return own;
    }
    const socPath = socId ? str(hass.states[socId]?.attributes.iobroker_id) : '';
    const base = socPath ? socPath.slice(0, socPath.lastIndexOf('.') + 1) : '';
    if (!base) {
        return null;
    }
    return (
        Object.keys(hass.states)
            .sort()
            .find(id => {
                const a = hass.states[id]!.attributes;
                const path = str(a.iobroker_id);
                return (
                    id.startsWith('sensor.') &&
                    path.startsWith(base) &&
                    !path.slice(base.length).includes('.') &&
                    BATTERY_FIELDS[key](path, a)
                );
            }) ?? null
    );
}

/**
 * Whether shore power is plugged in by its datapoint: on/true/connected, or a number as the AC input's source of an
 * inverter/charger reports it (Victron: 1 grid, 2 generator, 3 shore; 0 unknown and 240 not connected).
 */
export function shoreConnected(state: string): boolean {
    const n = Number(state);
    if (state.trim() !== '' && Number.isFinite(n)) {
        return n > 0 && n < 240;
    }
    return /^(on|true|connected|verbunden|подключ)/i.test(state.trim());
}

/** Hours and minutes: "5 h 20 min", "45 min", "3 d" beyond two days. */
function duration(lang: string, h: number): string {
    if (h >= 48) {
        return `${Math.round(h / 24).toLocaleString(lang)} d`;
    }
    const m = Math.round(h * 60);
    return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
}

/** A battery's card (a home battery in the plan): charge, charging or discharging, voltage, current, how long it lasts, shore power. */
export function batteryCard(host: BoatHost, floorId: string, f: BoatItem): Record<string, unknown> | null {
    const hass = host.hass();
    const lang = host.language();
    const b = host.building();
    const energy = b?.energy ?? {};
    const socId = linked(f.soc) ? f.soc : linked(energy.battery_soc) ? energy.battery_soc : null;
    const powerId = linked(f.power) ? f.power : linked(energy.battery) ? energy.battery : null;
    const soc = num(hass, socId);
    const rawPower = num(hass, powerId);
    const chargeIn = linked(f.charge) ? num(hass, f.charge) : null;
    if (soc === null && rawPower === null && chargeIn === null) {
        return null;
    }
    // as everywhere in the plan: positive = discharging (inverted on request); with a charging sensor of its own the
    // power reports only the discharging and the signs do not matter. Here: positive = charging.
    const charge =
        linked(f.charge) && (chargeIn !== null || rawPower !== null)
            ? Math.max(0, chargeIn ?? 0) - Math.max(0, rawPower ?? 0)
            : rawPower === null
              ? null
              : energy.battery_invert
                ? rawPower
                : -rawPower;
    const link = (key: BatteryField): string | null => batteryLink(hass, f, socId, key);
    const voltage = num(hass, link('battery_voltage'));
    const current = num(hass, link('battery_current'));
    const remaining = num(hass, link('battery_remaining'));
    const capacity = num(hass, link('battery_capacity'));
    const temp = num(hass, link('battery_temp'));
    const flow = charge ?? (current !== null && voltage !== null ? current * voltage : null);
    const word =
        flow !== null && flow > 15
            ? soc !== null && soc >= 99.5
                ? 'bat_full'
                : 'charging'
            : flow !== null && flow < -15
              ? 'discharging'
              : soc !== null && soc >= 99.5
                ? 'bat_full'
                : 'idle';
    const low = soc !== null && soc < 20;
    const color = low
        ? RED
        : soc !== null && soc < 35
          ? ORANGE
          : word === 'charging' || word === 'bat_full'
            ? GREEN
            : BLUE;
    const fmt = (v: number, digits: number): string =>
        v.toLocaleString(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits });
    const watts = (w: number): string => `${Math.round(Math.abs(w)).toLocaleString(lang)} W`;
    const rows: Record<string, unknown>[] = [];
    if (soc !== null) {
        rows.push({ label: text(lang, 'soc'), value: `${Math.round(soc)} %`, at: soc, fill: true, color });
    }
    if (remaining !== null && capacity !== null && capacity > 0) {
        rows.push({
            label: text(lang, 'capacity'),
            value: `${Math.round(remaining).toLocaleString(lang)} / ${Math.round(capacity).toLocaleString(lang)} Ah`,
        });
    }
    // how long it lasts (discharging) or until it is full (charging): from the Ah and the current, else from the power
    const amps = current ?? (flow !== null && voltage ? flow / voltage : null);
    if (amps !== null && Math.abs(amps) >= 0.2) {
        const left = amps < 0 ? remaining : remaining !== null && capacity !== null ? capacity - remaining : null;
        if (left !== null && left > 0) {
            rows.push({
                label: text(lang, amps < 0 ? 'runtime' : 'until_full'),
                value: duration(lang, left / Math.abs(amps)),
            });
        }
    }
    const cells: Record<string, unknown>[] = [];
    if (voltage !== null) {
        cells.push({ label: text(lang, 'voltage'), value: `${fmt(voltage, 2)} V` });
    }
    if (current !== null) {
        cells.push({ label: text(lang, 'current'), value: `${fmt(current, 1)} A` });
    }
    if (temp !== null) {
        cells.push({ label: text(lang, 'temperature'), value: `${fmt(temp, 1)} °C` });
    }
    // shore power: its own datapoints, on a boat else the plan's grid (the charger)
    const boat = typeof b?.settings?.sea_level === 'number';
    const shoreOff = f.shore_power === 'none';
    const shoreId = linked(f.shore_power)
        ? f.shore_power
        : !shoreOff && boat && linked(energy.grid)
          ? energy.grid
          : null;
    const shoreW = num(hass, shoreId);
    const plugSt = linked(f.shore_connected) ? hass.states[f.shore_connected] : undefined;
    const plugged =
        plugSt && !DEAD.test(plugSt.state)
            ? shoreConnected(plugSt.state)
            : shoreW !== null
              ? Math.abs(shoreW) > 5
              : null;
    if (plugged !== null) {
        rows.push({
            label: text(lang, 'shore'),
            value: plugged
                ? `${text(lang, 'shore_on')}${shoreW !== null && Math.abs(shoreW) > 5 ? ` · ${watts(shoreW)}` : ''}`
                : text(lang, 'shore_off'),
            color: plugged ? GREEN : undefined,
        });
    }
    return {
        id: `boat:battery:${f.id}`,
        anchor: { floorId, furnitureId: f.id },
        icon: '🔋',
        title: f.name || text(lang, 'battery'),
        live: [soc !== null ? `${Math.round(soc)} %` : '', flow !== null && Math.abs(flow) > 15 ? watts(flow) : '']
            .filter(Boolean)
            .join(' · '),
        liveColor: color,
        status: {
            icon: low ? '⚠' : word === 'charging' ? '⚡' : word === 'discharging' ? '↓' : '✓',
            text: text(lang, word),
            color,
        },
        main: {
            text: soc !== null ? `${Math.round(soc)} %` : watts(flow ?? 0),
            sub: text(lang, soc !== null ? 'soc' : word),
            ...(soc !== null && flow !== null
                ? {
                      side: {
                          text: `${flow > 0 ? '+' : flow < 0 ? '−' : ''}${watts(flow)}`,
                          sub: text(lang, word),
                          color,
                      },
                  }
                : {}),
        },
        rows,
        ...(cells.length ? { cells } : {}),
        ...(low ? { hint: { text: text(lang, 'battery_low'), color: RED } } : {}),
    };
}

/** The boat's cards: an anchor's, and one for the tanks of each floor (a furniture's device_card false leaves it out). */
export function boatCards(host: BoatHost): unknown[] {
    const out: unknown[] = [];
    for (const fl of host.building()?.floors ?? []) {
        for (const f of fl.furniture) {
            if (f.type === 'home_battery' && f.device_card !== false) {
                const card = batteryCard(host, fl.id, f);
                if (card) {
                    out.push(card);
                }
            }
            if (f.type === 'anchor' && f.device_card !== false) {
                const card = anchorCard(host, fl.id, f);
                if (card) {
                    out.push(card);
                }
            }
        }
        // the wind: one card, over the first wind indicator
        const vane = fl.furniture.find(f => f.type === 'wind_vane' && f.device_card !== false);
        const windC =
            vane && !out.some(c => String((c as { id: string }).id).startsWith('boat:wind:'))
                ? windCard(host, fl.id, vane)
                : null;
        if (windC) {
            out.push(windC);
        }
        const tanks = fl.furniture.filter(f => f.type === 'tank' && f.device_card !== false && linked(f.gear_entity));
        if (tanks.length) {
            const card = tanksCard(host, fl.id, tanks);
            if (card) {
                out.push(card);
            }
        }
    }
    return out;
}

/** The datapoints the boat's cards read. */
export function boatWatched(host: BoatHost): string[] {
    const set = host.building()?.settings ?? {};
    const energy = host.building()?.energy ?? {};
    const out: string[] = [
        set.wind_speed,
        set.wind_dir,
        set.wind_gust,
        set.pressure_entity,
        energy.battery,
        energy.battery_soc,
        energy.grid,
    ].filter(linked);
    for (const fl of host.building()?.floors ?? []) {
        for (const f of fl.furniture) {
            const ids =
                f.type === 'anchor'
                    ? [f.anchor_chain, f.anchor_depth, f.anchor_distance, f.anchor_radius, f.anchor_alarm]
                    : f.type === 'tank'
                      ? [f.gear_entity, f.gear_liters]
                      : f.type === 'wind_vane'
                        ? [f.wind_apparent_speed, f.wind_apparent_angle]
                        : f.type === 'home_battery'
                          ? [
                                f.soc,
                                f.power,
                                f.charge,
                                f.shore_power,
                                f.shore_connected,
                                ...(Object.keys(BATTERY_FIELDS) as BatteryField[]).map(k =>
                                    batteryLink(
                                        host.hass(),
                                        f,
                                        linked(f.soc) ? f.soc : (energy.battery_soc ?? null),
                                        k,
                                    ),
                                ),
                            ]
                          : [];
            out.push(...ids.filter(linked));
        }
    }
    return out;
}

const CARD: Record<string, string> = {
    de: 'Glaskarte zeigen',
    en: 'show glass card',
    ru: 'показать стеклянную карточку',
};

/** The anchor's and a tank's form: whether its glass card shows. */
export function boatFields(
    host: BoatHost & { updateBuilding?(mutate: (b: { floors: { furniture: BoatItem[] }[] }) => void): void },
    item: BoatItem,
): unknown[] {
    if (item.type !== 'anchor' && item.type !== 'tank' && item.type !== 'wind_vane' && item.type !== 'home_battery') {
        return [];
    }
    const lang = host.language();
    const update = (mutate: (f: BoatItem) => void): void =>
        host.updateBuilding?.(b => {
            const f = b.floors.flatMap(fl => fl.furniture).find(x => x.id === item.id);
            if (f) {
                mutate(f);
            }
        });
    const sensor = (key: 'wind_apparent_speed' | 'wind_apparent_angle', re: RegExp): Record<string, unknown> => ({
        kind: 'entity',
        label: `${text(lang, 'apparent')}: ${key === 'wind_apparent_speed' ? 'kn' : '°'}`,
        value: item[key] ?? null,
        auto: autoSensor(host.hass(), re),
        filter: (id: string) => id.startsWith('sensor.'),
        set: (v: string | null) =>
            update(f => {
                if (v === null) {
                    delete f[key];
                } else {
                    f[key] = v;
                }
            }),
    });
    const energy = host.building()?.energy ?? {};
    const socId = linked(item.soc) ? item.soc : (energy.battery_soc ?? null);
    const pick = (
        key: BatteryField | 'shore_power' | 'shore_connected',
        auto: string | null,
    ): Record<string, unknown> => ({
        kind: 'entity',
        label: text(lang, key),
        value: item[key] ?? null,
        auto,
        filter: (id: string) => /^(sensor|binary_sensor)\./.test(id),
        set: (v: string | null) =>
            update(f => {
                if (v === null) {
                    delete f[key];
                } else {
                    f[key] = v;
                }
            }),
    });
    const batteryFields =
        item.type === 'home_battery'
            ? [
                  ...(Object.keys(BATTERY_FIELDS) as BatteryField[]).map(k =>
                      pick(k, batteryLink(host.hass(), { ...item, [k]: null }, socId, k)),
                  ),
                  pick('shore_power', null),
                  pick('shore_connected', null),
                  { kind: 'text', text: text(lang, 'battery_hint') },
              ]
            : [];
    const windFields =
        item.type === 'wind_vane'
            ? [
                  sensor('wind_apparent_speed', /speed.?apparent|apparent.?wind.?speed|scheinbar.*geschw/i),
                  sensor('wind_apparent_angle', /angle.?apparent|apparent.?wind.?angle|scheinbar.*winkel/i),
                  { kind: 'text', text: text(lang, 'wind_hint') },
              ]
            : [];
    return [
        {
            kind: 'check',
            label: `${text(lang, item.type === 'anchor' ? 'anchor' : item.type === 'tank' ? 'tanks' : item.type === 'home_battery' ? 'battery' : 'wind')}: ${CARD[lang.slice(0, 2)] ?? CARD.en}`,
            value: item.device_card !== false,
            set: (v: boolean) =>
                host.updateBuilding?.(b => {
                    const f = b.floors.flatMap(fl => fl.furniture).find(x => x.id === item.id);
                    if (f) {
                        if (v) {
                            delete f.device_card;
                        } else {
                            f.device_card = false;
                        }
                    }
                }),
        },
        ...windFields,
        ...batteryFields,
    ];
}

/** A mapped sensor whose datapoint or name matches (the apparent wind of an NMEA adapter …), null without. */
function autoSensor(hass: HassLike, re: RegExp): string | null {
    return (
        Object.keys(hass.states)
            .sort()
            .find(id => {
                const a = hass.states[id]?.attributes;
                return id.startsWith('sensor.') && re.test(`${str(a?.iobroker_id)} ${str(a?.friendly_name)}`);
            }) ?? null
    );
}
