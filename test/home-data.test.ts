import assert from 'node:assert/strict';
import test from 'node:test';
import {
    activityColor,
    airFlow,
    carPresent,
    cheapestWindow,
    climateHeats,
    coldCorners,
    convexHull,
    dryness,
    edgeNormalOut,
    flowLpm,
    healthKey,
    healthOf,
    healthProblem,
    isNoiseSensor,
    isOn,
    isOuterEdge,
    lanes,
    mediaLevel,
    meterLitres,
    MeterFlow,
    mouldRisk,
    mowerPhase,
    noiseLevel,
    parseForecast,
    pathLength,
    pointAt,
    pointIn,
    priceLevel,
    priceTone,
    roomActivity,
    slotsFromHistory,
    type StateLike,
    type Vec2,
    warningLevel,
    warningText,
} from '../frontend/vendor-ext/home-data';
import { gearMarkers, healthReport, homeScene, homeWatched, type BuildingLike, type HomeInput } from '../frontend/vendor-ext/home-view';

const st = (state: string, attributes: Record<string, unknown> = {}, last_changed?: string): StateLike => ({
    state,
    attributes,
    last_changed,
});
const near = (a: number, b: number, eps = 0.05): void => {
    assert.ok(Math.abs(a - b) <= eps, `${a} is not near ${b}`);
};
const square = (x0: number, z0: number, x1: number, z1: number): Vec2[] => [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
];

test('health: battery, low battery, unreachable, stopped adapter', () => {
    assert.equal(healthProblem(healthOf(st('21', { battery_level: 80 }))), null);
    assert.equal(healthOf(st('21', { battery_level: 15 })).low, true);
    assert.equal(healthProblem(healthOf(st('21', { battery_low: true }))), 'battery');
    assert.equal(healthProblem(healthOf(st('21', { unreachable: true, battery_level: 5 }))), 'unreach');
    assert.equal(healthOf(st('21', { iobroker_adapter: 'stopped' })).adapter, 'stopped');
    assert.equal(healthProblem(healthOf(st('unavailable'))), 'unreach');
    // a datapoint without a value of a device that reports its own health: judged by its health datapoints
    assert.equal(healthProblem(healthOf(st('unavailable', { health_device: 'victron-cerbo.0.system' }))), null);
    assert.equal(healthKey('sensor.a', st('1', { health_device: 'hm-rpc.0.ABC' })), 'hm-rpc.0.ABC');
    assert.equal(healthKey('sensor.a', st('1')), 'sensor.a');
});

test('mould: the coldest corner of a humid room', () => {
    // 20 °C and 60 % inside, 0 °C outside: the corner has 14 °C and almost 88 % there
    const m = mouldRisk(20, 60, 0);
    near(m.surface, 14);
    near(m.dewPoint, 12, 0.2);
    assert.ok(m.surfaceRh > 85 && m.surfaceRh < 90);
    assert.equal(m.level, 2);
    // a dry room on a mild day is fine
    assert.equal(mouldRisk(21, 45, 5).level, 0);
    // 70 % in the room is a hint even without outdoor temperature
    assert.equal(mouldRisk(22, 70, null).level >= 1, true);
});

test('geometry: outward normal, outer walls, cold corners, hull', () => {
    const room = square(0, 0, 4, 3);
    // edge 0 runs along z = 0: outward is -z
    assert.deepEqual(
        edgeNormalOut(room, 0).map(v => Math.round(v) + 0),
        [0, -1],
    );
    assert.deepEqual(
        edgeNormalOut([...room].reverse(), 0).map(v => Math.round(v) + 0),
        [0, 1],
    );
    assert.equal(pointIn([1, 1], room), true);
    assert.equal(pointIn([5, 1], room), false);
    const neighbour = square(4, 0, 8, 3);
    // edge 1 (x = 4) borders the neighbour: no outer wall
    assert.equal(isOuterEdge(room, 1, [room, neighbour]), false);
    assert.equal(isOuterEdge(room, 0, [room, neighbour]), true);
    const corners = coldCorners(room, [room, neighbour]);
    // the corners at x = 0 lie between two outer walls
    assert.deepEqual(corners.map(c => [c.x, c.z]).sort(), [
        [0, 0],
        [0, 3],
    ]);
    assert.equal(convexHull([...room, ...neighbour, [2, 1]]).length, 4);
});

