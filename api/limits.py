"""Token buckets, written once.

Two different jobs need the same arithmetic, so it lives here instead of twice:
`api/http.py` spends a bucket before every outbound call, and `api/app.py`
spends one for every inbound request. One copy means the locking is written
once and the eviction rule is written once.

A bucket is a level and a timestamp, not a list of timestamps. A list has to
grow with the traffic it is measuring and then be trimmed; two floats do not,
and an idle client's bucket is full again long before anyone looks at it.

Callers hold `LOCK` around `wait()` and `spend()` themselves. That looks like
work pushed onto the caller, and it is deliberate: `api/http.py` has to check
two buckets and only then charge both, so that a visitor is never charged for a
refusal caused by the whole service being busy. That decision cannot be made
one bucket at a time. The lock is never held across a network call.
"""

import heapq
import threading
import time
from typing import Dict

LOCK = threading.Lock()


class _Level:
    """One client's bucket: how many tokens it has, and when that was true."""

    __slots__ = ("tokens", "updated")

    def __init__(self, tokens: float, updated: float):
        self.tokens = tokens
        self.updated = updated


class Buckets:
    """A family of buckets that share one capacity and one refill rate.

    Keyed by whatever the caller counts: a client address, or a site.
    """

    def __init__(
        self,
        capacity: float,
        refill_per_second: float,
        idle_seconds: float = 300.0,
        sweep_above: int = 2048,
        keep_at_most: int = 10000,
        sweep_every: int = 256,
    ):
        self.capacity = float(capacity)
        self.refill_per_second = float(refill_per_second)
        self.idle_seconds = idle_seconds
        self.sweep_above = sweep_above
        self.keep_at_most = keep_at_most
        self.sweep_every = sweep_every
        self._levels: Dict[str, _Level] = {}
        self._since_sweep = 0

    def wait(self, key: str, now: float) -> float:
        """Seconds until this key can spend a token. `0.0` means it can now.

        Hold `LOCK` around this and the `spend()` that follows it, and pass both
        the same clock reading.
        """
        level = self._touch(key, now)
        if level.tokens >= 1.0:
            return 0.0
        return (1.0 - level.tokens) / self.refill_per_second

    def spend(self, key: str, now: float) -> None:
        self._touch(key, now).tokens -= 1.0

    def _touch(self, key: str, now: float) -> _Level:
        level = self._levels.get(key)
        if level is None:
            level = self._levels[key] = _Level(self.capacity, now)
            # Sweeping on every new key is a pass over the whole dictionary
            # while holding the one lock the whole service shares, so somebody
            # rotating addresses would make every other request wait behind it.
            # Amortised instead: rare passes, and the hard cap checked each time
            # so memory stays bounded between them.
            self._since_sweep += 1
            # The cap is allowed a sweep's worth of slack. Enforcing it exactly
            # would mean a full pass on every insertion once it is reached,
            # which is the whole cost this is here to avoid. The dictionary can
            # therefore hold keep_at_most + sweep_every at worst, and that is
            # the number that bounds memory.
            over = len(self._levels) > self.keep_at_most + self.sweep_every
            if self._since_sweep >= self.sweep_every or over:
                self._evict(now)
            return level

        elapsed = max(0.0, now - level.updated)
        level.tokens = min(self.capacity, level.tokens + elapsed * self.refill_per_second)
        level.updated = now
        return level

    def _evict(self, now: float) -> None:
        """Drop entries while writing one, rather than on a timer.

        A timer would be work this service does when nobody asked it to, which
        is the one thing it has promised not to do. Sweeping on write costs a
        rare pass over the dictionary and needs no task and no clock.

        Losing an entry only ever hands a client a full bucket again. That is a
        fairness loss and never a safety one, because the site bucket that
        actually protects the source sites is a fixed set of keys that no
        stranger can grow.
        """
        self._since_sweep = 0
        if len(self._levels) <= self.sweep_above:
            return

        for key in [
            key
            for key, level in self._levels.items()
            if now - level.updated > self.idle_seconds
        ]:
            del self._levels[key]

        # Somebody rotating source addresses must not be able to grow this
        # dictionary without bound, so age alone is not the last word on it.
        excess = len(self._levels) - self.keep_at_most
        if excess > 0:
            # nsmallest rather than a full sort: only the few oldest are wanted,
            # and this runs under the shared lock.
            for key in heapq.nsmallest(
                excess, self._levels, key=lambda key: self._levels[key].updated
            ):
                del self._levels[key]


def now() -> float:
    return time.monotonic()
