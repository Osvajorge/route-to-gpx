// Run with:  node --test web/test/
//
// The rules that live in app.js: what the page does when a visitor cannot see
// it, cannot use a pointer, or is handed a server that never answers. Every one
// of them was broken once, and none of them by a mistake in the arithmetic.
//
// These read the source text, the way the style suite already reads it for the
// shape queue, and for the same reason: app.js boots a whole page against a
// `window` and a document this suite has no browser for, so the functions below
// cannot be called. A source-text rule is weaker than a behaviour test and it is
// what there is; each one is written against the exact line that carries the
// behaviour, so a change that puts the defect back has to go through it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const js = readFileSync(fileURLToPath(new URL('../assets/app.js', import.meta.url)), 'utf8');

/** The source of one top-level function, to the line that closes it.
 *
 *  Every block inside a function is indented, so the first `}` alone at the
 *  start of a line is the function's own. */
function body(name) {
  const at = js.search(new RegExp(`\\n(?:async )?function ${name}\\(`));
  assert.notEqual(at, -1, `${name} is gone from app.js`);
  const rest = js.slice(at + 1);
  const ends = rest.indexOf('\n}\n');
  assert.notEqual(ends, -1, `${name} never closes`);
  return rest.slice(0, ends + 2);
}

/** How often one exact string appears in the whole file. */
function times(text) {
  return js.split(text).length - 1;
}