test('air: the wind blows in on its side and out on the other', () => {
    // a wall facing north (-z) with the wind blowing south (+z): air comes in
    assert.ok(airFlow([0, -1], [0, 1], 5) > 0);
    assert.ok(airFlow([0, 1], [0, 1], 5) < 0);
    assert.equal(airFlow([0, 1], null, 5), 0);
});

test('heating: thermostat action or mode below its target', () => {
    assert.equal(climateHeats(st('heat', { hvac_action: 'heating' })), true);
    assert.equal(climateHeats(st('heat', { hvac_action: 'idle' })), false);
    assert.equal(climateHeats(st('auto', { current_temperature: 18, temperature: 21 })), true);
    assert.equal(climateHeats(st('auto', { current_temperature: 21, temperature: 21 })), false);
    assert.equal(climateHeats(st('off', { current_temperature: 15, temperature: 21 })), false);
    assert.equal(climateHeats(undefined), false);
});

test('price: forecast, level, cheapest hour', () => {
    const h = 3600_000;
    const day = Date.UTC(2026, 10, 17, 0);
    const prices = [0.3, 0.28, 0.25, 0.2, 0.15, 0.1, 0.12, 0.22, 0.35, 0.4];
    const tibber = JSON.stringify(prices.map((p, i) => ({ startsAt: new Date(day + i * h).toISOString(), total: p })));
    const slots = parseForecast(tibber);
    assert.equal(slots.length, prices.length);
    assert.equal(slots[0].end, day + h);
    // nested lists (today and tomorrow) and times in seconds
    const nested = parseForecast({ today: [{ start: day / 1000, price: 1 }], tomorrow: [{ start: (day + h) / 1000, price: 2 }] });
    assert.deepEqual(
        nested.map(s => s.price),
        [1, 2],
    );
    assert.deepEqual(parseForecast('no json'), []);
    const now = day + 30 * 60_000;
    near(priceLevel(0.3, slots, now) ?? -1, (0.3 - 0.1) / 0.3);
    assert.equal(priceLevel(0.3, slots.slice(0, 2), now), null);
    assert.equal(priceTone(0.1), 'cheap');
    assert.equal(priceTone(0.9), 'dear');
    const best = cheapestWindow(slots, now, 1);
    assert.equal(best?.start, day + 5 * h);
    assert.equal(best?.end, day + 6 * h);
    const hist = slotsFromHistory(
        [
            { s: '0.2', lu: day / 1000 },
            { s: 'x', lu: day / 1000 + 10 },
            { s: '0.3', lu: (day + h) / 1000 },
        ],
        day + 2 * h,
    );
    assert.deepEqual(
        hist.map(s => [s.price, s.end - s.start]),
        [
            [0.2, h],
            [0.3, h],
        ],
    );
});

test('weather warnings: numbers, words, headline', () => {
    assert.equal(warningLevel(3), 3);
    assert.equal(warningLevel('7'), 4);
    assert.equal(warningLevel('Unwetterwarnung'), 3);
    assert.equal(warningLevel('Markante Wetterwarnung'), 2);
    assert.equal(warningLevel('gelb'), 1);
    assert.equal(warningLevel('Extreme'), 4);
    assert.equal(warningLevel('keine'), 0);
    assert.equal(warningLevel(null), 0);
    assert.equal(warningText(st('2', { headline: 'Amtliche Warnung vor Sturmböen' })), 'Amtliche Warnung vor Sturmböen');
    assert.equal(warningText(st('Unwetter')), 'Unwetter');
    assert.equal(warningText(st('2')), '');
});

