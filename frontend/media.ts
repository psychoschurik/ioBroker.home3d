// Media players in "Geräte verbinden": a device whose states have the roles of a media player (as the type-detector of
// ioBroker knows them: media.state, button.play/pause/next/prev, level.volume, media.title …) becomes one
// `media_player` with all its actions, so play/pause, next/previous and the volume work in the 3D view.
import type { ActionRule, Binding, Mapping, RoomObject, StateObject } from './model.js';
import { stateTexts } from './state-texts.js';

/** The parts of a media player, named as in the type-detector. */
export type MediaPart =
    | 'STATE'
    | 'PLAY'
    | 'PAUSE'
    | 'STOP'
    | 'NEXT'
    | 'PREV'
    | 'VOLUME'
    | 'VOLUME_ACTUAL'
    | 'VOLUME_UP'
    | 'VOLUME_DOWN'
    | 'MUTE'
    | 'POWER'
    | 'TITLE'
    | 'ARTIST'
    | 'ALBUM'
    | 'COVER'
    | 'DURATION'
    | 'ELAPSED'
    | 'APP'
    | 'INPUT';

/** Role, whether it must be writable, the type it must have (missing: any). */
export const MEDIA_PARTS: [MediaPart, RegExp, boolean, string?][] = [
    ['STATE', /^media\.state(\..*)?$/, false],
    ['PLAY', /^(button|action)\.play(\..*)?$/, true, 'boolean'],
    ['PAUSE', /^(button|action)\.pause(\..*)?$/, true, 'boolean'],
    ['STOP', /^(button|action)\.stop(\..*)?$/, true, 'boolean'],
    ['NEXT', /^(button|action)\.(next|forward)(\..*)?$/, true, 'boolean'],
    ['PREV', /^(button|action)\.(prev|reverse)(\..*)?$/, true, 'boolean'],
    ['VOLUME', /^level\.volume$/, true, 'number'],
    ['VOLUME_ACTUAL', /^value\.volume$/, false, 'number'],
    ['VOLUME_UP', /^button\.volume\.up$/, true, 'boolean'],
    ['VOLUME_DOWN', /^button\.volume\.down$/, true, 'boolean'],
    ['MUTE', /^media\.mute$/, true, 'boolean'],
    ['POWER', /^switch\.power$/, true, 'boolean'],
    ['TITLE', /^media\.title$/, false],
    ['ARTIST', /^media\.artist$/, false],
    ['ALBUM', /^media\.album$/, false],
    ['COVER', /^media\.cover(\.big)?$/, false, 'string'],
    ['DURATION', /^media\.duration$/, false, 'number'],
    ['ELAPSED', /^media\.elapsed$/, false, 'number'],
    // a TV's app (YouTube, Netflix …) and its input (HDMI 1 …), named as in the type-detector's TV_APPS and TV_INPUTS
    ['APP', /^media\.app$/, false],
    ['INPUT', /^media\.input$/, false],
];

/** The roles only a TV or player has beside its power switch (the "tv" of the type-detector). */
const TV_ROLES = /^(media\.(key|input|app)|button\.volume\.(up|down))$/;

/** The controls of which a player needs at least one. */
const CONTROLS: MediaPart[] = ['PLAY', 'PAUSE', 'NEXT', 'PREV', 'VOLUME', 'VOLUME_UP', 'POWER'];

/** The features of the 3D frontend's media player (as Home Assistant counts them). */
const FEATURE = {
    PAUSE: 1,
    VOLUME_SET: 4,
    VOLUME_MUTE: 8,
    PREVIOUS_TRACK: 16,
    NEXT_TRACK: 32,
    TURN_ON: 128,
    SELECT_SOURCE: 2048,
    TURN_OFF: 256,
    VOLUME_STEP: 1024,
    STOP: 4096,
    PLAY: 16384,
};

