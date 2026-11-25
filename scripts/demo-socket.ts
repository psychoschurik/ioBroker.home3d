// Simulated socket of the web adapter for the local demo (`npm run demo`). It answers the socket commands that
// the page uses with simulated devices and keeps states and files in the localStorage of the browser.
// It is bundled by scripts/demo.ts and served as `/lib/js/socket.io.js`; it is not part of the adapter package.
type Callback = (...args: any[]) => void;
interface DemoObject {
    type: string;
    common: Record<string, any>;
    native?: Record<string, any>;
}
interface DemoState {
    val: unknown;
    ack: boolean;
    ts: number;
    lc: number;
    q: number;
    from: string;
}
interface Demo {
    objects: Record<string, DemoObject>;
    states: Record<string, { val: unknown }>;
    /** "<namespace>/<file>" → base64 */
    files: Record<string, string>;
}
declare const __DEMO__: Demo;

const KEY = 'home3d-demo';
const MIME: Record<string, string> = {
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
};
const now = Date.now();
/** Like `readFile64` of the web socket (socket-classes): JSON goes out as base64 of `encodeURIComponent(text)`. */
function jsonAsServer(base64: string): string {
    const text = new TextDecoder().decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
    return btoa(encodeURIComponent(text));
}
let saved: { states?: Record<string, DemoState>; files?: Record<string, string> } = {};
try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
} catch {
    // private window or no storage: start from the demo data
}
const objects = __DEMO__.objects;
const states: Record<string, DemoState> =
    saved.states ||
    Object.fromEntries(
        Object.entries(__DEMO__.states).map(([id, s]) => [
            id,
            { val: s.val, ack: true, ts: now, lc: now, q: 0, from: 'system.adapter.demo.0' },
        ]),
    );
const files: Record<string, string> = saved.files || { ...__DEMO__.files };
function save(): void {
    try {
        localStorage.setItem(KEY, JSON.stringify({ states, files }));
    } catch {
        // storage full or blocked: the demo keeps working in memory
    }
}
const toRegExp = (pattern: string): RegExp =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