/** The same source with the comments taken out.
 *
 *  A comment that names the thing a line stopped doing is exactly the sentence
 *  a reader needs, and must not fail the test that asks whether the line still
 *  does it. The paste handler says out loud that the focus used to sit behind
 *  an await, which is the word that test forbids in the code. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

test('every road to the report takes focus with it', () => {
  // Three of them: the link field, a dropped file, and the Report button in the
  // preview dialog. Step two replaces step one, so whatever was focused is
  // hidden and focus falls to the top of the document with nothing said. It was
  // fixed on the dialog's road alone, which left the two ordinary ones silent.
  assert.match(body('showReport'), /el\.downloadButton\.focus\(\)/);
  assert.equal(
    times('el.downloadButton.focus()'),
    1,
    'focus belongs in showReport, where all three roads pass, and nowhere else',
  );
});

test('a results panel has its live region before it has anything to say', () => {
  assert.match(body('collect'), /el\.searchSay = addLiveRegion\(el\.searchOut\)/);
  assert.match(body('collect'), /el\.nearbySay = addLiveRegion\(el\.nearbyOut\)/);

  // Created empty. A region that arrives holding its text has changed nothing,
  // and what is announced is what changes inside a region already being watched.
  const region = body('addLiveRegion');
  assert.match(region, /'role', 'status'/);
  assert.doesNotMatch(region, /textContent/);
});

test('a search that worked says so, and not twice', () => {
  const said = body('announceResults');
  assert.match(said, /panel\.status === 'ready'/, 'only failures used to be announced');
  assert.match(said, /panel\.status === 'working'/);
  assert.match(said, /panel\.status === 'empty'/);
  // The sentences it now carries are drawn and thrown away with the list, so
  // they must not announce themselves from in there as well.
  const results = body('renderResults');
  assert.doesNotMatch(results, /class="finder-status" role="status"/);
  assert.doesNotMatch(results, /class="finder-empty" role="status"/);
  assert.match(results, /announceResults\(mode, panel, source\)/);
});

test('the reading under the pointer can be reached without one', () => {
  // The height at a given distance is in the hover and nowhere else on the
  // page, so a visitor without a pointer could not read it at all.
  const keys = body('wireChartKeys');
  for (const key of ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']) {
    assert.match(keys, new RegExp(`\\b${key}:`), `${key} does not move the cursor`);
  }
  assert.match(keys, /event\.preventDefault\(\)/, 'the arrows would scroll the chart away');

  const reachable = body('makeCursorReachable');
  assert.match(reachable, /plot\.tabIndex = 0/);
  assert.match(reachable, /'role', 'slider'/);
  assert.match(reachable, /'aria-label'/, 'a slider with no name is a slider for nothing');
  // And it reads out where it is at every step, not only where it started.
  assert.match(body('showHover'), /'aria-valuetext', label/);
});

test('a card title sits at the level its slot always sits at', () => {
  // Under step one's h1, in the slot that holds the cards when the search
  // worked and the "nothing came back" block when it did not.
  assert.match(body('cardMarkup'), /<h2 class="card-title"/);
  assert.equal(times('<h3 class="card-title"'), 0, 'a card title skipping h2');
  assert.match(body('renderResults'), /class="finder-empty"[\s\S]*?<h2>/);
});

test('a nearby tab whose activity list never arrived asks for it again', () => {
  const run = body('runList');
  // Nearby cannot be asked without an activity and the activities are fetched,
  // so one throttled answer at load used to end the tab for the session.
  assert.match(
    run,
    /mode === 'nearby' && !append && choicesFor\(mode\)\.sports\.length === 0/,
  );
  assert.match(run, /await loadCatalogue\(finder\.sourceId\)/);
  // And if it still does not arrive, the refusal must not be an instruction to
  // pick from a list that is empty and disabled.
  assert.match(run, /body\.errorKey === 'sport' && choicesFor\(mode\)\.sports\.length === 0/);
  assert.match(run, /panel\.errorKey = listMissing \? 'network' : body\.errorKey/);
});

test('a conversion that failed says so on the card that was pressed', () => {
  // The error panel is in step one, below the tab panels and therefore below
  // the whole grid: from the seventh card it is off the bottom of the screen.
  const act = body('runCardAction');
  assert.match(act, /noteOnCard\(listId, index, t\(`error\.\$\{failure\}\.title`\)\)/);
  assert.match(act, /clearRouteError\(\)/, 'and the panel under the grid comes down');
  // Found again by place in the list, because redrawing replaced the element.
  assert.match(body('noteOnCard'), /\.route-card\[data-index="\$\{index\}"\] \[data-note\]/);
});

test('a file that could not be read leaves nothing behind in the link field', () => {
  // Its name went in there to say which file was being worked on. Left behind,
  // the next press reads `walk.gpx` as a link and refuses it in different words.
  const fromFile = body('convertFromFile');
  assert.equal(fromFile.includes("fail('file')"), false, 'the name is still left in the field');
  assert.equal(times('failDroppedFile()'), 3, 'both ways a file can fail, and the function');

  const forget = body('failDroppedFile');
  assert.match(forget, /state\.url = ''/);
  assert.match(forget, /el\.input\.value = ''/);
});

test('a conversion the server never answers stops saying Working', () => {
  assert.match(body('convertRoute'), /signal: givesUpAfter\(CONVERT_TIMEOUT_MS\)/);
  const bound = /const CONVERT_TIMEOUT_MS = (\d+);/.exec(js);
  assert.ok(bound, 'the wait has no bound at all');
  assert.ok(Number(bound[1]) > 0 && Number(bound[1]) <= 120000, 'a bound nobody would wait out');
  // And a browser with no such signal keeps converting rather than failing on a
  // TypeError inside the try, which would read as a network error every time.
  assert.match(body('givesUpAfter'), /typeof AbortSignal\?\.timeout === 'function'/);
});

test('the paste button focuses the field inside the press, not after it', () => {
  // iOS raises the keyboard only for a focus in the task the tap started. After
  // the await for the clipboard the tap is over, so the refused-clipboard
  // fallback was a focused field with no keyboard under it.
  const wired = body('wire');
  const from = wired.indexOf('el.pasteButton.addEventListener');
  assert.notEqual(from, -1, 'the paste button is no longer wired here');
  const press = code(wired.slice(from, wired.indexOf('\n  });', from)));
  assert.doesNotMatch(press, /\bawait\b/);
  assert.ok(
    press.indexOf('el.input.focus()') < press.indexOf('readClipboard()'),
    'the clipboard is read before the field is focused',
  );
});

test('a full tile cache drops its oldest tile, not all of them', () => {
  // Emptying it at the ceiling meant the frame that filled it threw away every
  // tile on screen, so from then on each pan refetched the whole plate.
  const load = body('loadTile');
  assert.doesNotMatch(load, /tileCache\.clear\(\)/);
  assert.match(load, /tileCache\.delete\(tileCache\.keys\(\)\.next\(\)\.value\)/);
  // And a hit moves the tile to the young end, or "least recently used" would
  // mean least recently fetched and throw away the tile drawn in every frame.
  const recall = body('recallTile');
  assert.match(recall, /tileCache\.delete\(url\);[\s\S]*tileCache\.set\(url, pending\)/);
  assert.match(load, /const pending = recallTile\(url\)/);
});

test('the send button is shown only where the browser can really hand over a file', () => {
  // Chromium answers canShare() with true for plenty of types and then rejects
  // the share, and it keeps .gpx off the list it will pass on. So the question
  // is asked with a real File of the real type, and the button exists only if
  // the answer is yes. A button that opens nothing is worse than no button.
  const probe = body('browserCanSendFiles');
  assert.match(probe, /new File\(/, 'the capability is not probed with a real File');
  assert.match(probe, /application\/gpx\+xml/, 'the probe does not use the type that gets refused');
  assert.match(probe, /navigator\.canShare/);
  assert.match(
    js,
    /el\.sendButton\.hidden = !browserCanSendFiles\(\)/,
    'the button is not gated on the probe',
  );
});

test('the send happens inside the click, because iOS spends the gesture on an await', () => {
  // iOS grants one share per user gesture. An `await` before navigator.share
  // spends it and the call throws NotAllowedError, which is why this button is
  // on the report -- where the conversion has already happened -- and not on a
  // card, where pressing it starts one.
  const send = body('sendResult');
  assert.doesNotMatch(send, /\bawait\b/, 'sendResult awaits, so iOS will refuse the share');
  assert.doesNotMatch(send, /fetch\(/, 'sendResult fetches, so the gesture is gone by the time it shares');
  assert.match(send, /state\.result\.gpxText/, 'it does not use the GPX the page already holds');
  assert.match(send, /navigator\.share\(/);
  assert.match(send, /\.catch\(/, 'a dismissed share must not raise');

  // And it is wired to the click rather than to something that defers.
  assert.match(js, /el\.sendButton\.addEventListener\('click', sendResult\)/);
});

test('the send button says what the receiving app will do to the numbers', () => {
  // Garmin redraws elevation from its own map: a 551-point track published at
  // 535 m of ascent came back from a real upload as 598 m. A page whose whole
  // argument is measured fidelity has to say so where the handover happens.
  assert.match(js, /el\.sendButton\.title = t\('step2\.send\.note'\)/);
  assert.match(js, /aria-description', t\('step2\.send\.note'\)/);
});
