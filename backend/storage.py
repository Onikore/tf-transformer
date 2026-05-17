"""File-based JSON persistence for configs.

Config name is also the filename stem, so it is strictly validated to prevent
path traversal. Storage directory is resolvable via the TF_CONFIG_DIR env var
(used by tests) and read at call time, not import time.
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

from .models import Config, migrate_legacy

_NAME_RE = re.compile(r"^[A-Za-z0-9_.\- ]{1,64}$")


class StorageError(Exception):
    pass


class NotFoundError(StorageError):
    pass


class InvalidNameError(StorageError):
    pass


def get_config_dir() -> Path:
    env = os.environ.get("TF_CONFIG_DIR")
    base = Path(env) if env else Path(__file__).resolve().parent.parent / "configs"
    return base


def _safe_path(name: str) -> Path:
    if not name or ".." in name or "/" in name or "\\" in name or not _NAME_RE.match(name):
        raise InvalidNameError(f"invalid config name: {name!r}")
    cfg_dir = get_config_dir().resolve()
    path = (cfg_dir / f"{name}.json").resolve()
    if path.parent != cfg_dir:
        raise InvalidNameError(f"invalid config name: {name!r}")
    return path


def ensure_dir() -> Path:
    d = get_config_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d


def list_configs() -> list[dict]:
    d = ensure_dir()
    out: list[dict] = []
    for p in sorted(d.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        md = data.get("metadata", {}) or {}
        out.append(
            {
                "name": p.stem,
                "display_name": data.get("name", p.stem),
                "modified": md.get("modified", ""),
                "frame_count": len(data.get("frames", []) or []),
            }
        )
    return out


def load_config(name: str) -> tuple[Config, bool]:
    """Returns (config, migrated). Legacy rotation schemas are up-converted
    so callers always get a valid quaternion config; `migrated` is True when
    the on-disk file used the legacy format."""
    path = _safe_path(name)
    if not path.exists():
        raise NotFoundError(name)
    data = json.loads(path.read_text(encoding="utf-8"))
    migrated = migrate_legacy(data)
    return Config.model_validate(data), migrated


def save_config(name: str, config: Config) -> None:
    ensure_dir()
    path = _safe_path(name)
    path.write_text(config.model_dump_json(indent=2), encoding="utf-8")


def delete_config(name: str) -> None:
    path = _safe_path(name)
    if not path.exists():
        raise NotFoundError(name)
    path.unlink()
