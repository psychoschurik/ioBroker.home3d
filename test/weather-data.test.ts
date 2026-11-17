import assert from 'node:assert/strict';
import test from 'node:test';
import {
    beaufort,
    bearing,
    compassPoint,
    dewPoint,
    fogOf,
    gustiness,
    PressureLog,
    pressureFall,
    pressureHpa,
    sockLift,
    speedMs,
    stormLevel,
    whitecaps,
    windOf,
} from '../frontend/vendor-ext/weather-data';

const near = (a: number | null, b: number, eps = 0.05): void => {
    assert.ok(a !== null && Math.abs(a - b) < eps, `${a} ≉ ${b}`);
};

test('wind speeds in m/s from knots, km/h, mph and Beaufort; Beaufort and compass points back', () => {
    near(speedMs(10, 'kn'), 5.144);
    near(speedMs(36, 'km/h'), 10);
    near(speedMs(10, 'mph'), 4.47);
    near(speedMs(4, 'Bft'), 6.69, 0.1);
    near(speedMs(36, '', 'km/h'), 10);
    assert.equal(beaufort(0.1), 0);
    assert.equal(beaufort(5), 3);
    assert.equal(beaufort(8.79 * 0.5144), 3);
    assert.equal(beaufort(40), 12);
    const points = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    assert.equal(compassPoint(237.5, points), 'SW');
    assert.equal(compassPoint(350, points), 'N');
    assert.equal(bearing('SW'), 225);
    assert.equal(bearing('NO'), 45);
    assert.equal(bearing(-90), 270);
});

test('the wind comes from the own sensors while they report, else from the weather entity', () => {
    const now = Date.parse('2026-11-17T20:00:00Z');
    const weather = {
        state: 'partlycloudy',
        attributes: { wind_speed: 6.7, wind_speed_unit: 'km/h', wind_bearing: 126, wind_gust_speed: 15.5 },
    };
    const sensor = (state: string, unit: string, at: string) => ({
        state,
        attributes: { unit_of_measurement: unit },
        last_updated: at,
    });
    // the instruments reported a day ago: the weather entity counts
    const stale = {
        'weather.w': weather,
        'sensor.s': sensor('8.79', 'kn', '2026-11-16T17:00:00Z'),
        'sensor.d': sensor('237.5', '°', '2026-11-16T17:00:00Z'),
    };
    const w = windOf(stale, { speed: 'sensor.s', dir: 'sensor.d', weather: 'weather.w' }, now);
    near(w!.speed, 6.7 / 3.6);
    assert.equal(w!.from, 126);
    near(w!.gust, 15.5 / 3.6);
    // they report: their wind
    const live = {
        ...stale,
        'sensor.s': sensor('8.79', 'kn', '2026-11-17T19:59:00Z'),
        'sensor.d': sensor('237.5', '°', '2026-11-17T19:59:00Z'),
    };
    const v = windOf(live, { speed: 'sensor.s', dir: 'sensor.d', weather: 'weather.w' }, now);
    near(v!.speed, 4.52);
    assert.equal(v!.from, 237.5);
    // gusts never below the wind; nothing known: null
    assert.equal(windOf({}, { weather: 'weather.x' }, now), null);
    assert.equal(gustiness({ speed: 5, from: 0, gust: 10 }), 1);
    assert.equal(gustiness({ speed: 5, from: 0, gust: null }), 0);
});

test('whitecaps from 4 Bft, the windsock straight out from 15 kn', () => {
    assert.equal(whitecaps(5), 0);
    assert.equal(whitecaps(20), 1);
    near(whitecaps(9.7), 0.5);
    assert.equal(sockLift(0), 0);
    assert.equal(sockLift(15 * 0.5144), 1);
});

test('fog from the visibility, else from how close the air is to its dew point', () => {
    near(dewPoint(16.2, 87), 14.0, 0.1);
    assert.equal(fogOf({ temperature: 16.2, humidity: 87 }), 0);
    near(fogOf({ temperature: 10, humidity: 100 }), 0.85);
    assert.equal(fogOf({ visibility: 10 }), 0);
    near(fogOf({ visibility: 400, visibility_unit: 'm' }), 1);
    assert.equal(fogOf({ humidity: 90 }), null);
});

test('a pressure that falls 3 hPa in three hours warns, 6 hPa is a storm; too short a log tells nothing', () => {
    near(pressureHpa(29.92, 'inHg'), 1013.2, 0.2);
    near(pressureHpa(101.3, 'kPa'), 1013);
    const now = Date.parse('2026-11-17T20:00:00Z');
    const series = (fall: number, hours: number) =>
        Array.from({ length: hours * 12 + 1 }, (_, i) => ({
            t: now - (hours * 3600 - i * 300) * 1000,
            v: 1015 - (fall * i) / (hours * 12),
        }));
    near(pressureFall(series(4, 3), now), 4, 0.4);
    assert.equal(stormLevel(pressureFall(series(4, 3), now)), 1);
    assert.equal(stormLevel(pressureFall(series(7, 3), now)), 2);
    assert.equal(stormLevel(pressureFall(series(-2, 3), now)), 0);
    assert.equal(pressureFall(series(4, 1), now), null);
    const log = new PressureLog();
    log.add(now - 30_000, 1010);
    log.add(now, 1010);
    // one sample per minute at most; the history fills in before the own first sample
    assert.equal(log.merged([]).length, 1);
    assert.equal(log.merged([{ t: now - 3600_000, v: 1012 }, { t: now, v: 1011 }]).length, 2);
});
