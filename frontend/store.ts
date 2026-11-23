// Plans, history, images and device mappings of 3D Home, kept as files of the instance in the file storage of
// ioBroker (`home3d.0`). Runs in the browser; the web adapter only transports the socket commands.
import type {
    Building,
    Plan,
    Snapshot,
    StorageData,
    LegacyStorageData,
    IoAccess,
    FileAccess,
    Mapping,
    ModelEntry,
    ProtocolMessage,
    ProtocolRecord,
} from './model.js';
import { validateMappings, discover, execute, nameOf, hash } from './entities.js';
import { mediaBases, mediaCandidates } from './media.js';
import { lightBases, lightCandidates } from './device-kinds.js';
import {
    freeEntityId,
    plainMapping,
    projectFile,
    readModels,
    readProject,
    renamed,
    strings,
    usedBy,
    type ProjectModel,
} from './project.js';
import { t } from './lang.js';
import { MODEL_EXTS, MODEL_MAX_BYTES, modelSize, type ModelInfo } from './vendor-ext/model-files.js';

declare const __HOME3D_VERSION__: string | undefined;
const version = typeof __HOME3D_VERSION__ === 'string' ? __HOME3D_VERSION__ : 'dev';

export const DATA_FILE = 'data.json';
/** An adapter instance such as `recorder.0`. */
const INSTANCE = /^[a-z0-9][a-z0-9_-]*\.\d+$/;
/** Minutes without an update after which a device counts as unreachable (1 min … 1 week); null: not set or invalid. */
export function staleMinutes(v: unknown): number | null {
    const n = typeof v === 'string' && v.trim() ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 10080 ? Math.round(n) : null;
}
const MUTATING = new Set([
    'iobroker/mappings/set',
    'iobroker/position/set',
    'iobroker/timetravel/set',
    'iobroker/health/set',
    'building/save',
    'plans/create',
    'plans/update',
    'plans/delete',
    'plans/restore',
    'plans/order',
    'plans/locate',
    'image/set',
    'history/snapshot',
    'history/restore',
    'backup/import',
    'project/import',
    'model/set',
    'model/prune',
]);
const IMAGE_TYPES: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

