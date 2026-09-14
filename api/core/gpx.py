"""Builds GPX 1.1 files.

Every file we hand out says where it came from, in two places a walker can
find later: the metadata link, and the track name. A GPX with no provenance is
a file you cannot check.
"""

from typing import Iterable, Optional, Sequence

Point = Sequence[float]  # (lat, lon, elevation or None)


def _is_xml_character(code: int) -> bool:
    """The XML 1.0 Char production, verbatim.

    Anything outside it cannot appear in a document at all. There is no escape
    for it either: a numeric reference to a forbidden character is itself
    forbidden, so the only repair left is to drop the character.
    """
    return (
        0x20 <= code <= 0xD7FF
        or 0xE000 <= code <= 0xFFFD
        or 0x10000 <= code <= 0x10FFFF
    )


def escape(text: str) -> str:
    """Turns a remote site's text into character data that parses.

    Titles reach us from Komoot and Wikiloc, so they carry whatever a stranger
    typed. A single 0x08 in a title is enough to make the whole .gpx not
    well-formed, and a strict reader — Garmin's among them — then rejects the
    file rather than the character.

    Tab, newline and carriage return are legal but are turned into spaces
    here: every value this writes is a one-line label, and inside an attribute
    a parser would replace them with spaces anyway.
    """
    kept = []
    for character in str(text):
        code = ord(character)
        if code in (0x09, 0x0A, 0x0D):
            kept.append(" ")
        elif _is_xml_character(code):
            kept.append(character)
    return (
        "".join(kept)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def build(
    points: Iterable[Point],
    name: str,
    source_url: Optional[str] = None,
    source_label: Optional[str] = None,
) -> str:
    """Writes a single-track GPX 1.1 document."""
    # A title made only of characters XML forbids escapes to nothing, and a
    # nameless file is the one thing this module exists to prevent.
    safe_name = escape(name or "Route").strip() or "Route"
    link = ""
    if source_url:
        link = (
            f'<link href="{escape(source_url)}">'
            f"<text>{escape(source_label or 'source')}</text></link>"
        )

    lines = []
    for latitude, longitude, elevation in points:
        elevation_tag = "" if elevation is None else f"<ele>{elevation:.1f}</ele>"
        lines.append(
            f'    <trkpt lat="{latitude:.6f}" lon="{longitude:.6f}">'
            f"{elevation_tag}</trkpt>"
        )

    body = "\n".join(lines)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<gpx version="1.1" creator="route-to-gpx" '
        'xmlns="http://www.topografix.com/GPX/1/1">\n'
        f"  <metadata><name>{safe_name}</name>{link}</metadata>\n"
        f"  <trk><name>{safe_name}</name><trkseg>\n"
        f"{body}\n"
        "  </trkseg></trk>\n"
        "</gpx>\n"
    )
