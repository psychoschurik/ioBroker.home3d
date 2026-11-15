import type { IoAccess, StateValue } from "../src/lib/types.js";
import type { DemoHouse } from "./demo-types.js";
import { Backend } from "../src/lib/backend.js";
import { createServer } from "../src/lib/server.js";
const demo: DemoHouse = require("../artifacts/demo-house-0.2.0.json");
const objects = Object.fromEntries(
  demo.definitions.map(({ id, def, ...common }) => [
    id,
    { _id: id, type: "state", common },
  ]),
);
const states: Record<string, StateValue> = Object.fromEntries(
  demo.definitions.map((d) => [d.id, { val: d.def, ts: Date.now() }]),
);
const data = {
  plans: {
    main: {
      id: "main",
      name: demo.name,
      icon: null,
      site: null,
      created: Date.now() / 1000,
      revision: 1,
      building: demo.building,
      snapshots: [],
    },
  },
  images: {},
  mappings: demo.mappings,
  locate_plan: "main",
};
const io: IoAccess = {
  objects: async () => objects,
  states: async () => states,
  rooms: async () => ({}),
  getObject: async (id) => objects[id],
  getState: async (id) => states[id],
  setState: async (id, val) => {
    states[id] = { val, ts: Date.now() };
  },
};
createServer(
  new Backend(io, data, async () => {}),
  "home3d-demo-local",
).listen(8098, "127.0.0.1", () =>
  console.log("House preview: http://127.0.0.1:8098"),
);
