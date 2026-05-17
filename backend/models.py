"""Pydantic schemas for TF Transformer configs.

Per-field/structural validation lives in the models (FastAPI surfaces these as
422). Graph integrity (single root, no cycles, unique names, valid parent
references) is a separate function so the API can return 409 for it, keeping
"bad shape" (422) and "bad hierarchy" (409) distinct.
"""

from __future__ import annotations

import math
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

Convention = Literal["ENU", "NED", "FRD", "FLU"]


def _check_finite(v: float) -> float:
    if not math.isfinite(v):
        raise ValueError("must be a finite number")
    return v


class Vec3(BaseModel):
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

    @field_validator("x", "y", "z")
    @classmethod
    def _finite(cls, v: float) -> float:
        return _check_finite(v)


class Quaternion(BaseModel):
    """Canonical rotation representation (x, y, z, w). RPY/matrix are lossless
    UI conversions only — the stored truth is this quaternion."""

    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    w: float = 1.0

    @field_validator("x", "y", "z", "w")
    @classmethod
    def _finite(cls, v: float) -> float:
        return _check_finite(v)

    @model_validator(mode="after")
    def _non_zero_norm(self) -> "Quaternion":
        if self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w < 1e-12:
            raise ValueError("quaternion must have non-zero norm")
        return self


class Frame(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    translation: Vec3 = Field(default_factory=Vec3)
    rotation: Quaternion = Field(default_factory=Quaternion)
    convention: Convention = "ENU"

    @field_validator("id")
    @classmethod
    def _id_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("frame id must be non-empty")
        return v

    @field_validator("name")
    @classmethod
    def _name_valid(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("frame name must be non-empty")
        if any(c.isspace() for c in v):
            raise ValueError("frame name must not contain whitespace (ROS frame_id)")
        return v


class Metadata(BaseModel):
    created: str = ""
    modified: str = ""
    root_name: str = ""


class Config(BaseModel):
    name: str
    version: str = "1.0"
    frames: list[Frame] = Field(default_factory=list)
    metadata: Metadata = Field(default_factory=Metadata)


class GraphError(ValueError):
    """Raised when the frame hierarchy is structurally invalid."""


def validate_graph(config: Config) -> None:
    """Validate hierarchy integrity. Raises GraphError on the first problem.

    Rules: unique ids, unique names, exactly one root (parent_id is None) when
    non-empty, every parent_id resolves to an existing frame, no cycles.
    """
    frames = config.frames
    if not frames:
        return

    ids = [f.id for f in frames]
    if len(ids) != len(set(ids)):
        raise GraphError("duplicate frame ids")

    names = [f.name for f in frames]
    if len(names) != len(set(names)):
        raise GraphError("duplicate frame names")

    id_set = set(ids)
    roots = [f for f in frames if f.parent_id is None]
    if len(roots) != 1:
        raise GraphError("config must have exactly one root frame")

    for f in frames:
        if f.parent_id is not None and f.parent_id not in id_set:
            raise GraphError(f"parent_id '{f.parent_id}' does not reference an existing frame")

    parent_of = {f.id: f.parent_id for f in frames}
    for start in ids:
        seen: set[str] = set()
        cur: Optional[str] = start
        while cur is not None:
            if cur in seen:
                raise GraphError("cycle detected in frame hierarchy")
            seen.add(cur)
            cur = parent_of.get(cur)


def rpy_to_quat(roll: float, pitch: float, yaw: float) -> dict:
    """Radians -> quaternion for REP-103 R = Rz(yaw)·Ry(pitch)·Rx(roll)."""
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return {
        "x": sr * cp * cy - cr * sp * sy,
        "y": cr * sp * cy + sr * cp * sy,
        "z": cr * cp * sy - sr * sp * cy,
        "w": cr * cp * cy + sr * sp * sy,
    }


def migrate_legacy(data: dict) -> bool:
    """Up-convert a legacy config dict in place: rotation {roll,pitch,yaw}
    (+ optional angle_unit, default deg) -> canonical quaternion. Returns True
    if anything was converted. Idempotent on new-schema configs."""
    migrated = False
    for frame in data.get("frames", []) or []:
        rot = frame.get("rotation")
        unit = frame.pop("angle_unit", None)
        if isinstance(rot, dict) and any(k in rot for k in ("roll", "pitch", "yaw")):
            r = float(rot.get("roll", 0.0) or 0.0)
            p = float(rot.get("pitch", 0.0) or 0.0)
            y = float(rot.get("yaw", 0.0) or 0.0)
            if unit != "rad":
                r, p, y = math.radians(r), math.radians(p), math.radians(y)
            frame["rotation"] = rpy_to_quat(r, p, y)
            migrated = True
        elif unit is not None:
            migrated = True
    return migrated
