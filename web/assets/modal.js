// One dialog open over the page, and the four things that makes true.
//
//   the page behind does not scroll, and does not shift sideways when its
//     scrollbar goes away
//   nothing behind the dialog can be reached, by a pointer, by Tab, or by a
//     screen reader walking the document
//   Escape closes it
//   focus goes back to the control that opened it, not to the top of the page
//
// There is only ever one. Opening a second closes the first and inherits the
// control the first would have returned focus to, which is what the preview
// handing over to the re-arranger needs: it is one errand from one button.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Set inert while a dialog is open, so the page behind is out of reach for a
// pointer and for a screen reader, not only for Tab.
const BEHIND = '.shell, .drop-veil';

let current = null;

/** Everything in `root` that a visitor can reach, in document order. */
function focusable(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(
    (node) => !node.hidden && node.offsetParent !== null,
  );
}

function onKeydown(event) {
  if (!current) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog();
    return;
  }
  if (event.key !== 'Tab') return;

  // The trap. `inert` on the page behind already does this in every browser
  // that has it; this is what keeps the promise in one that does not.
  const stops = focusable(current.element);
  if (stops.length === 0) {
    event.preventDefault();
    current.element.focus();
    return;
  }
  const first = stops[0];
  const last = stops[stops.length - 1];
  const here = document.activeElement;
  if (event.shiftKey && (here === first || !current.element.contains(here))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && here === last) {
    event.preventDefault();
    first.focus();
  }
}

function onPointerDown(event) {
  if (!current || !current.closeOnBackdrop) return;
  // Only a press on the veil itself, never one that started inside the dialog
  // and drifted out, which is what a text selection dragged past the edge does.
  if (event.target === current.element) closeDialog();
}

/** Stops the page behind from scrolling under the dialog.
 *
 *  The width the scrollbar gives up is handed back as padding, because a page
 *  that jumps sideways as a dialog opens reads as the dialog having broken it. */
function lockPage() {
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.classList.add('dialog-open');
  if (gap > 0) document.documentElement.style.setProperty('--scrollbar-gap', `${gap}px`);
}

function unlockPage() {
  document.documentElement.classList.remove('dialog-open');
  document.documentElement.style.removeProperty('--scrollbar-gap');
}

/**
 * Opens `element`, the veil holding one dialog.
 *
 * @param element             the .dialog-veil element, hidden until now
 * @param returnFocusTo       the control that opened it, or a function that
 *                            finds it again. A card's buttons are rewritten
 *                            while the route is being converted, so the one
 *                            that was pressed is a different element by the
 *                            time the dialog closes, and holding the old one
 *                            would drop focus at the top of the document.
 * @param initialFocus        what to focus inside it; the dialog box itself by
 *                            default, so its name is read before its contents
 * @param onClose             run after it closes, whatever closed it
 * @param closeOnBackdrop     whether a press on the veil closes it
 */
export function openDialog(element, options = {}) {
  // A dialog opening over a dialog is one errand continuing, so the button that
  // started the errand is the one focus goes home to.
  const opener = current ? current.returnFocusTo : options.returnFocusTo;
  if (current) closeDialog({ keepLock: true, skipFocus: true });

  current = {
    element,
    returnFocusTo: opener ?? null,
    onClose: options.onClose ?? null,
    closeOnBackdrop: options.closeOnBackdrop !== false,
  };

  element.hidden = false;
  lockPage();
  for (const node of document.querySelectorAll(BEHIND)) node.inert = true;

  document.addEventListener('keydown', onKeydown, true);
  element.addEventListener('pointerdown', onPointerDown);

  const target = options.initialFocus ?? element.querySelector('.dialog');
  target?.focus();
}

/** Closes whatever is open. Safe to call when nothing is. */
export function closeDialog(options = {}) {
  if (!current) return;
  const closing = current;
  current = null;

  document.removeEventListener('keydown', onKeydown, true);
  closing.element.removeEventListener('pointerdown', onPointerDown);
  closing.element.hidden = true;

  if (!options.keepLock) {
    unlockPage();
    for (const node of document.querySelectorAll(BEHIND)) node.inert = false;
  }

  closing.onClose?.();

  if (options.skipFocus) return;
  const home =
    typeof closing.returnFocusTo === 'function' ? closing.returnFocusTo() : closing.returnFocusTo;
  // A control that has gone for good takes nothing anywhere. The browser's own
  // next stop is a better guess than forcing focus onto a hidden element.
  if (home?.isConnected) home.focus();
}

/** True when this particular dialog is the one on screen. */
export function dialogIsOpen(element) {
  return current !== null && current.element === element;
}
