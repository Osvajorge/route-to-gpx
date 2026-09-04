"""The outline one card draws, and the rules that keep it from being a crawl."""

import math

import pytest

from api.sources import shape


def ring(count=400, radius_m=800.0):
    """A circle, which every decimation must keep round."""
    per_degree = 111320.0
    return [
        (
            41.0 + (radius_m * math.sin(2 * math.pi * i / count)) / per_degree,
            2.0 + (radius_m * math.cos(2 * math.pi * i / count)) / (per_degree * math.cos(math.radians(41.0))),
        )
        for i in range(count)
    ]


def test_a_straight_run_collapses_to_its_ends():
    # The whole point of keeping the furthest point rather than every nth: a
    # line has nothing in the middle worth sending.
    line = [(41.0 + i * 0.0001, 2.0) for i in range(200)]
    assert len(shape.for_card(line)) == 2


def test_a_corner_survives():
    # Every-nth decimation loses these, and a corner is the only thing a reader
    # recognises an outline by.
    elbow = (
        [(41.0 + i * 0.0002, 2.0) for i in range(60)]
        + [(41.012, 2.0 + i * 0.0002) for i in range(1, 60)]
    )
    kept = shape.for_card(elbow)
    corner = (41.0 + 59 * 0.0002, 2.0)
    assert any(
        abs(point[0] - corner[0]) < 1e-6 and abs(point[1] - corner[1]) < 1e-6
        for point in kept
    ), "the bend itself was dropped"


def test_a_ring_stays_round_and_stays_shut():
    kept = shape.for_card(ring())
    assert 12 <= len(kept) <= shape.MAX_POINTS
    # The ring starts at angle zero, which is its easternmost point, and the
    # first point of the outline has to be the first point of the recording:
    # the card draws a start dot there.
    ring_points = ring()
    assert kept[0] == [pytest.approx(ring_points[0][0]), pytest.approx(ring_points[0][1])]
    assert kept[-1] == [pytest.approx(ring_points[-1][0]), pytest.approx(ring_points[-1][1])]


def test_the_tolerance_follows_the_route_and_not_a_constant():
    # A 2 km stroll and a 140 km ride are drawn into the same box, so a fixed
    # metre tolerance that is invisible on one flattens the other. A small ring
    # and a large one must survive with a comparable number of points.
    small = len(shape.for_card(ring(count=400, radius_m=200.0)))
    large = len(shape.for_card(ring(count=400, radius_m=20000.0)))
    assert abs(small - large) <= 4, f"{small} against {large}"


def test_nothing_leaves_larger_than_the_cap():
    # A backstop, not the working limit. A route that defeats the tolerance
    # still cannot send an unbounded list.
    noisy = [
        (41.0 + i * 0.0005 + (0.0004 if i % 2 else -0.0004), 2.0 + i * 0.0005)
        for i in range(3000)
    ]
    assert len(shape.for_card(noisy)) <= shape.MAX_POINTS


def test_two_points_and_one_point_do_not_raise():
    assert len(shape.for_card([(41.0, 2.0), (41.1, 2.1)])) == 2
    assert len(shape.for_card([(41.0, 2.0)])) == 1
    assert shape.for_card([]) == []


def test_the_cache_answers_the_second_ask_without_the_page():
    shapes = shape.Shapes()
    shapes.put("https://example.test/a", [[1.0, 2.0], [3.0, 4.0]])
    assert shapes.get("https://example.test/a") == [[1.0, 2.0], [3.0, 4.0]]
    assert shapes.get("https://example.test/b") is None


def test_the_cache_is_bounded_and_sweeps_rarely():
    # Amortised: the hard cap must not force a sweep on every write once the
    # table is full, which is what a cap with no slack does.
    shapes = shape.Shapes(keep_at_most=20, sweep_every=5)
    for index in range(200):
        shapes.put(f"https://example.test/{index}", [[1.0, 2.0], [3.0, 4.0]])
    assert len(shapes) <= 20 + 5
    # The newest survives; something early is gone.
    assert shapes.get("https://example.test/199") is not None
    assert shapes.get("https://example.test/0") is None
