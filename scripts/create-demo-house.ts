import type { Mapping, Floor, ProtocolRecord } from "../frontend/model";
import type { DemoDefinition } from "./demo-types";
import * as fs from "node:fs";
import { empty } from "../frontend/store";
const prefix = "0_userdata.0.home3d_demo_v020";
const definitions: DemoDefinition[] = [],
  mappings: Mapping[] = [];
const building = empty();
const floor: Floor = {
  id: "demo_eg",
  name: "Erdgeschoss · Demo",
  elevation: 0,
  height: 2.7,
  cut_height: 1.15,
  rooms: [],
  openings: [],
  furniture: [],
  placements: [],
  background: null,
  outdoor: [],
  walls: [],
  ha_floor: null,
};
building.floors.push(floor);
const rooms: [string, string, number, number, number, number, string][] = [
  ["living", "Wohnzimmer", 0, 0, 6, 5, "wood"],
  ["kitchen", "Küche", 6, 0, 10, 4, "tiles"],
  ["hall", "Flur", 6, 4, 10, 6, "stone"],
  ["bedroom", "Schlafzimmer", 0, 5, 6, 9, "wood"],
  ["bath", "Bad", 6, 6, 10, 9, "tiles"],
  ["office", "Arbeitszimmer", 10, 0, 14, 5, "wood"],
  ["garage", "Garage", 10, 5, 14, 9, "concrete"],
];
for (const [id, name, x, z, x2, z2, material] of rooms)
  floor.rooms.push({
    id: `demo_${id}`,
    name,
    area_id: null,
    points: [
      [x, z],
      [x2, z],
      [x2, z2],
      [x, z2],
    ],
    floor_material: material,
    wall_color: "#e7edf0",
    panel: [],
  });
