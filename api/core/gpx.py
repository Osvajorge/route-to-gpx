"""Builds GPX 1.1 files.

Every file we hand out says where it came from, in two places a walker can
find later: the metadata link, and the track name. A GPX with no provenance is
a file you cannot check.
"""

from typing import Iterable, Optional, Sequence

Point = Sequence[float]  # (lat, lon, elevation or None)


def escape(text: str) -> str:
    return (
        str(text)
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
    safe_name = escape(name or "Route")
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
