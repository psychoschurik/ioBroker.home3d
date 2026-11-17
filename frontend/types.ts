import type { Connection } from '@iobroker/socket-client';
import type { ProtocolMessage, ProtocolRecord, Mapping, StateObject, StateValue } from './model.js';
export type CallWS = (message: ProtocolMessage) => Promise<any>;
export interface Hass extends ProtocolRecord {
    states: Record<string, { state: string; attributes: ProtocolRecord }>;
    entities: Record<string, { area_id?: string | null }>;
    areas: Record<string, { name: string }>;
}
export interface PickerDetail {
    options: { id: string; label: string }[];
    fixed?: { id: string; label: string }[];
    value: string | null;
    choose: (value: string) => void;
}
declare global {
    interface WindowEventMap {
        'iobroker-pick': CustomEvent<PickerDetail>;
    }
}
export interface DeviceDialogOptions {
    callWS: CallWS;
    refresh: () => Promise<void>;
    getHass: () => Hass | undefined;
    /** Current values of the given datapoints; only for the rows that are shown. */
    getStates: (ids: string[]) => Promise<Record<string, StateValue>>;
    /** Forget cached objects, so that the object tree is read again. */
    reload: () => void;
    /** The socket connection, for the dialogs of `@iobroker/gui-components`. */
    socket: Connection;
    getLanguage: () => string;
    /** Another datapoint for a device, chosen in the object browser (null: cancelled). */
    pickDatapoint: (m: Mapping) => Promise<Mapping | null>;
}
export type { Mapping, ProtocolRecord, ProtocolMessage, StateObject, StateValue };
