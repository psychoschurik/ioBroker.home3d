import assert from 'node:assert/strict';
import test from 'node:test';
import {
    autoLink,
    autoPort,
    feedDone,
    nodeFlow,
    orientPipe,
    pipeFlow,
    pipeIssues,
    poolAlerts,
    poolFields,
    poolLink,
    poolModule,
    poolNow,
    poolScene,
    poolWatched,
    waterLook,
    type PoolAreaLike,
    type PoolHost,
    type PoolPipeLike,
} from '../frontend/vendor-ext/pool-module';

type St = { state: string; attributes: Record<string, unknown> };
const st = (state: string, attributes: Record<string, unknown> = {}): St => ({ state, attributes });

const states: Record<string, St> = {
    'sensor.a': st('27.4', { friendly_name: 'Pool Wassertemperatur', unit_of_measurement: '°C' }),
    'sensor.b': st('180', { friendly_name: 'Poolpumpe Leistung', unit_of_measurement: 'W' }),
    'climate.c': st('heat', { friendly_name: 'Pool Wärmepumpe', hvac_action: 'heating', current_temperature: 27 }),
    'light.d': st('on', { friendly_name: 'Pool Licht', rgb_color: [255, 0, 128], brightness: 128 }),
    'sensor.e': st('7.9', { friendly_name: 'pH Wert' }),
    'sensor.f': st('720', { friendly_name: 'Redox', unit_of_measurement: 'mV' }),
    'cover.g': st('open', { friendly_name: 'Pool Abdeckung', current_position: 25 }),
    'sensor.h': st('21', { friendly_name: 'Wohnzimmer Temperatur', unit_of_measurement: '°C' }),
};
const hass = { states };

const square: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 4],
    [0, 4],
];

test('a pool finds its datapoints by name, a chosen one wins, "none" switches one off', () => {
    assert.equal(autoLink(hass, 'temperature'), 'sensor.a');
    assert.equal(autoLink(hass, 'pump'), 'sensor.b');
    assert.equal(autoLink(hass, 'heater'), 'climate.c');
    assert.equal(autoLink(hass, 'light'), 'light.d');
    assert.equal(autoLink(hass, 'ph'), 'sensor.e');
    assert.equal(autoLink(hass, 'chlorine'), 'sensor.f');
    assert.equal(autoLink(hass, 'cover'), 'cover.g');
    assert.equal(autoLink(hass, 'salt'), null);
    const area: PoolAreaLike = { id: 'p', type: 'pool', points: square, pool: { temperature: 'sensor.h', light: 'none' } };
    assert.equal(poolLink(hass, area, 'temperature'), 'sensor.h');
    assert.equal(poolLink(hass, area, 'light'), null);
    assert.equal(poolLink(hass, area, 'pump'), 'sensor.b');
});

test('the water: pump, heating, light, cover and chemistry', () => {
    const now = poolNow(hass, { id: 'p', type: 'pool', points: square });
    assert.equal(now.temp, 27.4);
    assert.equal(now.pumpOn, true);
    assert.equal(now.heaterOn, true);
    assert.equal(now.heating, true);
    assert.deepEqual(now.light?.color, [1, 0, 128 / 255]);
    assert.equal(now.cover, 0.75);
    assert.equal(now.ph, 7.9);
    assert.deepEqual(now.chlorine, { value: 720, mv: true, ok: true });
    // the light's colour while it is on
    assert.deepEqual(waterLook(now).color, [1, 0, 128 / 255]);
    // without light: greenish while the pH is off, clear blue when it is fine
    const dark = { ...now, light: null };
    assert.ok(waterLook(dark).color[1] > waterLook(dark).color[2]);
    assert.ok(waterLook({ ...dark, ph: 7.2 }).color[2] > waterLook({ ...dark, ph: 7.2 }).color[1]);
    // a pump below 20 W stands, a switch off, a climate that only keeps its target does not heat
    const off = poolNow(
        {
            states: {
                ...states,
                'sensor.b': st('4', { friendly_name: 'Poolpumpe', unit_of_measurement: 'W' }),
                'climate.c': st('heat', { friendly_name: 'Pool Heizung', hvac_action: 'idle' }),
            },
        },
        { id: 'p', type: 'pool', points: square },
    );
    assert.equal(off.pumpOn, false);
    assert.equal(off.heaterOn, true);
    assert.equal(off.heating, false);
});

// the technical room: skimmer → pump → filter → T: heat pump or bypass → inlet; the filter's waste to the drain
const ports = [
    { id: 'sk', kind: 'skimmer', x: 0, z: 0 },
    { id: 'in', kind: 'inlet', x: 8, z: 0 },
    { id: 'ww', kind: 'waste', x: 4, z: 6 },
];
const pipe = (id: string, from: string, to: string, extra: Partial<PoolPipeLike> = {}): PoolPipeLike => ({
    id,
    from,
    to,
    points: [],
    ...extra,
});
const pipes = [
    pipe('a', 'port:sk', 'dev:pump:suction'),
    pipe('b', 'dev:pump:pressure', 'dev:filter:pump'),
    pipe('c', 'dev:filter:return', 'joint:t:in'),
    pipe('d', 'joint:t:out1', 'dev:hp:in'),
    pipe('e', 'dev:hp:out', 'joint:m:in'),
    pipe('f', 'joint:t:out2', 'joint:m:in'),
    pipe('g', 'joint:m:out1', 'port:in'),
    pipe('w', 'dev:filter:waste', 'port:ww'),
];
const devices = [
    { id: 'pump', type: 'pool_pump' },
    { id: 'filter', type: 'pool_filter' },
    { id: 'hp', type: 'pool_heat_pump' },
];
const active = (m: Map<string, { active: boolean }>): string[] =>
    [...m].filter(([, f]) => f.active).map(([id]) => id);

