import type {
  IoAccess,
  StateObject,
  StateValue,
  RoomObject,
} from "../src/lib/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Backend, empty } from "../src/lib/backend.js";
import { createServer } from "../src/lib/server.js";
async function main() {
  const dir = path.resolve(__dirname, "../.demo-data");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "data.json");
  let stored;
  try {
    stored = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const objects: Record<string, StateObject> = {
    "demo.light": {
      _id: "demo.light",
      type: "state",
      common: {
        name: "Wohnzimmer Licht",
        type: "boolean",
        role: "switch.light",
        read: true,
        write: true,
      },
    },
    "demo.temperature": {
      _id: "demo.temperature",
      type: "state",
      common: {
        name: "Wohnzimmer Temperatur",
        type: "number",
        role: "value.temperature",
        unit: "°C",
        read: true,
        write: false,
      },
    },
  };
  const states: Record<string, StateValue> = {
    "demo.light": { val: true, ts: Date.now() },
    "demo.temperature": { val: 21.6, ts: Date.now() },
  };
  const rooms: Record<string, RoomObject> = {
    "enum.rooms.living": {
      _id: "enum.rooms.living",
      common: {
        name: "Wohnzimmer",
        members: ["demo.light", "demo.temperature"],
      },
    },
  };
  const io: IoAccess = {
    objects: async () => objects,
    rooms: async () => rooms,
    states: async () => states,
    getObject: async (id) => objects[id],
    getState: async (id) => states[id],
    setState: async (id, val) => {
      states[id] = { val, ts: Date.now() };
    },
  };
  const backend = new Backend(io, stored, async (data) => {
    await fs.writeFile(file + ".tmp", JSON.stringify(data));
    await fs.rename(file + ".tmp", file);
  });
  if (!stored) {
    const building = empty();
    building.floors = [
      {
        id: "eg",
        name: "Erdgeschoss",
        elevation: 0,
        height: 2.6,
        cut_height: 1.2,
        rooms: [
          {
            id: "living",
            name: "Wohnzimmer",
            area_id: "enum.rooms.living",
            points: [
              [0, 0],
              [6, 0],
              [6, 4],
              [0, 4],
            ],
            floor_material: "wood",
          },
          {
            id: "kitchen",
            name: "Küche",
            area_id: null,
            points: [
              [6, 0],
              [10, 0],
              [10, 4],
              [6, 4],
            ],
            floor_material: "tiles",
          },
        ],
        openings: [],
        furniture: [],
        placements: [],
        background: null,
        outdoor: [],
        walls: [],
        ha_floor: null,
      },
    ];
    await backend.call({ type: "home3d/building/save", building });
    await backend.call({
      type: "iobroker/mappings/set",
      mappings: await backend.call({ type: "iobroker/discover" }),
    });
  }
  const token = process.env.HOME3D_DEMO_TOKEN || "home3d-demo-local";
  const server = createServer(backend, token);
  server.listen(8097, "127.0.0.1", () =>
    console.log("Local demo: http://127.0.0.1:8097 (simulated devices only)"),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
