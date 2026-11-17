import test from 'node:test';
import assert from 'node:assert/strict';
import { entities, execute, wmoCondition } from '../frontend/entities';
import { historyDuringPeriod, loggedBy, statisticsDuringPeriod, timeTravelHistory, type HistoryAccess } from '../frontend/history';
import { sensorIcon, sensorShow, sensorText } from '../frontend/vendor-ext/sensor-look';
import type { IoAccess, Mapping, StateObject } from '../frontend/model';

const object = (type: string, extra: Record<string, unknown> = {}): StateObject =>
    ({ type: 'state', common: { name: 'x', type, role: 'state', read: true, write: true, ...extra } }) as StateObject;

const light: Mapping = {
    entity_id: 'light.rgb',
    state: 'a.on',
    attributes: { rgb_color: { id: 'a.rgb', convert: 'rgb_hex' }, supported_color_modes: ['rgb'] },
    actions: {
        turn_on: [
            { id: 'a.on', value: true },
            { id: 'a.rgb', field: 'rgb_color', convert: 'rgbw_hex', optional: true },
        ],
    },
};

test('an RGB colour of ioBroker ("#rrggbb" or "#rrggbbww") becomes [r, g, b]', () => {
    for (const val of ['#d0ff00', '#D0FF0000']) {
        const out = entities([light], { 'a.on': { val: true, ts: 1 }, 'a.rgb': { val, ts: 1 } } as never, {
            'a.on': object('boolean'),
            'a.rgb': object('string'),
        });
        assert.deepEqual(out['light.rgb'].attributes.rgb_color, [208, 255, 0]);
        assert.equal(out['light.rgb'].state, 'on');
    }
});

test('turn_on with rgb_color writes the colour as text, with the white channel for rgbw_hex', async () => {
    const written: [string, unknown][] = [];
    const io = {
        getObjects: async (ids: string[]) =>
            Object.fromEntries(ids.map(id => [id, object(id === 'a.on' ? 'boolean' : 'string')])),
        getState: async () => null,
        setState: async (id: string, value: unknown) => void written.push([id, value]),
    } as unknown as IoAccess;
    await execute([light], 'light', 'turn_on', { entity_id: 'light.rgb', rgb_color: [255, 128, 0] }, io);
    assert.deepEqual(written, [
        ['a.on', true],
        ['a.rgb', '#ff800000'],
    ]);
    // without a colour only the switch is written
    written.length = 0;
    await execute([light], 'light', 'turn_on', { entity_id: 'light.rgb' }, io);
    assert.deepEqual(written, [['a.on', true]]);
});

test('the history is read from the instance that logs the datapoint and turned into device states', async () => {
    const asked: [string, ioBroker.GetHistoryOptions][] = [];
    const io: HistoryAccess = {
        getObjects: async ids =>
            Object.fromEntries(
                ids.map(id => [
                    id,
                    object(id === 'w.on' ? 'boolean' : 'number', { custom: { 'influxdb.0': { enabled: true } } }),
                ]),
            ),
        defaultHistory: async () => 'history.0',
        getHistory: async (id, options) => {
            asked.push([id, options]);
            if (options.end === 1000) {
                return [{ val: id === 'w.on' ? false : 20, ts: 500 }] as ioBroker.GetHistoryResult;
            }
            return (
                id === 'w.on'
                    ? [
                          { val: true, ts: 2000 },
                          { val: false, ts: 3000 },
                      ]
                    : [{ val: 21.456, ts: 2000 }]
            ) as ioBroker.GetHistoryResult;
        },
    };
    const mappings: Mapping[] = [
        { entity_id: 'binary_sensor.water', state: 'w.on' },
        { entity_id: 'sensor.temp', state: 't.val' },
    ];
    const rows = await historyDuringPeriod(io, mappings, {
        start_time: new Date(1000).toISOString(),
        end_time: new Date(5000).toISOString(),
        entity_ids: ['binary_sensor.water', 'sensor.temp', 'sensor.unknown'],
    });
    assert.deepEqual(rows['binary_sensor.water'], [
        { s: 'off', lu: 1 },
        { s: 'on', lu: 2 },
        { s: 'off', lu: 3 },
    ]);
    assert.deepEqual(rows['sensor.temp'], [
        { s: '20', lu: 1 },
        { s: '21.456', lu: 2 },
    ]);
    assert.equal(rows['sensor.unknown'], undefined);
    assert.ok(asked.every(([, o]) => o.instance === 'influxdb.0'));
});

test('without own history settings the default history of the system is used', () => {
    assert.equal(loggedBy(object('number'), 'history.0'), 'history.0');
    assert.equal(loggedBy(object('number', { custom: { 'sql.0': { enabled: true } } }), 'history.0'), 'sql.0');
    assert.equal(loggedBy(object('number', { custom: { 'sql.0': { enabled: false } } }), null), null);
});

test('sensors get a symbol by what they report, climate values stay visible', () => {
    const st = (entity_id: string, state: string, attributes: Record<string, unknown>) => ({
        entity_id,
        state,
        attributes,
    });
    assert.equal(sensorIcon(st('binary_sensor.b', 'on', { device_class: 'moisture' })), 'water-alert');
    assert.equal(sensorIcon(st('binary_sensor.b', 'off', { device_class: 'moisture' })), 'water-off');
    assert.equal(sensorIcon(st('binary_sensor.r', 'on', { device_class: 'smoke' })), 'fire');
    assert.equal(sensorIcon(st('binary_sensor.m', 'on', { device_class: 'motion' })), 'walk');
    assert.equal(sensorIcon(st('sensor.t', '21', { device_class: 'temperature' })), 'thermometer');
    assert.equal(sensorIcon(st('light.l', 'on', {})), null);
    assert.equal(sensorShow(st('sensor.t', '21', { device_class: 'temperature' })), 'always');
    assert.equal(sensorShow(st('binary_sensor.m', 'on', { device_class: 'motion' })), undefined);
    assert.equal(
        sensorText(st('sensor.t', '21.4', { device_class: 'temperature', humidity: 48.2 }), '21,4 °C'),
        '21,4 °C · 48 %',
    );
});

