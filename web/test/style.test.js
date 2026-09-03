// Run with:  node --test web/test/
//
// Four rules that live in the stylesheet and nowhere else. Each one was broken
// once, none of them by a mistake in reasoning: a token was moved, a heading
// was raised, a phone was measured last. So each is pinned here, where a change
// that breaks it again fails before it ships rather than after.
//
// These read the declarations outside the media query. The narrow width has one
// test of its own, which reads inside it.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../assets/app.css', import.meta.url)), 'utf8');

/** The declarations of one rule, by its exact selector. */
function block(selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `${selector} is gone from the stylesheet`);
  return css.slice(at, css.indexOf('}', at));
}

// How loud a text colour is. The ladder ranks by this, not by hex.
const LOUDNESS = { '--muted': 1, '--text-2': 2, '--text': 3 };

/** Size, weight and loudness of one rule, for comparing two of them. */
function type(selector) {
  const body = block(selector);
  const size = /font-size:\s*([\d.]+)px/.exec(body);
  const weight = /font-weight:\s*(\d+)/.exec(body);
  const colour = /color:\s*var\((--[a-z0-9-]+)\)/.exec(body);
  return {
    size: size ? Number(size[1]) : null,
    // A rule that does not set one inherits 400 from the body.
    weight: weight ? Number(weight[1]) : 400,
    loudness: colour ? LOUDNESS[colour[1]] : null,
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
  for (const ours of ['.dialog-kicker', '.dialog-subhead', '.chart-title']) {
    const head = type(ours);
    assert.ok(head.weight >= source.weight, `${ours} is lighter than .card-claim-head`);
    assert.ok(head.loudness >= source.loudness, `${ours} is dimmer than .card-claim-head`);
    assert.ok(head.size >= source.size, `${ours} is smaller than .card-claim-head`);
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

test('the dialog scroller shades the edge it is cutting content at', () => {
  // Without it a cut lands mid-glyph and reads as a broken render rather than
  // as more content. `local` is what makes the shade appear only at an end
  // there is something past.
  assert.match(block('.dialog-body'), /no-repeat local/);
});
