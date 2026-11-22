"""Load the raw UIUC GPA file, clean it, and merge sections into offerings.

One *offering* = one course, taught by one instructor, in one term.
All sections of the same offering are added together.
"""

from pathlib import Path

import pandas as pd

from . import config

RAW_COLUMN_NAMES = {
    "Year": "year",
    "Term": "term",
    "YearTerm": "year_term",
    "Subject": "subject",
    "Number": "number",
    "Course Title": "title",
    "Sched Type": "sched_type",
    "Students": "graded",  # = sum of A+..F, does NOT include W
    "W": "withdrawn",
    "Primary Instructor": "instructor",
}

OFFERING_KEYS = [
    "year", "term", "year_term", "term_index",
    "subject", "number", "course_id", "instructor",
]
COUNT_COLUMNS = config.GRADE_COLUMNS + ["withdrawn", "graded"]


def load_raw_grades(path: Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding=config.GPA_ENCODING)


def normalize_instructor(name) -> str:
    """'Siglos, David G' -> 'Siglos, David' (drops middle initials).

    The same person sometimes appears with and without a middle initial,
    so keeping only last name + first given name merges those spellings.
    """
    if not isinstance(name, str) or not name.strip():
        return config.UNKNOWN
    last, _, given = name.partition(",")
    first_given = given.split()[0] if given.split() else ""
    full = f"{last.strip()}, {first_given}" if first_given else last.strip()
    return full.title()


def _add_term_index(df: pd.DataFrame) -> pd.DataFrame:
    """Give every term a sequential number so history can look strictly back."""
    term_order = df["term"].map(config.TERM_ORDER)
    sort_key = df["year"] * 10 + term_order
    df["term_index"] = sort_key.rank(method="dense").astype(int)
    return df


def clean_grades(raw: pd.DataFrame) -> pd.DataFrame:
    df = raw.rename(columns=RAW_COLUMN_NAMES).drop_duplicates()
    df = df[df["graded"] > 0].copy()

    for column in ("subject", "title", "term", "year_term"):
        df[column] = df[column].astype(str).str.strip()
    df["sched_type"] = df["sched_type"].fillna(config.UNKNOWN).str.strip()
    df["instructor"] = df["instructor"].map(normalize_instructor)
    df["number"] = df["number"].astype(int)
    df["course_id"] = df["subject"] + df["number"].astype(str)
    df["is_online"] = df["sched_type"].isin(config.ONLINE_SCHED_TYPES).astype(int)
    return _add_term_index(df).reset_index(drop=True)


def aggregate_offerings(clean: pd.DataFrame) -> pd.DataFrame:
    """Merge sections into one row per course + instructor + term.

    Title and schedule type are taken from the largest section.
    """
    ordered = clean.sort_values("graded", ascending=False)
    grouped = ordered.groupby(OFFERING_KEYS, sort=False)

    counts = grouped[COUNT_COLUMNS].sum()
    meta = grouped.agg(
        title=("title", "first"),
        sched_type=("sched_type", "first"),
        is_online=("is_online", "max"),
        n_sections=("graded", "size"),
    )
    offerings = counts.join(meta).reset_index()
    return offerings.sort_values(["term_index", "course_id", "instructor"]).reset_index(drop=True)
