import type { Building, Mapping } from "../frontend/model";
export interface DemoDefinition {
  id: string;
  name: string;
  type: string;
  role: string;
  def: unknown;
  read: boolean;
  write: boolean;
  unit?: string;
  min?: number;
  max?: number;
}
export interface DemoHouse {
  planId: string;
  name: string;
  building: Building;
  mappings: Mapping[];
  definitions: DemoDefinition[];
  prefix: string;
}
