// Run with:  node --test web/test/
//
// The rules that live in the stylesheet and in the markup, and nowhere a unit
// test of the arithmetic would ever reach. Each one was broken once, none of
// them by a mistake in reasoning: a token was moved, a heading was raised, a
// phone was measured last, a paragraph was written and the declaration it
// describes was never added. So each is pinned here, where a change that breaks
// it again fails before it ships rather than after.
//
// These read the declarations outside the media query. The narrow width has one
// test of its own, which reads inside it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../assets/app.css', import.meta.url)), 'utf8');
// Two of the rules below are half markup: a heading that is set like a heading
// and is not one is the defect, not half of it.
const js = readFileSync(fileURLToPath(new URL('../assets/app.js', import.meta.url)), 'utf8');
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/** The declarations of one rule, by its exact selector. */
function block(selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `${selector} is gone from the stylesheet`);
  return css.slice(at, css.indexOf('}', at));
}

/** The same, with the comments taken out.
 *
 *  A comment that names the thing a rule stopped using is worth keeping and
 *  must not fail a test that asks whether the rule still uses it. `.results`
 *  says out loud that it replaced auto-fit, which is exactly the sentence a
 *  reader needs and exactly the word the test forbids in the declarations. */
function declarations(selector) {
  return block(selector).replace(/\/\*[\s\S]*?\*\//g, '');
}

/** The narrow media query, from its brace to the one that closes it. */
function narrowBlock() {
  const open = css.indexOf('{', css.indexOf('@media (max-width: 640px)'));
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(open, i);
  }
  throw new Error('the narrow media query is never closed');
}

/** The declarations of one rule inside the narrow media query.
 *
 *  `block` reads the first rule with a given selector anywhere in the file,
 *  which for a selector that also exists outside the media query is the wrong
 *  one. Two spaces of indent is what tells them apart.
 *
 *  And it refuses to read a selector written twice, because then "the first
 *  one" is a choice this helper has no business making quietly: `.shell` and
 *  `.card` were each declared twice here, the second copy won, and every test
 *  that read them was reading the copy the browser threw away. */
function narrowRule(selector) {
  const narrow = narrowBlock();
  const at = narrow.indexOf(`\n  ${selector} {`);
  assert.notEqual(at, -1, `${selector} is gone from the narrow block`);
  assert.equal(
    narrow.indexOf(`\n  ${selector} {`, at + 1),
    -1,
    `${selector} is declared twice in the narrow block, so one of the two never applies`,
  );
  return narrow.slice(at, narrow.indexOf('}', at));
}

/** Every declaration the cascade throws away before anyone can read it.
 *
 *  One selector written twice in the same block, setting the same property
 *  both times: the later copy wins and the earlier one is dead, however long
 *  the paragraph above it is. Reported as "selector :: property", one line per
 *  declaration that never runs. */
function deadDeclarations(source, label = 'top level', found = []) {
  // Braces and colons inside a comment are not declarations, and this file is
  // more comment than declaration.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const bySelector = new Map();
  let depth = 0;
  let start = 0;
  let head = '';
  let bodyStart = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) {
        head = text.slice(start, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
    } else if (text[i] === '}') {
      depth -= 1;
      if (depth > 0) continue;
      const body = text.slice(bodyStart, i);
      if (head.startsWith('@')) deadDeclarations(body, `${label} ${head}`, found);
      else {
        const selector = head.replace(/\s+/g, ' ');
        const properties = [...body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
        const earlier = bySelector.get(selector);
        if (!earlier) bySelector.set(selector, properties);
        else {
          for (const property of properties) {
            // A shorthand kills the longhands under it, so `padding` after
            // `padding-top` is the same defect as `padding` after `padding`.
            for (const was of earlier) {
              const clash =
                property === was ||
                property.startsWith(`${was}-`) ||
                was.startsWith(`${property}-`);
              if (clash) found.push(`${label} :: ${selector} :: ${was} then ${property}`);
            }
          }
          earlier.push(...properties);
        }
      }
      start = i + 1;
    }
  }

  return found;
}

