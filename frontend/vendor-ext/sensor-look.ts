// How sensors look in 3D (tasks.ts patches markers.ts) and in the detail dialog of the page: a symbol by what the
// sensor measures or reports (a drop for water, flames for smoke, a walking man for motion …), the humidity next to
// the temperature, and climate values that stay visible on the floor plan instead of only in an open room.

import { bundledPath } from './mdi-paths.js';

/** The part of a device state the look needs. */
export interface SensorState {
    entity_id: string;
    state: string;
    attributes: Record<string, unknown>;
}

const domain = (id: string): string => id.slice(0, id.indexOf('.'));
/** A value as text; objects count as none. */
const text = (v: unknown, fallback = ''): string =>
    typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : fallback;

/** Material Design symbol (without "mdi:") for a sensor; null: the usual symbol of its kind. */
export function sensorIcon(st: SensorState | undefined): string | null {
    if (!st) {
        return null;
    }
    const cls = text(st.attributes.device_class);
    const on = st.state === 'on';
    if (domain(st.entity_id) === 'binary_sensor') {
        switch (cls) {
            case 'moisture':
                return on ? 'water-alert' : 'water-off';
            case 'smoke':
            case 'heat':
                return on ? 'fire' : 'smoke-detector';
            case 'gas':
            case 'carbon_monoxide':
                return on ? 'smoke-detector-alert' : 'smoke-detector';
            case 'motion':
            case 'occupancy':
            case 'presence':
                return on ? 'walk' : 'motion-sensor-off';
            case 'window':
                return on ? 'window-open-variant' : 'window-closed-variant';
            case 'door':
            case 'opening':
            case 'garage_door':
                return on ? 'door-open' : 'door-closed';
            case 'plug':
            case 'power':
                return on ? 'power-plug' : 'power-plug-off';
            case 'battery':
                return 'battery';
            default:
                return null;
        }
    }
    if (domain(st.entity_id) === 'sensor') {
        switch (cls) {
            case 'temperature':
                return 'thermometer';
            case 'humidity':
                return 'water-percent';
            case 'moisture':
                return 'water';
            case 'pressure':
            case 'atmospheric_pressure':
                return 'gauge';
            case 'battery':
                return 'battery';
            default:
                // a fill level (tank) has no class of its own in ioBroker: its unit is %
                return st.attributes.unit_of_measurement === '%' && /tank/i.test(text(st.attributes.friendly_name))
                    ? 'storage-tank'
                    : null;
        }
    }
    return null;
}

/** Sensors whose value is worth seeing everywhere (not only in an open room): climate and fill levels. */
export function sensorShow(st: SensorState | undefined): 'always' | undefined {
    if (!st || domain(st.entity_id) !== 'sensor') {
        return undefined;
    }
    const cls = text(st.attributes.device_class);
    return cls === 'temperature' || cls === 'humidity' || sensorIcon(st) === 'storage-tank' ? 'always' : undefined;
}

/** The marker text of a temperature sensor with the humidity of the same device next to it ("21,4 °C · 48 %"). */
export function sensorText(st: SensorState | undefined, text: string, language = 'de'): string {
    const h = st?.attributes.humidity;
    if (typeof h !== 'number' || !Number.isFinite(h) || st?.attributes.device_class !== 'temperature') {
        return text;
    }
    return `${text} · ${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(h)} %`;
}

/**
 * The symbol of a device in the floor plan of the editor as an SVG path (24 × 24, filled): its own symbol, else the
 * one of the sensor; null: the usual symbol of its kind (only symbols of mdi-paths.ts can be drawn at once).
 */
/**
 * Symbols offered under "Eigenes Symbol" (Material Design names without "mdi:"), in groups with a heading (text key
 * `icon_group_<id>`); any other name can be typed. Every one is bundled in mdi-paths.ts, so it shows at once in 3D and
 * in the editor's floor plan (test/icons.test.ts checks that).
 */