/** UUID without `crypto.randomUUID`, which browsers offer only on https or localhost. */
export function uuid(): string {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** A file name for any ID: safe IDs stay readable, others become hex. */
export function fileKey(id: string): string {
    return /^[A-Za-z0-9_-]{1,80}$/.test(id)
        ? id
        : `x${[...new TextEncoder().encode(id)]
              .map(x => x.toString(16).padStart(2, '0'))
              .join('')
              .slice(0, 160)}`;
}
function base64ToBytes(base64: string): Uint8Array {
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}
export const empty = (): Building => ({
    version: 1,
    floors: [],
    settings: {
        wall_exterior: 0.24,
        wall_interior: 0.12,
        grid: 0.05,
        north: 0,
        roof: { type: 'none', pitch: 35, overhang: 0.4 },
    },
    energy: {},
    presence: [],
});
const plan = (building: Building = empty(), name: string | null = null): Plan => ({
    id: uuid(),
    name,
    icon: null,
    site: null,
    created: Date.now() / 1000,
    revision: 0,
    building,
});
const initial = (): StorageData => ({
    version: 2,
    plans: { main: { ...plan(), id: 'main' } },
    images: {},
    mappings: [],
    locate_plan: 'main',
});
function error(code: string, message: string): never {
    throw Object.assign(new Error(message), { code });
}
export function checkBuilding(b: ProtocolRecord): Building {
    if (!b || b.version !== 1 || !Array.isArray(b.floors) || !b.settings || !Array.isArray(b.presence)) {
        error('invalid_building', t('bad_plan'));
    }
    for (const f of b.floors) {
        if (!f || typeof f.id !== 'string' || !Array.isArray(f.rooms) || !Array.isArray(f.furniture)) {
            error('invalid_building', t('bad_floor'));
        }
    }
    return structuredClone(b) as Building;
}
/** All datapoints a mapping reads or writes. */
export function mappedIds(mappings: Mapping[]): string[] {
    const ids = new Set<string>();
    for (const m of mappings) {
        if (m.state) {
            ids.add(m.state);
        }
        if (typeof m.when?.id === 'string') {
            ids.add(m.when.id);
        }
        for (const value of Object.values(m.attributes || {})) {
            // a list of bindings: the red, green and blue of a light
            for (const b of Array.isArray(value) ? value : [value]) {
                if (b && typeof b === 'object' && typeof b.id === 'string') {
                    ids.add(b.id);
                }
            }
        }
        for (const rules of Object.values(m.actions || {})) {
            for (const r of Array.isArray(rules) ? rules : []) {
                if (typeof r?.id === 'string') {
                    ids.add(r.id);
                }
            }
        }
    }
    return [...ids];
}

/** A plan without its building, as the plan list shows it */
export type PlanInfo = Omit<Plan, 'building'> & { floors: number; rooms: number; furniture: number };
export interface PlanList {
    plans: PlanInfo[];
    trash: PlanInfo[];
    locate_plan: string;
}
export type StoreListener = (type: string, payload: unknown) => void;

export class Store {
    io: IoAccess;
    files: FileAccess;
    data: StorageData = initial();
    /** The user may not write the files of the project: every change is refused, nothing is written. */
    readOnly = false;
    private legacy?: () => Promise<string | null | undefined>;
    private tail: Promise<unknown> = Promise.resolve();
    private listeners = new Set<StoreListener>();
    private pending: [string, unknown][] | null = null;

    /** `legacy` reads the content of the state `3d-home.0.storage` of 0.4.0 once, for the migration. */
    constructor(io: IoAccess, files: FileAccess, legacy?: () => Promise<string | null | undefined>) {
        this.io = io;
        this.files = files;
        this.legacy = legacy;
    }
    onEvent(fn: StoreListener): () => void {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }
    private emit(type: string, payload: unknown): void {
        if (this.pending) {
            this.pending.push([type, payload]);
        } else {
            for (const fn of this.listeners) {
                fn(type, payload);
            }
        }
    }
    private serialize<T>(job: () => Promise<T>): Promise<T> {
        const task = this.tail.then(job);
        this.tail = task.catch(() => {});
        return task;
    }
    private async read(): Promise<StorageData | null> {
        const text = await this.files.readText(DATA_FILE);
        if (!text) {
            return null;
        }
        const d = JSON.parse(text);
        if (!d?.plans?.main) {
            error('bad_data', t('file_broken', { file: DATA_FILE }));
        }
        return {
            version: 2,
            plans: d.plans,
            images: d.images || {},
            mappings: Array.isArray(d.mappings) ? d.mappings : [],
            locate_plan: d.locate_plan || 'main',
            ...(typeof d.position_id === 'string' && d.position_id ? { position_id: d.position_id } : {}),
            ...(typeof d.timetravel_instance === 'string' && INSTANCE.test(d.timetravel_instance)
                ? { timetravel_instance: d.timetravel_instance }
                : {}),
            ...(staleMinutes(d.health_stale_min) ? { health_stale_min: staleMinutes(d.health_stale_min) } : {}),
            ...(d.models && typeof d.models === 'object' && !Array.isArray(d.models) ? { models: d.models } : {}),
        };
    }
    private async persist(): Promise<void> {
        await this.files.writeText(DATA_FILE, JSON.stringify(this.data));
    }
    /** Loads `data.json`; on the first start it takes over the storage state of 0.4.0, if there is one. */
    load(): Promise<void> {
        return this.serialize(async () => {
            const stored = await this.read();
            if (stored) {
                this.data = stored;
                return;
            }
            if (this.readOnly) {
                // nothing to show yet, and nothing may be written
                this.data = initial();
                return;
            }
            const old = this.legacy ? await this.legacy().catch(() => null) : null;
            this.data = initial();
            if (old) {
                await this.migrate(JSON.parse(old) as LegacyStorageData);
            }
            await this.persist();
        });
    }
    private async migrate(old: LegacyStorageData): Promise<void> {
        if (!old?.plans?.main) {
            return;
        }
        for (const [id, p] of Object.entries(old.plans)) {
            const { snapshots, ...rest } = p;
            this.data.plans[id] = rest;
            if (snapshots?.length) {
                await this.writeHistory(id, snapshots);
            }
        }
        this.data.mappings = old.mappings || [];
        this.data.locate_plan = old.locate_plan || 'main';
        for (const [id, url] of Object.entries(old.images || {})) {
            await this.writeImage(id, url).catch(() => {});
        }
    }
    /** Takes over changes that another browser saved, and reports them like own changes. */
    sync(): Promise<void> {
        return this.serialize(() => this.reload());
    }
    private async reload(): Promise<void> {
        const next = await this.read();
        if (!next) {
            return;
        }
        const before = this.data;
        // The revision is reported by building/subscribe; the plan list only changes with names, order or trash.
        const listKey = (): string => JSON.stringify(this.list(), (k, v) => (k === 'revision' ? undefined : v));
        const listBefore = listKey();
        this.data = next;
        for (const [id, p] of Object.entries(next.plans)) {
            if (before.plans[id]?.revision !== p.revision) {
                this.emit('home3d/building/subscribe', {
                    plan: id,
                    revision: p.revision,
                });
            }
        }
        if (listKey() !== listBefore) {
            this.emit('home3d/plans/subscribe', this.list());
        }
        if (JSON.stringify(before.mappings) !== JSON.stringify(next.mappings)) {
            this.emit('iobroker/mappings', next.mappings);
        }
    }
    list(): PlanList {
        const entries = Object.values(this.data.plans).map(p => ({
            ...(({ building, ...metadata }) => metadata)(p),
            floors: p.building.floors.length,
            rooms: p.building.floors.reduce((n, f) => n + f.rooms.length, 0),
            furniture: p.building.floors.reduce((n, f) => n + f.furniture.length, 0),
        }));
        return {
            plans: entries.filter(p => !p.deleted_at),
            trash: entries.filter(p => p.deleted_at),
            locate_plan: this.data.locate_plan,
        };
    }
    async areas(): Promise<Record<string, { area_id: string; name: string }>> {
        const rooms = await this.io.rooms();
        return Object.fromEntries(Object.values(rooms).map(r => [r._id, { area_id: r._id, name: nameOf(r) }]));
    }
    entities(): Record<string, { entity_id: string; area_id: string | null; name?: string }> {
        return Object.fromEntries(
            this.data.mappings.map(m => [
                m.entity_id,
                { entity_id: m.entity_id, area_id: m.area_id || null, name: m.name },
            ]),
        );
    }
    private async readHistory(id: string): Promise<Snapshot[]> {
        const text = await this.files.readText(`history/${fileKey(id)}.json`);
        return text ? JSON.parse(text) : [];
    }
    private writeHistory(id: string, snapshots: Snapshot[]): Promise<void> {
        return this.files.writeText(`history/${fileKey(id)}.json`, JSON.stringify(snapshots));
    }
    private async writeImage(id: string, url: unknown): Promise<void> {
        const match = typeof url === 'string' ? /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/s.exec(url) : null;
        if (typeof id !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(id) || !match) {
            error('invalid_image', t('image_type'));
        }
        const name = `images/${fileKey(id)}.${IMAGE_TYPES[match[1]]}`;
        await this.files.writeBinary(name, base64ToBytes(match[2]));
        const previous = this.data.images[id];
        this.data.images[id] = name;
        if (previous && previous !== name) {
            await this.files.remove(previous).catch(() => {});
        }
    }
    private async readImage(id: string): Promise<string> {
        if (!Object.hasOwn(this.data.images, id)) {
            error('not_found', t('image_missing'));
        }
        const url = await this.files.readDataUrl(this.data.images[id]);
        if (!url) {
            error('not_found', t('image_missing'));
        }
        return url;
    }
    /** The models of own 3D objects that a plan places (also one in the trash: it may come back). */
    private modelsUsed(): Set<string> {
        const used = new Set<string>();
        const models = this.data.models ?? {};
        for (const p of Object.values(this.data.plans)) {
            for (const s of strings(p.building)) {
                if (Object.hasOwn(models, s)) {
                    used.add(s);
                }
            }
        }
        return used;
    }
    /** Stores a model file; `id` null: a new ID. Returns the ID. */
    private async writeModel(
        id: string | null,
        model: { name?: unknown; ext?: unknown; data?: unknown; size?: unknown; tris?: unknown },
    ): Promise<string> {
        const ext = (typeof model.ext === 'string' ? model.ext.toLowerCase() : '') as ModelEntry['ext'];
        if (!(MODEL_EXTS as readonly string[]).includes(ext) || typeof model.data !== 'string') {
            error('invalid_model', t('model_type'));
        }
        const bytes = base64ToBytes(model.data.replace(/^data:[^,]*,/, ''));
        if (!bytes.length || bytes.length > MODEL_MAX_BYTES) {
            error('invalid_model', t('model_big', { mb: MODEL_MAX_BYTES / 1024 / 1024 }));
        }
        const key = id ?? `model_${uuid()}`;
        const file = `models/${fileKey(key)}.${ext}`;
        await this.files.writeBinary(file, bytes);
        this.data.models = {
            ...(this.data.models ?? {}),
            [key]: {
                file,
                name: typeof model.name === 'string' && model.name.trim() ? model.name.trim().slice(0, 80) : key,
                ext,
                bytes: bytes.length,
                tris:
                    typeof model.tris === 'number' && Number.isInteger(model.tris) && model.tris >= 0 ? model.tris : 0,
                size: modelSize(model.size) ?? [1, 1, 1],
            },
        };
        return key;
    }
    /** The models of a project or backup that are not here yet (an ID is random: the same ID is the same model). */
    private async importModels(models: Record<string, ProjectModel>): Promise<{ id: string; reason: string }[]> {
        const failed: { id: string; reason: string }[] = [];
        for (const [id, m] of Object.entries(models)) {
            if (Object.hasOwn(this.data.models ?? {}, id)) {
                continue;
            }
            try {
                await this.writeModel(id, m);
            } catch (e) {
                failed.push({ id, reason: (e as Error).message });
            }
        }
        return failed;
    }
    /** Models with their files, for a project or backup file. */
    private async exportModels(ids: string[]): Promise<Record<string, ProjectModel>> {
        const out: Record<string, ProjectModel> = {};
        for (const id of ids) {
            const entry = this.data.models?.[id];
            const data = entry ? await this.files.readDataUrl(entry.file).catch(() => null) : null;
            if (entry && data) {
                const { file, ...rest } = entry;
                out[id] = { ...rest, data };
            }
        }
        return out;
    }
    /**
     * Mappings from a file (backup, project) that work on this system: the others name datapoints that are missing
     * here or are not writable, and are left out with the reason.
     */
    private async importable(
        list: unknown,
    ): Promise<{ ok: Mapping[]; skipped: { entity_id: string; reason: string }[] }> {
        const candidates = (Array.isArray(list) ? list : []).filter(
            (m): m is Mapping => !!m && typeof m === 'object' && typeof m.entity_id === 'string',
        );
        const objects = await this.io.getObjects(mappedIds(candidates));
        const ok: Mapping[] = [];
        const skipped: { entity_id: string; reason: string }[] = [];
        const seen = new Set<string>();
        for (const m of candidates) {
            const plain = plainMapping(m);
            try {
                if (seen.has(plain.entity_id)) {
                    error('duplicate', 'Doppelte entity_id.');
                }
                validateMappings([plain], objects);
                seen.add(plain.entity_id);
                ok.push(plain);
            } catch (e) {
                skipped.push({ entity_id: plain.entity_id, reason: (e as Error).message });
            }
        }
        return { ok, skipped };
    }
    /** One request of the 3D frontend. Changes are serialized; a failed save restores the previous data. */
    call(m: ProtocolMessage): Promise<any> {
        return this.serialize(async () => {
            if (m && MUTATING.has(String(m.type).replace(/^home3d\//, ''))) {
                if (this.readOnly) {
                    error('read_only', t('read_only'));
                }
                await this.reload();
            }
            const before = structuredClone(this.data);
            this.pending = [];
            try {
                const result = await this.handle(m);
                const events = this.pending;
                this.pending = null;
                for (const [type, payload] of events) {
                    this.emit(type, payload);
                }
                return result;
            } catch (e) {
                this.pending = null;
                this.data = before;
                throw e;
            }
        });
    }
    private async handle(m: ProtocolMessage): Promise<any> {
        if (!m || typeof m.type !== 'string') {
            error('bad_request', 'type fehlt.');
        }
        const type = m.type.replace(/^home3d\//, ''),
            id = m.plan || 'main';
        const p = Object.hasOwn(this.data.plans, id) ? this.data.plans[id] : undefined;
        const save = async <T>(result: T): Promise<T> => {
            await this.persist();
            return result;
        };
        const active = (): Plan => {
            if (!p || p.deleted_at) {
                error('not_found', t('plan_missing'));
            }
            return p;
        };
        const changed = (target: Plan): void => {
            target.revision++;
            this.emit('home3d/building/subscribe', {
                plan: target.id,
                revision: target.revision,
            });
        };
        const plansChanged = (): void => this.emit('home3d/plans/subscribe', this.list());
        switch (type) {
            case 'iobroker/mappings/get':
                return this.data.mappings;
            case 'iobroker/discover': {
                const objects = await this.io.stateObjects();
                const rooms = await this.io.rooms();
                // media players and lights first, as one device each with all their parts and actions; their channels
                // and devices only for the names
                const players = mediaBases(objects);
                const bases = [...new Set([...players, ...lightBases(objects)])].slice(0, 800);
                const devices = bases.length ? await this.io.getObjects(bases) : {};
                return [
                    ...mediaCandidates(objects, rooms, devices, base => `media_player.${hash(base)}`, nameOf),
                    ...lightCandidates(
                        objects,
                        rooms,
                        devices,
                        base => `light.${hash(base)}`,
                        nameOf,
                        new Set(players),
                    ),
                    ...discover(objects, rooms),
                ];
            }
            case 'iobroker/mappings/set': {
                const ids = Array.isArray(m.mappings) ? mappedIds(m.mappings as Mapping[]) : [];
                this.data.mappings = validateMappings(m.mappings, await this.io.getObjects(ids));
                this.emit('iobroker/mappings', this.data.mappings);
                return save({ saved: this.data.mappings.length });
            }
            case 'iobroker/position/set':
                this.data.position_id = typeof m.id === 'string' && m.id ? m.id : null;
                return save({});
            case 'iobroker/timetravel/set':
                if (m.instance != null && !(typeof m.instance === 'string' && INSTANCE.test(m.instance))) {
                    error('invalid_instance', t('bad_instance'));
                }
                this.data.timetravel_instance = m.instance || null;
                return save({});
            case 'iobroker/health/set':
                if (m.minutes != null && m.minutes !== '' && !staleMinutes(m.minutes)) {
                    error('invalid_minutes', t('bad_minutes'));
                }
                this.data.health_stale_min = staleMinutes(m.minutes);
                return save({});
            case 'iobroker/service':
                return execute(this.data.mappings, m.domain, m.service, m.data || {}, this.io);
            case 'building/get': {
                const target = active();
                return {
                    building: target.building,
                    revision: target.revision,
                    plan: target.id,
                    version,
                };
            }
            case 'building/save': {
                const target = active();
                if (m.base_revision !== undefined && m.base_revision !== target.revision) {
                    error('stale_plan', t('stale'));
                }
                target.building = checkBuilding(m.building);
                changed(target);
                return save({ revision: target.revision });
            }
            case 'plans/list':
                return this.list();
            case 'plans/create': {
                if (m.copy_of && !Object.hasOwn(this.data.plans, m.copy_of)) {
                    error('not_found', 'Kopiervorlage fehlt.');
                }
                const n = plan(
                    checkBuilding(m.building || (m.copy_of ? this.data.plans[m.copy_of].building : empty())),
                    String(m.name || 'Neuer Grundriss'),
                );
                n.icon = m.icon || null;
                this.data.plans[n.id] = n;
                plansChanged();
                return save({ plan: n.id });
            }
            case 'plans/update': {
                const target = active();
                for (const k of ['name', 'icon', 'site'] as const) {
                    if (Object.hasOwn(m, k)) {
                        target[k] = m[k];
                    }
                }
                plansChanged();
                return save({});
            }
            case 'plans/delete': {
                const target = active();
                if (id === 'main') {
                    error('main_plan', t('main_plan_stays'));
                }
                target.deleted_at = Date.now() / 1000;
                plansChanged();
                return save({});
            }
            case 'plans/restore':
                if (!p) {
                    error('not_found', 'Grundriss fehlt.');
                }
                delete p.deleted_at;
                plansChanged();
                return save({});
            case 'plans/order': {
                if (!Array.isArray(m.plans) || m.plans.some(k => !Object.hasOwn(this.data.plans, k))) {
                    error('bad_request', t('bad_order'));
                }
                this.data.plans = Object.fromEntries(
                    [...new Set([...m.plans, ...Object.keys(this.data.plans)])].map(k => [k, this.data.plans[k]]),
                );
                plansChanged();
                return save({});
            }
            case 'plans/locate':
                active();
                this.data.locate_plan = id;
                return save({});
            case 'image/set':
                await this.writeImage(m.image_id, m.data);
                return save({});
            case 'image/get':
                return { data: await this.readImage(m.image_id) };
            case 'model/list': {
                const used = this.modelsUsed();
                const models: ModelInfo[] = Object.entries(this.data.models ?? {}).map(([key, e]) => ({
                    id: key,
                    name: e.name,
                    ext: e.ext,
                    bytes: e.bytes,
                    tris: e.tris,
                    size: e.size,
                    used: used.has(key),
                }));
                return { models: models.sort((a, b) => a.name.localeCompare(b.name)) };
            }
            case 'model/get': {
                const models = this.data.models ?? {};
                const entry =
                    typeof m.model_id === 'string' && Object.hasOwn(models, m.model_id)
                        ? models[m.model_id]
                        : undefined;
                const data = entry ? await this.files.readDataUrl(entry.file) : null;
                if (!entry || !data) {
                    error('not_found', t('model_missing'));
                }
                return { data, ext: entry.ext };
            }
            case 'model/set': {
                const key = await this.writeModel(null, {
                    name: m.name,
                    ext: m.ext,
                    data: m.data,
                    size: m.size,
                    tris: m.tris,
                });
                return save({ model_id: key, ...this.data.models![key] });
            }
            case 'model/prune': {
                const used = this.modelsUsed();
                const removed: string[] = [];
                for (const [key, e] of Object.entries(this.data.models ?? {})) {
                    if (!used.has(key)) {
                        await this.files.remove(e.file).catch(() => {});
                        delete this.data.models![key];
                        removed.push(key);
                    }
                }
                return save({ removed });
            }
            case 'history/list':
                active();
                return {
                    snapshots: (await this.readHistory(id)).map(({ building, ...s }) => s),
                };
            case 'history/snapshot': {
                const target = active();
                const snapshots = await this.readHistory(id);
                snapshots.unshift({
                    id: uuid(),
                    revision: target.revision,
                    saved_at: Date.now() / 1000,
                    floors: target.building.floors.length,
                    rooms: target.building.floors.reduce((n, f) => n + f.rooms.length, 0),
                    furniture: target.building.floors.reduce((n, f) => n + f.furniture.length, 0),
                    building: structuredClone(target.building),
                });
                await this.writeHistory(id, snapshots.slice(0, 30));
                return {};
            }
            case 'history/restore': {
                const target = active();
                const s = (await this.readHistory(id)).find(s => s.id === m.snapshot_id);
                if (!s) {
                    error('not_found', 'Wiederherstellungspunkt fehlt.');
                }
                target.building = structuredClone(s.building);
                changed(target);
                return save({ revision: target.revision });
            }
            case 'backup/export': {
                const images: Record<string, string> = {};
                for (const key of Object.keys(this.data.images)) {
                    images[key] = await this.readImage(key).catch(() => '');
                }
                const main = this.data.plans.main;
                return {
                    format: 'home3d-backup',
                    version: 2,
                    building: main.building,
                    main: { name: main.name, icon: main.icon, site: main.site },
                    plans: Object.values(this.data.plans).filter(p => p.id !== 'main' && !p.deleted_at),
                    packs: [],
                    images,
                    // the datapoints of the devices (not part of the backup format of the 3D frontend)
                    mappings: this.data.mappings.map(plainMapping),
                    // the files of own 3D objects
                    models: await this.exportModels(Object.keys(this.data.models ?? {})),
                };
            }
            case 'backup/import': {
                const main = this.data.plans.main;
                main.building = checkBuilding(m.building);
                if (m.main) {
                    for (const k of ['name', 'icon', 'site'] as const) {
                        main[k] = m.main[k] ?? null;
                    }
                }
                if (m.plans) {
                    const next: Record<string, Plan> = { main };
                    for (const entry of m.plans) {
                        if (
                            !entry.id ||
                            ['main', '__proto__', 'constructor', 'prototype'].includes(entry.id) ||
                            Object.hasOwn(next, entry.id)
                        ) {
                            error('invalid_backup', t('bad_plan_id'));
                        }
                        next[entry.id] = {
                            ...plan(checkBuilding(entry.building), entry.name),
                            id: entry.id,
                            icon: entry.icon || null,
                            site: entry.site || null,
                        };
                    }
                    this.data.plans = next;
                }
                for (const [key, url] of Object.entries(m.images || {})) {
                    if (url) {
                        await this.writeImage(key, url);
                    }
                }
                const modelsFailed = await this.importModels(readModels(m.models));
                // backups without mappings (before 0.5.0) keep the current ones
                const devices = Array.isArray(m.mappings) ? await this.importable(m.mappings) : null;
                if (devices) {
                    this.data.mappings = devices.ok;
                    this.emit('iobroker/mappings', this.data.mappings);
                }
                changed(main);
                plansChanged();
                return save({
                    revision: main.revision,
                    building: main.building,
                    packs: 0,
                    skipped: [
                        ...(m.packs || []).map((p: { id: string }) => ({
                            id: p.id,
                            reason: t('no_packs'),
                        })),
                        ...(devices?.skipped || []).map(d => ({ id: d.entity_id, reason: d.reason })),
                        ...modelsFailed,
                    ],
                });
            }
            case 'project/export': {
                const target = active();
                const used = usedBy(target.building, this.data.images, this.data.mappings, this.data.models);
                const images: Record<string, string> = {};
                for (const key of used.images) {
                    const url = await this.readImage(key).catch(() => '');
                    if (url) {
                        images[key] = url;
                    }
                }
                return projectFile(target, images, used.mappings, await this.exportModels(used.models));
            }
            case 'project/import': {
                const project = readProject(m.project);
                const building = checkBuilding(project.building);
                const rename = new Map<string, string>();
                // a picture ID that is taken here gets a new one, so no picture of another plan is replaced
                const pictures: [string, string][] = Object.entries(project.images).map(([key, url]) => {
                    const target = Object.hasOwn(this.data.images, key) ? `img_${uuid()}` : key;
                    if (target !== key) {
                        rename.set(key, target);
                    }
                    return [target, url];
                });
                // devices: an equal mapping is used again, another one with the same entity_id is renamed
                const devices = await this.importable(project.mappings);
                const existing = new Map(this.data.mappings.map(x => [x.entity_id, x]));
                const taken = new Set(existing.keys());
                const added: Mapping[] = [];
                const renamedDevices: { from: string; to: string }[] = [];
                let reused = 0;
                for (const d of devices.ok) {
                    const same = existing.get(d.entity_id);
                    if (same && JSON.stringify(plainMapping(same)) === JSON.stringify(d)) {
                        reused++;
                        continue;
                    }
                    const entityId = taken.has(d.entity_id) ? freeEntityId(d.entity_id, taken) : d.entity_id;
                    if (entityId !== d.entity_id) {
                        rename.set(d.entity_id, entityId);
                        renamedDevices.push({ from: d.entity_id, to: entityId });
                    }
                    taken.add(entityId);
                    added.push({ ...d, entity_id: entityId });
                }
                let images = 0;
                const brokenImages: string[] = [];
                for (const [key, url] of pictures) {
                    try {
                        await this.writeImage(key, url);
                        images++;
                    } catch {
                        brokenImages.push(key);
                    }
                }
                const modelsFailed = await this.importModels(project.models);
                const n = plan(renamed(building, rename), String(m.name || project.name || 'Importierter Grundriss'));
                n.icon = project.icon;
                n.site = project.site ?? null;
                this.data.plans[n.id] = n;
                if (added.length) {
                    this.data.mappings = [...this.data.mappings, ...added];
                    this.emit('iobroker/mappings', this.data.mappings);
                }
                plansChanged();
                return save({
                    plan: n.id,
                    name: n.name,
                    images,
                    devices: added.length + reused,
                    renamed: renamedDevices,
                    skipped: [
                        ...devices.skipped.map(d => ({ id: d.entity_id, reason: d.reason })),
                        ...brokenImages.map(id => ({ id, reason: t('image_unreadable') })),
                        ...modelsFailed,
                    ],
                });
            }
            case 'packs/list':
                return { packs: [] };
            case 'license/get':
                return {
                    instance: 'iobroker',
                    active: false,
                    key_hint: null,
                    licensee: null,
                    checked_at: null,
                    error: null,
                    shop_url: 'help.html',
                    packs: [],
                    offers: [],
                };
            case 'diagnostics/get':
            case 'diagnostics/delete':
            case 'diagnostics/set':
                return {
                    enabled: false,
                    last_daily: null,
                    can_delete: false,
                    preview: {},
                    endpoint: '',
                };
            case 'diagnostics/client':
                return {};
            case 'voice/settings':
                return { sentences: 'off' };
            case 'config/area_registry/list':
                return Object.values(await this.areas());
            case 'config/entity_registry/list':
                return Object.values(this.entities());
            case 'config/device_registry/list':
            case 'config/floor_registry/list':
                return [];
            case 'energy/get_prefs':
                return { energy_sources: [], device_consumption: [] };
            default:
                error('not_supported', t('not_implemented', { type: String(m.type) }));
        }
    }
}
