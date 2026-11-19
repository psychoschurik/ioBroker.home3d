import assert from 'node:assert/strict';
import test from 'node:test';
import { boatCards, boatFields, boatWatched, windCard, type BoatItem } from '../frontend/vendor-ext/boat-cards';

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

test('wind card: true wind in knots on a boat, Beaufort, where from, apparent wind, pressure, gale warning', () => {
    const now = Date.parse('2026-11-19T12:00:00Z');
    const at = { last_updated: new Date(now - 60000).toISOString() };
    const states: Record<string, St & { last_updated?: string }> = {
        'sensor.tws': { state: '18.19', attributes: { unit_of_measurement: 'kn' }, ...at },
        'sensor.twd': { state: '178.8', attributes: { unit_of_measurement: '°' }, ...at },
        'sensor.aws': { state: '22', attributes: { unit_of_measurement: 'kn', iobroker_id: 'nmea.0.windData.windSpeedApparent' }, ...at },
        'sensor.awa': { state: '-99.6', attributes: { unit_of_measurement: '°', iobroker_id: 'nmea.0.windData.windAngleApparent' }, ...at },
        'sensor.baro': { state: '1012.6', attributes: { unit_of_measurement: 'hPa' }, ...at },
    };
    const vane: BoatItem = { id: 'v', type: 'wind_vane', wind_apparent_speed: 'sensor.aws', wind_apparent_angle: 'sensor.awa' };
    const settings: Record<string, string | number> = { wind_speed: 'sensor.tws', wind_dir: 'sensor.twd', pressure_entity: 'sensor.baro', sea_level: -1.3 };
    const host = { hass: () => ({ states }), building: () => ({ settings, floors: [{ id: 'dk', furniture: [vane] }] }), language: () => 'de' };
    type Card = { live: string; status: { text: string }; main: { text: string; side?: { text: string } }; rows: { label: string; value: string }[]; hint?: { text: string } };
    const card = windCard(host, 'dk', vane, now) as Card;
    assert.equal(card.main.text, '18 kn');
    assert.equal(card.main.side?.text, 'S 179°');
    assert.equal(card.live, '18 kn · S 179°');
    assert.equal(card.status.text, 'Brise');
    assert.deepEqual(card.rows.map(r => [r.label, r.value]), [
        ['Windstärke', '5 Bft'],
        ['scheinbarer Wind', '22 kn · 100° Bb'],
        ['Luftdruck', '1.013 hPa'],
    ]);
    assert.equal(card.hint, undefined);
    states['sensor.tws'] = { ...states['sensor.tws'], state: '30' };
    const gale = windCard(host, 'dk', vane, now) as Card;
    assert.equal(gale.status.text, 'Starkwind');
    assert.equal(gale.hint?.text, 'Starkwind: 7 Bft');
    assert.ok(boatWatched(host).includes('sensor.awa'));
    // instruments off for two hours: the weather service's wind, no apparent wind
    const old = { last_updated: new Date(now - 2 * 3600000).toISOString() };
    for (const id of ['sensor.tws', 'sensor.twd', 'sensor.aws', 'sensor.awa']) {
        states[id] = { ...states[id], ...old };
    }
    states['weather.home'] = { state: 'cloudy', attributes: { wind_speed: 15, wind_bearing: 160, wind_speed_unit: 'km/h' }, ...at };
    settings.weather_entity = 'weather.home';
    const off = windCard(host, 'dk', vane, now) as Card & { main: { sub: string } };
    assert.equal(off.main.text, '8 kn');
    assert.equal(off.main.sub, 'laut Wetterdienst');
    assert.equal(off.rows.some(r => r.label === 'scheinbarer Wind'), false);
    // the form finds the apparent wind by its datapoint
    const fields = boatFields(host, { id: 'v', type: 'wind_vane' }) as { auto?: string | null }[];
    assert.deepEqual(fields.slice(1, 3).map(f => f.auto), ['sensor.aws', 'sensor.awa']);
});