test('a WMO weather code becomes a weather condition, read only', () => {
    const weather: Mapping = { entity_id: 'weather.boat', state: 'w.code', convert: 'wmo' };
    const at = (val: unknown): string =>
        entities([weather], { 'w.code': { val, ts: 1 } } as never, { 'w.code': object('number') })['weather.boat'].state;
    assert.equal(at(0), 'sunny');
    assert.equal(at(2), 'partlycloudy');
    assert.equal(at(3), 'cloudy');
    assert.equal(at(45), 'fog');
    assert.equal(at(61), 'rainy');
    assert.equal(at(80), 'rainy');
    assert.equal(at(65), 'pouring');
    assert.equal(at(73), 'snowy');
    assert.equal(at(95), 'lightning-rainy');
    assert.equal(wmoCondition(null), 'unknown');
});

test('the time travel gets the states as compact rows, measured values as five-minute means and the sun', async () => {
    const start = 1_700_000_000;
    const io: HistoryAccess = {
        getObjects: async ids =>
            Object.fromEntries(ids.map(id => [id, object(id === 'd.open' ? 'boolean' : 'number')])),
        defaultHistory: async () => 'history.0',
        getHistory: async (id, options) => {
            if (options.aggregate === 'average') {
                return [
                    { val: 20, ts: (start + 10) * 1000 },
                    { val: 22, ts: (start + 20) * 1000 },
                    { val: 30, ts: (start + 610) * 1000 },
                ] as ioBroker.GetHistoryResult;
            }
            if (options.count === 1) {
                return [{ val: false, ts: (start - 100) * 1000 }] as ioBroker.GetHistoryResult;
            }
            return [
                { val: true, ts: (start + 60) * 1000 },
                { val: false, ts: (start + 120) * 1000 },
                { val: true, ts: (start + 180) * 1000 },
            ] as ioBroker.GetHistoryResult;
        },
    };
    const mappings: Mapping[] = [
        { entity_id: 'binary_sensor.door', state: 'd.open' },
        { entity_id: 'sensor.temp', state: 't.val' },
    ];
    const day = await timeTravelHistory(
        io,
        mappings,
        {
            start_time: start,
            end_time: start + 900,
            entity_ids: ['binary_sensor.door', 'sun.sun', 'light.gone'],
            statistic_ids: ['sensor.temp'],
        },
        { lat: 52.5, lon: 13.4 },
    );
    assert.equal(day.day_start, start);
    assert.deepEqual(day.entities['binary_sensor.door'], { t: [0, 60, 120, 180], v: [0, 1, 0, 1], tab: ['off', 'on'] });
    assert.deepEqual(day.stats['sensor.temp'], { start, step: 300, mean: [21, null, 30] });
    assert.equal(day.entities['sun.sun'].t.length, 2);
    assert.deepEqual(day.missing, ['light.gone']);
});

test('statistics: five-minute means of the solar power and the hourly change of a counter', async () => {
    const t0 = Date.UTC(2026, 0, 5, 10, 0, 0);
    const io: HistoryAccess = {
        getObjects: async ids => Object.fromEntries(ids.map(id => [id, object('number', { custom: { 'influxdb.0': { enabled: true } } })])),
        defaultHistory: async () => null,
        getHistory: async (id, o) => {
            if (id === 'pv.power') {
                // the adapter gives the average per step
                return [
                    { ts: t0 + 150_000, val: 100 },
                    { ts: t0 + 450_000, val: 300 },
                ] as ioBroker.GetHistoryResult;
            }
            if (o.count === 1) {
                return [{ ts: t0 - 1000, val: 10 }] as ioBroker.GetHistoryResult;
            }
            // a gas counter: 10 → 12 in the first hour, a reset to 1 in the second
            return [
                { ts: t0 + 60_000, val: 11 },
                { ts: t0 + 1_800_000, val: 12 },
                { ts: t0 + 3_700_000, val: 1 },
            ] as ioBroker.GetHistoryResult;
        },
    };
    const mappings: Mapping[] = [
        { entity_id: 'sensor.pv', state: 'pv.power' },
        { entity_id: 'sensor.gas', state: 'gas.total' },
    ];
    const mean = await statisticsDuringPeriod(io, mappings, {
        start_time: new Date(t0).toISOString(),
        end_time: new Date(t0 + 600_000).toISOString(),
        statistic_ids: ['sensor.pv', 'sensor.none'],
        period: '5minute',
        types: ['mean'],
    });
    assert.deepEqual(mean, {
        'sensor.pv': [
            { start: t0, end: t0 + 300_000, mean: 100 },
            { start: t0 + 300_000, end: t0 + 600_000, mean: 300 },
        ],
    });
    const change = await statisticsDuringPeriod(io, mappings, {
        start_time: new Date(t0).toISOString(),
        end_time: new Date(t0 + 7_200_000).toISOString(),
        statistic_ids: ['sensor.gas'],
        period: 'hour',
        types: ['change'],
    });
    assert.deepEqual(
        change['sensor.gas'].map(r => r.change),
        [2, 1],
    );
});
