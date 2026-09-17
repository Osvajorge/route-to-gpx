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


def test_the_queued_message_is_a_list_because_a_bare_object_is_a_500(monkeypatch):
    """Garmin answers a bare object with a 500, and that cost an afternoon.

    Saving a course does not deliver it. Delivery is a queue: a message
    carrying the URL of the course's FIT goes into the account's device queue
    and the watch collects it on its next sync. Measured on a real Forerunner
    965 -- created, queued, synced, and the course was under Navigate >
    Courses -- which is why this shape is pinned rather than trusted.
    """
    # The ids below are invented. The real ones this was written against
    # belong to somebody's account and say nothing a test needs to say.
    sent = {}

    class Recording:
        def connectapi(self, path, method="GET", **kwargs):
            sent["path"] = path
            sent["method"] = method
            sent["json"] = kwargs.get("json")
            return {}

    device = {"id": 4000000001, "name": "Forerunner 965"}
    assert garmin._queue_on_device(Recording(), 9000000002, device, "Sant Pere") is True

    assert sent["path"] == "/device-service/devicemessage/messages"
    assert sent["method"] == "POST"
    assert isinstance(sent["json"], list), "a bare object is answered with a 500"
    assert len(sent["json"]) == 1

    message = sent["json"][0]
    assert message["deviceId"] == 4000000001
    assert message["messageType"] == "courses"
    assert message["fileType"] == "FIT"
    assert message["metaDataId"] == 9000000002
    # Relative, and no leading slash. The watch fetches this itself at sync
    # time, so this service never downloads the FIT.
    assert message["messageUrl"] == (
        "course-service/course/fit/9000000002/4000000001?elevation=true"
    )
    assert not message["messageUrl"].startswith("/")


def test_a_queue_that_refuses_leaves_the_course_saved_rather_than_failing_everything():
    """Two outcomes, and they are different instructions to the person waiting.

    The course reaching the account and the course reaching the watch are not
    the same event. If only the first happened, the page must say so, because
    the repair is one tap in Garmin's own app rather than trying again here.
    """

    class Refusing:
        def connectapi(self, path, method="GET", **kwargs):
            raise RuntimeError("no")

    device = {"id": 1, "name": "Forerunner 965"}
    assert garmin._queue_on_device(Refusing(), 1, device, "x") is False


def test_the_watch_is_asked_for_rather_than_written_down():
    """A device id in a settings file goes stale the day somebody buys a watch."""

    class Answering:
        def connectapi(self, path, method="GET", **kwargs):
            assert path == "/device-service/deviceservice/mylastused"
            return {"userDeviceId": 4000000001, "lastUsedDeviceName": "Forerunner 965"}

    assert garmin._last_used_device(Answering()) == {
        "id": 4000000001,
        "name": "Forerunner 965",
    }


def test_an_account_with_no_device_is_not_an_error():
    """Somebody may have a Garmin account and no watch paired to this session.
    Their course still saves; there is simply nowhere to send it."""

    class Empty:
        def connectapi(self, path, method="GET", **kwargs):
            return {}

    class Broken:
        def connectapi(self, path, method="GET", **kwargs):
            raise RuntimeError("no")

    assert garmin._last_used_device(Empty()) is None
    assert garmin._last_used_device(Broken()) is None


def _queue(*course_ids):
    """A device queue holding a courses message for each id given."""
    return {
        "numOfMessages": len(course_ids),
        "messages": [
            {
                "messageId": 100 + n,
                "messageType": "courses",
                "metaData": {"metaDataId": cid, "messageName": f"route {cid}"},
            }
            for n, cid in enumerate(course_ids)
        ],
    }


class _Queue:
    def __init__(self, answer):
        self.answer = answer

    def connectapi(self, path, method="GET", **kwargs):
        assert path == "/device-service/devicemessage/messages"
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


def test_a_course_still_in_the_queue_has_not_reached_the_watch(monkeypatch, tmp_path):
    """The queue answers by emptying.

    A message sits there until the device syncs, downloads the FIT and
    acknowledges it. So "still queued" and "arrived" are the same question
    asked of the same list, and neither needs the watch to be asked anything.
    """
    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    monkeypatch.setattr(garmin, "_client", lambda: _Queue(_queue(515580837)))

    said = garmin.course_arrived(515580837)
    assert said == {"known": True, "queued": True, "arrived": False}


def test_a_course_gone_from_the_queue_is_on_the_watch(monkeypatch, tmp_path):
    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    monkeypatch.setattr(garmin, "_client", lambda: _Queue(_queue(111, 222)))

    said = garmin.course_arrived(515580837)
    assert said == {"known": True, "queued": False, "arrived": True}


def test_another_kind_of_message_is_not_mistaken_for_this_course(monkeypatch, tmp_path):
    """A settings message for a speed sensor shares the queue and must not
    count as a route waiting."""
    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    other = {
        "numOfMessages": 1,
        "messages": [
            {
                "messageId": 1,
                "messageType": "device-settings",
                "metaData": {"metaDataId": 515580837},
            }
        ],
    }
    monkeypatch.setattr(garmin, "_client", lambda: _Queue(other))

    said = garmin.course_arrived(515580837)
    assert said["arrived"] is True, "a settings message was read as a course"


def test_a_queue_that_cannot_be_read_is_unknown_and_never_arrived(monkeypatch, tmp_path):
    """The one answer here that could send somebody up a hill without their
    route is 'it is on your watch' when it might not be. So a queue this cannot
    read is reported as unknown rather than guessed at."""
    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    monkeypatch.setattr(garmin, "_client", lambda: _Queue(RuntimeError("no")))

    said = garmin.course_arrived(515580837)
    assert said["known"] is False
    assert said["arrived"] is not True


def test_an_empty_queue_means_arrived(monkeypatch, tmp_path):
    monkeypatch.setenv(garmin.TOKENS_ENV, str(tmp_path))
    for empty in ({"numOfMessages": 0, "messages": []}, {}, None):
        monkeypatch.setattr(garmin, "_client", lambda answer=empty: _Queue(answer))
        assert garmin.course_arrived(515580837)["arrived"] is True
