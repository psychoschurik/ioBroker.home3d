import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { FLAG_DESIGNS, flagAspect, flagChoices, flagColor, flagDesign, flagName, flagPixels, inStar } from '../frontend/vendor-ext/flags';

const hex = (id: string, x: number, y: number): string =>
    flagColor(id, x, y)
        .map(c => c.toString(16).padStart(2, '0'))
        .join('');

test('the flags asked for are there, each with its own colours', () => {
    for (const id of ['de', 'at', 'ch', 'fr', 'it', 'ru', 'ua']) {
        assert.ok(FLAG_DESIGNS.includes(id), id);
    }
    assert.equal(FLAG_DESIGNS[0], 'plain');
    // horizontal stripes from the top
    assert.deepEqual([hex('de', 0.5, 0.1), hex('de', 0.5, 0.5), hex('de', 0.5, 0.9)], ['000000', 'dd0000', 'ffce00']);
    assert.deepEqual([hex('at', 0.5, 0.1), hex('at', 0.5, 0.5), hex('at', 0.5, 0.9)], ['c8102e', 'ffffff', 'c8102e']);
    assert.deepEqual([hex('ru', 0.5, 0.1), hex('ru', 0.5, 0.5), hex('ru', 0.5, 0.9)], ['ffffff', '0039a6', 'd52b1e']);
    assert.deepEqual([hex('ua', 0.5, 0.2), hex('ua', 0.5, 0.8)], ['0057b7', 'ffd700']);
    // vertical stripes from the pole
    assert.deepEqual([hex('fr', 0.1, 0.5), hex('fr', 0.5, 0.5), hex('fr', 0.9, 0.5)], ['0055a4', 'ffffff', 'ef4135']);
    assert.deepEqual([hex('it', 0.1, 0.5), hex('it', 0.5, 0.5), hex('it', 0.9, 0.5)], ['009246', 'ffffff', 'ce2b37']);
    // Switzerland: square, a white cross in the middle, red in the corners and beyond the ends of the arms
    assert.equal(flagAspect('ch'), 1);
    assert.equal(hex('ch', 0.5, 0.5), 'ffffff');
    assert.equal(hex('ch', 0.5, 0.25), 'ffffff');
    assert.equal(hex('ch', 0.5, 0.1), 'da291c');
    assert.equal(hex('ch', 0.25, 0.25), 'da291c');
});

test('the flags with crosses and stars', () => {
    // Greece: the white cross in the blue square, stripes beside it
    assert.equal(hex('gr', 5 / 27, 5 / 18), 'ffffff');
    assert.equal(hex('gr', 0.05, 0.05), '0d5eaf');
    assert.equal(hex('gr', 0.9, 0.05), '0d5eaf');
    assert.equal(hex('gr', 0.9, 1.5 / 9), 'ffffff');
    // the EU: a star at the top of the circle, blue in the middle
    assert.equal(hex('eu', 0.5, 0.5 - 1 / 3), 'ffcc00');
    assert.equal(hex('eu', 0.5, 0.5), '003399');
    // the Union Flag: red cross, white beside it, blue in the corner fields
    assert.equal(hex('gb', 0.5, 0.5), 'c8102e');
    assert.equal(hex('gb', 0.5 + 4 / 60, 0.2), 'ffffff');
    assert.equal(hex('gb', 0.3, 0.1), '012169');
    // the red diagonal lies below the middle of the white one at the pole, above it at the free end
    const at = (X: number, below: number): [number, number] => [X / 60, (X / 2 + (below * Math.sqrt(5)) / 2) / 30];
    assert.equal(hex('gb', ...at(10, 1)), 'c8102e');
    assert.equal(hex('gb', ...at(10, -1)), 'ffffff');
    assert.equal(hex('gb', ...at(50, -1)), 'c8102e');
    assert.equal(hex('gb', ...at(50, 1)), 'ffffff');
    // the USA: red stripe at the top beside the canton, a white star at the first place
    assert.equal(hex('us', 0.9, 0.02), 'b22234');
    assert.equal(hex('us', 0.9, 1.5 / 13), 'ffffff');
    assert.equal(hex('us', 0.063 / 1.9, 0.054), 'ffffff');
    assert.equal(hex('us', 0.126 / 1.9, 0.054), '3c3b6e');
    // Scandinavian crosses lie towards the pole
    assert.equal(hex('se', 6 / 16, 0.1), 'fecc02');
    assert.equal(hex('se', 0.5, 0.1), '006aa7');
    assert.equal(hex('no', 8 / 22, 0.5), '00205b');
    assert.equal(hex('no', 6.5 / 22, 0.1), 'ffffff');
    // Czechia: the blue wedge reaches the middle
    assert.equal(hex('cz', 0.45, 0.5), '11457e');
    assert.equal(hex('cz', 0.55, 0.25), 'ffffff');
    assert.equal(hex('cz', 0.55, 0.75), 'd7141a');
});

