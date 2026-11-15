import type {
  Building,
  Plan,
  StorageData,
  IoAccess,
  ProtocolMessage,
  ProtocolRecord,
  BackendEvent,
} from "./types.js";
import { randomUUID } from "node:crypto";
import {
  entities,
  validateMappings,
  discover,
  execute,
  nameOf,
} from "./entities.js";
const adapterVersion: string = require("../../package.json").version;
const empty = (): Building => ({
  version: 1,
  floors: [],
  settings: {
    wall_exterior: 0.24,
    wall_interior: 0.12,
    grid: 0.05,
    north: 0,
    roof: { type: "none", pitch: 35, overhang: 0.4 },
  },
  energy: {},
  presence: [],
});
const plan = (
  building: Building = empty(),
  name: string | null = null,
): Plan => ({
  id: randomUUID(),
  name,
  icon: null,
  site: null,
  created: Date.now() / 1000,
  revision: 0,
  building,
  snapshots: [],
});
function error(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}
function checkBuilding(b: ProtocolRecord): Building {
  if (
    !b ||
    b.version !== 1 ||
    !Array.isArray(b.floors) ||
    !b.settings ||
    !Array.isArray(b.presence)
  )
    error("invalid_building", "Ungültiger 3D Home-Grundriss.");
  for (const f of b.floors)
    if (
      !f ||
      typeof f.id !== "string" ||
      !Array.isArray(f.rooms) ||
      !Array.isArray(f.furniture)
    )
      error("invalid_building", "Ungültiges Stockwerk.");
  return structuredClone(b) as Building;
}
class Backend {
  io: IoAccess;
  data: StorageData;
  persist: (data: StorageData) => Promise<unknown>;
  language: string;
  tail: Promise<unknown>;
  events: BackendEvent[];
  sequence: number;

