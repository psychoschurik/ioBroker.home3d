import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { bundledPath } from '../frontend/vendor-ext/mdi-paths';
import { ICON_GROUPS, ICON_PICKS } from '../frontend/vendor-ext/sensor-look';

test('every symbol offered under "Eigenes Symbol" is bundled and offered once', () => {
    assert.ok(ICON_PICKS.length > 150);
    assert.deepEqual(
        ICON_PICKS.filter(n => !bundledPath(n)),
        [],
    );
    assert.equal(new Set(ICON_PICKS).size, ICON_PICKS.length);
    for (const wanted of ['dishwasher', 'robot-vacuum', 'bicycle', 'sprinkler', 'floor-lamp', 'ceiling-light']) {
        assert.ok(ICON_PICKS.includes(wanted), wanted);
    }
});

test('every group has its heading in German, English and Russian', () => {
    const tasks = readFileSync(join(__dirname, '..', 'tasks.ts'), 'utf8');
    const ru = JSON.parse(readFileSync(join(__dirname, '..', 'frontend', 'public', 'vendor', 'lang', 'ru.json'), 'utf8')) as Record<
        string,
        string
    >;
    for (const g of ICON_GROUPS) {
        const key = `icon_group_${g.id}`;
        assert.equal(tasks.split(`            ${key}: '`).length, 3, `${key} in de and en`);
        assert.ok(ru[key], `${key} in ru`);
    }
});
