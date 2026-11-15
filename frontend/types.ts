import type {
  ProtocolMessage,
  ProtocolRecord,
  Mapping,
  BackendEvent,
} from "../src/lib/types.js";
export type CallWS = (message: ProtocolMessage) => Promise<any>;
export interface Hass extends ProtocolRecord {
  states: Record<string, { state: string; attributes: ProtocolRecord }>;
  entities: Record<string, { area_id?: string }>;
  areas: Record<string, { name: string }>;
  revisions: Record<string, number>;
  plans: unknown;
  seq: number;
  events: BackendEvent[];
}
export interface PickerDetail {
  options: { id: string; label: string }[];
  fixed?: { id: string; label: string }[];
  value: string | null;
  choose: (value: string) => void;
}
declare global {
  interface WindowEventMap {
    "iobroker-pick": CustomEvent<PickerDetail>;
  }
}
export interface DeviceDialogOptions {
  callWS: CallWS;
  refresh: () => Promise<void>;
  getHass: () => Hass | undefined;
}
export type { Mapping, ProtocolRecord, ProtocolMessage };
