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
    return {
        "courseId": course_id,
        "name": saved.get("courseName"),
        "distanceM": saved.get("distanceMeter"),
        # Garmin's own figures, kept apart from ours on purpose: the page shows
        # both so the difference is visible rather than argued about.
        "garminAscentM": saved.get("elevationGainMeter"),
        "garminDescentM": saved.get("elevationLossMeter"),
        "url": f"https://connect.garmin.com/modern/course/{course_id}",
    }
