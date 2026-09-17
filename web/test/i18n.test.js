// Run with:  node --test web/test/
//
// Spanish is a full translation and not a fallback, so a key that exists in one
// language and not the other is a reader meeting `place.pickedPartly` where a
// sentence should be. Nothing else in the suite would notice: `translate`
// returns the key itself when it cannot find one, which renders as text and
// throws nothing.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LANGUAGES, keysOf, translate } from '../assets/i18n.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/** The {placeholders} a string asks to be given, as a sorted set. */
function placeholders(text) {
  return [...new Set([...text.matchAll(/\{([^{}\s]+)\}/g)].map((found) => found[1]))].sort();
}

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

test('every key asks both languages for the same values, not just the dozen we thought of', () => {
  // The test above pins two keys, and the ones further down pin ten more. That
  // left 238 of the 250 keys free to lose a placeholder in translation, and a
  // Spanish sentence that dropped {source} prints "{source}" to a reader while
  // the whole suite stays green: `translate` fills what it is given and leaves
  // the rest of the text alone.
  //
  // The set is compared rather than the count, so a rename on one side is
  // caught too: a Spanish string asking for {origen} is exactly as broken as
  // one asking for nothing.
  const [first, ...rest] = LANGUAGES;
  for (const key of keysOf(first)) {
    const wanted = placeholders(translate(first, key));
    for (const lang of rest) {
      assert.deepEqual(
        placeholders(translate(lang, key)),
        wanted,
        `${lang} ${key} does not ask for the same values as ${first}`,
      );
    }
  }
});

test('the four privacy statements still say every thing a reader could act on', () => {
  // These were shortened, not thinned. A cut that drops one of these facts
  // removes a disclosure rather than a word, so each is pinned by the part of
  // it a reader could do something about: whether a file leaves the machine,
  // what is kept and what is not, who else sees them, and how to stop the one
  // that can be stopped.
  //
  // The url line used to promise that nothing is stored. That stopped being
  // true when cards began fetching their own outline and holding it so the
  // same one is not fetched twice, so the promise was narrowed to what is
  // still true, in memory rather than on disk, and this test was narrowed with
  // it. A test that pins a sentence the code has outgrown protects the wording
  // and not the reader.
  //
  // The map line changed the same way and for the same reason. It used to say
  // the background was on the trace chart, which was the whole truth until
  // cards started drawing ground of their own. So the card is now pinned too,
  // and the way to stop it is pinned by the NAME OF THE CONTROL rather than by
  // a phrase describing where the control sits: "turn it off on the trace
  // chart" was a true sentence that had become a wrong instruction.
  const required = {
    en: {
      'footer.processing.file': [/never uploaded/i, /this browser/i],
      'footer.processing.url': [/our server/i, /outline is held in memory/i, /nothing is written down/i, /no accounts/i],
      'footer.processing.map': [/OpenStreetMap/, /IP address/i, /card outlines/i, /hide map/i],
      'footer.processing.fonts': [/Google/, /IP address/i, /before you press/i],
    },
    es: {
      'footer.processing.file': [/no se suben/i, /navegador/i],
      'footer.processing.url': [/servidor/i, /contorno.*queda en memoria/i, /no se anota nada/i, /no hay cuentas/i],
      'footer.processing.map': [/OpenStreetMap/, /IP/, /contornos/i, /ocultar mapa/i],
      'footer.processing.fonts': [/Google/, /IP/, /antes de que pulses/i],
    },
  };
  for (const [lang, keys] of Object.entries(required)) {
    for (const [key, patterns] of Object.entries(keys)) {
      const said = translate(lang, key);
      for (const pattern of patterns) {
        assert.match(said, pattern, `${lang} ${key} no longer says it`);
      }
    }
  }
});

