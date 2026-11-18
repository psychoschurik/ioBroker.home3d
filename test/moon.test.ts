import assert from 'node:assert/strict';
import test from 'node:test';
import { moonAt, moonAttributes, siderealTime } from '../frontend/moon';
import { drawnElevation, litAt, MOON_R, starStrength } from '../frontend/vendor-ext/night-sky';

// Munich
const LAT = 48.14;
const LON = 11.58;

test('the phases of January 2024', () => {
    const at = (iso: string) => moonAt(LAT, LON, Date.parse(iso));
    const full = at('2024-01-25T17:54:00Z');
    assert.ok(full.fraction > 0.99 && Math.abs(full.phase - 0.5) < 0.03, `full ${full.phase}`);
    const newMoon = at('2024-01-11T11:57:00Z');
    assert.ok(newMoon.fraction < 0.01 && (newMoon.phase < 0.03 || newMoon.phase > 0.97), `new ${newMoon.phase}`);
    const first = at('2024-01-18T03:53:00Z');
    assert.ok(Math.abs(first.fraction - 0.5) < 0.03 && Math.abs(first.phase - 0.25) < 0.02, `first ${first.phase}`);
    const last = at('2024-02-02T23:18:00Z');
    assert.ok(Math.abs(last.fraction - 0.5) < 0.03 && Math.abs(last.phase - 0.75) < 0.02, `last ${last.phase}`);
});

test('where the moon stands', () => {
    // the full moon rises in the east in the evening and stands high in the south at midnight
    const rising = moonAt(LAT, LON, Date.parse('2024-01-25T16:30:00Z'));
    assert.ok(rising.elevation > -5 && rising.elevation < 15 && rising.azimuth > 45 && rising.azimuth < 90, JSON.stringify(rising));
    const midnight = moonAt(LAT, LON, Date.parse('2024-01-25T23:30:00Z'));
    assert.ok(midnight.elevation > 55 && midnight.azimuth > 150 && midnight.azimuth < 210, JSON.stringify(midnight));
    // the new moon stands with the sun, in the south at noon
    const noon = moonAt(LAT, LON, Date.parse('2024-01-11T11:00:00Z'));
    assert.ok(noon.azimuth > 160 && noon.azimuth < 200, JSON.stringify(noon));
});

test('sidereal time and the attributes of sun.sun', () => {
    // a sidereal day is about 4 minutes shorter than a solar day
    const t = Date.parse('2024-03-20T00:00:00Z');
    const a = siderealTime(LON, t);
    const b = siderealTime(LON, t + 86400000);
    assert.ok(Math.abs(((b - a + 360) % 360) - 0.9856) < 0.01);
    const attrs = moonAttributes(LAT, LON, t);
    assert.deepEqual(Object.keys(attrs).sort(), ['latitude', 'moon_azimuth', 'moon_elevation', 'moon_fraction', 'moon_phase', 'sidereal']);
});

test('which part of the disc is lit', () => {
    // new: nothing; first quarter: the right half; full: all
    assert.equal(litAt(0.9, 0, 0), false);
    assert.equal(litAt(0.5, 0, 0.25), true);
    assert.equal(litAt(-0.5, 0, 0.25), false);
    assert.equal(litAt(-0.9, 0, 0.5), true);
    // a crescent: only the right edge
    assert.equal(litAt(0.95, 0, 0.08), true);
    assert.equal(litAt(0.3, 0, 0.08), false);
});

test('stars come out at dusk, fewer behind clouds and in moonlight', () => {
    assert.equal(starStrength(10, 0, 0, false), 0);
    assert.equal(starStrength(null, 0, 0, false), 0);
    const dark = starStrength(-18, 0, 0, false);
    assert.equal(dark, 1);
    assert.ok(starStrength(-18, 0.6, 0, false) < dark);
    assert.equal(starStrength(-18, 1, 0, false), 0);
    assert.ok(starStrength(-18, 0, 1, true) < dark);
    assert.equal(starStrength(-18, 0, 1, false), dark);
});

test('the moon is drawn just under the top edge of the picture, as high as it stands at most', () => {
    // looking along the horizon: where it stands
    assert.equal(drawnElevation(20, 30), 20);
    // looking down: just under the top edge
    assert.equal(drawnElevation(40, 5), 5 - MOON_R * 1.6);
    // steeply down: not deeper than -35°
    assert.equal(drawnElevation(40, -60), -35);
});