// How loud a text colour is. The ladder ranks by this, not by hex.
const LOUDNESS = { '--muted': 1, '--text-2': 2, '--text': 3 };

/** Size, weight, loudness and tracking of one rule, for comparing two of them.
 *
 *  Tracking is here because the ladder says out loud that rank is carried by
 *  weight, colour and tracking, and the test was checking two of the three. */
function type(selector) {
  const body = block(selector);
  const size = /font-size:\s*([\d.]+)px/.exec(body);
  const weight = /font-weight:\s*(\d+)/.exec(body);
  const colour = /color:\s*var\((--[a-z0-9-]+)\)/.exec(body);
  const tracking = /letter-spacing:\s*([\d.]+)em/.exec(body);
  return {
    size: size ? Number(size[1]) : null,
    // A rule that does not set one inherits 400 from the body.
    weight: weight ? Number(weight[1]) : 400,
    loudness: colour ? LOUDNESS[colour[1]] : null,
    tracking: tracking ? Number(tracking[1]) : 0,
  };
}

test('the empty star track is not painted with the boundary token', () => {
  // --field-border is held at 3:1 against the ground behind it. A rating track
  // wants the opposite: it is read against the fill drawn over it, and the two
  // asks pull in different directions. Sharing one token took a score from
  // 6.48:1 against its fill to 3.13:1, where a 4.8 and a 3.0 look alike.
  const stars = block('.card-stars');
  assert.match(stars, /var\(--rating-track\)/);
  assert.doesNotMatch(stars, /var\(--field-border\)/);
});

test('the token comment counts the uses it actually has', () => {
  // The comment said "every input, outline button and slider track" while the
  // token painted fourteen things, four of which were none of those. A comment
  // that undercounts its own reach is how the star track got painted with it.
  const uses = css.match(/var\(--field-border\)/g) || [];
  const claimed = /(\w+) uses/.exec(block(':root').replace(/\n/g, ' '));
  assert.ok(claimed, 'the --field-border comment no longer says how many uses it has');
  const words = {
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
  };
  assert.equal(words[claimed[1].toLowerCase()], uses.length, `the comment says ${claimed[1]}`);
});

test('no heading over our own figures is quieter than the source heading', () => {
  // THE CLAIM RULE, in the type. .card-claim-head is "What Komoot says" and it
  // heads figures this product exists to doubt. Every heading in this list
  // stands over figures we measured ourselves, and one pass left all of them
  // lighter, dimmer and smaller than that one.
  const source = type('.card-claim-head');
  for (const ours of ['.dialog-kicker', '.dialog-subhead', '.chart-title', '.tile-label']) {
    const head = type(ours);
    assert.ok(head.weight >= source.weight, `${ours} is lighter than .card-claim-head`);
    assert.ok(head.loudness >= source.loudness, `${ours} is dimmer than .card-claim-head`);
    assert.ok(head.size >= source.size, `${ours} is smaller than .card-claim-head`);
    assert.ok(head.tracking >= source.tracking, `${ours} is tighter than .card-claim-head`);
  }
});

test('a heading is never smaller than the labels beneath it', () => {
  const label = type('.tile-label');
  for (const head of ['.dialog-kicker', '.dialog-subhead']) {
    assert.ok(type(head).size >= label.size, `${head} is smaller than the .tile-label it governs`);
  }
});

test('the line saying we drew the gap outranks the chart chrome around it', () => {
  // It is the only line on the report that says the stretch the reader is
  // looking at was drawn here and recorded by nobody. It sat at the size of
  // the axis ticks, right of a start/finish legend, reading as a second key.
  const chrome = type('.chart-caption');
  const thesis = type('.caption-warn');
  assert.ok(thesis.size > chrome.size, 'the caption is set at chart-chrome size');
  assert.ok(thesis.weight > chrome.weight, 'the caption is set at chart-chrome weight');
  assert.match(block('.caption-warn'), /flex-basis:\s*100%/, 'the caption shares a line again');
});