/** What a player's state datapoint says, as the 3D frontend's player state (media.state: play/pause/stop, 1/0/2, true/false). */
export const MEDIA_STATES: Record<string, string> = {
    true: 'playing',
    false: 'paused',
    1: 'playing',
    0: 'paused',
    2: 'idle',
    play: 'playing',
    playing: 'playing',
    PLAY: 'playing',
    PLAYING: 'playing',
    buffering: 'playing',
    BUFFERING: 'playing',
    pause: 'paused',
    paused: 'paused',
    PAUSE: 'paused',
    PAUSED: 'paused',
    stop: 'idle',
    stopped: 'idle',
    STOP: 'idle',
    STOPPED: 'idle',
    idle: 'idle',
    IDLE: 'idle',
    off: 'off',
    OFF: 'off',
};

const parentOf = (id: string): string => id.slice(0, id.lastIndexOf('.'));
const depth = (id: string): number => id.split('.').length;
const roleOf = (o: StateObject | undefined): string => o?.common?.role ?? '';

/**
 * The devices with a media player: below each, its parts. A player is anchored at its state (media.state) or, for a
 * TV, at its power switch beside TV keys; its parts are looked for below the anchor's device (one level up from its
 * channel, when that holds no other player and is no adapter instance), else below its channel.
 */
export function findMediaPlayers(
    objects: Record<string, StateObject>,
): { base: string; parts: Partial<Record<MediaPart, string>> }[] {
    const ids = Object.keys(objects).filter(id => objects[id]?.type === 'state');
    const anchors = ids.filter(id => {
        const role = roleOf(objects[id]);
        if (/^media\.state(\..*)?$/.test(role)) {
            return true;
        }
        if (role !== 'switch.power') {
            return false;
        }
        const p = `${parentOf(id)}.`;
        return ids.some(o => o.startsWith(p) && TV_ROLES.test(roleOf(objects[o])));
    });
    const below = (base: string): string[] => ids.filter(id => id.startsWith(`${base}.`));
    const partsOf = (base: string): Partial<Record<MediaPart, string>> => {
        const out: Partial<Record<MediaPart, string>> = {};
        // the nearest first: the state's own channel before the device's other channels
        for (const id of below(base).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))) {
            const c = objects[id].common ?? {};
            for (const [name, role, write, type] of MEDIA_PARTS) {
                if (out[name] || !role.test(c.role ?? '') || (write && c.write !== true) || (type && c.type !== type)) {
                    continue;
                }
                // a big cover only when there is no plain one
                if (
                    name === 'COVER' &&
                    /\.big$/.test(c.role ?? '') &&
                    below(base).some(o => roleOf(objects[o]) === 'media.cover')
                ) {
                    continue;
                }
                out[name] = id;
            }
        }
        return out;
    };
    const anchorsBelow = (base: string): number =>
        anchors.filter(a => a.startsWith(`${base}.`) && /^media\.state/.test(roleOf(objects[a]))).length;
    const out = new Map<string, Partial<Record<MediaPart, string>>>();
    for (const a of anchors) {
        // the device of the state's channel when it holds no other player: its title or cover may lie in a channel
        // beside the controls
        let base = parentOf(a);
        const up = parentOf(base);
        if (depth(up) >= 3 && anchorsBelow(up) <= 1) {
            base = up;
        }
        const parts = partsOf(base);
        if (!CONTROLS.some(c => parts[c]) || out.has(base)) {
            continue;
        }
        // a TV's power anchors it only without a state of its own
        if (!/^media\.state/.test(roleOf(objects[a])) && parts.STATE) {
            continue;
        }
        out.set(base, parts);
    }
    return [...out].map(([base, parts]) => ({ base, parts }));
}

/**
 * The choices of a TV's app or input: its values with their texts (common.states; a list of texts of a text datapoint:
 * each text is its own value), at most 60.
 */
function choices(states: unknown, type: string | undefined): Record<string, string> | null {
    if (Array.isArray(states) && type === 'string') {
        const list = states.map(String).slice(0, 60);
        return list.length ? Object.fromEntries(list.map(v => [v, v])) : null;
    }
    return stateTexts(states, 60);
}

/** The value a writable state datapoint takes for play (true) or pause (false), by its type. */
function stateValue(o: StateObject, play: boolean): unknown {
    if (o.common.type === 'boolean') {
        return play;
    }
    if (o.common.type === 'number') {
        return play ? 1 : 0;
    }
    return play ? 'play' : 'pause';
}

/**
 * The media player of a device as one mapping: its state (playing, paused, idle; off while its power is off), the
 * title, artist, album, cover, volume and position as attributes, and an action for each control it has.
 */
