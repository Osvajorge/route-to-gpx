// Run with:  node --test web/test/
//
// The rules that live in index.html: the document a screen reader and a
// keyboard actually meet, which no test of the arithmetic and no test of the
// stylesheet reads. Every one of these was broken, and none of them by a
// mistake in reasoning -- a view was hidden and the link pointing into it was
// not revisited, a control was added to the head of a drawing and the drawing
// took its name from the whole head.
//
// These read the markup as text, the way the style suite already reads the
// stylesheet, and for the same reason: app.js boots a whole page against a
// window this suite has no browser for, so the document cannot be built here.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { LANGUAGES, translate } from '../assets/i18n.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const js = readFileSync(fileURLToPath(new URL('../assets/app.js', import.meta.url)), 'utf8');

/** One element's opening tag, by an id it carries. */
function tag(id) {
  const at = html.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `#${id} is gone from index.html`);
  const from = html.lastIndexOf('<', at);
  return html.slice(from, html.indexOf('>', at) + 1);
}

test('the skip link points at something the report has not hidden', () => {
  // It pointed at #tabs, which lives inside #step-one, and app.js sets
  // `el.stepOne.hidden = state.view === 'report'`. So for the whole of the
  // report -- the view a visitor spends the longest in, and the one with the
  // most to skip past -- the first control on the page led to an element that
  // was not in the document and moved neither focus nor the page.
  const target = /<a class="skip-link" href="#([a-z-]+)"/.exec(html);
  assert.ok(target, 'the skip link is gone');
  const id = target[1];

  // The one element both views share. If the link is ever pointed somewhere
  // else, that somewhere has to survive the report as well.
  assert.equal(id, 'app', 'the skip link points into a view that gets hidden');
  assert.match(js, /el\.stepOne\.hidden = state\.view === 'report'/);

  // And it has to be able to hold focus. A fragment target that cannot leaves
  // the next Tab back at the top of the document, which is the press the link
  // existed to save.
  assert.match(tag(id), /tabindex="-1"/, `#${id} cannot take the focus the link sends it`);
});

test('the words on the skip link do not name the tabs it no longer reaches', () => {
  // The markup carries the English once as the pre-JavaScript paint, and
  // i18n.js carries both languages for every paint after that. A rename that
  // reached one and not the other would leave the two disagreeing.
  const printed = /<a class="skip-link" href="#[a-z-]+">([^<]+)<\/a>/.exec(html);
  assert.ok(printed, 'the skip link has no words');
  assert.equal(printed[1], translate('en', 'skip.main'));
  for (const lang of LANGUAGES) {
    assert.doesNotMatch(
      translate(lang, 'skip.main'),
      /tabs|pestañas/i,
      `${lang} still sends the reader to the tabs`,
    );
  }
});

test('a drawing with controls in its head is named by its title alone', () => {
  // A <figure> takes its accessible name from the whole <figcaption>, and the
  // head of a trace holds the map toggle and, in the re-arranger, three zoom
  // buttons as well. Read in a browser before this was fixed, the report's
  // trace announced itself as "Route trace Hide map" and the re-arranger's as
  // "Route trace - + Fit Hide map": four control labels inside the name of the
  // picture they sit above.
  //
  // The rule is written against the condition rather than against the three
  // figures that had it, so a button added to the elevation profile's head
  // fails here rather than in somebody's ears.
  const figures = [...html.matchAll(/<figure\b[^>]*>[\s\S]*?<\/figcaption>/g)].map((m) => m[0]);
  assert.ok(figures.length >= 5, `only found ${figures.length} figures`);

  for (const figure of figures) {
    const open = figure.slice(0, figure.indexOf('>') + 1);
    const head = figure.slice(figure.indexOf('<figcaption'));
    if (!/<button/.test(head)) continue;

    const named = /aria-labelledby="([a-z-]+)"/.exec(open);
    assert.ok(named, `a figure with controls in its head takes its name from them: ${open}`);

    // And the name it is given is its own heading, not some other figure's.
    assert.match(
      head,
      new RegExp(`<h[23] class="chart-title" id="${named[1]}"`),
      `${named[1]} is not the title of this figure`,
    );
  }
});

test('nothing inside a dialog claims to be the page banner or the page footer', () => {
  // Per HTML-AAM a <header> maps to `banner` and a <footer> to `contentinfo`
  // unless it sits inside article, aside, main, nav or section. role="dialog"
  // is not on that list, so the title bar and the action bar of each dialog
  // were landmarks of the whole document: a visitor navigating by landmark
  // inside the re-arranger found a "banner" that was the route's own title.
  const shell = html.slice(html.indexOf('<div class="shell">'));
  const dialogs = shell.slice(shell.indexOf('<div\n      class="dialog-veil"'));
  assert.ok(dialogs.length > 0, 'the dialogs are gone from index.html');
  assert.doesNotMatch(dialogs, /<header|<footer/, 'a dialog is using a landmark element again');

  // The page's own two are still landmarks, and are still the only ones.
  assert.equal(html.split('<header').length - 1, 1, 'the page has more than one banner');
  assert.equal(html.split('<footer').length - 1, 1, 'the page has more than one contentinfo');
});