function connect(): unknown {
    const handlers: Record<string, Callback[]> = {};
    const stateSubscriptions = new Set<string>();
    const fileSubscriptions: [RegExp, RegExp][] = [];
    const fire = (event: string, ...args: unknown[]): void => {
        for (const h of handlers[event] || []) {
            h(...args);
        }
    };
    const changeState = (id: string, state: DemoState): void => {
        states[id] = state;
        save();
        if ([...stateSubscriptions].some(p => toRegExp(p).test(id))) {
            fire('stateChange', id, state);
        }
    };
    const statesOf = (pattern: string | string[]): Record<string, DemoState> => {
        const ids = Array.isArray(pattern)
            ? pattern
            : Object.keys(states).filter(id => toRegExp(pattern || '*').test(id));
        return Object.fromEntries(ids.filter(id => states[id]).map(id => [id, states[id]]));
    };
    const fileKey = (namespace: string, name: string): string => `${namespace}/${name.replace(/^\/+/, '')}`;
    // a write from another adapter (a voice assistant, a script), e.g. demoWrite('home3d.0.show', 'Küche') in the console
    (globalThis as { demoWrite?: (id: string, val: unknown) => void }).demoWrite = (id, val) =>
        changeState(id, { val, ack: false, ts: Date.now(), lc: Date.now(), q: 0, from: 'system.adapter.javascript.0' });
    const commands: Record<string, Callback> = {
        getVersion: (cb: Callback) => cb(null, '7.0.0', 'web'),
        authenticate: (cb: Callback) => cb(true, false),
        authEnabled: (cb: Callback) => cb(false, 'admin'),
        getUserPermissions: (cb: Callback) => cb(null, {}),
        getCompactSystemConfig: (cb: Callback) => cb(null, objects['system.config']?.common || {}),
        getObject: (id: string, cb: Callback) => cb(null, objects[id] ?? null),
        getObjects: (cb: Callback) => cb(null, objects),
        getObjectView: (_design: string, type: string, o: { startkey: string; endkey: string }, cb: Callback) =>
            cb(null, {
                rows: Object.entries(objects)
                    .filter(([id, v]) => v.type === type && id >= o.startkey && id <= o.endkey)
                    .map(([id, value]) => ({ id, value: { ...value, _id: id } })),
            }),
        getForeignObjects: (pattern: string, type: string, cb: Callback) =>
            cb(
                null,
                Object.fromEntries(
                    Object.entries(objects).filter(([id, o]) => toRegExp(pattern).test(id) && (!type || o.type === type)),
                ),
            ),
        getStates: (pattern: string | string[], cb: Callback) => cb(null, statesOf(pattern)),
        getForeignStates: (pattern: string | string[], cb: Callback) => cb(null, statesOf(pattern)),
        getState: (id: string, cb: Callback) => cb(null, states[id] ?? null),
        setState: (id: string, state: unknown, cb?: Callback) => {
            const s =
                state && typeof state === 'object' && 'val' in state
                    ? (state as { val: unknown; ack?: boolean })
                    : { val: state };
            const t = Date.now();
            const lc = states[id]?.val === s.val ? states[id].lc : t;
            changeState(id, { val: s.val, ack: !!s.ack, ts: t, lc, q: 0, from: 'system.adapter.web.0' });
            cb?.(null);
            // A simulated device confirms commands after a short moment.
            if (!s.ack && objects[id]) {
                setTimeout(() => changeState(id, { ...states[id], ack: true, ts: Date.now() }), 300);
            }
        },
        subscribe: (pattern: string | string[]) => {
            for (const p of ([] as string[]).concat(pattern)) {
                stateSubscriptions.add(p);
            }
        },
        unsubscribe: (pattern: string | string[]) => {
            for (const p of ([] as string[]).concat(pattern)) {
                stateSubscriptions.delete(p);
            }
        },
        subscribeFiles: (id: string, pattern: string | string[], cb?: Callback) => {
            for (const p of ([] as string[]).concat(pattern)) {
                fileSubscriptions.push([toRegExp(id), toRegExp(p)]);
            }
            cb?.(null);
        },
        unsubscribeFiles: (...args: unknown[]) => (args.at(-1) as Callback | undefined)?.(null),
        readFile64: (namespace: string, name: string, cb: Callback) => {
            const key = fileKey(namespace, name);
            if (files[key] === undefined) {
                cb('Not exists');
            } else {
                const type = MIME[name.split('.').pop() || ''] || 'application/octet-stream';
                cb(null, type === 'application/json' ? jsonAsServer(files[key]) : files[key], type);
            }
        },
        writeFile64: (namespace: string, name: string, data: string, options?: unknown, cb?: Callback) => {
            const done = typeof options === 'function' ? (options as Callback) : cb;
            files[fileKey(namespace, name)] = data;
            save();
            done?.(null);
            for (const [ns, file] of fileSubscriptions) {
                if (ns.test(namespace) && file.test(name)) {
                    fire('fileChange', namespace, name, data.length);
                }
            }
        },
        deleteFile: (namespace: string, name: string, cb?: Callback) => {
            delete files[fileKey(namespace, name)];
            save();
            cb?.(null);
        },
        // a project with everything in it (dialog "Projekte")
        deleteFolder: (namespace: string, name: string, cb?: Callback) => {
            const prefix = `${fileKey(namespace, name.replace(/^\/+|\/+$/g, ''))}/`;
            for (const key of Object.keys(files)) {
                if (key.startsWith(prefix)) {
                    delete files[key];
                }
            }
            save();
            cb?.(null);
        },
        fileExists: (namespace: string, name: string, cb: Callback) => cb(null, fileKey(namespace, name) in files),
        // the file browser of @iobroker/gui-components (dialog "Projekte")
        readDir: (namespace: string, path: string, cb: Callback) => {
            const folder = path.replace(/^\/+|\/+$/g, '');
            const prefix = folder ? `${namespace}/${folder}/` : `${namespace}/`;
            const entries = new Map<string, { file: string; isDir: boolean; stats: { size: number }; modifiedAt: number }>();
            for (const [key, data] of Object.entries(files)) {
                if (key.startsWith(prefix)) {
                    const [name, ...rest] = key.slice(prefix.length).split('/');
                    entries.set(name, {
                        file: name,
                        isDir: rest.length > 0,
                        stats: { size: rest.length ? 0 : Math.floor((data.length * 3) / 4) },
                        modifiedAt: Date.now(),
                    });
                }
            }
            if (folder && !entries.size) {
                cb('Not exists');
            } else {
                cb(null, [...entries.values()]);
            }
        },
    };
    const socket = {
        connected: true,
        on(event: string, h: Callback) {
            (handlers[event] ||= []).push(h);
        },
        off(event: string, h: Callback) {
            handlers[event] = (handlers[event] || []).filter(x => x !== h);
        },
        emit(command: string, ...args: unknown[]) {
            const fn = commands[command];
            setTimeout(() => {
                if (fn) {
                    fn(...args);
                } else if (typeof args.at(-1) === 'function') {
                    (args.at(-1) as Callback)(null);
                }
            }, 5);
            return true;
        },
        connect() {},
        close() {},
        destroy() {},
    };
    setTimeout(() => fire('connect'), 10);
    return socket;
}
(globalThis as unknown as { io: { connect: typeof connect } }).io = { connect };
