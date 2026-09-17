"""Sends a route to the visitor's own Garmin Connect, as a course.

THIS IS OFF UNLESS SOMEBODY TURNS IT ON, and that is the whole design. Set
GARMIN_TOKENS to the directory holding a Garmin session and the endpoint
appears; leave it unset and there is no endpoint, no import, and no dependency
to install. The deployment anybody else can reach runs with it unset, so the
promise the page makes -- no accounts, nothing written down -- stays true
there, because it is true of that process rather than true by politeness.

WHY IT EXISTS. A .gpx handed to a phone's share sheet does not offer Garmin
Connect on every phone, and where it does it still costs an import dialog, an
activity picker and a Send to Device. Uploading the course directly is one
press. The route still has to reach the watch by Garmin's own sync, which this
cannot change.

CREATING THE COURSE IS NOT ENOUGH, and that cost two days to learn. A course
saved to the account sits there; the watch never hears about it. Delivery is a
QUEUE: a message carrying the URL of the course's FIT is put in the account's
device queue, and the watch downloads it on its next ordinary sync. Nobody
presses anything. Measured on a real Forerunner 965: course created, message
queued, watch synced, course under Navigate > Courses.

WHAT IT DOES NOT DO. It never reads, asks for or stores a password. It points
the library at a session directory that already exists, created by something
else, and if that session has expired the answer says so and the repair is to
log in with that other tool. Nothing in this repository can create one.

THE NUMBERS WILL NOT MATCH, and the page says so beside the button. Garmin
redraws elevation from its own map: a 551-point track published at 535 m of
ascent and measured here at 533 m came back from a real upload reading 598 m.
The file that is sent is exactly the file the download button hands over.
"""

import io
import logging
import math
import os
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# The environment variable is the switch AND the address: it says where the
# session lives rather than letting this module guess, so turning the feature
# on is one deliberate act and not a side effect of a file existing.
TOKENS_ENV = "GARMIN_TOKENS"

EARTH_RADIUS_M = 6371000.0

# Garmin's own ids. Written down rather than fetched, for the same reason the
# source adapters write their activity lists down: a bad value is refused here
# before anything leaves the process.
ACTIVITY_IDS = {
    "running": 1,
    "cycling": 2,
    "hiking": 3,
    "walking": 4,
    "trail_running": 5,
    "mountain_biking": 6,
    "road_biking": 7,
    "gravel_cycling": 8,
}

DEFAULT_ACTIVITY = "hiking"

# A course is created private. Anything else would publish a visitor's route to
# strangers as a side effect of pressing one button.
PRIVATE = 2
SOURCE_TYPE_GPX = 3


class GarminUnavailable(Exception):
    """The feature is off, or its session is gone. `hint` says which."""

    def __init__(self, hint: str, detail: str):
        super().__init__(detail)
        self.hint = hint
        self.detail = detail


def tokens_dir() -> Optional[str]:
    raw = os.environ.get(TOKENS_ENV, "").strip()
    if not raw:
        return None
    return os.path.expanduser(raw)


def enabled() -> bool:
    """Whether the endpoint should exist at all in this process."""
    where = tokens_dir()
    return bool(where) and os.path.isdir(where)


def _client():
    where = tokens_dir()
    if not where:
        raise GarminUnavailable("off", f"{TOKENS_ENV} is not set in this process")
    if not os.path.isdir(where):
        raise GarminUnavailable("off", f"{TOKENS_ENV} does not name a directory")

    try:
        import garth
    except ImportError as missing:
        raise GarminUnavailable(
            "install",
            "the garth package is not installed; see api/requirements-garmin.txt",
        ) from missing

    client = garth.Client()
    try:
        client.load(where)
    except Exception as broken:
        # Never the exception's own text: a session error can carry the token.
        raise GarminUnavailable(
            "session",
            f"the saved Garmin session could not be read ({type(broken).__name__})",
        ) from broken
    return client


def _haversine(a: Dict[str, float], b: Dict[str, float]) -> float:
    lat1, lon1 = math.radians(a["latitude"]), math.radians(a["longitude"])
    lat2, lon2 = math.radians(b["latitude"]), math.radians(b["longitude"])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    inner = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(inner))


