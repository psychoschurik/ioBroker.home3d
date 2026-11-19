import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { mock } from 'node:test';
import { CardPeek, dotRadius, HOLO_MODES, holoKey, holoModeOf, holoModeValue } from '../frontend/vendor-ext/card-peek';

test('a dot shrinks with its distance, within bounds', () => {
    // the viewer's scale: 15 / distance × 0.7 (the card size), between 0.25 and 1.6 times that
    const at = (dist: number): number => dotRadius(Math.min(1.6, Math.max(0.25, 15 / dist)) * 0.7);
    assert.equal(at(5), 5);
    assert.ok(at(20) < at(10) && at(30) < at(20), `${at(10)} ${at(20)} ${at(30)}`);
    assert.equal(at(80), 1.6);
    assert.equal(dotRadius(0), 1.6);
});

test('the mode as kept per browser: nothing chosen yet shows the cards only when pointed at', () => {
    assert.equal(holoModeOf(null), 'hover');
    assert.equal(holoModeOf('1'), 'always');
    assert.equal(holoModeOf('0'), 'off');
    assert.equal(holoModeOf('hover'), 'hover');
    for (const m of HOLO_MODES) {
        assert.equal(holoModeOf(holoModeValue(m)), m);
    }
});

test('a card is the same card across updates', () => {
    assert.equal(holoKey({ kind: 'module', name: 'x', module: { id: 'devices:f1' } }), 'devices:f1');
    assert.equal(holoKey({ kind: 'media', name: 'x', media: { id: 'media_player.k' } }), 'media_player.k');
    assert.equal(holoKey({ kind: 'car', name: 'x', car: { spot: 'p1' } }), 'p1');
    assert.equal(holoKey({ kind: 'main', name: 'Solar' }), 'main:Solar');
});

test('pointed at: shows, and stays a moment after the pointer left (to reach the card from its dot)', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        let changes = 0;
        const peek = new CardPeek(() => changes++, 700);
        assert.equal(peek.shows('a'), false);
        peek.enter('a');
        assert.equal(peek.shows('a'), true);
        assert.equal(changes, 1);
        peek.leave('a');
        mock.timers.tick(500);
        assert.equal(peek.shows('a'), true);
        // from the dot onto the card in time: it stays
        peek.enter('a');
        mock.timers.tick(1000);
        assert.equal(peek.shows('a'), true);
        peek.leave('a');
        mock.timers.tick(701);
        assert.equal(peek.shows('a'), false);
        assert.equal(changes, 2);
    } finally {
        mock.timers.reset();
    }
});

test('a tap keeps a card until the next tap, a new mode forgets all', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const peek = new CardPeek(() => {}, 700);
        // a tap on a tablet: over, click, out
        peek.enter('a');
        peek.tap('a');
        peek.leave('a');
        mock.timers.tick(2000);
        assert.equal(peek.shows('a'), true);
        assert.equal(peek.shows('b'), false);
        peek.enter('a');
        peek.tap('a');
        peek.leave('a');
        mock.timers.tick(2000);
        assert.equal(peek.shows('a'), false);
        peek.tap('b');
        peek.clear();
        assert.equal(peek.shows('b'), false);
    } finally {
        mock.timers.reset();
    }
});

test('the menu names the modes in every language', () => {
    const tasks = readFileSync(join(__dirname, '..', 'tasks.ts'), 'utf8');
    for (const key of ['holo_mode', 'holo_mode_always', 'holo_mode_hover', 'holo_mode_off', 'holo_mode_hint']) {
        assert.equal(tasks.match(new RegExp(`'  ${key}: "`, 'g'))?.length, 2, key);
    }
    const ru = JSON.parse(readFileSync(join(__dirname, '..', 'frontend/public/vendor/lang/ru.json'), 'utf8')) as Record<
        string,
        string
    >;
    assert.ok(ru.holo_mode && ru.holo_mode_always && ru.holo_mode_hover && ru.holo_mode_off && ru.holo_mode_hint);
});
