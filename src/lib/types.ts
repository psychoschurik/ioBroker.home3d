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
}
export interface ActionRule extends Binding {
  id: string;
  field?: string;
  value?: unknown;
  toggle?: boolean;
  optional?: boolean;
}
export interface Mapping extends Binding {
  entity_id: string;
  state: string;
  name?: string;
  area_id?: string;
  attributes?: Record<string, any>;
  actions?: Record<string, ActionRule[]>;
  _meta?: {
    role: string;
    type?: string;
    read: boolean;
    write: boolean;
    value: unknown;
  };
}
export interface IoAccess {
  objects(): Promise<Record<string, StateObject>>;
  rooms(): Promise<Record<string, RoomObject>>;
  states(): Promise<Record<string, StateValue>>;
  getObject(id: string): Promise<StateObject | null | undefined>;
  getState(id: string): Promise<StateValue | null | undefined>;
  setState(id: string, value: any): Promise<unknown>;
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
  snapshots: Snapshot[];
  deleted_at?: number;
}
export interface StorageData {
  plans: Record<string, Plan>;
  images: Record<string, string>;
  mappings: Mapping[];
  locate_plan: string;
}
export interface ProtocolMessage extends ProtocolRecord {
  type: string;
  plan?: string;
}
export interface BackendEvent {
  seq: number;
  type: string;
  payload: unknown;
}