export function mediaPlayerMapping(
    entityId: string,
    name: string,
    parts: Partial<Record<MediaPart, string>>,
    objects: Record<string, StateObject>,
): Mapping {
    const p = parts;
    const actions: Record<string, ActionRule[]> = {};
    let features = 0;
    const button = (service: string, part: MediaPart, feature: number): void => {
        if (p[part]) {
            actions[service] = [{ id: p[part], value: true }];
            features |= feature;
        }
    };
    button('media_play', 'PLAY', FEATURE.PLAY);
    button('media_pause', 'PAUSE', FEATURE.PAUSE);
    button('media_stop', 'STOP', FEATURE.STOP);
    button('media_next_track', 'NEXT', FEATURE.NEXT_TRACK);
    button('media_previous_track', 'PREV', FEATURE.PREVIOUS_TRACK);
    button('volume_up', 'VOLUME_UP', FEATURE.VOLUME_STEP);
    button('volume_down', 'VOLUME_DOWN', FEATURE.VOLUME_STEP);
    // one button for both: it toggles
    if (p.PLAY && p.PLAY === p.PAUSE) {
        actions.media_play_pause = [{ id: p.PLAY, value: true }];
    }
    // without buttons a writable state plays and pauses
    const st = p.STATE ? objects[p.STATE] : undefined;
    if (st?.common.write === true) {
        if (!p.PLAY) {
            actions.media_play = [{ id: p.STATE!, value: stateValue(st, true) }];
            features |= FEATURE.PLAY;
        }
        if (!p.PAUSE) {
            actions.media_pause = [{ id: p.STATE!, value: stateValue(st, false) }];
            features |= FEATURE.PAUSE;
        }
    }
    const attributes: Record<string, Binding | number | string[]> = {};
    const volume = p.VOLUME ?? p.VOLUME_ACTUAL;
    if (volume) {
        const max = objects[volume]?.common.max;
        const top = typeof max === 'number' && max > 0 ? max : 100;
        attributes.volume_level = top === 1 ? { id: volume } : { id: volume, scale: 1 / top };
        if (p.VOLUME) {
            actions.volume_set = [
                top === 1
                    ? { id: p.VOLUME, field: 'volume_level' }
                    : { id: p.VOLUME, field: 'volume_level', scale: top },
            ];
            features |= FEATURE.VOLUME_SET;
        }
    }
    if (p.MUTE) {
        attributes.is_volume_muted = { id: p.MUTE };
        actions.volume_mute = [{ id: p.MUTE, field: 'is_volume_muted' }];
        features |= FEATURE.VOLUME_MUTE;
    }
    if (p.POWER) {
        actions.turn_on = [{ id: p.POWER, value: true }];
        actions.turn_off = [{ id: p.POWER, value: false }];
        features |= FEATURE.TURN_ON | FEATURE.TURN_OFF;
    }
    for (const [key, part] of [
        ['media_title', 'TITLE'],
        ['media_artist', 'ARTIST'],
        ['media_album_name', 'ALBUM'],
        ['entity_picture', 'COVER'],
        ['media_duration', 'DURATION'],
        ['media_position', 'ELAPSED'],
    ] as const) {
        if (p[part]) {
            attributes[key] = { id: p[part] };
        }
    }
    // a TV's app and input: what it shows (the app's logo when it gives no picture), and its choices as sources, which
    // the quick menu offers as chips (YouTube, HDMI 1 …); a choice writes the app's or the input's datapoint
    const sources: string[] = [];
    const select: ActionRule[] = [];
    for (const part of ['APP', 'INPUT'] as const) {
        const id = p[part];
        if (!id) {
            continue;
        }
        const c = objects[id]?.common;
        const texts = choices(c?.states, c?.type);
        attributes[part === 'APP' ? 'app_name' : 'source'] = texts ? { id, map: texts } : { id };
        if (part === 'APP' && !p.INPUT) {
            attributes.source = attributes.app_name;
        }
        if (c?.write === true && texts) {
            const back: Record<string, unknown> = {};
            for (const [value, label] of Object.entries(texts)) {
                if (!sources.includes(label)) {
                    sources.push(label);
                    back[label] = c.type === 'number' ? Number(value) : c.type === 'boolean' ? value === 'true' : value;
                }
            }
            // only the choices of this datapoint: an app goes to the app, an input to the input
            select.push({ id, field: 'source', map: back, optional: true });
        }
    }
    if (select.length) {
        attributes.source_list = sources;
        actions.select_source = select;
        features |= FEATURE.SELECT_SOURCE;
    }
    attributes.supported_features = features;
    const m: Mapping = {
        entity_id: entityId,
        name,
        state: p.STATE ?? p.POWER!,
        attributes,
        actions,
    };
    if (p.STATE) {
        // the state's own texts first (0: "pause", 1: "play" …), then the usual values
        const texts = objects[p.STATE]?.common.states;
        const own: Record<string, string> = {};
        if (texts && typeof texts === 'object' && !Array.isArray(texts)) {
            for (const [key, label] of Object.entries(texts as Record<string, unknown>)) {
                const to = MEDIA_STATES[String(label)] ?? MEDIA_STATES[String(label).toLowerCase()];
                if (to) {
                    own[key] = to;
                }
            }
        }
        m.map = { ...MEDIA_STATES, ...own };
        if (p.POWER) {
            m.when = { id: p.POWER, values: [true], else: 'off' };
        }
    } else {
        m.map = { true: 'on', false: 'off' };
    }
    return m;
}

