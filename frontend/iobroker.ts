// Connection to ioBroker over the socket of the web adapter (like vis-2). Login and access rights are those of web.
import { Connection } from '@iobroker/socket-client';
import type { IoAccess, FileAccess, StateObject, StateValue, RoomObject } from './model.js';
import { fileText } from './file-text.js';

export const NAMESPACE = 'home3d.0';
/** State of 0.4.0, when the adapter was still called 3d-home and had its own server */
export const LEGACY_STATE = '3d-home.0.storage';

const notFound = (e: unknown): boolean => /not exist|not found|ENOENT/i.test(String(e));

export class IoBroker implements IoAccess, FileAccess {
    conn: Connection;
    private objects = new Map<string, StateObject | null>();
    private roomCache?: Promise<Record<string, RoomObject>>;

    constructor() {
        this.conn = new Connection({
            name: 'home3d',
            doNotLoadAllObjects: true,
            doNotLoadACL: true,
            onError: e => console.error('[home3d]', e),
        });
    }
    async ready(): Promise<void> {
        await this.conn.waitForFirstConnection();
    }
    async language(): Promise<string> {
        try {
            return (await this.conn.getSystemConfig()).common.language || 'de';
        } catch {
            return navigator.language.slice(0, 2) || 'de';
        }
    }
    async getObjects(ids: string[]): Promise<Record<string, StateObject>> {
        const missing = ids.filter(id => !this.objects.has(id));
        await Promise.all(
            missing.map(async id => {
                try {
                    const o = (await this.conn.getObject(id)) as StateObject | null;
                    this.objects.set(id, o?.type ? { ...o, _id: id } : null);
                } catch {
                    this.objects.set(id, null);
                }
            }),
        );
        const out: Record<string, StateObject> = {};
        for (const id of ids) {
            const o = this.objects.get(id);
            if (o) {
                out[id] = o;
            }
        }
        return out;
    }
    /** The state objects below one device or channel (the health datapoints of a device, health.ts). */
    async statesUnder(prefix: string): Promise<Record<string, StateObject>> {
        const view = await this.conn.getObjectViewSystem('state', `${prefix}.`, `${prefix}.香`);
        return view ?? {};
    }
    async stateObjects(): Promise<Record<string, StateObject>> {
        const all = (await this.conn.getObjectViewSystem('state', '', '香')) as unknown as Record<string, StateObject>;
        for (const [id, o] of Object.entries(all)) {
            this.objects.set(id, { ...o, _id: id });
        }
        return all;
    }
    rooms(): Promise<Record<string, RoomObject>> {
        this.roomCache ??= this.conn
            .getObjectViewSystem('enum', 'enum.rooms.', 'enum.rooms.香')
            .then(r => r as unknown as Record<string, RoomObject>)
            .catch(() => ({}));
        return this.roomCache;
    }
    /** Forgets cached objects and rooms, e.g. when the device dialog loads the object tree again. */
    forget(): void {
        this.objects.clear();
        this.roomCache = undefined;
    }
    getState(id: string): Promise<StateValue | null | undefined> {
        return this.conn.getState(id);
    }
    async getStates(ids: string[]): Promise<Record<string, StateValue>> {
        if (!ids.length) {
            return {};
        }
        return (await this.conn.getStates(ids)) || {};
    }
    setState(id: string, value: any): Promise<void> {
        return this.conn.setState(id, value, false);
    }
    /** The history instance of the system settings (null: none). */
    async defaultHistory(): Promise<string | null> {
        try {
            return (await this.conn.getSystemConfig()).common.defaultHistory || null;
        } catch {
            return null;
        }
    }
    /** The position of the system (system settings), null if none is set. */
    async location(): Promise<{ lat: number; lon: number } | null> {
        try {
            const c = (await this.conn.getSystemConfig()).common as { latitude?: unknown; longitude?: unknown };
            const lat = Number(c.latitude);
            const lon = Number(c.longitude);
            return c.latitude !== '' && c.latitude != null && Number.isFinite(lat) && Number.isFinite(lon)
                ? { lat, lon }
                : null;
        } catch {
            return null;
        }
    }
    /** The instances that answer `getHistory` (history, influxdb, sql, recorder ...); empty if they cannot be read. */
    async historyInstances(): Promise<string[]> {
        try {
            const view = await this.conn.getObjectViewSystem('instance', 'system.adapter.', 'system.adapter.\u9999');
            return Object.values(view)
                .filter(o => (o.common as { getHistory?: boolean } | undefined)?.getHistory)
                .map(o => o._id.replace(/^system\.adapter\./, ''))
                .sort();
        } catch {
            return [];
        }
    }
    private recorded = new Map<string, { at: number; ids: Promise<Set<string> | null> }>();
    /**
     * The datapoints a history instance records (`getEnabledDPs`; the recorder answers with all it selected itself),
     * null without an answer within 5 s. Kept for a minute: the time travel asks for every window.
     */
    recordedIds(instance: string): Promise<Set<string> | null> {
        const hit = this.recorded.get(instance);
        if (hit && Date.now() - hit.at < 60_000) {
            return hit.ids;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const ids = Promise.race([
            this.conn.sendTo<Record<string, unknown> | null>(instance, 'getEnabledDPs', {}),
            new Promise<null>(resolve => (timer = setTimeout(() => resolve(null), 5000))),
        ])
            .then(r => (r && typeof r === 'object' && !('error' in r) ? new Set(Object.keys(r)) : null))
            .catch(() => null)
            .finally(() => clearTimeout(timer));
        this.recorded.set(instance, { at: Date.now(), ids });
        return ids;
    }
    /** Values of a datapoint from a history adapter. */
    getHistory(id: string, options: ioBroker.GetHistoryOptions): Promise<ioBroker.GetHistoryResult> {
        return this.conn.getHistory(id, options);
    }
    /**
     * Whether this user may change the project: write `data.json` of home3d.0, as the server evaluates the file's
     * rights for the user. Not listed (no file yet): the server decides on the first save. Refused: read-only.
     */
    async canWrite(file: string): Promise<boolean> {
        try {
            const entry = (await this.conn.readDir(NAMESPACE, '')).find(e => e.file === file);
            return entry?.acl?.write !== false;
        } catch (e) {
            // no folder yet: written on the first save; no right to list the files: read-only
            return notFound(e);
        }
    }
    // Files of home3d.0
    async readText(name: string): Promise<string | null> {
        try {
            const r = await this.conn.readFile(NAMESPACE, name, true);
            return r?.file ? fileText(r.file, r.mimeType) : null;
        } catch (e) {
            if (notFound(e)) {
                return null;
            }
            throw e;
        }
    }
    writeText(name: string, text: string): Promise<void> {
        const bytes = new TextEncoder().encode(text);
        return this.writeBinary(name, bytes);
    }
    async readDataUrl(name: string): Promise<string | null> {
        try {
            const r = await this.conn.readFile(NAMESPACE, name, true);
            return r?.file ? `data:${r.mimeType || 'application/octet-stream'};base64,${r.file}` : null;
        } catch (e) {
            if (notFound(e)) {
                return null;
            }
            throw e;
        }
    }
    writeBinary(name: string, bytes: Uint8Array): Promise<void> {
        // Only an ArrayBuffer goes out as `writeFile64`; a string would use the deprecated text command `writeFile`.
        return this.conn.writeFile64(NAMESPACE, name, bytes.slice().buffer);
    }
    async remove(name: string): Promise<void> {
        await this.conn.deleteFile(NAMESPACE, name);
    }
    /** Content of the state of 0.4.0, which stored everything in `3d-home.0.storage`. */
    async legacy(): Promise<string | null> {
        const s = await this.conn.getState(LEGACY_STATE);
        return typeof s?.val === 'string' ? s.val : null;
    }
}