def _initial_bearing(a: Dict[str, float], b: Dict[str, float]) -> float:
    lat1, lat2 = math.radians(a["latitude"]), math.radians(b["latitude"])
    dlon = math.radians(b["longitude"] - a["longitude"])
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _course_payload(
    skeleton: Dict[str, Any], name: str, activity_id: int
) -> Dict[str, Any]:
    points: List[Dict[str, Any]] = skeleton.get("geoPoints") or []
    if len(points) < 2:
        raise GarminUnavailable(
            "track", "Garmin read no usable coordinates out of that file"
        )

    for point in points:
        if point.get("elevation") is None:
            point["elevation"] = 0.0

    distance = sum(_haversine(points[i - 1], points[i]) for i in range(1, len(points)))
    lats = [p["latitude"] for p in points]
    lons = [p["longitude"] for p in points]

    return {
        "courseName": name,
        "description": None,
        "openStreetMap": False,
        "matchedToSegments": False,
        "userProfilePk": None,
        "userGroupPk": None,
        "rulePK": PRIVATE,
        "geoRoutePk": None,
        "sourceTypeId": SOURCE_TYPE_GPX,
        "sourcePk": None,
        "distanceMeter": distance,
        # Left at zero deliberately. Garmin recomputes elevation from its own
        # map whatever is sent, so a figure here would be a number this service
        # stated and Garmin then overwrote, which is worse than no figure.
        "elevationGainMeter": 0.0,
        "elevationLossMeter": 0.0,
        "startPoint": {
            "latitude": points[0]["latitude"],
            "longitude": points[0]["longitude"],
            "elevation": points[0].get("elevation") or 0.0,
            "distance": None,
            "timestamp": None,
        },
        "coursePoints": [],
        "boundingBox": {
            "center": {
                "latitude": (min(lats) + max(lats)) / 2,
                "longitude": (min(lons) + max(lons)) / 2,
            },
            "lowerLeft": {"latitude": min(lats), "longitude": min(lons)},
            "upperRight": {"latitude": max(lats), "longitude": max(lons)},
            "lowerLeftLatIsSet": True,
            "lowerLeftLongIsSet": True,
            "upperRightLatIsSet": True,
            "upperRightLongIsSet": True,
        },
        "hasShareableEvent": False,
        "hasTurnDetectionDisabled": False,
        "activityTypePk": activity_id,
        "virtualPartnerId": None,
        "includeLaps": False,
        "elapsedSeconds": None,
        "startBearing": _initial_bearing(points[0], points[-1]),
        "endBearing": None,
        "geoPoints": points,
    }


def _last_used_device(client) -> Optional[Dict[str, Any]]:
    """The watch this account used last, which for one person is the watch.

    Asked rather than configured: a device id in a settings file goes stale the
    day somebody buys a watch, and this answer never does.
    """
    try:
        said = client.connectapi("/device-service/deviceservice/mylastused")
    except Exception as refused:
        logger.info("garmin would not name a device: %s", type(refused).__name__)
        return None
    device_id = (said or {}).get("userDeviceId")
    if not device_id:
        return None
    return {"id": device_id, "name": said.get("lastUsedDeviceName") or "your watch"}


def _queue_on_device(client, course_id: int, device: Dict[str, Any], name: str) -> bool:
    """Puts the course in the watch's collection queue. True if it landed.

    The body is a LIST. A bare object is answered with a 500, which is the kind
    of detail that costs an afternoon, so it is written down here rather than
    discovered twice.

    `messageUrl` is relative and has no leading slash. It names the FIT the
    device will fetch for itself at sync time -- this service never downloads
    it, and the watch is the one that spends the bandwidth.
    """
    body = [
        {
            "deviceId": device["id"],
            "messageUrl": (
                f"course-service/course/fit/{course_id}/{device['id']}?elevation=true"
            ),
            "messageType": "courses",
            "messageName": name[:60],
            "groupName": None,
            # A hint only: the server rewrites this.
            "priority": 0,
            "fileType": "FIT",
            "metaDataId": course_id,
        }
    ]
    try:
        client.connectapi(
            "/device-service/devicemessage/messages", method="POST", json=body
        )
    except Exception as refused:
        # Not fatal, and the difference matters to the person waiting: the
        # course IS in their account and can still be sent by hand.
        logger.warning("garmin would not queue the course: %s", type(refused).__name__)
        return False
    logger.info("garmin course %s queued for device %s", course_id, device["id"])
    return True


