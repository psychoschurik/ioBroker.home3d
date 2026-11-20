// Muting a media player in the 3D view: the speaker beside the volume slider of the glass card, the quick menu and the
// room's panel (tasks.ts patches them). A player with a mute of its own (feature 8: a datapoint with the role
// media.mute) is muted by it; one with only a volume goes to 0 and back to the volume it had before (kept per browser
// in localStorage "home3d.volumeBeforeMute"). What was clicked shows at once, until the player reports it (at most 10 s).
import { mdiVolumeHigh, mdiVolumeOff } from '@mdi/js';

/** What of a player's state is read here. */
export interface PlayerState {
    entity_id: string;
    attributes: Record<string, unknown>;
}

/** supported_features of a media player */
const VOLUME_SET = 4;
const VOLUME_MUTE = 8;
/** Unmuted by its volume without one known from before: this much. */
const DEFAULT_LEVEL = 0.3;
const KEY = 'home3d.volumeBeforeMute';
/** The click shows that long at most while the player does not report it. */
const WAIT = 10_000;

const intents = new Map<string, { muted: boolean; at: number }>();

function features(st: PlayerState): number | null {
    const f = st.attributes.supported_features;
    return typeof f === 'number' ? f : null;
}

/**
 * It has a mute of its own: it reports one (a feature without a value, as some players claim, would mute nothing; its
 * volume does then), and the feature, if it names its features.
 */
function ownMute(st: PlayerState): boolean {
    const f = features(st);
    const v = st.attributes.is_volume_muted;
    return v !== undefined && v !== null && (f === null || (f & VOLUME_MUTE) !== 0);
}

/** Its volume can be set (unknown features: when it reports one). */
function settableVolume(st: PlayerState): boolean {
    const f = features(st);
    return typeof st.attributes.volume_level === 'number' && (f === null || (f & VOLUME_SET) !== 0);
}

function on(v: unknown): boolean {
    return v === true || v === 1 || v === 'true' || v === 'on' || v === '1';
}

function kept(): Record<string, number> {
    try {
        const v: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
        return v && typeof v === 'object' ? (v as Record<string, number>) : {};
    } catch {
        return {};
    }
}

function keep(id: string, level: number | null): void {
    try {
        const all = kept();
        if (level === null) {
            delete all[id];
        } else {
            all[id] = level;
        }
        localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
        // no storage (private window): the volume comes back as DEFAULT_LEVEL
    }
}

/** Whether the speaker is shown: the player can be muted by its mute or by its volume. */
export function canMute(st: PlayerState | undefined): boolean {
    return !!st && (ownMute(st) || settableVolume(st));
}

/** Whether it is silent: muted by its mute; without one, at volume 0. A click shows until the player reports it. */
export function isMuted(st: PlayerState): boolean {
    const reported = ownMute(st) ? on(st.attributes.is_volume_muted) : st.attributes.volume_level === 0;
    const intent = intents.get(st.entity_id);
    if (intent && (intent.muted === reported || Date.now() - intent.at > WAIT)) {
        intents.delete(st.entity_id);
    }
    return intents.get(st.entity_id)?.muted ?? reported;
}

/**
 * The call that mutes or unmutes it: `volume_mute` by its own mute, else `volume_set` to 0 (keeping the volume) and
 * back to the volume kept. Null: it can do neither.
 */
export function muteCall(
    st: PlayerState,
): { service: 'volume_mute' | 'volume_set'; data: Record<string, unknown>; muted: boolean } | null {
    const muted = !isMuted(st);
    let call: { service: 'volume_mute' | 'volume_set'; data: Record<string, unknown>; muted: boolean };
    if (ownMute(st)) {
        call = { service: 'volume_mute', data: { is_volume_muted: muted }, muted };
    } else if (!settableVolume(st)) {
        return null;
    } else if (muted) {
        keep(st.entity_id, st.attributes.volume_level as number);
        call = { service: 'volume_set', data: { volume_level: 0 }, muted };
    } else {
        const level = kept()[st.entity_id];
        keep(st.entity_id, null);
        call = {
            service: 'volume_set',
            data: { volume_level: typeof level === 'number' && level > 0 && level <= 1 ? level : DEFAULT_LEVEL },
            muted,
        };
    }
    intents.set(st.entity_id, { muted, at: Date.now() });
    return call;
}

/** The speaker's symbol: crossed out while silent. */
export function speakerPath(muted: boolean): string {
    return muted ? mdiVolumeOff : mdiVolumeHigh;
}
