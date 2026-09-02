// Run with:  node --test web/test/
//
// Spanish is a full translation and not a fallback, so a key that exists in one
// language and not the other is a reader meeting `place.pickedPartly` where a
// sentence should be. Nothing else in the suite would notice: `translate`
// returns the key itself when it cannot find one, which renders as text and
// throws nothing.

import assert from 'node:assert/strict';
import test from 'node:test';

import { LANGUAGES, keysOf, translate } from '../assets/i18n.js';

test('both languages hold exactly the same keys', () => {
  const [first, ...rest] = LANGUAGES.map((lang) => ({ lang, keys: new Set(keysOf(lang)) }));
  for (const other of rest) {
    const missing = [...first.keys].filter((key) => !other.keys.has(key));
    const extra = [...other.keys].filter((key) => !first.keys.has(key));
    assert.deepEqual(missing, [], `${other.lang} is missing keys held by ${first.lang}`);
    assert.deepEqual(extra, [], `${other.lang} holds keys ${first.lang} does not`);
  }
});

test('no language is empty, so an empty set cannot pass the test above', () => {
  for (const lang of LANGUAGES) assert.ok(keysOf(lang).length > 100, lang);
});

test('every sentence about the place a search used exists in both languages', () => {
  // The three that replaced one. Which of them is shown depends on what the two
  // sites did with the point, and a reader in either language reaches all three.
  for (const lang of LANGUAGES) {
    for (const key of ['place.picked', 'place.pickedPartly', 'place.pickedNone']) {
      assert.notEqual(translate(lang, key, { place: 'x', applied: 'y', ignored: 'z' }), key);
    }
  }
});

test('a sentence naming sites leaves no placeholder unfilled', () => {
  // The names are interpolated, so a wording that forgot one would print
  // "{ignored}" to a visitor.
  for (const lang of LANGUAGES) {
    for (const key of ['place.pickedPartly', 'place.pickedNone']) {
      const said = translate(lang, key, { place: 'Montserrat', applied: 'Wikiloc', ignored: 'Komoot' });
      assert.ok(!said.includes('{'), `${lang} ${key}: ${said}`);
      assert.ok(said.includes('Komoot'), `${lang} ${key} does not name the site: ${said}`);
    }
  }
});
