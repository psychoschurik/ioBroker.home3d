import assert from 'node:assert/strict';
import test from 'node:test';
import { boatCards, boatFields, boatWatched, type BoatItem } from '../frontend/vendor-ext/boat-cards';

type St = { state: string; attributes: Record<string, unknown> };
const st = (state: string, unit = ''): St => ({ state, attributes: unit ? { unit_of_measurement: unit } : {} });

test('boat cards: the anchor (distance against the radius, chain, depth, scope, alarm) and the tanks', () => {
    const states: Record<string, St> = {
        'sensor.chain': st('35', 'm'),
        'sensor.depth': st('6.2', 'm'),
        'sensor.dist': st('28', 'm'),
        'sensor.rad': st('40', 'm'),
        'binary_sensor.alarm': st('off'),
        'sensor.diesel': st('62', '%'),
        'sensor.diesel_l': st('124', 'l'),
        'sensor.water': st('12', '%'),
        'sensor.black': st('0.4'),
    };
    const anchor: BoatItem = { id: 'a', type: 'anchor', name: 'Anker', anchor_chain: 'sensor.chain', anchor_depth: 'sensor.depth', anchor_distance: 'sensor.dist', anchor_radius: 'sensor.rad', anchor_alarm: 'binary_sensor.alarm' };
    const tanks: BoatItem[] = [
        { id: 't1', type: 'tank', name: 'Diesel', gear_kind: 'fuel', gear_entity: 'sensor.diesel', gear_liters: 'sensor.diesel_l' },
        { id: 't2', type: 'tank', name: 'Wasser', gear_kind: 'water', gear_entity: 'sensor.water' },
        { id: 't3', type: 'tank', gear_kind: 'black', gear_entity: 'sensor.black' },
        { id: 't4', type: 'tank', gear_kind: 'gas', gear_entity: 'none' },
    ];
    let b = { floors: [{ id: 'dk', furniture: [anchor] }, { id: 'ud', furniture: tanks }] };
    const host = { hass: () => ({ states }), building: () => b, language: () => 'de', updateBuilding: (m: (x: typeof b) => void) => { b = structuredClone(b); m(b); } };
    type Card = { id: string; anchor: { furnitureId: string }; live: string; main?: { text: string; side?: { text: string } }; rows: { label: string; value: string; at?: number; color?: string }[]; hint?: { text: string } };
    let [a, t] = boatCards(host) as Card[];
    assert.equal(a.live, 'vor Anker');
    assert.equal(a.main?.text, '28 m');
    assert.equal(a.main?.side?.text, '40 m');
    assert.deepEqual(a.rows.map(r => [r.label, r.value]), [
        ['Abstand', '28 m / 40 m'],
        ['Kette', '35,0 m'],
        ['Tiefe', '6,2 m'],
        ['Kettenlänge : Tiefe', '5,6 : 1'],
    ]);
    assert.equal(a.rows[0].at, 70);
    assert.equal(t.anchor.furnitureId, 't1');
    assert.deepEqual(t.rows.map(r => [r.label, r.value]), [
        ['Diesel', '62 % · 124 l'],
        ['Wasser', '12 %'],
        ['Schwarzwasser', '40 %'],
    ]);
    assert.equal(t.live, 'fast leer / fast voll');
    assert.equal(t.rows[1].color, '#ff5d5d');
    // the alarm, too little chain
    states['binary_sensor.alarm'] = st('on');
    states['sensor.chain'] = st('15', 'm');
    [a] = boatCards(host) as Card[];
    assert.equal(a.live, 'Ankeralarm');
    assert.equal(a.hint?.text, 'zu wenig Kette');
    // stowed: no distance
    states['sensor.chain'] = st('0', 'm');
    states['binary_sensor.alarm'] = st('off');
    [a] = boatCards(host) as Card[];
    assert.equal(a.live, 'eingeholt');
    assert.equal(a.main, undefined);
    assert.deepEqual(boatWatched(host).sort(), ['binary_sensor.alarm', 'sensor.black', 'sensor.chain', 'sensor.depth', 'sensor.diesel', 'sensor.diesel_l', 'sensor.dist', 'sensor.rad', 'sensor.water']);
    // switched off in the form
    const [check] = boatFields(host, anchor) as { label: string; set(v: boolean): void }[];
    assert.equal(check.label, 'Anker: Glaskarte zeigen');
    check.set(false);
    assert.equal((boatCards(host) as Card[]).filter(c => c.id === 'boat:a').length, 0);
});