export const ICON_GROUPS: readonly { id: string; icons: readonly string[] }[] = [
    {
        id: 'light',
        icons: [
            'lightbulb',
            'lightbulb-outline',
            'lightbulb-group',
            'lightbulb-night',
            'ceiling-light',
            'chandelier',
            'floor-lamp',
            'desk-lamp',
            'lamp',
            'wall-sconce',
            'wall-sconce-flat',
            'outdoor-lamp',
            'coach-lamp',
            'track-light',
            'spotlight-beam',
            'led-strip-variant',
            'string-lights',
            'light-switch',
        ],
    },
    {
        id: 'appliances',
        icons: [
            'washing-machine',
            'tumble-dryer',
            'dishwasher',
            'fridge',
            'fridge-industrial',
            'stove',
            'microwave',
            'toaster-oven',
            'coffee-maker',
            'kettle',
            'pot-steam',
            'blender',
            'countertop',
            'robot-vacuum',
            'vacuum',
            'robot-mower',
            'iron',
        ],
    },
    {
        id: 'climate',
        icons: [
            'thermometer',
            'snowflake-thermometer',
            'thermostat',
            'radiator',
            'heat-pump',
            'air-conditioner',
            'fan',
            'ceiling-fan',
            'air-humidifier',
            'air-purifier',
            'air-filter',
            'molecule-co2',
            'fire',
            'fireplace',
            'weather-sunny',
            'weather-rainy',
            'weather-windy',
            'weather-snowy',
            'umbrella',
        ],
    },
    {
        id: 'water',
        icons: [
            'water',
            'water-alert',
            'water-percent',
            'water-off',
            'water-pump',
            'water-boiler',
            'water-thermometer',
            'pipe-leak',
            'storage-tank',
            'gas-cylinder',
            'fuel',
            'oil',
        ],
    },
    {
        id: 'power',
        icons: [
            'power-plug',
            'power-socket-eu',
            'power-socket-de',
            'power',
            'flash',
            'lightning-bolt',
            'solar-power',
            'solar-panel',
            'battery',
            'battery-alert',
            'battery-charging',
            'home-battery',
            'car-battery',
            'ev-station',
            'ev-plug-type2',
            'meter-electric',
            'transmission-tower',
            'generator-stationary',
        ],
    },
    {
        id: 'openings',
        icons: [
            'door',
            'door-open',
            'door-closed',
            'door-sliding',
            'garage',
            'garage-open',
            'gate',
            'gate-open',
            'window-closed-variant',
            'window-open-variant',
            'window-shutter',
            'window-shutter-open',
            'blinds',
            'blinds-open',
            'roller-shade',
            'curtains',
            'curtains-closed',
            'awning',
        ],
    },
    {
        id: 'security',
        icons: [
            'lock',
            'lock-open',
            'key',
            'doorbell',
            'doorbell-video',
            'bell',
            'bell-alert',
            'alarm-light',
            'shield-home',
            'cctv',
            'webcam',
            'motion-sensor',
            'smoke-detector',
            'smoke-detector-variant',
            'fire-extinguisher',
            'leak',
            'alert',
            'alert-circle',
            'medical-bag',
        ],
    },
    {
        id: 'media',
        icons: [
            'television',
            'speaker',
            'speaker-wireless',
            'cast',
            'music',
            'radio',
            'projector',
            'gamepad-variant',
            'headphones',
            'wifi',
            'router-wireless',
            'access-point',
            'nas',
            'server',
            'printer',
            'desktop-classic',
            'laptop',
            'cellphone',
            'tablet',
        ],
    },
    {
        id: 'garden',
        icons: [
            'sprinkler',
            'sprinkler-variant',
            'watering-can',
            'flower',
            'sprout',
            'tree',
            'grass',
            'pool',
            'hot-tub',
            'fountain',
            'grill',
            'greenhouse',
            'fence',
            'beehive-outline',
            'shovel',
            'mailbox',
            'trash-can',
            'recycle',
        ],
    },
    {
        id: 'vehicles',
        icons: [
            'car',
            'car-electric',
            'bicycle',
            'bicycle-electric',
            'motorbike',
            'scooter',
            'rv-truck',
            'caravan',
            'tractor',
            'bus',
            'garage-variant',
            'parking',
        ],
    },
    {
        id: 'boat',
        icons: [
            'anchor',
            'sail-boat',
            'ferry',
            'engine',
            'pump',
            'gauge',
            'compass',
            'ship-wheel',
            'lifebuoy',
            'waves',
            'navigation',
            'map-marker',
            'satellite-variant',
        ],
    },
    {
        id: 'rooms',
        icons: [
            'home',
            'sofa',
            'bed',
            'bathtub',
            'shower',
            'toilet',
            'stairs',
            'desk',
            'wardrobe',
            'baby-carriage',
            'dog',
            'cat',
            'paw',
            'account',
            'account-group',
            'clock',
            'timer',
            'calendar',
            'package-variant',
            'cog',
        ],
    },
];

/** All symbols of the groups, in their order. */
export const ICON_PICKS: readonly string[] = ICON_GROUPS.flatMap(g => g.icons);

/**
 * A marker's own colour while active: null when it is not "#rrggbb", else the writing that reads on it (dark on a
 * light colour, white on a dark one).
 */
export function markerInk(color: string | null | undefined): '#2a1a00' | '#fff' | null {
    if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
        return null;
    }
    const [r, g, b] = [1, 3, 5]
        .map(i => parseInt(color.slice(i, i + 2), 16) / 255)
        .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#2a1a00' : '#fff';
}

export function sensorPath(icon: string | null | undefined, st: SensorState | undefined): string | null {
    const own = icon ? bundledPath(icon) : null;
    if (own) {
        return own;
    }
    const name = sensorIcon(st);
    return name ? bundledPath(name) : null;
}
