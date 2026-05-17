"""API tests: persistence roundtrip + validation status codes.

422 = malformed body, 409 = bad hierarchy, 400 = unsafe name, 404 = missing.
"""

import copy

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("TF_CONFIG_DIR", str(tmp_path))
    from backend.app import app

    return TestClient(app)


def make_config(name="demo"):
    return {
        "name": name,
        "version": "1.0",
        "frames": [
            {
                "id": "r",
                "name": "world",
                "parent_id": None,
                "translation": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0, "w": 1},
                "convention": "ENU",
            },
            {
                "id": "c",
                "name": "base_link",
                "parent_id": "r",
                "translation": {"x": 1, "y": 2, "z": 0.5},
                # yaw 90 deg as a quaternion
                "rotation": {"x": 0, "y": 0, "z": 0.7071067811865476, "w": 0.7071067811865476},
                "convention": "FLU",
            },
        ],
        "metadata": {
            "created": "2026-05-16T00:00:00Z",
            "modified": "2026-05-16T00:00:00Z",
            "root_name": "world",
        },
    }


def test_roundtrip_save_load_list_delete(client):
    cfg = make_config("demo")

    r = client.put("/api/configs/demo", json=cfg)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "saved"

    r = client.get("/api/configs")
    assert r.status_code == 200
    names = [c["name"] for c in r.json()]
    assert "demo" in names
    entry = next(c for c in r.json() if c["name"] == "demo")
    assert entry["frame_count"] == 2

    r = client.get("/api/configs/demo")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "demo"
    assert [f["name"] for f in body["frames"]] == ["world", "base_link"]
    assert abs(body["frames"][1]["rotation"]["w"] - 0.7071067811865476) < 1e-9
    assert body["frames"][1]["convention"] == "FLU"

    r = client.delete("/api/configs/demo")
    assert r.status_code == 200

    assert client.get("/api/configs/demo").status_code == 404
    assert client.delete("/api/configs/demo").status_code == 404


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert "version" in r.json()


def test_get_missing_is_404(client):
    assert client.get("/api/configs/nope").status_code == 404


def test_empty_config_is_allowed(client):
    cfg = {"name": "blank", "version": "1.0", "frames": [], "metadata": {}}
    assert client.put("/api/configs/blank", json=cfg).status_code == 200


def test_cycle_rejected_409(client):
    cfg = make_config("cyc")
    # Valid single root, plus a separate 2-node cycle (a->b->a) that never
    # reaches the root: isolates cycle detection from the "one root" check.
    cfg["frames"] = [
        {"id": "r", "name": "world", "parent_id": None, "translation": {}, "rotation": {}},
        {"id": "a", "name": "a", "parent_id": "b", "translation": {}, "rotation": {}},
        {"id": "b", "name": "b", "parent_id": "a", "translation": {}, "rotation": {}},
    ]
    r = client.put("/api/configs/cyc", json=cfg)
    assert r.status_code == 409, r.text
    assert "cycle" in r.json()["detail"].lower()


def test_duplicate_names_rejected_409(client):
    cfg = make_config("dup")
    cfg["frames"][1]["name"] = "world"  # same as root
    r = client.put("/api/configs/dup", json=cfg)
    assert r.status_code == 409
    assert "name" in r.json()["detail"].lower()


def test_duplicate_ids_rejected_409(client):
    cfg = make_config("dupid")
    cfg["frames"][1]["id"] = "r"
    r = client.put("/api/configs/dupid", json=cfg)
    assert r.status_code == 409


def test_multiple_roots_rejected_409(client):
    cfg = make_config("roots")
    cfg["frames"][1]["parent_id"] = None
    r = client.put("/api/configs/roots", json=cfg)
    assert r.status_code == 409
    assert "root" in r.json()["detail"].lower()


def test_dangling_parent_rejected_409(client):
    cfg = make_config("dangle")
    cfg["frames"][1]["parent_id"] = "ghost"
    r = client.put("/api/configs/dangle", json=cfg)
    assert r.status_code == 409


