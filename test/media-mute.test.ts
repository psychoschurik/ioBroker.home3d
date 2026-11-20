import assert from 'node:assert/strict';
import test from 'node:test';
import { canMute, isMuted, muteCall, speakerPath, type PlayerState } from '../frontend/vendor-ext/media-mute';

// a localStorage of this test (the module reads it only when called)
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
    },
});

let n = 0;
/** A player of its own ID (the clicks shown are kept per player). */
function player(attributes: Record<string, unknown>): PlayerState {
    return { entity_id: `media_player.p${n++}`, attributes };
}

test('canMute: by its own mute or by a volume that can be set', () => {
    assert.equal(canMute(player({ supported_features: 8, is_volume_muted: false })), true);
    assert.equal(canMute(player({ supported_features: 4, volume_level: 0.5 })), true);
    // the volume only reported, not set
    assert.equal(canMute(player({ supported_features: 1, volume_level: 0.5 })), false);
    assert.equal(canMute(player({ supported_features: 1 })), false);
    // features unknown: by what it reports
    assert.equal(canMute(player({ is_volume_muted: true })), true);
    assert.equal(canMute(player({ volume_level: 0.2 })), true);
    assert.equal(canMute(undefined), false);
});

test('a player with a mute of its own: volume_mute, shown at once until it reports it', () => {
    const st = player({ supported_features: 4 | 8, is_volume_muted: false, volume_level: 0.4 });
    assert.equal(isMuted(st), false);
    assert.deepEqual(muteCall(st), { service: 'volume_mute', data: { is_volume_muted: true }, muted: true });
    // not reported yet: the click shows
    assert.equal(isMuted(st), true);
    st.attributes.is_volume_muted = true;
    assert.equal(isMuted(st), true);
    assert.deepEqual(muteCall(st), { service: 'volume_mute', data: { is_volume_muted: false }, muted: false });
    st.attributes.is_volume_muted = false;
    assert.equal(isMuted(st), false);
    // a datapoint may report it as a number or a text
    assert.equal(isMuted(player({ supported_features: 8, is_volume_muted: 1 })), true);
    assert.equal(isMuted(player({ supported_features: 8, is_volume_muted: 'false' })), false);
});

test('a player with only a volume: to 0 and back to the volume before', () => {
    const st = player({ supported_features: 4, volume_level: 0.45 });
    assert.equal(isMuted(st), false);
    assert.deepEqual(muteCall(st), { service: 'volume_set', data: { volume_level: 0 }, muted: true });
    st.attributes.volume_level = 0;
    assert.equal(isMuted(st), true);
    assert.deepEqual(muteCall(st), { service: 'volume_set', data: { volume_level: 0.45 }, muted: false });
    st.attributes.volume_level = 0.45;
    assert.equal(isMuted(st), false);
    // the volume kept is used once
    assert.equal(JSON.parse(store.get('home3d.volumeBeforeMute') ?? '{}')[st.entity_id], undefined);
});

test('a player that claims a mute but reports none is muted by its volume', () => {
    const st = player({ supported_features: 4 | 8, volume_level: 0.35 });
    assert.equal(canMute(st), true);
    assert.deepEqual(muteCall(st), { service: 'volume_set', data: { volume_level: 0 }, muted: true });
});

test('a player at volume 0 without a volume kept comes back at 30 %', () => {
    const st = player({ supported_features: 4, volume_level: 0 });
    assert.equal(isMuted(st), true);
    assert.deepEqual(muteCall(st), { service: 'volume_set', data: { volume_level: 0.3 }, muted: false });
});

test('a player that can do neither gets no call', () => {
    assert.equal(muteCall(player({ supported_features: 1 })), null);
});

test('the speaker is crossed out while silent', () => {
    assert.notEqual(speakerPath(true), speakerPath(false));
    assert.match(speakerPath(false), /^M/);
});