test('the ascent disclosure names all three parameters, in both languages', () => {
  // Ascent is the one figure on the page a reader can watch disagree with the
  // source by a fifth, and it was the one figure showing none of what made it.
  // A wording that dropped a placeholder would print "{window}" where the
  // width of the filter should be.
  const fill = { step: '27.6', window: '5', noise: '1' };
  for (const lang of LANGUAGES) {
    for (const key of ['measure.ascent.step', 'method.summary', 'method.sampling']) {
      const said = translate(lang, key, fill);
      assert.notEqual(said, key, `${lang} ${key} is missing`);
      assert.ok(!said.includes('{'), `${lang} ${key}: ${said}`);
    }
    assert.ok(translate(lang, 'measure.ascent.step', fill).includes('27.6'), lang);
    const sampling = translate(lang, 'method.sampling', fill);
    for (const value of ['27.6', '5', '1']) {
      assert.ok(sampling.includes(value), `${lang} drops ${value}: ${sampling}`);
    }
  }
});

test('the page never says how the source computed its own figure', () => {
  // It said so once, three ways, and all three were wrong: it stated what
  // portals do internally with nothing behind it, claimed ours is always the
  // lower of the two, and called our own unfiltered accumulation "theirs". On
  // one real route that was off by 177 m with both numbers on the same screen.
  // We measure the file. What the source did to reach its own number is not
  // something this page can see, so it is not something this page may say.
  // Narrow on purpose. "nothing of theirs is in this list" is about rows and is
  // true; what is banned is a claim about how the other site reached a number.
  const forbidden = /portals? publish|los portales publican|theirs is the raw|la suya es el desnivel/i;
  for (const lang of LANGUAGES) {
    for (const key of keysOf(lang)) {
      const said = translate(lang, key);
      assert.ok(!forbidden.test(said), `${lang} ${key} claims to know the source: ${said}`);
    }
  }
});

test('no sentence grows back into a wall', () => {
  // The footer used to run four statements of up to 300 characters at one
  // weight, which is the shape a site uses to bury a disclosure. The budget is
  // loose on purpose: it catches a paragraph arriving, not a long sentence.
  const budget = 220;
  for (const lang of LANGUAGES) {
    for (const key of keysOf(lang)) {
      const said = translate(lang, key);
      assert.ok(
        said.length <= budget,
        `${lang} ${key} is ${said.length} characters, past the ${budget} budget: ${said}`,
      );
    }
  }
});

test('nothing we write carries an em dash or an en dash', () => {
  // Route titles come from their authors and do carry them, but they are
  // escaped, not translated, so nothing here should hold one.
  for (const lang of LANGUAGES) {
    for (const key of keysOf(lang)) {
      const said = translate(lang, key);
      assert.ok(!/[–—]/.test(said), `${lang} ${key} carries a dash: ${said}`);
    }
  }
});

test('the shape a route was found to have leaves no placeholder unfilled', () => {
  // These three were reworded, and each interpolates the measured ends, the
  // allowance and the length. A wording that lost one would print "{tolerance}".
  const fill = { ends: '160 m', tolerance: '272 m', km: '13.6', floor: '25', ceiling: '400' };
  for (const lang of LANGUAGES) {
    for (const key of [
      'rotate.detected.closed',
      'rotate.detected.near',
      'rotate.detected.open',
      'rotate.rule',
    ]) {
      const said = translate(lang, key, fill);
      assert.ok(!said.includes('{'), `${lang} ${key}: ${said}`);
      assert.notEqual(said, key, `${lang} ${key} is missing`);
    }
  }
});

test('the re-arranger still says the ends are apart and by how much', () => {
  // The sentence that stops a reader moving the start of something that is not
  // a ring. Shortened, so the two facts it turns on are pinned: how far apart
  // the ends are, and that moving the start is not on offer.
  const fill = { ends: '900 m', tolerance: '272 m', km: '13.6' };
  const open = { en: translate('en', 'rotate.detected.open', fill), es: translate('es', 'rotate.detected.open', fill) };
  assert.match(open.en, /900 m/);
  assert.match(open.en, /272 m/);
  assert.match(open.en, /reversing/i);
  assert.match(open.es, /900 m/);
  assert.match(open.es, /272 m/);
  assert.match(open.es, /invertir/i);
});