test('motion: activity per room and its colour', () => {
    const rooms = roomActivity(
        [
            { entity: 'a', time: 10 },
            { entity: 'a', time: 30 },
            { entity: 'b', time: 20 },
            { entity: 'c', time: 40 },
        ],
        new Map([
            ['a', 'kitchen'],
            ['b', 'hall'],
        ]),
    );
    assert.deepEqual(rooms.get('kitchen'), { count: 2, last: 30 });
    assert.deepEqual(rooms.get('hall'), { count: 1, last: 20 });
    assert.equal(rooms.size, 2);
    const most = activityColor(2, 2);
    const little = activityColor(1, 10);
    assert.ok(most[1] < little[1], 'the busiest room is redder');
});

test('mower: phases of Worx, Husqvarna and words', () => {
    assert.equal(mowerPhase(2), 'mowing');
    assert.equal(mowerPhase('5'), 'returning');
    assert.equal(mowerPhase(1), 'docked');
    assert.equal(mowerPhase(9), 'error');
    assert.equal(mowerPhase('MOWING'), 'mowing');
    assert.equal(mowerPhase('GOING_HOME'), 'returning');
    assert.equal(mowerPhase('PARKED_IN_CS'), 'docked');
    assert.equal(mowerPhase('CHARGING'), 'docked');
    assert.equal(mowerPhase('STOPPED_IN_GARDEN'), 'error');
    assert.equal(mowerPhase('Mäht'), 'mowing');
    assert.equal(mowerPhase('paused'), 'paused');
    assert.equal(mowerPhase('unavailable'), 'unknown');
});

test('mower: lanes over a lawn, back and forth', () => {
    const lawn = square(0, 0, 4, 4);
    const path = lanes(lawn, 1, 0);
    assert.equal(path.length, 8);
    for (const p of path) {
        assert.equal(pointIn(p, lawn), true);
    }
    // the second lane runs the other way
    assert.ok(path[1][0] > path[0][0]);
    assert.ok(path[3][0] < path[2][0]);
    // turned lanes stay in the lawn too
    for (const p of lanes(lawn, 0.5, 0.6)) {
        assert.equal(pointIn(p, lawn), true);
    }
    const line: Vec2[] = [
        [0, 0],
        [3, 0],
        [3, 4],
    ];
    assert.equal(pathLength(line), 7);
    assert.deepEqual(pointAt(line, 4).p, [3, 1]);
    assert.deepEqual(pointAt(line, 8).p, [1, 0]);
});

test('switches, soil, sound and water', () => {
    assert.equal(isOn(st('on')), true);
    assert.equal(isOn(st('offen')), true);
    assert.equal(isOn(st('0')), false);
    assert.equal(isOn(st('3.5')), true);
    assert.equal(isOn(st('unavailable')), false);
    assert.equal(dryness(50), 0);
    assert.ok(dryness(10) > 0.5);
    assert.equal(mediaLevel(st('playing', { volume_level: 0.4 })), 0.4);
    assert.equal(mediaLevel(st('playing', { volume_level: 40 })), 0.4);
    assert.equal(mediaLevel(st('playing', { volume_level: 0.4, is_volume_muted: true })), 0);
    assert.equal(mediaLevel(st('paused', { volume_level: 0.4 })), 0);
    assert.equal(noiseLevel(85), 1);
    assert.equal(noiseLevel(30), 0);
    assert.equal(isNoiseSensor(st('60', { unit_of_measurement: 'dB' })), true);
    assert.equal(isNoiseSensor(st('60', { unit_of_measurement: '%' })), false);
    assert.equal(flowLpm(120, 'l/h'), 2);
    assert.equal(flowLpm(0.6, 'm³/h'), 10);
    assert.equal(meterLitres(1.5, 'm³'), 1500);
    assert.equal(meterLitres(12, 'l'), 12);
});

test('water meter: flow and how long it runs', () => {
    const m = new MeterFlow();
    const min = 60_000;
    m.add(0, 1000);
    m.add(min, 1010);
    m.add(2 * min, 1020);
    near(m.flow(2 * min), 10);
    assert.equal(m.running(2 * min, m.flow(2 * min)), 2 * min);
    // a short pause does not end the run
    assert.equal(m.running(4 * min, 0), 2 * min);
    // a long one does
    assert.equal(m.running(9 * min, 0), null);
    // no reading for long: no flow
    assert.equal(m.flow(10 * min), 0);
});

