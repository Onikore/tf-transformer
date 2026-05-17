"""FastAPI app: config REST API + static frontend.

Status codes: 422 for malformed bodies (Pydantic handles this automatically),
409 for a well-formed body whose hierarchy is invalid (cycle / duplicate /
missing parent / multiple roots), 400 for an unsafe config name, 404 for a
missing config.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles

from . import storage
from .models import Config, GraphError, validate_graph

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="TF Transformer", version="1.0")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "version": app.version}


@app.get("/api/configs")
def list_configs() -> list[dict]:
    return storage.list_configs()


@app.get("/api/configs/{name}")
def get_config(name: str, response: Response) -> dict:
    try:
        config, migrated = storage.load_config(name)
    except storage.NotFoundError:
        raise HTTPException(status_code=404, detail=f"config '{name}' not found")
    except storage.InvalidNameError:
        raise HTTPException(status_code=400, detail="invalid config name")
    if migrated:
        response.headers["X-TF-Migrated"] = "1"
    return config.model_dump()


@app.put("/api/configs/{name}")
def put_config(name: str, config: Config) -> dict:
    try:
        validate_graph(config)
    except GraphError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    try:
        storage.save_config(name, config)
    except storage.InvalidNameError:
        raise HTTPException(status_code=400, detail="invalid config name")
    return {"status": "saved", "name": name}


@app.delete("/api/configs/{name}")
def delete_config(name: str) -> dict:
    try:
        storage.delete_config(name)
    except storage.NotFoundError:
        raise HTTPException(status_code=404, detail=f"config '{name}' not found")
    except storage.InvalidNameError:
        raise HTTPException(status_code=400, detail="invalid config name")
    return {"status": "deleted", "name": name}


# Mounted last so /api/* is matched first. html=True serves index.html at /.
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
