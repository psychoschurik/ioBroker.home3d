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
        unit?: string;
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
     */
    convert?: 'rgb_hex' | 'rgbw_hex' | 'wmo';
}
export interface ActionRule extends Binding {
    id: string;
    field?: string;
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
    plans: Record<string, Plan>;
    /** image ID → file name below `images/` */
    images: Record<string, string>;
    mappings: Mapping[];
    locate_plan: string;
    /** A datapoint with the position (GPS, e.g. on a boat) instead of the one of the system settings. */
    position_id?: string | null;
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