const t = (key: string, vars: Record<string, string> = {}): string =>
    `${key}${Object.values(vars).length ? `(${Object.values(vars).join(',')})` : ''}`;

function input(b: BuildingLike, states: Record<string, StateLike>, patch: Partial<HomeInput> = {}): HomeInput {
    return {
        hass: { states },
        building: b,
        now: Date.parse('2026-11-17T12:00:00Z'),
        t,
        areaEntities: area => Object.keys(states).filter(id => (states[id].attributes.area as string | undefined) === area),
        climate: () => ({ t: null, rh: null }),
        openings: new Map(),
        contacts: new Map(),
        markers: [],
        wind: null,
        tOut: null,
        leaks: [],
        priceHistory: [],
        health: false,
        meter: new MeterFlow(),
        fmt: (n, d) => n.toFixed(d),
        time: ms => new Date(ms).toISOString().slice(11, 16),
        ...patch,
    };
}

const house = (): BuildingLike => ({
    settings: {},
    floors: [
        {
            id: 'eg',
            elevation: 0,
            height: 2.6,
            rooms: [
                { id: 'living', name: 'Wohnen', area_id: 'living', points: square(0, 0, 5, 4) },
                { id: 'bath', name: 'Bad', area_id: 'bath', points: square(5, 0, 8, 4) },
            ],
            openings: [
                { id: 'w1', room_id: 'living', edge: 0, offset: 2, width: 1.2, type: 'window', sill: 0.9, height: 1.3 },
                // the wall to the bath is no outer wall
                { id: 'd1', room_id: 'living', edge: 1, offset: 2, width: 0.9, type: 'door', sill: 0, height: 2 },
            ],
            furniture: [
                { id: 'sh', type: 'shower', x: 7, z: 1, w: 0.9, d: 0.9, h: 0.1, rotation: 0, water: 'sensor.shower' },
                { id: 'mow', type: 'robot_mower', x: 2, z: -5, w: 0.5, d: 0.6, h: 0.25, rotation: 0, entity: 'sensor.mower' },
                {
                    id: 'spr',
                    type: 'sprinkler',
                    x: 3,
                    z: -6,
                    w: 6,
                    d: 6,
                    h: 0.1,
                    rotation: 0,
                    entity: 'switch.valve',
                    moisture: 'sensor.soil',
                    moisture_min: 30,
                },
            ],
            outdoor: [{ id: 'lawn', type: 'lawn', points: square(-2, -10, 8, -2) }],
        },
    ],
});

test('home: open window while heating, mould, water, garden', () => {
    const b = house();
    const states: Record<string, StateLike> = {
        'climate.living': st('heat', { hvac_action: 'heating', area: 'living' }),
        'binary_sensor.w1': st('on', {}, '2026-11-17T11:30:00Z'),
        'sensor.shower': st('on'),
        'sensor.mower': st('mowing'),
        'switch.valve': st('on'),
        'sensor.soil': st('12'),
    };
    const out = homeScene(
        input(b, states, {
            openings: new Map([
                ['w1', { open: 1, tilt: 0, open2: 0, tilt2: 0 }],
                ['d1', { open: 1, tilt: 0, open2: 0, tilt2: 0 }],
            ]),
            contacts: new Map([['w1', 'binary_sensor.w1']]),
            climate: (_f, r) => (r.id === 'living' ? { t: 20, rh: 65 } : { t: null, rh: null }),
            tOut: 0,
            wind: { to: [0, 1], speed: 6 },
        }),
    );
    // only the window in the outer wall lets air through; with the wind on its side it blows in
    assert.deepEqual(
        out.scene.airs.map(a => a.id),
        ['w1'],
    );
    assert.ok(out.scene.airs[0].flow > 0);
    assert.equal(out.scene.airs[0].heat, true);
    const warn = out.alerts.find(a => a.kind === 'fp3d_window_heat');
    assert.equal(warn?.roomId, 'living');
    assert.equal(warn?.text, 'home_window_heat(30)');
    assert.equal(out.scene.moulds[0]?.id, 'living');
    assert.equal(out.scene.moulds[0].level, 2);
    // the mould risk switched off on its own: the air at the window stays
    const quiet = house();
    quiet.settings = { ...quiet.settings, mould: false };
    const noMould = homeScene(
        input(quiet, states, {
            openings: new Map([['w1', { open: 1, tilt: 0, open2: 0, tilt2: 0 }]]),
            contacts: new Map([['w1', 'binary_sensor.w1']]),
            climate: (_f, r) => (r.id === 'living' ? { t: 20, rh: 65 } : { t: null, rh: null }),
            tOut: 0,
            wind: { to: [0, 1], speed: 6 },
        }),
    );
    assert.equal(noMould.scene.moulds.length, 0);
    assert.equal(noMould.scene.airs.length, 1);
    assert.equal(out.scene.streams[0]?.id, 'sh');
    assert.equal(out.scene.sprinklers[0]?.on, true);
    assert.equal(out.scene.mowers[0]?.phase, 'mowing');
    assert.equal(out.scene.mowers[0].lawn, 'lawn');
    assert.ok((out.scene.lawns[0]?.dry ?? 0) > 0.5);
    assert.equal(out.scene.lawns[0].mown, true);
    assert.equal(out.warning, 0);
    assert.equal(out.scene.glow, null);
});