test('the three figures the report was hiding are named in both languages', () => {
  // Each one is a number this page already measured and did not print, so each
  // is a placeholder that has to survive translation. A wording that lost one
  // would print "{gaps}" over a figure a reader is being asked to trust.
  const fill = { gaps: '2.7 km', coverage: '77' };
  for (const lang of LANGUAGES) {
    for (const key of ['measure.distance.gaps', 'measure.ascent.coverage', 'measure.descent']) {
      const said = translate(lang, key, fill);
      assert.notEqual(said, key, `${lang} ${key} is missing`);
      assert.ok(!said.includes('{'), `${lang} ${key}: ${said}`);
    }
  }
  assert.match(translate('en', 'measure.distance.gaps', fill), /2\.7 km/);
  assert.match(translate('es', 'measure.distance.gaps', fill), /2\.7 km/);
  assert.match(translate('en', 'measure.ascent.coverage', fill), /77%/);
  assert.match(translate('es', 'measure.ascent.coverage', fill), /77%/);
});

test('the three notes stay notes and never grow into sentences', () => {
  // They were added under an instruction that the page already says too much,
  // and each is a figure in a note line that existed, not a line of prose. The
  // budget is the longest of the notes already there, which is the gap tile's
  // "no gap over {threshold} m". Anything past it is a sentence arriving.
  const budget = Math.max(
    ...LANGUAGES.map((lang) => translate(lang, 'gap.none', { threshold: 100 }).length),
  );
  for (const lang of LANGUAGES) {
    for (const key of ['measure.distance.gaps', 'measure.ascent.coverage', 'measure.descent']) {
      const said = translate(lang, key, { gaps: '2.7 km', coverage: '77' });
      assert.ok(said.length <= budget, `${lang} ${key} is ${said.length} against ${budget}: ${said}`);
    }
  }
});

test('a visitor with no JavaScript is told so, in both languages', () => {
  // Every string on the page is written by i18n.js, so with JavaScript off the
  // first paint is empty buttons and unlabelled fields and nothing saying why.
  // The language toggle is JavaScript too, so both sentences are printed, one
  // after the other, and each is marked with the language it is in.
  const at = html.indexOf('<noscript>');
  assert.notEqual(at, -1, 'index.html has no noscript');
  const said = html.slice(at, html.indexOf('</noscript>', at));
  assert.match(said, /lang="en"/);
  assert.match(said, /lang="es"/);
  assert.match(said, /needs JavaScript/i);
  assert.match(said, /necesita JavaScript/i);
});

test('the word printed beside the link field is the name the field answers to', () => {
  // WCAG 2.2 SC 2.5.3 Label in Name. The visible word is `field.prefix`, and
  // `app.js` names the field with `field.label`. A name that did not start with
  // the visible word would leave a speech-input user saying "click URL" with
  // nothing to click, and the field was also the one input on the page with no
  // label element at all.
  assert.match(html, /<label class="field-prefix" for="route-url">/);
  for (const lang of LANGUAGES) {
    const visible = translate(lang, 'field.prefix');
    const named = translate(lang, 'field.label');
    assert.ok(
      named.toLowerCase().startsWith(visible.toLowerCase()),
      `${lang}: "${named}" does not start with the visible "${visible}"`,
    );
  }
});

test('the activity note says who narrows the list and never counts pages for the reader', () => {
  // One sentence sits under two surfaces, so it may only say what is true of
  // both. Nearby reads up to four windows of Wikiloc results (`_scan` in
  // `api/sources/wikiloc_discovery.py`) and Search reads exactly one (`_look`),
  // so "several pages" was a true sentence on one tab and a false one on the
  // other. What both paths do share is the fact a reader can act on: the
  // narrowing is ours, not Wikiloc's, which is why a filtered list can come
  // back short.
  const counted = /several pages|pages of (its|their) results|varias páginas/i;
  for (const lang of LANGUAGES) {
    const said = translate(lang, 'activity.notFiltered');
    assert.ok(!counted.test(said), `${lang} counts pages the search path never reads: ${said}`);
    assert.match(said, /Wikiloc/);
    assert.match(said, /our server|nuestro servidor/i);
  }
});

