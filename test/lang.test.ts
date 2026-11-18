import test from 'node:test';
import assert from 'node:assert/strict';
import { lang, setLanguage, t, TEXTS, type TextKey } from '../frontend/lang';

const holders = (s: string): string =>
    (s.match(/\{[a-z_]+\}/g) || [])
        .slice()
        .sort()
        .join(',');

test('every text of the frame is there in German, English and Russian, with the same placeholders', () => {
    for (const [key, texts] of Object.entries(TEXTS)) {
        for (const l of ['de', 'en', 'ru'] as const) {
            assert.ok(texts[l].trim(), `${key} ${l} is empty`);
        }
        assert.equal(holders(texts.en), holders(texts.de), `${key} en`);
        assert.equal(holders(texts.ru), holders(texts.de), `${key} ru`);
        assert.doesNotMatch(texts.ru, /[äöüß]/, `${key} ru is German`);
    }
});

test('the language follows the system: German, Russian, else English; t fills in the values', () => {
    try {
        assert.equal(setLanguage('ru'), 'ru');
        assert.equal(t('connected', { n: 3 }), 'Подключено · устройств: 3');
        assert.equal(setLanguage('fr'), 'en');
        assert.equal(t('changed_apply', { name: 'Tank', id: 'a.0.b' }), 'Tank: a.0.b – save with Apply.');
        assert.equal(setLanguage('de-AT'), 'de');
        assert.equal(t('remove_aria', { name: 'Licht' }), 'Licht aus Zuordnungen entfernen');
        assert.equal(setLanguage(undefined), 'de');
        assert.equal(lang(), 'de');
    } finally {
        setLanguage('de');
    }
});

test('unknown keys are a type error, known ones are typed', () => {
    const key: TextKey = 'help';
    assert.equal(t(key), 'Hilfe');
});