test('home: a closed window, no heat, no alerts', () => {
    const out = homeScene(input(house(), { 'climate.living': st('off', { area: 'living' }) }));
    assert.equal(out.scene.airs.length, 0);
    assert.equal(out.alerts.length, 0);
    assert.equal(out.scene.streams.length, 0);
});

test('home: weather warning, price glow, a leak, water running long', () => {
    const b = house();
    b.settings = { warning_entity: 'sensor.dwd', price_entity: 'sensor.price', price_forecast: 'sensor.prices', water_flow: 'sensor.flow' };
    const now = Date.parse('2026-11-17T12:00:00Z');
    const h = 3600_000;
    const prices = JSON.stringify([0.1, 0.2, 0.3, 0.4, 0.15].map((p, i) => ({ startsAt: new Date(now - 2 * h + i * h).toISOString(), total: p })));
    const states: Record<string, StateLike> = {
        'sensor.dwd': st('3', { headline: 'Unwetterwarnung vor Orkanböen' }),
        'sensor.price': st('0.4'),
        'sensor.prices': st(prices),
        'sensor.flow': st('6', { unit_of_measurement: 'l/min' }),
        'binary_sensor.leak': st('on', {}, new Date(now - 15 * 60_000).toISOString()),
    };
    const meter = new MeterFlow();
    // the water has been running for 40 minutes
    homeScene(input(b, states, { now: now - 40 * 60_000, meter }));
    const out = homeScene(
        input(b, states, {
            now,
            meter,
            leaks: [{ entity: 'binary_sensor.leak', roomId: 'bath', floorId: 'eg' }],
        }),
    );
    assert.equal(out.warning, 3);
    const wx = out.alerts.find(a => a.kind === 'fp3d_wx3');
    assert.equal(wx?.text, 'Unwetterwarnung vor Orkanböen');
    assert.equal(wx?.quiet, true);
    assert.equal(out.price?.level, 1);
    assert.ok(out.price?.cheapest);
    assert.equal(out.scene.glow?.floor, 'eg');
    assert.ok((out.scene.glow?.color[0] ?? 0) > (out.scene.glow?.color[1] ?? 1), 'dear: red');
    assert.equal(out.scene.floods[0]?.id, 'bath');
    near(out.scene.floods[0].level, 0.072, 0.001);
    assert.ok(out.alerts.some(a => a.kind === 'fp3d_water_run'));
});

