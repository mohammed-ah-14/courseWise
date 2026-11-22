"""Live forecasts for upcoming terms (used by the API server).

A future offering has no grades yet. It is added to the offerings table as an
empty row (zero counts, no targets) and `build_features()` computes its history
features exactly as in training: only from earlier terms, so nothing leaks.

The models learned to predict one term ahead from all earlier terms, so every
upcoming term gets the term index right after the last term in the data. Its
term type (Fall / Spring / Summer), year and university level still change.
"""

import threading
from dataclasses import dataclass
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd

from . import config
from .estimators import ThresholdClassifier, YearRankClassifier
from .features import build_features
from .tasks import TASKS
from .utils import log

TERM_CODES = {"Winter": "wi", "Spring": "sp", "Summer": "su", "Fall": "fa"}
# Counts and targets of an offering that has not happened yet.
EMPTY_COUNTS = config.GRADE_COLUMNS + ["withdrawn", "graded", "grade_points", "dfw_count", "enrolled",
                                       "count_A", "count_F"]
EMPTY_TARGETS = ["avg_gpa", "dfw_rate", "difficulty_code", "difficulty", "high_risk", "gpa_pct", "dfw_pct"]

FORMATS = ("", "in-person", "online")  # "" = the instructor's usual format
ONLINE_SCHED_TYPE = "ONL"
IN_PERSON_SCHED_TYPE = "LCD"  # lecture-discussion, the most common type


@dataclass(frozen=True)
class Term:
    year: int
    name: str  # "Fall"

    @property
    def key(self) -> str:
        return f"{self.year}-{TERM_CODES[self.name]}"

    @property
    def label(self) -> str:
        return f"{self.name} {self.year}"

    def as_dict(self) -> dict:
        return {"key": self.key, "label": self.label}


def upcoming_terms(last_year: int, last_term: str, count: int = config.FORECAST_TERM_COUNT) -> list[Term]:
    """The next `count` terms of the types in config.FORECAST_TERMS, after the last term in the data."""
    order = sorted(config.TERM_ORDER, key=config.TERM_ORDER.get)
    year, position = last_year, order.index(last_term)
    terms = []
    while len(terms) < count:
        position += 1
        if position == len(order):
            year, position = year + 1, 0
        if order[position] in config.FORECAST_TERMS:
            terms.append(Term(year, order[position]))
    return terms


def _load_model(task_name: str):
    path = config.MODELS_DIR / f"{task_name}.joblib"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `python3 -m coursewise train` first.")
    model = joblib.load(path)["model"]
    inner = model.estimator if isinstance(model, ThresholdClassifier) else model
    if isinstance(inner, YearRankClassifier):
        # It ranks a prediction against the other offerings of the same year,
        # which do not exist for a single future offering.
        raise ValueError(f"the saved '{task_name}' model ranks within a year and cannot score one offering")
    return model


def _recent(rows: pd.DataFrame) -> pd.DataFrame:
    """The course's own last N years (so courses that paused still get instructors)."""
    return rows[rows["year"] > rows["year"].max() - config.FORECAST_INSTRUCTOR_YEARS]


def _usual_format(sched_type: str) -> str:
    return "online" if sched_type in config.ONLINE_SCHED_TYPES else "in-person"


def _sched_type(usual: str, fmt: str, recent: pd.DataFrame) -> str:
    """Schedule type for the requested format, keeping the usual one when it already matches."""
    if not fmt or _usual_format(usual) == fmt:
        return usual
    if fmt == "online":
        return ONLINE_SCHED_TYPE
    in_person = recent.loc[~recent["sched_type"].isin(config.ONLINE_SCHED_TYPES), "sched_type"]
    return in_person.mode().iat[0] if len(in_person) else IN_PERSON_SCHED_TYPE


def _weighted(values: np.ndarray, weights: np.ndarray) -> np.ndarray:
    return np.average(values, axis=0, weights=weights)


