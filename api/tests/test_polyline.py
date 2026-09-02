"""The encoded polyline reader, against the format and against real data."""

from api.sources import polyline


def test_the_canonical_vector_from_the_format_documentation():
    """Precision 5 here, because that is what this well known example uses."""
    points = polyline.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=1e5)
    assert len(points) == 3
    assert [(round(a, 3), round(b, 3)) for a, b in points] == [
        (38.5, -120.2),
        (40.7, -120.95),
        (43.252, -126.453),
    ]


def test_komoot_thumbnails_are_precision_four():
    """A real thumbnail path, captured 2026-09-02 from a tour whose own
    start_point is 41.591707, 1.834806. At 1e4 the first point lands on it; at
    1e5 it would sit ten times nearer the equator, in the Atlantic."""
    encoded = "yikXwyb@MF@JHXLJIADJ?DIFIRID?p@Kb@c@VO"
    points = polyline.decode(encoded)

    assert len(points) > 2
    assert abs(points[0][0] - 41.5917) < 0.001
    assert abs(points[0][1] - 1.8348) < 0.001

    wrong = polyline.decode(encoded, precision=1e5)
    assert abs(wrong[0][0] - 4.159) < 0.001


def test_a_truncated_line_ends_rather_than_raising():
    """Half a line drawn on a card beats a card that throws.

    Built on the canonical vector because it is known to be complete. A slice
    of a real URL is not: the first draft of this test cut one that already
    ended mid-pair, so removing another character changed nothing and the test
    passed while proving no such thing.
    """
    whole = "_p~iF~ps|U_ulLnnqC_mqNvxq`@"
    full = polyline.decode(whole, precision=1e5)
    assert len(full) == 3

    # The last pair can no longer be completed, so it is dropped whole rather
    # than emitted half read.
    cut = polyline.decode(whole[:-1], precision=1e5)
    assert len(cut) == 2
    assert cut == full[:2]


def test_nothing_decodes_to_nothing():
    assert polyline.decode("") == []