/** The parts a player has, for the value column of the device tree (▶ ⏸ ⏮ ⏭ 🔊 …). */
export function mediaSummary(parts: Partial<Record<MediaPart, string>>): string {
    return (
        [
            [parts.PLAY || parts.STATE, '▶'],
            [parts.PAUSE, '⏸'],
            [parts.PREV, '⏮'],
            [parts.NEXT, '⏭'],
            [parts.VOLUME || parts.VOLUME_UP, '🔊'],
            [parts.POWER, '⏻'],
            [parts.TITLE, '♪'],
            [parts.COVER, '🖼'],
            [parts.APP || parts.INPUT, '📺'],
        ] as const
    )
        .filter(([id]) => id)
        .map(([, s]) => s)
        .join(' ');
}

/**
 * The media players among `objects` as candidates of "Geräte verbinden": `devices` are the objects of their devices
 * (for the name), `entityId(base)` gives each its id. The tree shows a player as the entry "media_player" below its
 * device (`_meta.path`).
 */
export function mediaCandidates(
    objects: Record<string, StateObject>,
    rooms: Record<string, RoomObject>,
    devices: Record<string, StateObject | undefined>,
    entityId: (base: string) => string,
    nameOf: (o: StateObject | undefined) => string,
): Mapping[] {
    const players = findMediaPlayers(objects);
    return players.map(({ base, parts }) => {
        // a player in a channel ("Player") goes by its device's name; with more of them in the device (the zones of a
        // receiver, two channels of one speaker) the channel's name follows
        const own = devices[base];
        const device = own?.type === 'channel' ? devices[parentOf(base)] : undefined;
        const last = base.slice(base.lastIndexOf('.') + 1).replace(/_/g, ' ');
        const ownName = (own && nameOf(own)) || last;
        const siblings = players.filter(p => parentOf(p.base) === parentOf(base)).length;
        const name =
            device && nameOf(device) ? (siblings > 1 ? `${nameOf(device)} · ${ownName}` : nameOf(device)) : ownName;
        const m = mediaPlayerMapping(entityId(base), name, parts, objects);
        const room = Object.values(rooms).find(r =>
            r.common?.members?.some(
                id => base === id || base.startsWith(`${id}.`) || (parts.STATE ?? '').startsWith(`${id}.`),
            ),
        );
        if (room) {
            m.area_id = room._id;
        }
        m._meta = {
            role: 'media_player',
            type: 'media_player',
            read: true,
            write: true,
            value: mediaSummary(parts),
            path: `${base}.media_player`,
        };
        return m;
    });
}

/** The devices and channels of the media players and the devices above them (for their names). */
export function mediaBases(objects: Record<string, StateObject>): string[] {
    // each with the device above it (a player in a channel goes by its device's name)
    return [...new Set(findMediaPlayers(objects).flatMap(p => [p.base, parentOf(p.base)]))];
}
