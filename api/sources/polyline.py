"""Google encoded polyline, the format Komoot hides its card geometry in.

A discovery row carries no coordinates, but the picture it links to does: the
thumbnail URL is a drawing request, and the shape to draw is encoded into its
own path.

    https://tourpic-vector.maps.komoot.net/r/small/yikXwyb@MF@JHXLJIADJ?DIF...

Reading it means the card can draw the route in this product's own colours,
over the tiles the report already uses, instead of loading a picture from a
third party with somebody else's line colour baked into the pixels. It also
means a card costs no image request at all.

The precision is 4, not the 5 that is usual for this format. Measured against
the same tours' own `start_point`: at 1e4 the first point lands within a metre,
and closed loops close exactly. At 1e5 everything is ten times too near the
equator.
"""

from typing import List, Tuple

PRECISION = 1e4

# A card is a hundred pixels of route. Far more points than that is a waste of
# bytes and of the browser's time, and Komoot already simplifies to about a
# hundred, so this is a guard against a surprise rather than a working limit.
MAX_POINTS = 400


def decode(text: str, precision: float = PRECISION) -> List[Tuple[float, float]]:
    """Latitude and longitude pairs. A truncated string ends the run rather
    than raising: half a line drawn is better than a card that fails."""
    points: List[Tuple[float, float]] = []
    index = 0
    lat = lng = 0
    length = len(text)

    while index < length and len(points) < MAX_POINTS:
        moved = []
        for _ in range(2):
            result = 0
            shift = 0
            while True:
                if index >= length:
                    return points
                chunk = ord(text[index]) - 63
                index += 1
                result |= (chunk & 0x1F) << shift
                shift += 5
                if chunk < 0x20:
                    break
            # zigzag: the low bit carries the sign
            moved.append(~(result >> 1) if result & 1 else (result >> 1))
        lat += moved[0]
        lng += moved[1]
        points.append((lat / precision, lng / precision))

    return points
