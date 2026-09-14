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
  const words = { thirteen: 13, fourteen: 14, fifteen: 15, twelve: 12, eleven: 11, ten: 10 };
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

test('the page keeps a gap the exact height of the fixed download bar', () => {
  // The bar is out of flow, so nothing under it reserves its space. Measured
  // at 375x812 before this: the bottom 59px of the colophon sat behind the bar
  // with the page scrolled as far as it went — the privacy statement and the
  // source link, which are the two things on this page that are there for
  // honesty rather than use. Afterwards the link clears the bar by 16px.
  const bar = narrowRule('.report-actions');
  assert.match(bar, /position:\s*fixed/);
  const border = Number(/border-top:\s*(\d+)px/.exec(bar)[1]);
  const above = Number(/padding:\s*(\d+)px/.exec(bar)[1]);
  const below = Number(/calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/.exec(bar)[1]);
  const button = Number(/min-height:\s*(\d+)px/.exec(narrowRule('#download'))[1]);

  const published = /--action-bar:\s*calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)/.exec(
    narrowRule('.shell'),
  );
  assert.ok(published, 'the shell no longer publishes what the bar takes');
  assert.equal(Number(published[1]), border + above + button + below);

  // And the last block on the page is the one that keeps clear of it, only
  // while step two is up, because that is when the bar exists.
  assert.match(
    narrowRule("#app[data-view='report'] ~ .colophon"),
    /padding-bottom:\s*var\(--action-bar\)/,
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