test('a five-pointed star', () => {
    assert.ok(inStar(0, 0, 0, 0, 1));
    // its upper point, not the gap beside it
    assert.ok(inStar(0, -0.9, 0, 0, 1));
    assert.ok(!inStar(0.3, -0.75, 0, 0, 1));
    assert.ok(!inStar(0, 0.9, 0, 0, 1));
    assert.ok(!inStar(2, 0, 0, 0, 1));
});

test('an unknown or missing flag is the plain one', () => {
    assert.equal(flagDesign(undefined), 'plain');
    assert.equal(flagDesign('xx'), 'plain');
    assert.equal(flagDesign('toString'), 'plain');
    assert.equal(flagAspect(null), 0.62);
    assert.equal(hex('xx', 0.5, 0.2), '1f4fbf');
});

test('the picture: the pole on the left, row 0 at the bottom, edges smoothed', () => {
    const w = 30;
    const h = Math.round(w * flagAspect('de'));
    const px = flagPixels('de', w, h);
    assert.equal(px.length, w * h * 4);
    const at = (i: number, j: number): number[] => Array.from(px.subarray((j * w + i) * 4, (j * w + i) * 4 + 4));
    assert.deepEqual(at(0, h - 1), [0, 0, 0, 255]);
    assert.deepEqual(at(0, 0), [255, 206, 0, 255]);
    const fr = flagPixels('fr', 3, 2);
    assert.deepEqual(Array.from(fr.subarray(0, 4)), [0, 85, 164, 255]);
    const ch = flagPixels('ch', 32, 32);
    const mid = (16 * 32 + 16) * 4;
    assert.deepEqual(Array.from(ch.subarray(mid, mid + 3)), [255, 255, 255]);
    // the border of the black and the red stripe falls in the middle of a pixel row: mixed
    const edge = flagPixels('de', 1, 4);
    const mixed = Array.from(edge.subarray(8, 12));
    assert.ok(mixed[0] > 0 && mixed[0] < 255, String(mixed));
});

test('names from the browser, the plain flag first', () => {
    assert.equal(flagName('de', 'de'), 'Deutschland');
    assert.equal(flagName('ch', 'en'), 'Switzerland');
    assert.equal(flagName('plain', 'de'), null);
    const choices = flagChoices('de', 'Blau-Weiß');
    assert.equal(choices[0].id, 'plain');
    assert.equal(choices[0].name, 'Blau-Weiß');
    assert.equal(choices.length, FLAG_DESIGNS.length);
    const names = choices.slice(1).map(c => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'de')));
    assert.ok(names.includes('Österreich') && names.includes('Ukraine') && names.includes('Russland'));
});

test('the editor names the choice in every language', () => {
    const tasks = readFileSync(join(__dirname, '..', 'tasks.ts'), 'utf8');
    assert.equal(tasks.match(/vane_design: '/g)?.length, 2);
    assert.equal(tasks.match(/flag_plain: '/g)?.length, 2);
    const ru = JSON.parse(readFileSync(join(__dirname, '..', 'frontend/public/vendor/lang/ru.json'), 'utf8')) as Record<
        string,
        string
    >;
    assert.ok(ru.vane_design && ru.flag_plain);
});
