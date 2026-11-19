import test from 'node:test';
import assert from 'node:assert/strict';
import { entities, execute, validateMappings } from '../frontend/entities';
import { findMediaPlayers, mediaCandidates, mediaPlayerMapping } from '../frontend/media';
import type { IoAccess, StateObject } from '../frontend/model';

const st = (role: string, type: string, write = false, extra: Record<string, unknown> = {}): StateObject =>
    ({ type: 'state', common: { name: role, role, type, read: true, write, ...extra } }) as StateObject;

// a cast player: its state in "player", the title and cover in "media"; a lamp beside it
const cast: Record<string, StateObject> = {
    'cast.0.devices.Wohnzimmer_TV.player.state': st('media.state', 'string'),
    'cast.0.devices.Wohnzimmer_TV.player.play': st('button.play', 'boolean', true),
    'cast.0.devices.Wohnzimmer_TV.player.pause': st('button.pause', 'boolean', true),
    'cast.0.devices.Wohnzimmer_TV.player.next': st('button.next', 'boolean', true),
    'cast.0.devices.Wohnzimmer_TV.player.prev': st('button.prev', 'boolean', true),
    'cast.0.devices.Wohnzimmer_TV.player.volume': st('level.volume', 'number', true, { min: 0, max: 100 }),
    'cast.0.devices.Wohnzimmer_TV.player.mute': st('media.mute', 'boolean', true),
    'cast.0.devices.Wohnzimmer_TV.media.title': st('media.title', 'string'),
    'cast.0.devices.Wohnzimmer_TV.media.cover': st('media.cover', 'string'),
    'hue.0.lamp.on': st('switch.light', 'boolean', true),
};

// a TV without a play state: only its power and volume keys
const tv: Record<string, StateObject> = {
    'lgtv.0.states.power': st('switch.power', 'boolean', true),
    'lgtv.0.states.volumeUp': st('button.volume.up', 'boolean', true),
    'lgtv.0.states.volumeDown': st('button.volume.down', 'boolean', true),
    'lgtv.0.states.volume': st('level.volume', 'number', true, { max: 100 }),
};

test('media players are found by the roles of their states, also across the channels of their device', () => {
    const found = findMediaPlayers({ ...cast, ...tv });
    assert.deepEqual(
        found.map(f => f.base),
        ['cast.0.devices.Wohnzimmer_TV', 'lgtv.0.states'],
    );
    // the whole device: the controls of "player", the title and cover of "media"
    assert.equal(found[0].parts.PLAY, 'cast.0.devices.Wohnzimmer_TV.player.play');
    assert.equal(found[0].parts.COVER, 'cast.0.devices.Wohnzimmer_TV.media.cover');
    assert.equal(found[1].parts.POWER, 'lgtv.0.states.power');
    // a state with nothing to control is no player
    assert.deepEqual(findMediaPlayers({ 'x.0.a.state': st('media.state', 'string') }), []);
});

test('a player in an adapter without devices is not taken; in a device it is', () => {
    const objects: Record<string, StateObject> = {
        'kodi.0.info.playing': st('media.state', 'boolean'),
        'kodi.0.player.play': st('button.play', 'boolean', true),
        'kodi.0.player.pause': st('button.pause', 'boolean', true),
        'kodi.0.player.next': st('button.next', 'boolean', true),
    };
    // kodi.0 is the instance: not taken as a device (fewer than three parts)
    assert.deepEqual(findMediaPlayers(objects), []);
    const deeper = Object.fromEntries(Object.entries(objects).map(([id, o]) => [id.replace('kodi.0.', 'kodi.0.box.'), o]));
    const [p] = findMediaPlayers(deeper);
    assert.equal(p.base, 'kodi.0.box');
    assert.equal(p.parts.NEXT, 'kodi.0.box.player.next');
});

