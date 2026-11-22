"""Small helpers shared by several modules (I/O, logging, timing)."""

import importlib
import json
import logging
import time
from contextlib import contextmanager
from functools import cache
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger("coursewise")


def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )


@cache
def module_available(name: str) -> bool:
    """True only if the package is installed AND imports without error.

    Some packages install fine but fail at import, e.g. xgboost / lightgbm
    on macOS without the OpenMP runtime (`brew install libomp`).
    """
    try:
        importlib.import_module(name)
    except Exception as error:  # noqa: BLE001 - any import failure means "unavailable"
        if not isinstance(error, ModuleNotFoundError):
            first_line = str(error).strip().splitlines()[0] if str(error).strip() else type(error).__name__
            log.warning("package '%s' is installed but failed to import: %s", name, first_line)
        return False
    return True


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def read_csv_any_encoding(path: Path, **kwargs) -> pd.DataFrame:
    """Read a CSV as UTF-8, falling back to latin-1 for older exports."""
    try:
        return pd.read_csv(path, encoding="utf-8", **kwargs)
    except UnicodeDecodeError:
        return pd.read_csv(path, encoding="latin-1", **kwargs)


def to_builtin(value):
    """Convert numpy / pandas values so json.dump can write them."""
    if isinstance(value, dict):
        return {str(k): to_builtin(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_builtin(v) for v in value]
    if isinstance(value, np.ndarray):
        return [to_builtin(v) for v in value.tolist()]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return None if np.isnan(value) else round(float(value), 6)
    if isinstance(value, float):
        return None if np.isnan(value) else round(value, 6)
    return value


def save_json(data, path: Path, indent: int | None = 2) -> None:
    """Write JSON; indent=None writes a compact file (used for large frontend data)."""
    ensure_dir(path.parent)
    separators = None if indent else (",", ":")
    with open(path, "w", encoding="utf-8") as file:
        json.dump(to_builtin(data), file, indent=indent, separators=separators, ensure_ascii=False)


def load_json(path: Path):
    with open(path, encoding="utf-8") as file:
        return json.load(file)


@contextmanager
def timed(step: str):
    start = time.perf_counter()
    log.info("%s ...", step)
    yield
    log.info("%s done in %.1fs", step, time.perf_counter() - start)
