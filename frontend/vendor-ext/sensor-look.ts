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
export function sensorPath(icon: string | null | undefined, st: SensorState | undefined): string | null {
    const own = icon ? bundledPath(icon) : null;
    if (own) {
        return own;
    }
    const name = sensorIcon(st);
    return name ? bundledPath(name) : null;
}