test('every outcome useMyLocation can reach has a sentence in both languages', () => {
  // geoSentence falls back to geo.unavailable when a key is missing, which is
  // a kindness that hides a defect: a `timedout` outcome was added to the code
  // and its string never was, so a slow fix -- the one outcome worth trying
  // again -- was reported as a browser that cannot give a position. That is
  // the exact bug the outcome had been split apart to end.
  //
  // Read out of app.js rather than listed here, so an outcome added later is
  // caught by this test rather than by somebody on a phone.
  const app = readFileSync(fileURLToPath(new URL('../assets/app.js', import.meta.url)), 'utf8');
  const start = app.indexOf('function useMyLocation');
  assert.notEqual(start, -1);
  const source = app.slice(start, app.indexOf('\n}\n', start));

  const outcomes = new Set(
    [...source.matchAll(/(?:geo\s*=\s*|outcome\s*=\s*)'([a-z]+)'/g)].map((m) => m[1]),
  );
  assert.ok(outcomes.size >= 4, `only found ${[...outcomes]}`);

  for (const lang of LANGUAGES) {
    for (const outcome of outcomes) {
      const key = `geo.${outcome}`;
      assert.notEqual(translate(lang, key), key, `${lang} has no ${key}`);
    }
  }
});

test('the caption under the link field does not name the button under the caption', () => {
  // Four lines of mono at 390, and the last clause of them named Choose a .gpx
  // file, which is the visible label of the button 40px below. The three link
  // shapes and the drop are the facts nothing else on that screen carries, so
  // those are what stayed and those are what is pinned here.
  for (const lang of LANGUAGES) {
    const said = translate(lang, 'step1.hint');
    assert.match(said, /komoot\.com\/tour/, `${lang} drops the tour link shape`);
    assert.match(said, /komoot\.com\/smarttour/, `${lang} drops the smarttour link shape`);
    assert.match(said, /wikiloc\.com/, `${lang} drops Wikiloc`);
    assert.match(said, /\.gpx/, `${lang} drops the file you already have`);
    assert.doesNotMatch(
      said,
      /\bbelow\b|\babajo\b/i,
      `${lang} sends the reader to a control already in front of them: ${said}`,
    );
  }
});

test('four lines on the good path are captions and footnotes, not paragraphs', () => {
  // None of these lost a fact. Each lost a clause that something else on the
  // same screen already says, and the budget is what each came out at with a
  // little room, so a clause growing back fails here rather than on a phone.
  //
  //   step1.hint       159 -> 127  the button under it says "choose it below"
  //   provenance       111 ->  95  named the file twice in one sentence
  //   rotate.rule       71 ->  63  the tail of a 245-character paragraph that
  //                                stood between the reader and the two
  //                                controls the re-arranger exists for
  //   step2.send.note  200 -> 184  never seen by anybody: it is the button's
  //                                aria-description, read out in full every
  //                                time the button takes focus
  //
  // The budgets answer the longer of the two languages, because both are read
  // by somebody and only one of them can set the number.
  const budget = {
    'step1.hint': 152,
    provenance: 106,
    'rotate.rule': 66,
    'step2.send.note': 197,
  };
  const fill = { floor: '30', ceiling: '1000' };
  for (const lang of LANGUAGES) {
    for (const [key, cap] of Object.entries(budget)) {
      const said = translate(lang, key, fill);
      assert.ok(!said.includes('{'), `${lang} ${key} left a placeholder: ${said}`);
      assert.ok(said.length <= cap, `${lang} ${key} is ${said.length} against ${cap}: ${said}`);
    }
  }
});
