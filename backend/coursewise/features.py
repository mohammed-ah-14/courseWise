"""Build the model-ready feature table and define the feature columns."""

import numpy as np
import pandas as pd

from . import config
from .catalog import CATALOG_FEATURES, join_catalog
from .history import add_history_features
from .subjects import department_group

TITLE_KEYWORDS = {
    "title_intro": r"\bintro|introduct|elementary|fundamental|principles|basic",
    "title_advanced": r"\badv|advanced|intermediate",
    "title_lab": r"\blab",
    "title_seminar": r"seminar|colloquium|workshop|practicum",
    "title_topics": r"\btopics?\b",
    "title_research": r"research|thesis|independent|individual|project",
    "title_honors": r"honors",
    "title_math_heavy": r"calculus|analysis|algebra|statistic|probability|mechanics|physics",
}

# --------------------------------------------------------------------------- #
# Feature columns (the only columns the models are allowed to see)
# --------------------------------------------------------------------------- #
COURSE_FEATURES = ["number", "level", *TITLE_KEYWORDS, *CATALOG_FEATURES, "in_catalog"]
TERM_FEATURES = ["year", "is_covid"]
CLASS_FEATURES = ["n_sections", "is_online"]

_CORE_STATS = [
    "n_past_terms", "past_students", "past_gpa", "past_dev", "past_dfw",
    "past_share_A", "past_fail_rate", "past_w_rate", "last_gpa", "ewm_dev",
    "ewm_dfw", "terms_since_last",
]


def _history(prefix: str, stats: list[str]) -> list[str]:
    return [f"{prefix}_{stat}" for stat in stats]


HISTORY_FEATURES = [
    *_history("crs", _CORE_STATS + [
        "ewm_gpa", "recent_gpa", "past_gpa_std", "past_avg_size",
        "past_sections_per_term", "past_instructors",
    ]),
    *_history("ins", _CORE_STATS + ["grading_offset", "offset_n"]),
    *_history("pair", _CORE_STATS),
    *_history("sub", ["past_gpa", "past_dev", "past_dfw", "past_w_rate"]),
    *_history("sublvl", ["past_gpa", "past_dev", "past_dfw"]),
    *_history("glob", ["past_gpa", "recent_gpa", "ewm_gpa", "same_term_last_gpa"]),
    "is_new_course", "is_new_instructor", "is_new_pair",
    "best_guess_gpa", "best_guess_dfw", "adjusted_guess_gpa",
    "sub_shrunk_dev", "crs_shrunk_dev", "pair_shrunk_dev", "ins_shrunk_offset",
    "shrunk_guess_gpa", "shrunk_guess_dfw",
]
NUMERIC_FEATURES = COURSE_FEATURES + TERM_FEATURES + CLASS_FEATURES + HISTORY_FEATURES
LOW_CARD_CATEGORICAL = ["term", "sched_type", "dept_group"]
HIGH_CARD_CATEGORICAL = ["subject", "instructor"]
CATEGORICAL_FEATURES = LOW_CARD_CATEGORICAL + HIGH_CARD_CATEGORICAL
ALL_FEATURES = NUMERIC_FEATURES + CATEGORICAL_FEATURES

ID_COLUMNS = ["year", "term", "year_term", "term_index", "course_id", "title"]
TARGET_COLUMNS = [
    "avg_gpa", "dfw_rate", "difficulty_code", "difficulty", "high_risk",
    "gpa_pct", "dfw_pct", "graded", "enrolled",
]