class Forecaster:
    """Loads the data and the four saved models once; answers forecast requests."""

    def __init__(self):
        self.offerings = pd.read_csv(config.OFFERINGS_FILE)
        self.catalog = pd.read_csv(config.CATALOG_COURSES_FILE)
        self.models = {name: _load_model(name) for name in TASKS}
        self.threshold = getattr(self.models["high_risk"], "threshold", 0.5)

        last = self.offerings.loc[self.offerings["term_index"].idxmax()]
        self.data_until = f"{last['term']} {last['year']}"
        self.next_index = int(last["term_index"]) + 1
        self.terms = {t.key: t for t in upcoming_terms(int(last["year"]), last["term"])}
        self.courses = dict(tuple(self.offerings.groupby("course_id", sort=False)))
        self.instructors = set(self.offerings["instructor"])

        self._lock = threading.Lock()  # one feature build at a time (CPU bound)
        self.predict = lru_cache(maxsize=config.FORECAST_CACHE_SIZE)(self._predict)
        log.info("forecaster ready: %d courses, data until %s, terms %s",
                 len(self.courses), self.data_until, ", ".join(self.terms))

    # ------------------------------------------------------------------ #
    # Lookups
    # ------------------------------------------------------------------ #
    def info(self) -> dict:
        return {"dataUntil": self.data_until, "terms": [t.as_dict() for t in self.terms.values()],
                "highRiskThreshold": round(self.threshold, 4)}

    def _course_rows(self, course_id: str) -> pd.DataFrame:
        if course_id not in self.courses:
            raise KeyError(f"unknown course '{course_id}'")
        return self.courses[course_id]

    def _instructor_weights(self, recent: pd.DataFrame, instructor: str | None) -> pd.Series:
        """Students per instructor in the course's recent years ("Any instructor"), or one instructor."""
        if instructor:
            if instructor not in self.instructors:
                raise KeyError(f"unknown instructor '{instructor}'")
            return pd.Series({instructor: 1.0})
        return recent.groupby("instructor")["graded"].sum().astype(float)

    def options(self, course_id: str) -> dict:
        recent = _recent(self._course_rows(course_id))
        students = self._instructor_weights(recent, None).drop(config.UNKNOWN, errors="ignore")
        return {
            "course": course_id,
            **self.info(),
            "instructors": [{"name": name, "students": int(n)} for name, n in students.sort_values(ascending=False).items()],
            "usualFormat": _usual_format(recent["sched_type"].mode().iat[0]),
        }

    # ------------------------------------------------------------------ #
    # Prediction
    # ------------------------------------------------------------------ #
    def _empty_offering(self, rows: pd.DataFrame, recent: pd.DataFrame, instructor: str, term: Term, fmt: str) -> dict:
        """A future offering, copied from the instructor's (or the course's) latest one."""
        own = rows[rows["instructor"] == instructor]
        row = (own if len(own) else rows).iloc[-1].to_dict()
        row.update(dict.fromkeys(EMPTY_COUNTS, 0))
        row.update(dict.fromkeys(EMPTY_TARGETS, np.nan))
        sched_type = _sched_type(row["sched_type"], fmt, recent)
        row.update(year=term.year, term=term.name, year_term=term.key, term_index=self.next_index,
                   instructor=instructor, sched_type=sched_type,
                   is_online=int(sched_type in config.ONLINE_SCHED_TYPES))
        return row

    def _features(self, offerings: list[dict]) -> pd.DataFrame:
        table = pd.concat([self.offerings, pd.DataFrame(offerings)], ignore_index=True)
        with self._lock:
            features = build_features(table, self.catalog)
        return features[features["term_index"] == self.next_index].reset_index(drop=True)

    def _predict(self, course_id: str, term_key: str, instructor: str = "", fmt: str = "") -> dict:
        if term_key not in self.terms:
            raise ValueError(f"term must be one of {', '.join(self.terms)}")
        if fmt not in FORMATS:
            raise ValueError("format must be 'in-person' or 'online'")
        term = self.terms[term_key]
        rows = self._course_rows(course_id)
        recent = _recent(rows)
        weights = self._instructor_weights(recent, instructor or None)

        X = self._features([self._empty_offering(rows, recent, name, term, fmt) for name in weights.index])
        w = weights.loc[X["instructor"]].to_numpy()
        gpa = np.clip(self.models["gpa"].predict(X), 0, 4)
        dfw = np.clip(self.models["dfw"].predict(X), 0, 1)
        difficulty = self.models["difficulty"].predict_proba(X)
        risk = self.models["high_risk"].predict_proba(X)[:, 1]

        classes = config.DIFFICULTY_CLASSES
        mean_difficulty = _weighted(difficulty, w)
        mean_risk = float(_weighted(risk, w))
        return {
            "course": course_id,
            "term": term.as_dict(),
            "instructor": instructor or None,
            "format": fmt or None,
            "dataUntil": self.data_until,
            "gpa": round(float(_weighted(gpa, w)), 3),
            "dfw": round(100 * float(_weighted(dfw, w)), 2),
            "difficulty": classes[int(np.argmax(mean_difficulty))],
            "difficultyProbabilities": {c: round(float(p), 3) for c, p in zip(classes, mean_difficulty)},
            "highRisk": mean_risk >= self.threshold,
            "highRiskProbability": round(mean_risk, 3),
            # A chosen instructor who never taught this course: the model leans on course + instructor history.
            "newPair": bool(instructor and X["is_new_pair"].iat[0]),
            "sections": [
                {
                    "instructor": name,
                    "weight": round(float(weight / w.sum()), 3),
                    "gpa": round(float(g), 3),
                    "dfw": round(100 * float(d), 2),
                    "difficulty": classes[int(np.argmax(p))],
                    "highRisk": bool(r >= self.threshold),
                }
                for name, weight, g, d, p, r in zip(X["instructor"], w, gpa, dfw, difficulty, risk)
            ],
        }