function state(
  key: string,
  name: string,
  type: string,
  role: string,
  value: unknown,
  extra: Partial<DemoDefinition> = {},
) {
  const id = `${prefix}.${key}`;
  definitions.push({
    id,
    name: `Demo · ${name}`,
    type,
    role,
    def: value,
    read: true,
    write: true,
    ...extra,
  });
  return id;
}
function map(
  domain: string,
  key: string,
  name: string,
  source: string,
  attributes: Mapping["attributes"] = {},
  actions: Mapping["actions"] = {},
  extra: Partial<Mapping> = {},
) {
  const entity_id = `${domain}.npdemo_${key}`;
  mappings.push({
    entity_id,
    name: `Demo · ${name}`,
    state: source,
    attributes,
    actions,
    ...extra,
  });
  return entity_id;
}
function place(entity_id: string, x: number, z: number, y = 1.2) {
  floor.placements.push({ entity_id, x, z, y, rotation: 0, show_name: true });
}
function furniture(
  type: string,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  rotation = 0,
  entity: string | null = null,
  extra: ProtocolRecord = {},
) {
  const f = {
    id: `demo_f${floor.furniture.length + 1}`,
    type,
    x,
    z,
    w,
    d,
    h,
    rotation,
    variant: null,
    entity,
    ...extra,
  };
  floor.furniture.push(f);
  return f;
}
function onOff(id: string) {
  return {
    turn_on: [{ id, value: true }],
    turn_off: [{ id, value: false }],
    toggle: [{ id, toggle: true }],
  };
}
for (const [i, r] of rooms.entries()) {
  const [key, name, x, z, x2, z2] = r,
    source = state(
      `${key}.light`,
      `${name} Licht`,
      "boolean",
      "switch.light",
      i !== 3 && i !== 6,
    );
  const entity = map(
    "light",
    `${key}_light`,
    `${name} Licht`,
    source,
    {
      supported_color_modes: ["onoff"],
      color_mode: "onoff",
      rgb_color: i === 0 ? [255, 197, 118] : [255, 236, 205],
    },
    onOff(source),
  );
  furniture(
    "lamp_ceiling",
    (x + x2) / 2,
    (z + z2) / 2,
    0.45,
    0.45,
    0.12,
    0,
    entity,
    { mount_y: 2.56 },
  );
  floor.rooms[i].panel.push(entity);
}
for (const [key, label, temp, x, z] of [
  ["living", "Wohnzimmer", 22.3, 1, 0.4],
  ["bedroom", "Schlafzimmer", 19.7, 0.5, 5.8],
  ["bath", "Bad", 23.8, 6.5, 6.5],
] as [string, string, number, number, number][]) {
  const source = state(
    `${key}.temperature`,
    `${label} Temperatur`,
    "number",
    "value.temperature",
    temp,
    { unit: "°C", min: -10, max: 50 },
  );
  const e = map("sensor", `${key}_temperature`, `${label} Temperatur`, source, {
    device_class: "temperature",
    unit_of_measurement: "°C",
  });
  place(e, x, z);
  floor.rooms.find((r) => r.id === `demo_${key}`)!.climate = { temperature: e };
}
const motion = state(
  "hall.motion",
  "Flur Bewegung",
  "boolean",
  "sensor.motion",
  false,
);
place(
  map("binary_sensor", "hall_motion", "Flur Bewegung", motion, {
    device_class: "motion",
  }),
  8,
  4.3,
  2.2,
);
const socket = state(
  "kitchen.coffee",
  "Kaffeemaschine",
  "boolean",
  "switch",
  true,
);
const coffee = map(
  "switch",
  "coffee",
  "Kaffeemaschine",
  socket,
  {},
  onOff(socket),
);
place(coffee, 9.2, 0.6, 0.95);
const plug = state(
  "office.socket",
  "Schreibtisch Steckdose",
  "boolean",
  "switch",
  true,
);
place(
  map(
    "switch",
    "office_socket",
    "Schreibtisch Steckdose",
    plug,
    {},
    onOff(plug),
  ),
  12.4,
  0.4,
  0.5,
);
const blind = state(
  "living.blind",
  "Wohnzimmer Rollladen",
  "number",
  "level.blind",
  65,
  { unit: "%", min: 0, max: 100 },
);
const cover = map(
  "cover",
  "living_blind",
  "Wohnzimmer Rollladen",
  blind,
  {
    current_position: { id: blind },
    supported_features: 15,
    device_class: "shutter",
  },
  {
    open_cover: [{ id: blind, value: 100 }],
    close_cover: [{ id: blind, value: 0 }],
    set_cover_position: [{ id: blind, field: "position" }],
  },
  { map: { 0: "closed", 100: "open" } },
);
const target = state(
  "living.setpoint",
  "Heizung Solltemperatur",
  "number",
  "level.temperature",
  22,
  { unit: "°C", min: 5, max: 30 },
);
const mode = state("living.hvac", "Heizung Modus", "string", "text", "heat");
const heat = map(
  "climate",
  "living_heat",
  "Wohnzimmer Heizung",
  mode,
  {
    temperature: { id: target },
    current_temperature: { id: `${prefix}.living.temperature` },
    min_temp: 5,
    max_temp: 30,
    target_temp_step: 0.5,
    hvac_modes: ["off", "heat"],
    supported_features: 1,
  },
  {
    set_temperature: [{ id: target, field: "temperature" }],
    set_hvac_mode: [{ id: mode, field: "hvac_mode" }],
    turn_on: [{ id: mode, value: "heat" }],
    turn_off: [{ id: mode, value: "off" }],
  },
);
place(heat, 5.5, 2, 1.2);
const mediaState = state(
  "living.media",
  "Fernseher Wiedergabe",
  "string",
  "media.state",
  "playing",
);
const volume = state(
  "living.volume",
  "Fernseher Lautstärke",
  "number",
  "level.volume",
  0.35,
  { min: 0, max: 1 },
);
const tv = map(
  "media_player",
  "living_tv",
  "Wohnzimmer Fernseher",
  mediaState,
  {
    media_title: "Demo · Zuhause",
    volume_level: { id: volume },
    supported_features: 15421,
  },
  {
    media_play: [{ id: mediaState, value: "playing" }],
    media_pause: [{ id: mediaState, value: "paused" }],
    media_play_pause: [{ id: mediaState, value: "paused" }],
    media_stop: [{ id: mediaState, value: "idle" }],
    turn_on: [{ id: mediaState, value: "idle" }],
    turn_off: [{ id: mediaState, value: "off" }],
    volume_set: [{ id: volume, field: "volume_level" }],
  },
);
furniture("sofa", 2.8, 3.7, 2.7, 0.95, 0.9, 180);
furniture("rug", 2.8, 2.7, 3, 2, 0.02);
furniture("coffee_table", 2.8, 2.6, 1.2, 0.65, 0.42);
furniture("tv_board", 2.7, 0.45, 2.1, 0.42, 0.5);
furniture("tv", 2.7, 0.5, 1.4, 0.12, 0.85, 0, tv, { mount_y: 0.5 });
furniture("plant", 0.55, 0.6, 0.5, 0.5, 1.2);
furniture("armchair", 0.8, 2, 0.85, 0.85, 0.9, 270);
furniture("fridge", 6.5, 0.5, 0.75, 0.7, 1.85);
furniture("kitchen", 7.5, 0.45, 1.2, 0.65, 0.92);
furniture("sink", 8.6, 0.45, 0.85, 0.65, 0.92);
furniture("stove", 9.5, 0.45, 0.7, 0.65, 0.92);
furniture("table", 8, 2.7, 1.5, 0.9, 0.76);
furniture("chair", 7.4, 3.5, 0.45, 0.5, 0.9, 180);
furniture("chair", 8.5, 3.5, 0.45, 0.5, 0.9, 180);
furniture("bed", 2.6, 6.8, 1.8, 2.1, 0.85);
furniture("wardrobe", 0.55, 7.1, 0.6, 2, 2.2, 270);
furniture("nightstand", 1.3, 6.1, 0.45, 0.45, 0.5);
furniture("nightstand", 3.9, 6.1, 0.45, 0.45, 0.5);
furniture("bathtub", 8.7, 8.3, 1.75, 0.8, 0.6);
furniture("washbasin", 7.1, 6.4, 0.85, 0.5, 0.85);
furniture("wc", 9.4, 6.5, 0.45, 0.65, 0.8);
furniture("desk", 12, 0.6, 1.8, 0.75, 0.76);
furniture("office_chair", 12, 1.6, 0.6, 0.6, 1.1, 180);
furniture("shelf", 13.6, 2.5, 0.35, 1.5, 1.9, 90);
furniture("coat_rack", 6.4, 5, 0.4, 1.1, 1.8, 270);
furniture("car", 12, 7, 1.7, 3.3, 1.5);
function opening(
  room: string,
  edge: number,
  offset: number,
  width: number,
  type = "window",
  entity: string | null = null,
) {
  const o = {
    id: `demo_o${floor.openings.length + 1}`,
    room_id: `demo_${room}`,
    edge,
    offset,
    width,
    type,
    sill: type === "window" ? 0.85 : 0,
    height: type === "window" ? 1.4 : 2.1,
    hinge: "left",
    leaves: 1,
    swing: "in",
    contact2: null,
    cover: entity,
    contact: null,
    tilt: null,
    shut: true,
  };
  floor.openings.push(o);
  return o;
}
opening("living", 0, 3, 2.8, "window", cover);
opening("living", 3, 2.5, 2);
opening("kitchen", 0, 2, 1.8);
opening("office", 0, 2, 1.8);
opening("office", 1, 2.5, 1.8);
opening("bedroom", 2, 3, 2.5);
opening("bath", 2, 2, 0.9);
opening("garage", 1, 2, 2.8, "garage");
opening("living", 1, 4.3, 0.95, "door");
opening("kitchen", 2, 2, 0.9, "door");
opening("bedroom", 1, 3.2, 0.9, "door");
opening("bath", 0, 2, 0.85, "door");
opening("office", 3, 0.6, 0.9, "door");
opening("garage", 3, 3.5, 0.9, "door");
building.settings.north = 20;
const result = {
  planId: "iobroker_demo_v020",
  name: "Demo-Haus · ioBroker",
  building,
  mappings,
  definitions,
  prefix,
};
fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(
  "artifacts/demo-house-0.2.0.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
