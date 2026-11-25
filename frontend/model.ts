/** JSON-compatible protocol payloads retain unknown upstream model fields. */
export type ProtocolRecord = Record<string, any>;
export interface StateValue {
    val: unknown;
    ts?: number;
    lc?: number;
    q?: number;
}
export interface StateObject {
    _id?: string;
    type: string;
    common: {
        name?: string | Record<string, string>;
        type?: string;
        role?: string;
        read?: boolean;
        write?: boolean;
        min?: number;
        max?: number;
        step?: number;
        unit?: string;
        /** The texts of its values (e.g. 0: "pause", 1: "play"). */
        states?: Record<string, string> | string | string[];
    };
}
export interface RoomObject {
    _id: string;
    common: { name?: string | Record<string, string>; members?: string[] };
}
export interface Binding {
    id?: string;
    map?: Record<string, unknown>;
    scale?: number;
    offset?: number;
    /**
     * Colour as text in ioBroker: `rgb_hex` "#rrggbb", `rgbw_hex` "#rrggbbww" (the white channel is written as 00).
     * Read it becomes [r, g, b], written an [r, g, b] becomes the text again. `wmo`: a weather code of the WMO (as the
     * weather adapters give it, e.g. open-meteo) becomes the weather condition of the 3D frontend (read only).
     * `mired`: a colour temperature in mired (153 … 500) is read and written as Kelvin. `on_off` (read only): a number,
     * a colour or a text as on or off: a dimmer without a switch is on above 0, a colour unless it is black (for a
     * cover: open or closed).
     */
    convert?: 'rgb_hex' | 'rgbw_hex' | 'wmo' | 'mired' | 'on_off';
}
/**
 * One write of an action: the value of the call's `field` (the element `index` of a list: the red of an RGB colour),
 * else `value` (with a field: what it writes when the call does not give it), or the opposite of the current value
 * (`toggle`; a number between its min and max). `optional`: skipped when the call does not give the field, or when the
 * `map` does not know its value (a TV's source: an app goes to the app, an input to the input).
 */
export interface ActionRule extends Binding {
    id: string;
    field?: string;
    index?: number;
    value?: unknown;
    toggle?: boolean;
    optional?: boolean;
}
/**
 * The state counts only while another datapoint has one of the values; otherwise the device shows `else` (default
 * "off"). E.g. a washing machine and a dishwasher on one plug: the dishwasher runs only while the running machine is
 * "dishwasher".
 */
export interface Condition {
    id: string;
    values: unknown[];
    else?: string;
}
export interface Mapping extends Binding {
    entity_id: string;
    state: string;
    when?: Condition;
    /**
     * When the device counts as unreachable ("Technik"): as the device reports, after this many minutes without an
     * update (a battery device that sleeps between its reports), or never (a 12 V device switched off with the boat).
     * Missing: as set for the house (`health_stale_min`). Counts for the whole device, also its other datapoints.
     */
    reach?: 'report' | 'never' | number;
    /**
     * Checked only while its adapter is connected: a lost connection is normal for it (NMEA instruments switched off
     * with the boat), its values are not stale then. A stopped adapter still counts. Also for the whole device.
     */
    reach_connected?: boolean;
    /**
     * The battery of its device in "Technik": a datapoint (a number: the charge in %, true/false: low battery) or
     * `none` (no battery, e.g. on the on-board supply); missing: found by the type-detector or by name and role.
     * Set at one datapoint, it counts for the whole device.
     */
    battery?: string;
    /**
     * The datapoints a device of several was built from, by part (a light: switch, brightness, rgb, color_temp …; see
     * frontend/device-kinds.ts): the editor's device form shows them, each can be chosen by hand, and the mapping is
     * built from them anew. Missing: found from the mapping's datapoints by their roles.
     */
    parts?: Record<string, string>;
    name?: string;
    area_id?: string;
    attributes?: Record<string, any>;
    actions?: Record<string, ActionRule[]>;
    _meta?: {
        role: string;
        type?: string;
        read: boolean;
        write: boolean;
        secret?: boolean;
        value: unknown;
        /** Where the device tree shows it (a media player: below its device), missing: at its state. */
        path?: string;
    };
}
/** ioBroker access of the browser. Everything is loaded on demand, never all states at once. */
export interface IoAccess {
    /** Objects of the given IDs (missing IDs are left out). */
    getObjects(ids: string[]): Promise<Record<string, StateObject>>;
    /** All state objects. Only for the device dialog, when it is opened. */
    stateObjects(): Promise<Record<string, StateObject>>;
    rooms(): Promise<Record<string, RoomObject>>;
    getState(id: string): Promise<StateValue | null | undefined>;
    setState(id: string, value: any): Promise<unknown>;
}
/** Files of the instance (`home3d.0`) in the file storage of ioBroker. */
export interface FileAccess {
    readText(name: string): Promise<string | null>;
    writeText(name: string, text: string): Promise<void>;
    readDataUrl(name: string): Promise<string | null>;
    writeBinary(name: string, bytes: Uint8Array): Promise<void>;
    remove(name: string): Promise<void>;
}
export interface Building extends ProtocolRecord {
    version: number;
    floors: Floor[];
    settings: ProtocolRecord;
    presence: unknown[];
}
export interface Floor extends ProtocolRecord {
    id: string;
    rooms: ProtocolRecord[];
    furniture: ProtocolRecord[];
}
export interface Snapshot {
    id: string;
    revision: number;
    saved_at: number;
    floors: number;
    rooms: number;
    furniture: number;
    building: Building;
}
export interface Plan {
    id: string;
    name: string | null;
    icon: string | null;
    site: unknown;
    created: number;
    revision: number;
    building: Building;
    deleted_at?: number;
}
/** Content of `data.json`. Snapshots are in `history/<plan>.json`, images in `images/`. */
export interface StorageData {
    version: 2;
    /** The project's name (null: none of its own; the default project then shows as "Standardprojekt"). */
    name?: string | null;
    plans: Record<string, Plan>;
    /** image ID → file name below `images/` */
    images: Record<string, string>;
    mappings: Mapping[];
    locate_plan: string;
    /** A datapoint with the position (GPS, e.g. on a boat) instead of the one of the system settings. */
    position_id?: string | null;
    /** The history instance the time travel prefers for the datapoints it records (e.g. `recorder.0`); null: automatic. */
    timetravel_instance?: string | null;
    /**
     * A device counts as unreachable after this many minutes without an update of its datapoints, instead of by its
     * UNREACH/online datapoints (sensors that send only every few minutes look offline in between); null: as reported.
     */
    health_stale_min?: number | null;
    /** Own 3D objects: model ID → its file below `models/` and what it is (missing: none uploaded yet). */
    models?: Record<string, ModelEntry>;
}
/** A model file of an own 3D object (furniture type `model3d`, its field `model` names the ID). */
export interface ModelEntry {
    file: string;
    name: string;
    ext: 'glb' | 'gltf' | 'obj' | 'stl';
    bytes: number;
    tris: number;
    /** Its natural width (x), depth (z) and height (y) in metres. */
    size: [number, number, number];
}
/** Format of 0.4.0, which kept everything (also the images as data URLs) in the state `home3d.0.storage`. */
export interface LegacyStorageData {
    plans: Record<string, Plan & { snapshots?: Snapshot[] }>;
    images?: Record<string, string>;
    mappings?: Mapping[];
    locate_plan?: string;
}
export interface ProtocolMessage extends ProtocolRecord {
    type: string;
    plan?: string;
}