test('a player becomes one valid mapping: its state, volume, title and an action for each control', async () => {
    const [cand] = mediaCandidates(cast, {}, {}, base => `media_player.p${base.length}`, () => '');
    assert.equal(cand.name, 'Wohnzimmer TV');
    assert.equal(cand._meta?.path, 'cast.0.devices.Wohnzimmer_TV.media_player');
    assert.deepEqual(cand.attributes?.entity_picture, { id: 'cast.0.devices.Wohnzimmer_TV.media.cover' });
    const { _meta, ...m } = cand;
    assert.ok(_meta);
    validateMappings([m], cast);
    const states = {
        'cast.0.devices.Wohnzimmer_TV.player.state': { val: 'PLAYING', ts: 1 },
        'cast.0.devices.Wohnzimmer_TV.player.volume': { val: 40, ts: 1 },
        'cast.0.devices.Wohnzimmer_TV.player.mute': { val: false, ts: 1 },
    };
    const e = entities([m], states as never, cast)[m.entity_id];
    assert.equal(e.state, 'playing');
    assert.equal(e.attributes.volume_level, 0.4);
    // pause 1, volume 4, mute 8, previous 16, next 32, play 16384
    assert.equal(e.attributes.supported_features, 1 | 4 | 8 | 16 | 32 | 16384);
    const written: [string, unknown][] = [];
    const io = {
        getObjects: async (ids: string[]) => Object.fromEntries(ids.map(id => [id, cast[id]])),
        getState: async () => null,
        setState: async (id: string, value: unknown) => void written.push([id, value]),
    } as unknown as IoAccess;
    await execute([m], 'media_player', 'media_next_track', { entity_id: m.entity_id }, io);
    await execute([m], 'media_player', 'volume_set', { entity_id: m.entity_id, volume_level: 0.5 }, io);
    assert.deepEqual(written, [
        ['cast.0.devices.Wohnzimmer_TV.player.next', true],
        ['cast.0.devices.Wohnzimmer_TV.player.volume', 50],
    ]);
});

test('a TV without a play state is on or off by its power; a writable state plays and pauses', () => {
    const [p] = findMediaPlayers(tv);
    const m = mediaPlayerMapping('media_player.tv', 'TV', p.parts, tv);
    assert.equal(m.state, 'lgtv.0.states.power');
    assert.deepEqual(m.actions?.turn_off, [{ id: 'lgtv.0.states.power', value: false }]);
    assert.deepEqual(m.actions?.volume_up, [{ id: 'lgtv.0.states.volumeUp', value: true }]);
    const e = entities([m], { 'lgtv.0.states.power': { val: true, ts: 1 } } as never, tv)['media_player.tv'];
    assert.equal(e.state, 'on');
    const objects: Record<string, StateObject> = {
        'sonos.0.room.state': st('media.state', 'boolean', true),
        'sonos.0.room.next': st('button.next', 'boolean', true),
    };
    const [s] = findMediaPlayers(objects);
    const sm = mediaPlayerMapping('media_player.s', 'S', s.parts, objects);
    assert.deepEqual(sm.actions?.media_play, [{ id: 'sonos.0.room.state', value: true }]);
    assert.deepEqual(sm.actions?.media_pause, [{ id: 'sonos.0.room.state', value: false }]);
});

test('a player goes by its device when it lies in a channel; the texts of its state count', () => {
    const objects: Record<string, StateObject> = {
        'alexa2.0.Echo.Player.currentState': st('media.state', 'boolean'),
        'alexa2.0.Echo.Player.controlPlay': st('button.play', 'boolean', true),
        'alexa2.0.Echo.Media.state': st('media.state', 'boolean'),
        'yt.0.tv.state': st('media.state', 'number', false, { states: { 0: 'pause', 1: 'play', 2: 'stop' } }),
        'yt.0.tv.play': st('button.play', 'boolean', true),
    };
    const devices = {
        'alexa2.0.Echo.Player': { type: 'channel', common: { name: 'Player' } } as StateObject,
        'alexa2.0.Echo': { type: 'device', common: { name: 'Echo Salon' } } as StateObject,
    };
    const players = mediaCandidates(objects, {}, devices, b => `media_player.${b.replace(/\W/g, '_')}`, o =>
        typeof o?.common.name === 'string' ? o.common.name : '',
    );
    assert.deepEqual(
        players.map(p => p.name),
        ['Echo Salon', 'tv'],
    );
    const yt = players[1];
    const e = entities([yt], { 'yt.0.tv.state': { val: 2, ts: 1 } } as never, objects)[yt.entity_id];
    assert.equal(e.state, 'idle');
});