test('home: the entities watched', () => {
    const b = house();
    b.settings = { warning_entity: 'sensor.dwd', price_entity: 'sensor.missing' };
    const states: Record<string, StateLike> = {
        'sensor.dwd': st('0'),
        'sensor.mower': st('docked'),
        'switch.valve': st('off'),
        'sensor.soil': st('40'),
        'sensor.shower': st('off'),
        'media_player.tv': st('playing', { area: 'living' }),
        'sensor.noise': st('40', { unit_of_measurement: 'dB', area: 'bath' }),
        'sensor.temp': st('21', { area: 'living' }),
    };
    const ids = homeWatched({ states }, b, area => Object.keys(states).filter(id => states[id].attributes.area === area), false);
    assert.deepEqual(ids.sort(), ['media_player.tv', 'sensor.dwd', 'sensor.mower', 'sensor.noise', 'sensor.shower', 'sensor.soil', 'switch.valve']);
});

test('cars: present by their datapoint, in the garage or outside', () => {
    assert.equal(carPresent(st('on')), true);
    assert.equal(carPresent(st('home')), true);
    assert.equal(carPresent(st('Anwesend')), true);
    assert.equal(carPresent(st('not_home')), false);
    assert.equal(carPresent(st('off')), false);
    assert.equal(carPresent(st('1')), true);
    assert.equal(carPresent(st('0')), false);
    assert.equal(carPresent(st('unavailable')), false);
    assert.equal(carPresent(undefined), false);
    const b = house();
    const floor = b.floors[0];
    floor.furniture.push(
        { id: 'c1', type: 'car_sedan', x: 6.5, z: 2, w: 1.85, d: 4.75, h: 1.45, rotation: 90, entity: 'binary_sensor.car', car_color: '#ff0000' },
        { id: 'c2', type: 'car_van', x: 3, z: 12, w: 2, d: 5.3, h: 2.3, rotation: 0 },
    );
    const states: Record<string, StateLike> = { 'binary_sensor.car': st('off') };
    const out = homeScene(input(b, states, { ground: () => -0.2 }));
    const [sedan, van] = out.scene.cars;
    // inside a room it stands on the floor, outside on the ground
    assert.deepEqual([sedan.kind, sedan.present, sedan.sensed, sedan.y, sedan.color], ['car_sedan', false, true, 0, '#ff0000']);
    near(sedan.angle, Math.PI / 2, 1e-9);
    assert.deepEqual([van.kind, van.present, van.sensed, van.y, van.color], ['car_van', true, false, -0.2, null]);
    states['binary_sensor.car'] = st('on');
    assert.equal(homeScene(input(b, states)).scene.cars[0].present, true);
    assert.ok(homeWatched({ states }, b, () => [], false).includes('binary_sensor.car'));
});

test('gear with a sensor of its own gets a spot for its badge, once per sensor', () => {
    const b = house();
    b.floors[0].furniture.push(
        { id: 'h1', type: 'hatch', x: 2, z: 2, w: 0.6, d: 0.6, h: 0.06, rotation: 0, gear_entity: 'binary_sensor.hatch' },
        // a second hatch on the same contact, a placed device and one without a sensor
        { id: 'h2', type: 'hatch', x: 3, z: 2, w: 0.6, d: 0.6, h: 0.06, rotation: 0, gear_entity: 'binary_sensor.hatch' },
        { id: 'h3', type: 'hatch', x: 6, z: 2, w: 0.6, d: 0.6, h: 0.06, rotation: 0, gear_entity: 'binary_sensor.placed' },
        { id: 'h4', type: 'hatch', x: 6, z: 3, w: 0.6, d: 0.6, h: 0.06, rotation: 0, gear_entity: 'none' },
    );
    const m = gearMarkers(b, new Set(['binary_sensor.placed']));
    assert.deepEqual(
        m.map(x => [x.id, x.roomId, x.x]),
        [['binary_sensor.hatch', 'living', 2]],
    );
    near(m[0].y, 0.26, 1e-9);
});