  constructor(
    io: IoAccess,
    data: StorageData | null | undefined,
    persist: (data: StorageData) => Promise<unknown>,
    language = "de",
  ) {
    this.io = io;
    this.data = data || {
      plans: { main: { ...plan(), id: "main" } },
      images: {},
      mappings: [],
      locate_plan: "main",
    };
    this.persist = persist;
    this.language = language;
    this.tail = Promise.resolve();
    this.events = [];
    this.sequence = 0;
  }
  event(type: string, payload: unknown) {
    this.events.push({ seq: ++this.sequence, type, payload });
    if (this.events.length > 200) this.events.shift();
  }
  list() {
    const entries = Object.values(this.data.plans).map((p) => ({
      ...(({ building, snapshots, ...metadata }) => metadata)(p),
      floors: p.building.floors.length,
      rooms: p.building.floors.reduce((n, f) => n + f.rooms.length, 0),
      furniture: p.building.floors.reduce((n, f) => n + f.furniture.length, 0),
    }));
    return {
      plans: entries.filter((p) => !p.deleted_at),
      trash: entries.filter((p) => p.deleted_at),
      locate_plan: this.data.locate_plan,
    };
  }
  async bootstrap() {
    const objects = await this.io.objects(),
      states = await this.io.states(),
      rooms = await this.io.rooms();
    return {
      language: this.language,
      user: { is_admin: true, name: "ioBroker" },
      states: entities(this.data.mappings, states, objects),
      areas: Object.fromEntries(
        Object.values(rooms).map((r) => [
          r._id,
          { area_id: r._id, name: nameOf(r) },
        ]),
      ),
      floors: {},
      devices: {},
      entities: Object.fromEntries(
        this.data.mappings.map((m) => [
          m.entity_id,
          { entity_id: m.entity_id, area_id: m.area_id || null, name: m.name },
        ]),
      ),
      config: {
        unit_system: { temperature: "°C", length: "m" },
        time_zone: "Europe/Berlin",
      },
      revisions: Object.fromEntries(
        Object.values(this.data.plans).map((p) => [p.id, p.revision]),
      ),
      plans: this.list(),
      seq: this.sequence,
      events: this.events,
    };
  }
  async call(m: ProtocolMessage): Promise<any> {
    // Serializes saves, revision checks and physical commands; failed persistence rolls back memory.
    const task = this.tail.then(async () => {
      const before = structuredClone(this.data),
        seq = this.sequence,
        events = [...this.events];
      try {
        return await this.handle(m);
      } catch (e) {
        this.data = before;
        this.sequence = seq;
        this.events = events;
        throw e;
      }
    });
    this.tail = task.catch(() => {});
    return task;
  }
  async handle(m: ProtocolMessage): Promise<any> {
    if (!m || typeof m.type !== "string") error("bad_request", "type fehlt.");
    const type = m.type.replace(/^home3d\//, ""),
      id = m.plan || "main";
    const p = Object.hasOwn(this.data.plans, id)
      ? this.data.plans[id]
      : undefined;
    const save = async <T>(result: T): Promise<T> => {
      await this.persist(this.data);
      return result;
    };
    const changed = () => {
      if (!p) error("not_found", "Grundriss fehlt.");
      p.revision++;
      this.event("home3d/building/subscribe", {
        plan: id,
        revision: p.revision,
      });
    };
    const plansChanged = () =>
      this.event("home3d/plans/subscribe", this.list());
    switch (type) {
      case "iobroker/mappings/get":
        return this.data.mappings;
      case "iobroker/discover":
        return discover(
          await this.io.objects(),
          await this.io.rooms(),
          await this.io.states(),
        );
      case "iobroker/mappings/set":
        this.data.mappings = validateMappings(
          m.mappings,
          await this.io.objects(),
        );
        return save({ saved: this.data.mappings.length });
      case "iobroker/service":
        return execute(
          this.data.mappings,
          m.domain,
          m.service,
          m.data || {},
          this.io,
        );
      case "building/get":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        return {
          building: p.building,
          revision: p.revision,
          plan: id,
          version: adapterVersion,
        };
      case "building/save":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        if (m.base_revision !== undefined && m.base_revision !== p.revision)
          error(
            "stale_plan",
            "Inzwischen anderswo gespeichert. Bitte neu laden.",
          );
        p.building = checkBuilding(m.building);
        changed();
        return save({ revision: p.revision });
      case "plans/list":
        return this.list();
      case "plans/create": {
        if (m.copy_of && !Object.hasOwn(this.data.plans, m.copy_of))
          error("not_found", "Kopiervorlage fehlt.");
        const n = plan(
          checkBuilding(
            m.building ||
              (m.copy_of ? this.data.plans[m.copy_of].building : empty()),
          ),
          String(m.name || "Neuer Grundriss"),
        );
        n.icon = m.icon || null;
        this.data.plans[n.id] = n;
        plansChanged();
        return save({ plan: n.id });
      }
      case "plans/update":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        for (const k of ["name", "icon", "site"] as const)
          if (Object.hasOwn(m, k)) p[k] = m[k];
        plansChanged();
        return save({});
      case "plans/delete":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        if (id === "main")
          error("main_plan", "Der Hauptgrundriss bleibt erhalten.");
        p.deleted_at = Date.now() / 1000;
        plansChanged();
        return save({});
      case "plans/restore":
        if (!p) error("not_found", "Grundriss fehlt.");
        delete p.deleted_at;
        plansChanged();
        return save({});
      case "plans/order": {
        if (
          !Array.isArray(m.plans) ||
          m.plans.some((k) => !Object.hasOwn(this.data.plans, k))
        )
          error("bad_request", "Ungültige Reihenfolge.");
        this.data.plans = Object.fromEntries(
          [...new Set([...m.plans, ...Object.keys(this.data.plans)])].map(
            (k) => [k, this.data.plans[k]],
          ),
        );
        plansChanged();
        return save({});
      }
      case "plans/locate":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        this.data.locate_plan = id;
        return save({});
      case "image/set":
        if (
          typeof m.image_id !== "string" ||
          ["__proto__", "constructor", "prototype"].includes(m.image_id) ||
          typeof m.data !== "string" ||
          !/^data:image\/(png|jpeg|webp|gif);base64,/.test(m.data)
        )
          error("invalid_image", "Nur PNG, JPEG, WebP oder GIF als Data-URL.");
        this.data.images[m.image_id] = m.data;
        return save({});
      case "image/get":
        if (!Object.hasOwn(this.data.images, m.image_id))
          error("not_found", "Bild fehlt.");
        return { data: this.data.images[m.image_id] };
      case "history/list":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        return { snapshots: p.snapshots.map(({ building, ...s }) => s) };
      case "history/snapshot":
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        p.snapshots.unshift({
          id: randomUUID(),
          revision: p.revision,
          saved_at: Date.now() / 1000,
          floors: p.building.floors.length,
          rooms: p.building.floors.reduce((n, f) => n + f.rooms.length, 0),
          furniture: p.building.floors.reduce(
            (n, f) => n + f.furniture.length,
            0,
          ),
          building: structuredClone(p.building),
        });
        p.snapshots = p.snapshots.slice(0, 30);
        return save({});
      case "history/restore": {
        if (!p || p.deleted_at)
          error("not_found", "Grundriss nicht vorhanden.");
        const s = p.snapshots.find((s) => s.id === m.snapshot_id);
        if (!s) error("not_found", "Wiederherstellungspunkt fehlt.");
        p.building = structuredClone(s.building);
        changed();
        return save({ revision: p.revision });
      }
      case "backup/export":
        return {
          format: "home3d-backup",
          version: 2,
          building: this.data.plans.main.building,
          main: {
            name: this.data.plans.main.name,
            icon: this.data.plans.main.icon,
            site: this.data.plans.main.site,
          },
          plans: Object.values(this.data.plans)
            .filter((p) => p.id !== "main" && !p.deleted_at)
            .map(({ snapshots, ...p }) => p),
          packs: [],
          images: this.data.images,
        };
      case "backup/import": {
        const main = this.data.plans.main;
        main.building = checkBuilding(m.building);
        main.revision++;
        if (m.main)
          for (const k of ["name", "icon", "site"] as const)
            main[k] = m.main[k] ?? null;
        if (m.plans) {
          const next: Record<string, Plan> = { main };
          for (const entry of m.plans) {
            if (
              !entry.id ||
              ["main", "__proto__", "constructor", "prototype"].includes(
                entry.id,
              ) ||
              Object.hasOwn(next, entry.id)
            )
              error("invalid_backup", "Ungültige Grundriss-ID.");
            next[entry.id] = {
              ...plan(checkBuilding(entry.building), entry.name),
              id: entry.id,
              icon: entry.icon || null,
              site: entry.site || null,
            };
          }
          this.data.plans = next;
        }
        plansChanged();
        this.event("home3d/building/subscribe", {
          plan: "main",
          revision: main.revision,
        });
        return save({
          revision: main.revision,
          building: main.building,
          packs: 0,
          skipped: (m.packs || []).map((p: { id: string }) => ({
            id: p.id,
            reason:
              "Shop-Pakete werden von dieser Portierung noch nicht unterstützt.",
          })),
        });
      }
      case "packs/list":
        return { packs: [] };
      case "license/get":
        return {
          instance: "iobroker",
          active: false,
          key_hint: null,
          licensee: null,
          checked_at: null,
          error: null,
          shop_url: "/help.html",
          packs: [],
          offers: [],
        };
      case "diagnostics/get":
      case "diagnostics/delete":
      case "diagnostics/set":
        return {
          enabled: false,
          last_daily: null,
          can_delete: false,
          preview: {},
          endpoint: "",
        };
      case "diagnostics/client":
        return {};
      case "voice/settings":
        return { sentences: "off" };
      case "config/area_registry/list":
        return Object.values((await this.bootstrap()).areas);
      case "config/entity_registry/list":
        return Object.values((await this.bootstrap()).entities);
      case "config/device_registry/list":
      case "config/floor_registry/list":
        return [];
      case "energy/get_prefs":
        return { energy_sources: [], device_consumption: [] };
      case "assist_pipeline/pipeline/list":
        return { pipelines: [], preferred_pipeline: null };
      default:
        error(
          "not_supported",
          `Noch nicht für ioBroker implementiert: ${m.type}`,
        );
    }
  }
}
export { Backend, empty, checkBuilding };
