import os
import sys
import tempfile
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(tempfile.mkdtemp(), "test.db")
os.environ["DISABLE_SCHEDULER"] = "1"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from namjai import db as D
from namjai.app import app

ADMIN = {"Authorization": "Bearer dev-admin"}


@pytest.fixture
def fresh():
    D.Base.metadata.drop_all(D.engine)
    D.init()
    yield


@pytest.fixture
def client(fresh):
    with TestClient(app) as c:
        yield c


@pytest.fixture
def session(fresh):
    with D.Session() as s:
        yield s