test('on a phone the re-arranger puts its measured figures before its drawing', () => {
  // At 375x812 the dialog body is 556px tall and holds 891px. With the drawing
  // first, the Largest gap tile was 0% on screen: a walker could take the file
  // having never seen the one figure this product exists to show.
  const narrow = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(narrow, /#rotate-trace\s*\{\s*order:\s*1;/);
  assert.match(narrow, /#rotate-times,\s*\n\s*#rotate-notrim\s*\{\s*order:\s*2;/);
});

test('the measured figure under the re-arranger tiles cannot be squeezed to nothing', () => {
  // .secondary hides its overflow at this width so the row corners cut into the
  // shared border. Taking overflow off visible also takes away a flex item's
  // automatic minimum size, and the dialog body is a flex column that scrolls:
  // the descent row shrank to its own 2px border, which is what a reader saw
  // where a figure should be. The report's copy sits in a column that does not
  // scroll, which is why only this one needs saying.
  const narrow = css.slice(css.indexOf('@media (max-width: 640px)'));
  assert.match(narrow, /#rotate-secondary\s*\{\s*flex-shrink:\s*0;/);
});

test('the dialog scroller shades the edge it is cutting content at', () => {
  // Without it a cut lands mid-glyph and reads as a broken render rather than
  // as more content. `local` is what makes the shade appear only at an end
  // there is something past.
  assert.match(block('.dialog-body'), /no-repeat local/);
});

test('the card map and the chart map are damped by one rule, not two', () => {
  // A card is a promise about what the report will show. Two damping rules that
  // drifted apart would break that promise in the one place a reader would
  // notice: the same route, the same ground, two different pictures. So the two
  // selectors share a block, and this fails if anyone splits them.
  const shared = block('.chart-map,\n.card-map');
  assert.match(shared, /filter:\s*grayscale\(1\)/);
  assert.match(shared, /opacity:/);
  // And neither may quietly grow its own copy of the damping.
  assert.doesNotMatch(declarations('.card-map'), /filter:/);
  assert.doesNotMatch(declarations('.chart-map'), /filter:/);
});

test('the damped map stays visible against the card it sits on', () => {
  // The structure test above passed while the map was effectively invisible,
  // which is the gap this closes. Damping is two multipliers and it is easy to
  // tighten one without noticing the other: brightness 0.38 under opacity 0.45
  // composited raw tiles averaging 187 down to 50, against a card ground of 32.
  // Eighteen points is not ground.
  //
  // Bounded at both ends on purpose. Too dark and the map may as well not be
  // fetched, which would mean asking OpenStreetMap for tiles nobody can see.
  // Too bright and it stops being ground and starts competing with the line,
  // which is the only thing on the picture a reader is meant to read.
  const shared = block('.chart-map,\n.card-map');
  const brightness = Number(shared.match(/brightness\(([\d.]+)\)/)?.[1]);
  const opacity = Number(shared.match(/opacity:\s*([\d.]+)/)?.[1]);
  assert.ok(Number.isFinite(brightness) && Number.isFinite(opacity), shared);

  const TILE = 187;   // measured on real OpenStreetMap tiles
  const GROUND = 32;  // the card surface underneath
  const LINE = 213;   // the cyan the route is drawn in
  const shown = TILE * brightness * opacity + GROUND * (1 - opacity);

  assert.ok(shown - GROUND > 35, `map only ${(shown - GROUND).toFixed(0)} above the card`);
  assert.ok(LINE / shown > 1.8, `line only ${(LINE / shown).toFixed(1)}x the map`);
});

test('the card map sits under the line and takes no presses', () => {
  // Ground, and nothing more. It must never sit over the cyan line it exists to
  // sit under, and it must never eat a press meant for the card.
  const map = block('.card-map');
  assert.match(map, /z-index:\s*0/);
  assert.match(map, /pointer-events:\s*none/);
  assert.match(block('.card-trace'), /z-index:\s*1/);
});

test('the results grid gets its column count from the page, not from auto-fit', () => {
  // THE LONE CARD. auto-fit can only ask how many columns the width holds, so
  // it gave nine cards four, four and one. The count now comes from
  // columnCount() in cards.js, which asks the number of cards as well. A revert
  // to auto-fit would bring the bug back with no test failing anywhere else.
  const grid = declarations('.results');
  assert.match(grid, /repeat\(var\(--card-columns/);
  assert.doesNotMatch(grid, /auto-fit|auto-fill/);
  // And a card may not grow without limit when there are too few to fill a row.
  assert.match(grid, /max-width:\s*calc\(var\(--card-columns\)/);
});

test('a phone is one column whatever the page works out', () => {
  // The narrow rule is the floor under the computed count, so a stale value
  // from a wide render can never leave a phone with two columns.
  const narrow = css.slice(css.indexOf('@media (max-width: 640px)'));
  const rule = narrow.slice(narrow.indexOf('\n  .results {'));
  assert.match(rule.slice(0, rule.indexOf('}')), /grid-template-columns:\s*1fr/);
});

test('no rule is written twice over, with the first copy dead on arrival', () => {
  // THE DUPLICATE RULE, and the reason the one below it could sit broken for
  // as long as it did. `.shell` and `.card` were each written twice inside the
  // media query. The second copy of each won, so the first — the one with a
  // paragraph above it explaining what a phone was paying for the margin —
  // never applied at all. Nothing here could see it: `block` reads the first
  // rule with a given selector and stops, which is exactly the copy that was
  // being thrown away.
  //
  // Two rules sharing a selector are fine and the file has a few on purpose,
  // splitting a concern in two. What is never fine is the same property in
  // both, which is a declaration that cannot run and a comment that describes
  // a page nobody has ever seen.
  assert.deepEqual(deadDeclarations(css), []);
});

test('a phone gets the side margin the paragraph above it argues for', () => {
  // 32px of card padding inside 18px of shell padding is 100px of a 375px
  // screen, and the rule cutting that to 52 was written and then overridden by
  // the duplicate above. Measured in a browser at 375 before the duplicate was
  // removed: the shell reported 16px of side padding and the card 16px, which
  // is neither what the comment argues for nor what it argues against.
  assert.match(narrowRule('.shell'), /--shell-pad:\s*12px/);
  assert.match(narrowRule('.card'), /padding:\s*16px 14px/);
  // --shell-pad and not a literal, because `.card.is-wide` subtracts it: a
  // side padding written straight into `.shell` leaves the wide card aligned
  // to a margin the shell no longer has.
  assert.doesNotMatch(narrowRule('.shell'), /padding:\s/);
});

test('the page keeps a gap the height of the download bar at its tallest', () => {
  // The bar is out of flow, so nothing under it reserves its space. Measured
  // at 375x812 before this: the bottom 59px of the colophon sat behind the bar
  // with the page scrolled as far as it went — the privacy statement and the
  // source link, which are the two things on this page that are there for
  // honesty rather than use. Afterwards the link clears the bar by 16px.
  //
  // THE SUM IS NOW TWO ROWS, BECAUSE THE BAR HAS TWO WHENEVER ONE WILL NOT DO.
  // Which of the two it has depends on how wide the labels are in the language
  // being read, and no media query can ask that: measured at 360x844, the bar
  // is one row in English and two in Spanish. So the reservation answers the
  // worse case. It was the one-row sum while the bar could already be two, and
  // that was measured at 360x844 in Spanish as a 95.8px bar against a 75px
  // reservation, with the bottom 20.8px of the colophon behind it again.
  const bar = narrowRule('.report-actions');
  assert.match(bar, /position:\s*fixed/);
  const border = Number(/border-top:\s*(\d+)px/.exec(bar)[1]);
  const above = Number(/padding:\s*(\d+)px/.exec(bar)[1]);
  const below = Number(/calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/.exec(bar)[1]);
  const between = Number(/row-gap:\s*(\d+)px/.exec(bar)[1]);
  const button = Number(/min-height:\s*(\d+)px/.exec(narrowRule('#download'))[1]);
  // The tallest control that can land on the second row, not one of them. Four
  // controls can share it once a build carries a Garmin session and the
  // browser can hand over a file, and the reservation answers the worst case.
  const secondRow = Math.max(
    ...['#report-adjust', '#reset', '#send-file,\n  #send-garmin'].map((selector) =>
      Number(/min-height:\s*(\d+)px/.exec(narrowRule(selector))[1]),
    ),
  );

  const published = /--action-bar:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/.exec(
    narrowRule('.shell'),
  );
  assert.ok(published, 'the shell no longer publishes what the bar takes');
  assert.equal(Number(published[1]), border + above + button + between + secondRow + below);

  // And the last block on the page is the one that keeps clear of it, only
  // while step two is up, because that is when the bar exists.
  assert.match(
    narrowRule("#app[data-view='report'] ~ .colophon"),
    /padding-bottom:\s*var\(--action-bar\)/,
  );
});

test('the action bar drops a control to a second row rather than crushing the row it has', () => {
  // THE BAR HAD NO SLACK. Measured at 390x844 in Spanish: 196.7px of button,
  // 46px of icon, 91.3px of link, two 12px gaps and two 16px margins come to
  // 390.0px, to the pixel — a line that fits only because nothing on it is a
  // character longer. At 360 it stopped fitting: "Descargar GPX" broke onto a
  // second line inside its own button and the bar grew to 95.8px.
  //
  // Wrapping is what makes that a reflow instead of a squeeze. Without it the
  // controls share one line however little of it there is, and the words go
  // first.
  const bar = narrowRule('.report-actions');
  assert.match(bar, /flex-wrap:\s*wrap/, 'the bar packs into one line at any width again');

  // The primary keeps a floor, so it is never the control that gets thin: it
  // either holds the row it is on or takes a row of its own. Measured in
  // Spanish, the label is one line at 181.7px of button and two at 166.7px.
  const primary = /flex:\s*1 1 (\d+)px/.exec(narrowRule('#download'));
  assert.ok(primary, 'the primary no longer declares the width it needs');
  assert.ok(
    Number(primary[1]) >= 175,
    `a ${primary[1]}px floor is under the width the label needs`,
  );
});

test('every control on the action bar is as tall as a thumb', () => {
  // "New link" measured 72.5 x 29.6 at 390: wide enough to hit and not tall
  // enough. It is a link, and a link is as tall as its own text, so it was the
  // one control on the bar that never got the floor the rest of this block
  // gives the page. 44px is Apple's minimum; the block already uses 44 and 46.
  for (const selector of ['#report-adjust', '#reset']) {
    const secondary = narrowRule(selector);
    const floor = Number(/min-height:\s*(\d+)px/.exec(secondary)[1]);
    assert.ok(floor >= 44, `${selector} sits at ${floor}px, under the 44px thumb floor`);
    // And centred, because `.link-button` aligns itself to the top of whatever
    // holds it, which on a 50px row leaves the link hanging above its own box.
    assert.match(secondary, /align-self:\s*center/, `${selector} is not centred on its row`);
  }

  const button = Number(/min-height:\s*(\d+)px/.exec(narrowRule('#download'))[1]);
  assert.ok(button >= 44, `the primary is ${button}px tall`);
});

test('a chart readout cannot paint over the bar fixed across the bottom', () => {
  // THE READING THAT COVERED THE DOWNLOAD BUTTON. The overlays inside a chart
  // climb to z-index 4 and the bar sits at 4 as well, and the charts come
  // after the bar in the markup, so the tie went to the readout: a box saying
  // something like "km 0.95 · 1,114 m" drawn across the one control the report
  // exists to offer. Reproduced at 360x844 by taking the clip off the chart
  // box, which is all that was holding the readout in.
  //
  // The fix is a stacking context rather than a new number, because a number
  // only moves the argument: the chart is entitled to rank its own overlays
  // and has no business ranking itself against the page furniture.
  const canvas = block('.chart-canvas');
  assert.match(canvas, /isolation:\s*isolate/, 'the chart box no longer contains its overlays');

  // And the tie it contains is real, so this stays worth having.
  const barZ = Number(/z-index:\s*(\d+)/.exec(narrowRule('.report-actions'))[1]);
  const overlays = ['.gap-label', '.chart-tooltip', '.chart-attribution'].map((selector) =>
    Number(/z-index:\s*(\d+)/.exec(block(selector))[1]),
  );
  assert.ok(
    Math.max(...overlays) >= barZ,
    'no chart overlay outranks the bar any more, so say so here rather than leaving this note',
  );
});

test('the figures this page measured itself are headings in the document too', () => {
  // THE INVERTED LADDER. A source's claim on a card got a real <h4>; Distance,
  // Ascent and Largest gap got <span>. Enumerating the headings on the report
  // returned exactly one, the <h1>, whose text is the route's name in the
  // source's own words. A reader moving by heading through the surface built to
  // hold our numbers found the source's title and nothing else.
  assert.match(js, /<h\$\{level\} class="tile-label">/, '.tile-label is not a heading element');
  assert.doesNotMatch(js, /<span class="tile-label">/);

  // The rung is chosen per surface rather than fixed, because the same tile is
  // used on the report under an <h1> and in two dialogs under an <h2>.
  assert.match(js, /measuredTiles\(measurements, published, 2\)/, 'the report is not rung 2');
  assert.match(js, /measuredTiles\(measurements, published, 3\)/, 'the preview is not rung 3');
  assert.match(js, /arrangementTiles\(after, measurements, 4\)/, 'the re-arranger is not rung 4');

  // The two drawings on the report are ours as well, and were spans.
  assert.doesNotMatch(html, /<span class="chart-title">/);
});

test('the results grid reaches the width it works out for itself', () => {
  // `.results` is a flex item in a column, so its width is a cross size, and an
  // auto cross-axis margin cancels flex stretch outright. The grid fell back to
  // its content: measured at 1280 in a 1178px panel, 796.9px of grid and 257.6px
  // cards, 82px under the 340px floor the rule above it calls the bottom of
  // readable. A declared width is what makes the box definite again, and it is
  // also what leaves the auto margins something to halve, so the centring the
  // ceiling exists for still happens.
  const grid = declarations('.results');
  assert.match(grid, /margin-inline:\s*auto/, 'the grid no longer centres itself');
  assert.match(grid, /width:\s*100%/, 'auto margins without a declared width size the grid to content');
});

test('a card is as tall as what is in it', () => {
  // The comment over `.results` has described this since the void was first
  // fixed. The declaration was never written, so the default stretch stood and
  // the void came back bigger: a card whose shape was refused sat at its natural
  // 257.2px stretched to 493.7px, with 246.5px of nothing between the figures
  // and the buttons. A comment is not a declaration, which is why this is a test.
  assert.match(declarations('.results'), /align-items:\s*start/);
  // And the void only opens because the buttons are pushed to the bottom, so
  // the pair belongs together: if this ever stops being true, so does the rule.
  assert.match(declarations('.card-actions'), /margin-top:\s*auto/);
});

test('a sweep drains the queue it did not add to', () => {
  // A source-text rule, because the queue it is about lives in app.js behind a
  // `window` this suite has no browser for. It is here because the defect it
  // pins was found by measurement and would come back silently: a slot already
  // queued is skipped by the sweep, correctly, so a sweep that matched nothing
  // new drained nothing. That is exactly the state a paused queue is in. One
  // `busy` answer pauses every shape and leaves the rest queued; coming back to
  // the tab swept, matched nothing, and left nine cards waiting on a service
  // that had recovered thirty seconds earlier. Measured on a live list: one
  // request spent, then nothing at all until this line existed.
  const sweep = js.slice(js.indexOf('function sweepVisibleSlots('));
  const body = sweep.slice(0, sweep.indexOf('\n}\n'));
  assert.match(body, /drainShapes\(\);/, 'sweepVisibleSlots no longer drains the queue');
});

test('the thumb floor covers every kind of control on the phone, not most of them', () => {
  // THE FLOOR THAT KEPT BEING RAISED ONE CONTROL AT A TIME. The tab got it, the
  // ghost button got it, the icon button got it, and the bar's own link got it
  // after it was measured at 72.5 x 29.6. What was left were the two kinds
  // nobody had measured: the links under the URL field, which are how a walker
  // with a file already on the phone gets into the product at all, at 29.6px
  // tall; and the chart's switches, which at 390 stood 24.6 x 22.1 for the zoom
  // pair and 37.8 x 22.1 for Fit. WCAG 2.2 asks 24 x 24 of a target, so the
  // zoom pair failed on height and cleared on width by six tenths of a pixel.
  //
  // Enumerated rather than asserted one at a time, so the next control kind
  // added to this block is a failure here rather than a defect found on a hill.
  const floors = {
    '.tab': 44,
    '.ghost-button': 44,
    '.method-summary': 44,
    '.link-button': 44,
    '.chart-toggle': 44,
    '.card-primary,\n  .icon-button': 46,
  };
  for (const [selector, want] of Object.entries(floors)) {
    const found = /min-height:\s*(\d+)px/.exec(narrowRule(selector));
    assert.ok(found, `${selector} no longer declares a height floor on the phone`);
    assert.ok(Number(found[1]) >= want, `${selector} sits at ${found[1]}px, under ${want}px`);
  }

  // The zoom pair carries one glyph each, so a height floor alone leaves it a
  // sliver. It is the width that makes it a target.
  const zoom = /min-width:\s*(\d+)px/.exec(narrowRule('.chart-toggle'));
  assert.ok(zoom, 'the chart switch no longer declares a width floor');
  assert.ok(Number(zoom[1]) >= 44, `a ${zoom[1]}px-wide switch is not a thumb target`);
});

test('the chart switch is drawn with a control edge, not a card edge', () => {
  // These were the only controls on the page painted with --surface-line, which
  // is the card token: 1.23:1 against the --surface they sit on, where
  // --field-border gives 3.01:1 and every other control on the page is drawn.
  // A box nobody can see is not a box, and on this surface it is Hide map, the
  // control the colophon points at when it says how to stop OpenStreetMap
  // seeing where your routes are.
  const narrow = narrowRule('.chart-toggle');
  assert.match(narrow, /border-color:\s*var\(--field-border\)/);
  assert.doesNotMatch(narrow, /--surface-line/, 'the switch is back on the card token');

  // A 44px box has no baseline worth aligning a 12px title to, so the head that
  // holds it stops aligning on baselines. Without this the title floats.
  assert.match(narrowRule('.chart-head,\n  .chart-head-end'), /align-items:\s*center/);
});

test('one thing in the action bar is loud, and it is the file', () => {
  // FOUR CONTROLS AT ONE VOLUME. Measured at 390 in English they were 205.5,
  // 140.5, 194.6 and 46 wide with a 72.5 link after them, and three of the five
  // were drawn the same way. The eye had to read all four labels to find the
  // one the page is for.
  //
  // The accent is what ranks them. It fills the primary, and on this page it
  // means interactive or in order, so anything else in the bar wearing it is
  // claiming a rank it does not have. "New link" wore it as text, beside an
  // accent-filled button: the loudest ink the page has, spent on leaving.
  const exit = narrowRule('#reset');
  assert.match(exit, /color:\s*var\(--muted\)/, 'the way out is painted in the accent again');
  assert.match(
    exit,
    /text-decoration-color:\s*var\(--field-border\)/,
    'the rule under the way out is louder than the edge of a control',
  );

  // And it comes back where a visitor asks the question, which is under a
  // pointer or a focus ring. A control that never answers is not quiet, it is
  // dead.
  assert.match(
    narrowBlock(),
    /#reset:hover,\n\s+#reset:focus-visible \{[^}]*color:\s*var\(--accent\)/,
    'the way out no longer lights up on hover or focus',
  );
});

test('a Garmin send that has landed reads as a status, not as a fourth button', () => {
  // "On its way to your watch" is a report of something that has already
  // happened. It was drawn as an outlined button 194.6px wide against a primary
  // of 205.5: a hand-off that is over, at 95% of the width of the one thing the
  // page exists to hand over, and beside "Send to an app", which is a live verb
  // of the same size. The sentence above the bar says it again, in prose.
  const sent =
    /#report:has\(#garmin-note:not\(\[hidden\]\)\) #send-garmin:not\(:hover\):not\(:focus-visible\) \{([^}]*)\}/.exec(
      narrowBlock(),
    );
  assert.ok(sent, 'the sent state is no longer read off the note the page un-hides');
  assert.match(sent[1], /color:\s*var\(--muted\)/);

  // Transparent, never removed. A border that goes away takes 2px of width and
  // 2px of height with it, and this control sits in a bar that wraps: the row
  // it is on would reflow the moment a send landed.
  assert.match(sent[1], /border-color:\s*transparent/);
  assert.doesNotMatch(sent[1], /border:\s*(0|none)/, 'the border is taken away rather than hidden');

  // It is still a button, and pressing it sends the course again. The two
  // :not() clauses are what hand it back to .ghost-button:hover, so the edge
  // and the colour return under a pointer or a focus ring.
  assert.match(block('.ghost-button:hover:not(:disabled)'), /border-color:\s*var\(--accent\)/);

  // And the whole row agrees on a height, so the bar reads as two rows rather
  // than as five controls that happen to be near each other.
  const row = ['#send-file,\n  #send-garmin', '#report-adjust', '#reset'].map((selector) =>
    Number(/min-height:\s*(\d+)px/.exec(narrowRule(selector))[1]),
  );
  assert.equal(new Set(row).size, 1, `the second row holds ${row.join('px, ')}px controls`);
});

test('the route name is not drawn as a fourth figure', () => {
  // The action bar leaves this box on a phone, so what is left in it is a title
  // and one line of provenance, and it was still drawn as a card: the same
  // fill, the same 1px edge and the same 8px radius as the three measured tiles
  // under it. Four identical boxes down the top of the screen, of which one
  // holds no measurement at all.
  const head = narrowRule('.report-head');
  assert.match(head, /background:\s*none/, 'the name is back in a card');
  assert.match(head, /border:\s*0/);
  assert.match(head, /border-radius:\s*0/);

  // The tiles keep theirs, because a figure is what the box is for. If this
  // ever stops being true the rule above has nothing left to say.
  assert.match(block('.tile'), /background:\s*var\(--surface\)/);
  assert.match(block('.tile'), /border:\s*1px solid var\(--surface-line\)/);
});

test('the first screen has more than one interval down it', () => {
  // SIX BLOCKS AT ONE INTERVAL IS A LIST, NOT AN ARGUMENT. Measured at 390, the
  // whole of step one ran 16, 14, 14, 14, 14 from the heading down: the
  // heading, the sentence under it, the field, the line saying what the field
  // takes, and the two other ways in were all the same distance apart. Nothing
  // in that column said which of the six belong together.
  //
  // Two boundaries now, and both are read off the content. The hint is a
  // caption on the field above it and closes; the pair of links is a way in
  // that is not this field, and opens. A reader who can see one wide gap in a
  // column knows where the column divides.
  const panelGap = Number(/gap:\s*(\d+)px/.exec(declarations('.panel'))[1]);
  const close = Number(/margin-top:\s*(-?\d+)px/.exec(narrowRule('#step1-hint'))[1]);
  const open = Number(/margin-top:\s*(-?\d+)px/.exec(narrowRule('#example'))[1]);

  assert.ok(close < 0, 'the hint no longer closes on the field it captions');
  assert.ok(open > 0, 'the links no longer open away from the field');
  assert.ok(
    panelGap + open >= 2 * (panelGap + close),
    `a ${panelGap + open}px boundary against a ${panelGap + close}px one is not a boundary`,
  );

  // The two links are a pair and read as one. The 44px floor above grew each
  // box by 14.4px, which pushed the labels from 22px apart to 36px; this is
  // what pays that back, and it is only worth having while the floor is.
  assert.match(narrowRule('#choose-file'), /margin-top:\s*-\d+px/);
});