def course_arrived(course_id: int) -> Dict[str, Any]:
    """Whether the watch has collected this course yet.

    The queue is the answer and it answers by emptying. A message sits there
    with `messageStatus: new` until the device syncs, downloads the FIT and
    acknowledges it; then it is gone. So "still queued" and "arrived" are the
    same question asked of the same list, and neither needs the watch to be
    asked anything.

    A queue this cannot read is reported as unknown rather than as arrived.
    Telling somebody their route is on their watch when it might not be is the
    one answer here that could send them up a hill without it.
    """
    client = _client()
    try:
        queue = client.connectapi("/device-service/devicemessage/messages")
    except Exception as refused:
        logger.info("garmin queue unreadable: %s", type(refused).__name__)
        return {"known": False, "queued": None, "arrived": None}

    for message in (queue or {}).get("messages") or []:
        meta = message.get("metaData") or {}
        if message.get("messageType") != "courses":
            continue
        if meta.get("metaDataId") == course_id:
            return {"known": True, "queued": True, "arrived": False}

    return {"known": True, "queued": False, "arrived": True}


def send_course(
    gpx: str, file_name: str, name: str, activity: str = DEFAULT_ACTIVITY
) -> Dict[str, Any]:
    """Uploads one GPX as a private course. Returns what Garmin called it.

    Two calls, because Garmin's own flow is two: the file is parsed into a
    skeleton, and the skeleton plus a name is saved. There is no single-shot
    endpoint that does both.
    """
    activity_id = ACTIVITY_IDS.get((activity or "").lower())
    if activity_id is None:
        raise GarminUnavailable(
            "request",
            f"{activity!r} is not an activity Garmin takes for a course",
        )

    client = _client()

    try:
        skeleton = client.connectapi(
            "/course-service/course/import",
            method="POST",
            files={
                "file": (
                    file_name,
                    io.BytesIO(gpx.encode("utf-8")),
                    "application/gpx+xml",
                )
            },
        )
    except Exception as refused:
        logger.warning("garmin refused the import: %s", type(refused).__name__)
        raise GarminUnavailable(
            "session",
            f"Garmin would not read the file ({type(refused).__name__}). "
            "The saved session may have expired",
        ) from refused

    payload = _course_payload(skeleton, name or file_name, activity_id)

    try:
        saved = client.connectapi(
            "/course-service/course", method="POST", json=payload
        )
    except Exception as refused:
        logger.warning("garmin refused the save: %s", type(refused).__name__)
        raise GarminUnavailable(
            "session",
            f"Garmin read the file but would not save the course "
            f"({type(refused).__name__})",
        ) from refused

    course_id = saved.get("courseId")
    logger.info("garmin course %s saved, %s points", course_id, len(payload["geoPoints"]))

    # Saved is not delivered. Queue it, and report the two outcomes apart,
    # because "it is on your watch" and "it is in your account, send it
    # yourself" are different instructions to the person reading.
    device = _last_used_device(client)
    queued = bool(device) and _queue_on_device(client, course_id, device, name or file_name)

    return {
        "courseId": course_id,
        "queuedForDevice": queued,
        "deviceName": device["name"] if device else None,
        "name": saved.get("courseName"),
        "distanceM": saved.get("distanceMeter"),
        # Garmin's own figures, kept apart from ours on purpose: the page shows
        # both so the difference is visible rather than argued about.
        "garminAscentM": saved.get("elevationGainMeter"),
        "garminDescentM": saved.get("elevationLossMeter"),
        "url": f"https://connect.garmin.com/modern/course/{course_id}",
    }