def test_name_with_space_is_422(client):
    cfg = make_config("badname")
    cfg["frames"][1]["name"] = "base link"
    r = client.put("/api/configs/badname", json=cfg)
    assert r.status_code == 422


def test_wrong_type_is_422(client):
    cfg = make_config("badtype")
    cfg["frames"][1]["translation"]["x"] = "not-a-number"
    r = client.put("/api/configs/badtype", json=cfg)
    assert r.status_code == 422


def test_zero_norm_quaternion_is_422(client):
    cfg = make_config("badquat")
    cfg["frames"][1]["rotation"] = {"x": 0, "y": 0, "z": 0, "w": 0}
    r = client.put("/api/configs/badquat", json=cfg)
    assert r.status_code == 422


def test_missing_required_field_is_422(client):
    cfg = make_config("missing")
    del cfg["frames"][0]["name"]
    r = client.put("/api/configs/missing", json=cfg)
    assert r.status_code == 422


def test_unsafe_config_name_is_rejected(client):
    # An encoded-slash traversal attempt doesn't match the API route at all
    # (it falls through to static file serving), so it is never persisted.
    r = client.put("/api/configs/..%2Fevil", json=make_config("ok"))
    assert r.status_code in (400, 404, 405)
    assert not any(c["name"].startswith("..") for c in client.get("/api/configs").json())
    # A routable but invalid name reaches our validation -> 400.
    r2 = client.put("/api/configs/bad name!", json=make_config("x"))
    assert r2.status_code == 400


def test_invalid_name_get_delete_400(client):
    assert client.get("/api/configs/bad!name").status_code == 400
    assert client.delete("/api/configs/bad!name").status_code == 400


def test_rpy_to_quat_known_values():
    import math

    from backend.models import rpy_to_quat

    q = rpy_to_quat(0, 0, math.radians(90))  # yaw 90
    assert abs(q["z"] - 0.70710678) < 1e-6
    assert abs(q["w"] - 0.70710678) < 1e-6
    assert abs(q["x"]) < 1e-9 and abs(q["y"]) < 1e-9

    ident = rpy_to_quat(0, 0, 0)
    assert ident == {"x": 0.0, "y": 0.0, "z": 0.0, "w": 1.0}


def test_legacy_config_migrated_on_load(client, tmp_path):
    legacy = {
        "name": "old",
        "version": "1.0",
        "frames": [
            {
                "id": "r",
                "name": "world",
                "parent_id": None,
                "translation": {"x": 0, "y": 0, "z": 0},
                "rotation": {"roll": 0, "pitch": 0, "yaw": 0},
                "angle_unit": "deg",
                "convention": "ENU",
            },
            {
                "id": "c",
                "name": "base_link",
                "parent_id": "r",
                "translation": {"x": 1, "y": 0, "z": 0},
                "rotation": {"roll": 0, "pitch": 0, "yaw": 90},
                "angle_unit": "deg",
                "convention": "FLU",
            },
        ],
        "metadata": {},
    }
    (tmp_path / "old.json").write_text(__import__("json").dumps(legacy), encoding="utf-8")

    r = client.get("/api/configs/old")
    assert r.status_code == 200
    assert r.headers.get("X-TF-Migrated") == "1"
    bl = r.json()["frames"][1]
    assert "roll" not in bl["rotation"] and "w" in bl["rotation"]
    assert "angle_unit" not in bl
    assert abs(bl["rotation"]["z"] - 0.70710678) < 1e-6
    assert abs(bl["rotation"]["w"] - 0.70710678) < 1e-6


def test_new_schema_not_flagged_migrated(client):
    client.put("/api/configs/fresh", json=make_config("fresh"))
    r = client.get("/api/configs/fresh")
    assert r.status_code == 200
    assert "X-TF-Migrated" not in r.headers
