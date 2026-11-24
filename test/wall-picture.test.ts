import assert from 'node:assert/strict';
import test from 'node:test';
import { pictureOfState, WALL_PICTURE_PACK } from '../frontend/vendor-ext/wall-picture';

test('the picture of a datapoint: URLs and data URLs as they are, base64 as a data URL, a file path of ioBroker', () => {
    assert.equal(pictureOfState('data:image/jpeg;base64,AAAA'), 'data:image/jpeg;base64,AAAA');
    assert.equal(pictureOfState('https://example.invalid/a.jpg'), 'https://example.invalid/a.jpg');
    const png = `iVBORw0KGgo${'A'.repeat(80)}`;
    assert.equal(pictureOfState(png), `data:image/png;base64,${png}`);
    const jpeg = `/9j/4AAQSkZJRgABAQ${'A'.repeat(80)}`;
    assert.equal(pictureOfState(`${jpeg.slice(0, 40)}\n${jpeg.slice(40)}`), `data:image/jpeg;base64,${jpeg}`);
    // a file of the ioBroker storage, served by web one level above /home3d/
    assert.equal(pictureOfState('/vis.0/slideshow/1.jpg'), '../vis.0/slideshow/1.jpg');
    assert.equal(pictureOfState('vis.0/slideshow/1.JPEG'), '../vis.0/slideshow/1.JPEG');
});

test('no picture: empty, unavailable, a word, a number', () => {
    for (const v of ['', '  ', 'unavailable', 'off', 'Sonnenuntergang am Meer', 42, null, undefined]) {
        assert.equal(pictureOfState(v), null, String(v));
    }
});

test('the built-in pack has the wall picture with a screen part', () => {
    const [picture, frame] = WALL_PICTURE_PACK.items;
    assert.equal(picture.mount, 'wall');
    assert.equal(picture.parts.filter(p => p.screen).length, 1);
    assert.equal(frame.parts.filter(p => p.screen).length, 1);
    // the frame's bars stay inside the item
    for (const p of [...picture.parts, ...frame.parts]) {
        assert.ok(p.x - p.w / 2 >= -0.5 - 1e-9 && p.x + p.w / 2 <= 0.5 + 1e-9);
        assert.ok(p.y >= 0 && p.y + p.h <= 1 + 1e-9);
    }
});
