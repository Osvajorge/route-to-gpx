"""The send-to-Garmin path, tested without touching anybody's Garmin.

The two halves that can go wrong quietly are both here: whether the endpoint
EXISTS at all, which is the whole privacy argument for this feature, and what
gets built out of a parsed file, which is what Garmin then stores.

Nothing here logs in. `send_course` is the only function that reaches the
network and it is never called; everything below it is arithmetic.
"""

import math

import pytest
from fastapi.testclient import TestClient

from api import app as service, garmin


client = TestClient(service.app)


def test_the_endpoint_does_not_exist_unless_it_was_turned_on():
    """Off is not the same as absent, and only absent is worth promising.

    The page tells a visitor there are no accounts and nothing is written
    down. That stays true on the public deployment because this route is never
    registered there -- not because it is registered and refuses.
    """
    paths = [route.path for route in service.app.routes if hasattr(route, "path")]
    assert "/api/garmin/course" not in paths
    assert garmin.enabled() is False


def test_health_says_whether_this_build_can_send(monkeypatch):
    """The page asks rather than guesses, so one build serves both cases."""
    answer = client.get("/api/health").json()
    assert answer["ok"] is True
    assert answer["canSendToGarmin"] is False


def test_the_switch_is_the_address_and_not_a_guess(monkeypatch, tmp_path):
    """A directory that happens to exist must not turn the feature on.

    Turning it on names WHERE the session is. Anything looser would make the
    feature appear as a side effect of a file somebody else left behind.
    """
    monkeypatch.delenv(garmin.TOKENS_ENV, raising=False)
    assert garmin.enabled() is False

    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    assert garmin.enabled() is True

    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path / "not-there"))
    assert garmin.enabled() is False

    monkeypatch.setenv(garmin.TOKENS_ENV, "   ")
    assert garmin.enabled() is False


def test_an_activity_garmin_does_not_take_is_refused_before_anything_is_sent(
    monkeypatch, tmp_path
):
    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    with pytest.raises(garmin.GarminUnavailable) as refused:
        garmin.send_course(gpx="<gpx/>", file_name="a.gpx", name="A", activity="skiing")
    assert refused.value.hint == "request"


def test_the_feature_being_off_is_said_plainly_rather_than_crashing(monkeypatch):
    monkeypatch.delenv(garmin.TOKENS_ENV, raising=False)
    with pytest.raises(garmin.GarminUnavailable) as refused:
        garmin.send_course(gpx="<gpx/>", file_name="a.gpx", name="A")
    assert refused.value.hint == "off"


def _skeleton(points):
    return {"geoPoints": [dict(p) for p in points]}


UPHILL = [
    {"latitude": 41.5900, "longitude": 1.8300, "elevation": 700.0},
    {"latitude": 41.6000, "longitude": 1.8400, "elevation": 900.0},
    {"latitude": 41.6100, "longitude": 1.8500, "elevation": 1100.0},
]


def test_a_course_is_built_private_and_from_a_gpx():
    """Two fields that would be a real failure if they drifted.

    A course created public would publish a visitor's route to strangers as a
    side effect of one press, which nothing on the page asked for.
    """
    payload = garmin._course_payload(_skeleton(UPHILL), "Sant Jeroni", 3)
    assert payload["rulePK"] == garmin.PRIVATE
    assert payload["sourceTypeId"] == garmin.SOURCE_TYPE_GPX
    assert payload["activityTypePk"] == 3
    assert payload["courseName"] == "Sant Jeroni"


def test_the_distance_sent_is_measured_from_the_points_themselves():
    payload = garmin._course_payload(_skeleton(UPHILL), "x", 3)
    by_hand = sum(
        garmin._haversine(UPHILL[i - 1], UPHILL[i]) for i in range(1, len(UPHILL))
    )
    assert payload["distanceMeter"] == pytest.approx(by_hand)
    assert payload["distanceMeter"] > 2000


def test_no_elevation_figure_is_claimed_because_garmin_overwrites_it():
    """Measured against a real account: a track this service measured at 533 m
    of ascent came back from Garmin reading 598 m, because Garmin redraws
    elevation from its own map whatever is sent. A figure here would be a
    number this service stated and Garmin then replaced, which is worse than
    no figure at all.
    """
    payload = garmin._course_payload(_skeleton(UPHILL), "x", 3)
    assert payload["elevationGainMeter"] == 0.0
    assert payload["elevationLossMeter"] == 0.0


def test_a_point_with_no_height_is_sent_as_zero_rather_than_null():
    """Garmin rejects a null elevation, and a GPX from a source that publishes
    no heights is an ordinary file here, not an error."""
    flat = [dict(p, elevation=None) for p in UPHILL]
    payload = garmin._course_payload(_skeleton(flat), "x", 3)
    assert all(p["elevation"] == 0.0 for p in payload["geoPoints"])


def test_the_bounding_box_holds_every_point():
    payload = garmin._course_payload(_skeleton(UPHILL), "x", 3)
    box = payload["boundingBox"]
    for point in UPHILL:
        assert box["lowerLeft"]["latitude"] <= point["latitude"] <= box["upperRight"]["latitude"]
        assert box["lowerLeft"]["longitude"] <= point["longitude"] <= box["upperRight"]["longitude"]
    assert box["center"]["latitude"] == pytest.approx(41.60, abs=0.001)


def test_a_file_with_nothing_in_it_is_refused_rather_than_sent():
    for empty in ({"geoPoints": []}, {}, {"geoPoints": [UPHILL[0]]}):
        with pytest.raises(garmin.GarminUnavailable) as refused:
            garmin._course_payload(empty, "x", 3)
        assert refused.value.hint == "track"


def test_the_bearing_is_the_direction_the_route_sets_off_in():
    north = {"latitude": 0.0, "longitude": 0.0}
    assert garmin._initial_bearing(north, {"latitude": 1.0, "longitude": 0.0}) == pytest.approx(0, abs=0.1)
    assert garmin._initial_bearing(north, {"latitude": 0.0, "longitude": 1.0}) == pytest.approx(90, abs=0.1)
    assert garmin._initial_bearing(north, {"latitude": -1.0, "longitude": 0.0}) == pytest.approx(180, abs=0.1)
    assert garmin._initial_bearing(north, {"latitude": 0.0, "longitude": -1.0}) == pytest.approx(270, abs=0.1)


def test_haversine_agrees_with_the_measurement_the_rest_of_the_service_uses():
    """One degree of latitude is about 111 km everywhere."""
    a = {"latitude": 41.0, "longitude": 1.8}
    b = {"latitude": 42.0, "longitude": 1.8}
    assert garmin._haversine(a, b) == pytest.approx(111195, rel=0.001)
    assert garmin._haversine(a, a) == 0.0
