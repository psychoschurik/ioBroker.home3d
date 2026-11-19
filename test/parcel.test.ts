import assert from 'node:assert/strict';
import test from 'node:test';
import { buildParcel, frontRank, parcelWaits, ringAt, PARCEL_MS } from '../frontend/vendor-ext/parcel';

const iso = (ms: number): string => new Date(ms).toISOString();

test('a parcel lies after the bell rang until the door opens, at most four hours', () => {
    const now = Date.parse('2026-11-19T14:00:00Z');
    const rang = now - 20 * 60_000;
    assert.equal(ringAt('event.door_bell', { state: iso(rang), attributes: {} }), rang);
    assert.equal(ringAt('binary_sensor.klingel', { state: 'off', attributes: {}, last_changed: iso(rang) }), rang);
    assert.equal(ringAt('binary_sensor.klingel', { state: 'unavailable', attributes: {} }), null);
    const closed = { state: 'off', attributes: {}, last_changed: iso(now - 3 * 3600_000) };
    assert.equal(parcelWaits(rang, closed, now), true);
    // the door opened after the ring: taken in
    assert.equal(parcelWaits(rang, { state: 'off', attributes: {}, last_changed: iso(rang + 60_000) }, now), false);
    assert.equal(parcelWaits(rang, { state: 'on', attributes: {}, last_changed: iso(rang - 60_000) }, now), false);
    assert.equal(parcelWaits(now - PARCEL_MS - 1, closed, now), false);
    // no contact at the door: an hour
    assert.equal(parcelWaits(rang, null, now), true);
    assert.equal(parcelWaits(now - 61 * 60_000, null, now), false);
    assert.equal(parcelWaits(null, closed, now), false);
    assert.equal(frontRank('front_glass'), 0);
    assert.equal(frontRank('interior'), 1);
    assert.equal(buildParcel().children.length, 6);
});
