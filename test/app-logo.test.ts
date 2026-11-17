import assert from 'node:assert/strict';
import test from 'node:test';
import { appLogo, appOf, screenPicture } from '../frontend/vendor-ext/app-logo';

test('the app of a TV comes from its app name, else its source; YouTube is known by any of them', () => {
    assert.deepEqual(appOf({ app_name: 'YouTube' }), { key: 'youtube', name: 'YouTube' });
    assert.deepEqual(appOf({ app_name: '', source: 'YouTube TV' }), { key: 'youtube', name: 'YouTube TV' });
    assert.deepEqual(appOf({ source: 'HDMI 1' }), { key: 'hdmi 1', name: 'HDMI 1' });
    assert.equal(appOf({ app_name: '  ', volume_level: 0.3 }), null);
    // without a page (here in node) there is nothing to draw
    assert.equal(appLogo({ app_name: 'YouTube' }, [1, 0, 0]), null);
});

test('the screen shows the picture of what plays or is paused, the app otherwise (an old cover while idle is not shown)', () => {
    const attributes = { app_name: '', entity_picture: 'https://example.invalid/old.jpg' };
    assert.equal(screenPicture({ state: 'playing', attributes }, [1, 0, 0]), 'https://example.invalid/old.jpg');
    assert.equal(screenPicture({ state: 'paused', attributes }, [1, 0, 0]), 'https://example.invalid/old.jpg');
    // without an app the picture stays (in node no logo can be drawn either)
    assert.equal(screenPicture({ state: 'idle', attributes }, [1, 0, 0]), 'https://example.invalid/old.jpg');
});