test('health report: one device per physical device, per room', () => {
    const b = house();
    const states: Record<string, StateLike> = {
        'sensor.t': st('21', { battery_level: 10, health_device: 'zigbee.0.aa' }),
        'sensor.h': st('50', { battery_level: 12, health_device: 'zigbee.0.aa' }),
        'sensor.door': st('off', { unreachable: true }),
        'sensor.ok': st('1', { battery_level: 90 }),
        'sensor.nothing': st('1'),
    };
    const r = healthReport({ states }, b, [
        { id: 'sensor.t', floorId: 'eg', roomId: 'living', x: 1, y: 1, z: 1 },
        { id: 'sensor.door', floorId: 'eg', roomId: 'bath', x: 6, y: 1, z: 1 },
    ], id => id.toUpperCase());
    assert.equal(r.known, 3);
    assert.deepEqual(
        r.items.map(i => [i.id, i.problem, i.room]),
        [
            ['sensor.door', 'unreach', 'Bad'],
            ['sensor.t', 'battery', 'Wohnen'],
        ],
    );
    assert.equal(r.items[1].health.battery, 10);
    // each room knows its devices (the tooltip of its pin)
    assert.deepEqual(r.rooms.get('living'), {
        unreach: 0,
        low: 1,
        ok: 0,
        devices: [{ name: 'SENSOR.T', problem: 'battery', battery: 10 }],
    });
    assert.deepEqual(r.rooms.get('bath'), {
        unreach: 1,
        low: 0,
        ok: 0,
        devices: [{ name: 'SENSOR.DOOR', problem: 'unreach', battery: null }],
    });
});

test('home: smoke comes down from the ceiling, a brewing coffee machine on the worktop steams', () => {
    const b = house();
    const now = Date.parse('2026-11-17T12:00:00Z');
    b.floors[0].furniture.push(
        { id: 'top', type: 'worktop', x: 1, z: 1, w: 1.2, d: 0.6, h: 0.9, rotation: 0 },
        { id: 'cof', type: 'coffee_machine', x: 1, z: 1, w: 0.28, d: 0.4, h: 0.38, rotation: 90, entity: 'sensor.coffee_power' },
    );
    const states: Record<string, StateLike> = {
        'binary_sensor.smoke': st('on', {}, new Date(now - 90_000).toISOString()),
        'sensor.coffee_power': st('1400', { unit_of_measurement: 'W' }),
    };
    const out = homeScene(
        input(b, states, {
            now,
            smokes: [{ entity: 'binary_sensor.smoke', roomId: 'living', floorId: 'eg' }],
            surface: (_f, x, z) => (Math.abs(x - 1) < 0.6 && Math.abs(z - 1) < 0.3 ? 0.9 : 0),
        }),
    );
    const smoke = out.scene.smokes?.[0];
    assert.equal(smoke?.id, 'living');
    assert.equal(smoke?.top, 2.6);
    // half way down after a minute and a half
    near(smoke!.level, 0.625, 0.001);
    const cof = out.scene.coffees?.[0];
    assert.equal(cof?.brewing, true);
    assert.equal(cof?.y, 0.9);
    near(cof!.angle, Math.PI / 2, 1e-9);
    // in standby it does not steam
    states['sensor.coffee_power'] = st('2', { unit_of_measurement: 'W' });
    assert.equal(homeScene(input(b, states, { now })).scene.coffees?.[0]?.brewing, false);
});

test('home: a rainwater tank shows its litres, warns when nearly empty and fills while it rains', () => {
    const b = house();
    b.floors[0].furniture.push({ id: 'rt', type: 'rain_tank', x: -1, z: -4, w: 0.7, d: 0.7, h: 1, rotation: 0, entity: 'sensor.rain_level', tank_capacity: 300 });
    const states: Record<string, StateLike> = { 'sensor.rain_level': st('120', { unit_of_measurement: 'l' }) };
    let out = homeScene(input(b, states, { raining: true, ground: () => 0.1 }));
    const rt = out.scene.rainTanks?.[0];
    assert.equal(rt?.fill, 0.4);
    assert.equal(rt?.y, 0.1);
    assert.equal(rt?.label, '120 l · 40 %');
    assert.equal(rt?.warn, false);
    assert.ok(out.scene.streams.some(s => s.id === 'rt-rain'), 'rain runs in');
    states['sensor.rain_level'] = st('5', { unit_of_measurement: '%' });
    out = homeScene(input(b, states));
    assert.equal(out.scene.rainTanks?.[0]?.warn, true);
    assert.ok(!out.scene.streams.some(s => s.id === 'rt-rain'), 'dry weather');
});
