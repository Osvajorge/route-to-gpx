"""Minimal TWKB reader.

TWKB, Tiny Well-Known Binary, is an open PostGIS specification for packing
geometry into very few bytes. Wikiloc stores whole tracks that way and says so
in its own map code: `L.WklTrail.fromTwkbBase64(geom)`.

This reader covers what Wikiloc serves: a LineString carrying Z (elevation) and
M (a timestamp).
"""


def _zigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def decode(data: bytes):
    """Reads a TWKB blob.

    Returns `(points, header)`. Each point is `(lon, lat, elevation or None)`.
    """
    index = 0

    def unsigned_varint() -> int:
        nonlocal index
        result = 0
        shift = 0
        while True:
            byte = data[index]
            index += 1
            # Multiply, do not shift. The M values overflow 32 bits, and `<<`
            # wraps them around without saying anything.
            result += (byte & 0x7F) * (2**shift)
            shift += 7
            if not byte & 0x80:
                return result

    def signed_varint() -> int:
        return _zigzag(unsigned_varint())

    type_and_precision = data[index]
    index += 1
    geometry_type = type_and_precision & 0x0F
    precision_xy = _zigzag(type_and_precision >> 4)

    metadata = data[index]
    index += 1
    has_bbox = bool(metadata & 0x01)
    has_size = bool(metadata & 0x02)
    has_extended = bool(metadata & 0x08)
    is_empty = bool(metadata & 0x10)

    has_z = has_m = False
    precision_z = 0
    if has_extended:
        extended = data[index]
        index += 1
        has_z = bool(extended & 0x01)
        has_m = bool(extended & 0x02)
        precision_z = (extended >> 2) & 0x07

    dimensions = 2 + has_z + has_m
    if has_size:
        unsigned_varint()
    if has_bbox:
        for _ in range(dimensions * 2):
            signed_varint()

    scale_xy = 10**precision_xy
    scale_z = 10**precision_z

    count = 0 if is_empty else unsigned_varint()
    running = [0] * dimensions
    points = []
    for _ in range(count):
        for dimension in range(dimensions):
            running[dimension] += signed_varint()
        points.append(
            (
                running[0] / scale_xy,
                running[1] / scale_xy,
                running[2] / scale_z if has_z else None,
            )
        )

    header = {
        "geometry_type": geometry_type,
        "precision_xy": precision_xy,
        "has_z": has_z,
        "precision_z": precision_z,
        "has_m": has_m,
        "bytes_read": index,
        "bytes_total": len(data),
    }
    return points, header