test('the water in the pipes: through the heat pump while it is on, else the bypass; backwash to the waste drain', () => {
    const run = (pumpOn: boolean, heaterOn: boolean, heating: boolean, valve: string | null = null, list = pipes) =>
        pipeFlow({ pipes: list, ports, devices: devices.map(d => ({ ...d, valve })), pumpOn, heaterOn, heating });
    // the pump stands: nothing flows
    assert.deepEqual(active(run(false, true, true)), []);
    // heating: through the heat pump, warm after it
    const hot = run(true, true, true);
    assert.deepEqual(active(hot), ['a', 'b', 'c', 'd', 'e', 'g']);
    assert.equal(hot.get('d')?.warm, false);
    assert.equal(hot.get('e')?.warm, true);
    assert.equal(hot.get('g')?.warm, true);
    // heater off: the bypass
    assert.deepEqual(active(run(true, false, false)), ['a', 'b', 'c', 'f', 'g']);
    // backwash: from the filter to the waste drain, brown
    const back = run(true, false, false, 'backwash');
    assert.deepEqual(active(back), ['a', 'b', 'w']);
    assert.equal(back.get('w')?.waste, true);
    // a closed ball valve in the line from the skimmer stops everything
    const shut = pipes.map(p => (p.id === 'a' ? { ...p, fittings: [{ kind: 'valve', open: false }] } : p));
    assert.deepEqual(active(run(true, false, false, null, shut)), []);
});

test('drawing pipes: which way water goes, the connection a line belongs to, what is missing', () => {
    const area = { pool: { ports, pipes } };
    assert.equal(nodeFlow('port:sk', area, devices), 'source');
    assert.equal(nodeFlow('port:in', area, devices), 'sink');
    assert.equal(nodeFlow('dev:pump:suction', area, devices), 'sink');
    assert.equal(nodeFlow('dev:filter:waste', area, devices), 'source');
    assert.equal(nodeFlow('joint:t:out2', area, devices), 'source');
    assert.equal(autoPort('pool_pump', 'source', false, []), 'suction');
    assert.equal(autoPort('pool_filter', 'sink', true, []), 'waste');
    assert.equal(autoPort('pool_filter', 'sink', false, []), 'return');
    assert.equal(autoPort('pool_heat_pump', 'source', false, ['in']), 'out');
    // drawn from the inlet to the filter: turned round
    const turned = orientPipe(pipe('x', 'port:in', 'dev:filter:return', { points: [[1, 1], [2, 2]] }), 'sink', 'source');
    assert.equal(turned.from, 'dev:filter:return');
    assert.deepEqual(turned.points, [[2, 2], [1, 1]]);
    assert.equal(feedDone(area, 'skimmer'), true);
    assert.deepEqual(pipeIssues(area, devices), []);
    const loose = { pool: { ports: [...ports, { id: 'dr', kind: 'drain', x: 4, z: 2 }], pipes: [...pipes.slice(0, 2), pipe('z', 'dev:filter:return', '')] } };
    const issues = pipeIssues(loose, devices);
    assert.ok(issues.some(i => i.kind === 'loose' && i.node === 'z'));
    assert.ok(issues.some(i => i.kind === 'port' && i.node === 'dev:hp:in'));
    assert.ok(issues.some(i => i.kind === 'feed' && i.node === 'drain'));
});

test('the module: water, label, pipes, glow, warnings and the pool form', () => {
    let saved: unknown = null;
    const b = {
        floors: [
            {
                id: 'eg',
                outdoor: [{ id: 'p', type: 'pool', points: square, pool: { ports, pipes } }],
                furniture: devices,
            },
        ],
    };
    const host: PoolHost = {
        hass: () => hass,
        building: () => b,
        language: () => 'de',
        waterLevel: () => ({ y: -0.15, floorY: -1.5 }),
        updateBuilding: m => {
            const next = structuredClone(b);
            m(next);
            saved = next;
        },
    };
    const scene = poolScene(host) as { kind: string; [k: string]: unknown }[];
    const water = scene.find(p => p.kind === 'water');
    assert.ok(water);
    assert.equal(water.flow, true);
    assert.equal(water.heat, true);
    assert.equal(water.cover, 0.75);
    const tag = scene.find(p => p.kind === 'tag');
    assert.equal(tag?.text, '27,4 °C');
    assert.equal(tag?.sub, 'pH 7,9 · 720 mV');
    const flow = scene.find(p => p.kind === 'pipeflow') as unknown as { flows: Record<string, { active: boolean }> };
    assert.equal(flow.flows.e.active, true);
    assert.deepEqual(
        scene.filter(p => p.kind === 'glow').map(p => p.furnitureId),
        ['pump', 'filter', 'hp'],
    );
    assert.ok(poolWatched(host).includes('sensor.e'));
    const alerts = poolAlerts(host) as { kind: string; text: string }[];
    assert.deepEqual(alerts.map(a => a.kind), ['pool_ph']);
    assert.match(alerts[0].text, /pH 7,9/);
    // the form: a field per datapoint; choosing one writes it into the pool
    const fields = poolFields(host, b.floors[0].outdoor[0]) as { kind: string; label?: string; auto?: string; set?: (v: string | null) => void }[];
    const temp = fields.find(f => f.label === 'Wassertemperatur');
    assert.equal(temp?.auto, 'sensor.a');
    temp?.set?.('sensor.h');
    assert.equal((saved as { floors: { outdoor: PoolAreaLike[] }[] }).floors[0].outdoor[0].pool?.temperature, 'sensor.h');
    assert.equal(poolModule.id, 'home3d.pool');
    assert.equal(typeof poolModule.pipes.flow, 'function');
});