test('the tab panels are named by their tabs, and the tabs control real panels', () => {
  // The pattern only holds if every half of it does. A tab whose aria-controls
  // names nothing is a tab that says it opens something it cannot.
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/gs)].map((m) => m[0]);
  assert.equal(tabs.length, 3, `found ${tabs.length} tabs`);

  for (const button of tabs) {
    const id = /id="([a-z-]+)"/.exec(button)[1];
    const panelId = /aria-controls="([a-z-]+)"/.exec(button)[1];
    const panel = tag(panelId);
    assert.match(panel, /role="tabpanel"/, `${panelId} is not a tabpanel`);
    assert.match(panel, new RegExp(`aria-labelledby="${id}"`), `${panelId} is not named by its tab`);
  }

  // app.js gives the selected tab a tabIndex of 0 and the rest -1, which is the
  // half of the pattern that takes the other two out of the tab order. The
  // arrows are what puts them back, so the roving tabindex may not ship alone.
  assert.match(js, /button\.tabIndex = selected \? 0 : -1/);
  assert.match(js, /\{ ArrowRight: 1, ArrowLeft: -1 \}\[event\.key\]/);
});

test('the gap tile note never denies the figure printed above it', () => {
  // The tile's label is "Largest gap" and its figure is that gap in metres.
  // Under a measured 146 m the note read "no gap over 285 m", which is a true
  // sentence and an unreadable one three lines under the number it appears to
  // contradict. It now says where that figure sits against the threshold.
  for (const lang of LANGUAGES) {
    const said = translate(lang, 'gap.none', { threshold: 285 });
    assert.ok(said.includes('285'), `${lang} drops the threshold: ${said}`);
    assert.doesNotMatch(
      said,
      /no gap|ningún salto/i,
      `${lang} denies the gap the tile is showing: ${said}`,
    );
  }
});

test('neither finder lede names a row, because there are no rows on screen', () => {
  // The results are cards, in a grid, and every other string on the page calls
  // them that. "Converting a row is what measures it" was the one sentence
  // using the word for the shape they used to have.
  for (const lang of LANGUAGES) {
    for (const key of ['step1.sub.search', 'step1.sub.nearby']) {
      assert.doesNotMatch(translate(lang, key), /\brows?\b|\bfilas?\b/i, `${lang} ${key}`);
    }
  }
});

test('the sentence saying what the gap means reads before the drawings of it', () => {
  // THE GAP IS SAID FOUR TIMES ON THE REPORT: the Largest gap tile, the label
  // on the trace, the caption under it, and this line. Three of those are
  // labels on a picture. This one is the only thing on the page that asks the
  // reader to do something, and it sat under both drawings: measured at
  // 1440x900 it began 1145px down a 1554px page, so on that screen a reader
  // met the number four times and the instruction never, unless they scrolled.
  //
  // So it reads straight after the figure it is about, before the method fold
  // and before either drawing.
  const report = html.slice(html.indexOf('<section class="step" id="report"'));
  assert.ok(report.length > 0, 'the report section is gone from index.html');

  const at = (id) => {
    const found = report.indexOf(`id="${id}"`);
    assert.notEqual(found, -1, `#${id} is gone from the report`);
    return found;
  };

  assert.ok(at('tiles') < at('warning'), 'the warning reads before the figure it is about');
  assert.ok(at('warning') < at('method'), 'the arithmetic fold outranks the instruction');
  assert.ok(at('warning') < at('trace'), 'the warning reads after the trace again');
  assert.ok(at('warning') < at('profile'), 'the warning reads after the profile again');

  // It is still announced when it appears, which is what it is for on a phone.
  assert.match(tag('warning'), /role="status"/);
});

test('one Spanish word for a file, not two', () => {
  // `provenance.none` and `measure.elevation.raw` said "archivo" while eleven
  // other strings said "fichero", including the button that opens one and the
  // line that names it on the report. A reader meets both within one screen.
  const es = LANGUAGES.filter((lang) => lang === 'es');
  assert.deepEqual(es, ['es'], 'Spanish is gone');
  for (const key of ['provenance.none', 'measure.elevation.raw', 'source.file', 'action.choosefile']) {
    const said = translate('es', key, { min: '1', max: '2' });
    assert.doesNotMatch(said, /archivos?\b/i, `${key} is back on the other word: ${said}`);
  }
});
