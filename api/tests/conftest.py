"""What every test in this directory gets before it runs.

The service keeps four families of token buckets in module state, so a test
that spends one leaves it spent for whatever runs next. This reset used to live
in three test files as three copies, and the copies had drifted: the one in
`test_discovery.py` cleared `_inbound`, `_clients` and `_sites` but not
`_geocoder`, and `test_allowlist.py`, `test_hardening.py` and `test_sources.py`
had no reset at all.

Neither gap was theoretical. `test_a_list_answer_is_never_a_track` spends a
Photon token, and the copy in its own file left that token spent for the rest of
the run. Nothing failed only because the tests that care about the geocoder all
live in files whose copy happened to be the complete one. Make this fixture
reset nothing and three tests fail, so it is the ordering that was lucky, not
the reset that was unnecessary.
"""

import pytest

from api import app as service
from api import http
from api import limits


def _families():
    """Every bucket family the service holds in module state.

    Found rather than listed, because a listed copy is what drifted: a fifth
    family added to `api/http.py` tomorrow is reset here without anyone
    remembering to come back and add it.
    """
    for module in (service, http):
        for value in vars(module).values():
            if isinstance(value, limits.Buckets):
                yield value


@pytest.fixture(autouse=True)
def _empty_buckets():
    """Every test starts where a fresh process starts: nothing spent."""
    for buckets in _families():
        buckets._levels.clear()
    yield
