// One drawn icon set. Single 1.6 stroke, 24-unit box, round caps, no fills.
// Text glyphs standing in for icons look like a placeholder that was never
// replaced, so there are none here.

const BOX = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

const PATHS = {
  done: '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  active: '<path d="M9 5.5 17 12 9 18.5Z"/>',
  pending: '<circle cx="12" cy="12" r="3.2"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  download: '<path d="M12 3.5v12"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  warning:
    '<path d="M12 4.5 21 19.5H3Z"/><path d="M12 10.5v4"/><path d="M12 17.4h.01"/>',
  clipboard:
    '<rect x="6.5" y="4.5" width="11" height="15" rx="2"/><path d="M9.5 4.5V3.6a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v.9"/>',
  language:
    '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5S14.4 18.1 12 20.5c-2.4-2.4-3.6-5.3-3.6-8.5S9.6 5.9 12 3.5Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 1 0-5.7-5.7l-1.3 1.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 1 0 11 18.7l1.3-1.3"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.4 15.4 4.1 4.1"/>',
  // A crosshair, not a map pin: the button reports a position, and a pin is
  // what the page draws for a place somebody chose.
  crosshair:
    '<circle cx="12" cy="12" r="6"/><path d="M12 2.5v3.2"/><path d="M12 18.3v3.2"/><path d="M2.5 12h3.2"/><path d="M18.3 12h3.2"/>',
  chevron: '<path d="m7.5 10.5 4.5 4.5 4.5-4.5"/>',

  // The four figures a card prints, one mark each. Each one draws the thing it
  // measures rather than a symbol standing for it: a line with two ends, a
  // slope with a climb on it, a dial, a point on the ground.
  distance:
    '<path d="M4 12h16"/><path d="M4 9.5v5"/><path d="M20 9.5v5"/><path d="M12 10.5v3"/>',
  ascent: '<path d="M4 18.5 10 10l3.5 4L20 5.5"/><path d="M20 5.5h-4.5"/><path d="M20 5.5V10"/>',
  duration: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  start: '<path d="M12 21s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10Z"/><circle cx="12" cy="11" r="2.2"/>',

  // Five points and no fill: the fill is painted over a second copy of this
  // path, clipped to the score, so a 4.46 is drawn as 4.46 and not as a
  // rounding of it.
  star: '<path d="m12 4 2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 15.99l-4.7 2.47.9-5.23-3.8-3.7 5.25-.77Z"/>',

  // The three controls beside Download on a card.
  map: '<path d="m3.5 6.5 5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z"/><path d="M9 4.5v13"/><path d="M15 6.5v13"/>',
  sliders:
    '<path d="M4 8h4"/><path d="M12 8h8"/><path d="M4 16h10"/><path d="M18 16h2"/><circle cx="10" cy="8" r="2"/><circle cx="16" cy="16" r="2"/>',
  external:
    '<path d="M13.5 4.5H19.5V10.5"/><path d="m11 13 8.5-8.5"/><path d="M18.5 14v4.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H10"/>',

  // The two dialogs.
  close: '<path d="m6.5 6.5 11 11"/><path d="m17.5 6.5-11 11"/>',
  // Two runs of the same path, one each way. Not a circular arrow: nothing here
  // goes round, the walk is simply done in the other order.
  reverse:
    '<path d="M4 9h13"/><path d="m13.5 5.5 3.5 3.5-3.5 3.5"/><path d="M20 15H7"/><path d="m10.5 11.5-3.5 3.5 3.5 3.5"/>',
};

export function icon(name, className = '') {
  const path = PATHS[name];
  if (!path) throw new Error(`no icon named ${name}`);
  const classes = className ? `icon ${className}` : 'icon';
  return `<svg class="${classes}" ${BOX}>${path}</svg>`;
}