def _add_descriptors(df: pd.DataFrame) -> pd.DataFrame:
    df["level"] = (df["number"] // 100 * 100).clip(0, 700)
    df["is_covid"] = df["year"].isin(config.COVID_YEARS).astype(int)
    df["dept_group"] = df["subject"].map(department_group)
    title = df["title"].str.lower()
    for column, pattern in TITLE_KEYWORDS.items():
        df[column] = title.str.contains(pattern, regex=True).astype(int)
    return df


def _first_available(df: pd.DataFrame, columns: list[str]) -> pd.Series:
    """Most specific history value that exists (pair -> course -> subject -> global)."""
    result = df[columns[0]]
    for column in columns[1:]:
        result = result.fillna(df[column])
    return result


def _fallback_features(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Simple "most specific past average" guesses and new-course flags."""
    course_guess = _first_available(df, ["crs_past_gpa", "sub_past_gpa", "glob_past_gpa"])
    return {
        "is_new_course": (df["crs_n_past_terms"].fillna(0) == 0).astype(int),
        "is_new_instructor": (df["ins_n_past_terms"].fillna(0) == 0).astype(int),
        "is_new_pair": (df["pair_n_past_terms"].fillna(0) == 0).astype(int),
        "best_guess_gpa": _first_available(df, ["pair_past_gpa", "crs_past_gpa", "sub_past_gpa", "glob_past_gpa"]),
        "best_guess_dfw": _first_available(df, ["pair_past_dfw", "crs_past_dfw", "sub_past_dfw", "glob_past_dfw"]),
        "adjusted_guess_gpa": (course_guess + df["ins_grading_offset"].fillna(0)).clip(0, 4),
    }


def _shrink(value: pd.Series, n: pd.Series, prior: pd.Series | float, strength: float) -> pd.Series:
    """Empirical-Bayes style estimate: (n * value + k * prior) / (n + k).

    With few past students the estimate stays near the prior (the parent
    group); with many students it trusts the group's own history.
    """
    n = n.fillna(0)
    prior = pd.Series(prior, index=value.index) if np.isscalar(prior) else prior
    return (n * value.fillna(prior) + strength * prior) / (n + strength)


def _shrunk_features(df: pd.DataFrame) -> dict[str, pd.Series]:
    """Shrink noisy history step by step: university -> subject -> level -> course -> pair.

    GPA works on deviations from the university average (inflation-free),
    recency-weighted for course and pair; the guess adds back the university
    level of the same term type last year. Settings were chosen on the
    training years (see config: EWM_HALFLIFE_OFFERINGS, SHRINK_STUDENTS).
    """
    k = config.SHRINK_STUDENTS
    sub_dev = _shrink(df["sub_past_dev"], df["sub_past_students"], 0.0, k)
    sublvl_dev = _shrink(df["sublvl_past_dev"], df["sublvl_past_students"], sub_dev, k)
    crs_dev = _shrink(df["crs_ewm_dev"], df["crs_past_students"], sublvl_dev, k)
    pair_dev = _shrink(df["pair_ewm_dev"], df["pair_past_students"], crs_dev, k)

    offset_n = df["ins_offset_n"].fillna(0)
    ins_offset = df["ins_grading_offset"].fillna(0) * offset_n / (offset_n + config.SHRINK_OFFSET_ROWS)
    pair_students = df["pair_past_students"].fillna(0)
    pair_weight = pair_students / (pair_students + k)
    level = df["glob_same_term_last_gpa"].fillna(df["glob_ewm_gpa"])

    sub_dfw = _shrink(df["sub_past_dfw"], df["sub_past_enrolled"], df["glob_past_dfw"], k)
    crs_dfw = _shrink(df["crs_ewm_dfw"], df["crs_past_enrolled"], sub_dfw, k)
    return {
        "sub_shrunk_dev": sub_dev,
        "crs_shrunk_dev": crs_dev,
        "pair_shrunk_dev": pair_dev,
        "ins_shrunk_offset": ins_offset,
        # The instructor offset only matters when the pair itself has little history.
        "shrunk_guess_gpa": (level + pair_dev + (1 - pair_weight) * ins_offset).clip(0, 4),
        "shrunk_guess_dfw": _shrink(df["pair_ewm_dfw"], df["pair_past_enrolled"], crs_dfw, k),
    }


def build_features(offerings: pd.DataFrame, catalog_courses: pd.DataFrame) -> pd.DataFrame:
    """Offerings with targets -> full table (ids + targets + features)."""
    df = _add_descriptors(offerings.copy())
    df = join_catalog(df, catalog_courses)
    df = add_history_features(df)
    df = df.assign(**_fallback_features(df))
    df = df.assign(**_shrunk_features(df))
    df[LOW_CARD_CATEGORICAL + HIGH_CARD_CATEGORICAL] = (
        df[LOW_CARD_CATEGORICAL + HIGH_CARD_CATEGORICAL].astype(str)
    )
    columns = list(dict.fromkeys(ID_COLUMNS + TARGET_COLUMNS + ALL_FEATURES))
    return df[columns].replace([np.inf, -np.inf], np.nan)
