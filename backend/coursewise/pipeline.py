"""High-level steps of the project. Each function is one CLI command."""

from pathlib import Path

import pandas as pd

from . import config
from .catalog import build_catalog_courses
from .cleaning import aggregate_offerings, clean_grades, load_raw_grades
from .features import build_features
from .targets import add_labels, add_targets
from .utils import ensure_dir, log, timed


def prepare(raw_dir: Path = config.RAW_DIR) -> pd.DataFrame:
    """Raw CSVs -> offerings.csv, catalog_courses.csv, features.csv."""
    ensure_dir(config.PROCESSED_DIR)

    with timed("cleaning grades"):
        raw = load_raw_grades(raw_dir / config.GPA_FILE_NAME)
        clean = clean_grades(raw)
        offerings = add_labels(add_targets(aggregate_offerings(clean)))
        log.info("%d raw rows -> %d offerings", len(raw), len(offerings))

    with timed("reading catalog"):
        catalog_courses = build_catalog_courses(raw_dir / config.CATALOG_DIR_NAME)
        log.info("%d courses in catalog", len(catalog_courses))

    with timed("building features"):
        features = build_features(offerings, catalog_courses)

    offerings.to_csv(config.OFFERINGS_FILE, index=False)
    catalog_courses.to_csv(config.CATALOG_COURSES_FILE, index=False)
    features.to_csv(config.FEATURES_FILE, index=False)
    log.info("saved %s (%d rows, %d columns)", config.FEATURES_FILE.name, *features.shape)
    return features


def load_features() -> pd.DataFrame:
    return _load_processed(config.FEATURES_FILE)


def load_offerings() -> pd.DataFrame:
    return _load_processed(config.OFFERINGS_FILE)


def _load_processed(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `python3 -m coursewise prepare` first.")
    return pd.read_csv(path)


def train(task_names: list[str], options) -> dict:
    """Tasks 1-4: train, tune and compare every model."""
    from .tasks import TASKS
    from .training import train_task

    features = load_features()
    outcomes = {}
    # Registry order: regression tasks first, so the classification tasks
    # can also try classes derived from them.
    for name in [n for n in TASKS if n in task_names]:
        with timed(f"task {name}"):
            outcomes[name] = train_task(TASKS[name], features, options, sources=outcomes)
    return {name: outcome.summary for name, outcome in outcomes.items()}


def threshold(task_names: list[str]) -> None:
    """Tune the decision threshold of saved binary models (no full retrain)."""
    from .tasks import TASKS
    from .training import retune_saved_threshold

    features = load_features()
    for name in task_names:
        if TASKS[name].is_binary:
            with timed(f"threshold {name}"):
                retune_saved_threshold(TASKS[name], features)


def serve(port: int) -> None:
    """Website + live prediction API on http://127.0.0.1:<port>."""
    from .server import run_server

    run_server(port)


def cluster(k: int | None = None) -> dict:
    """Task 5: K-Means grading styles."""
    from .clustering import run_clustering

    with timed("clustering"):
        return run_clustering(load_offerings(), k)


def explain(task_names: list[str]) -> None:
    """SHAP / feature importance and error analysis of each saved best model."""
    from .analysis import run_error_analysis
    from .explain import explain_task
    from .tasks import TASKS

    features = load_features()
    for name in task_names:
        with timed(f"explain {name}"):
            explain_task(TASKS[name], features)
            run_error_analysis(TASKS[name])
