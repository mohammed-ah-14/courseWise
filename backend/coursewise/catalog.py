"""Course catalog: credit hours and Gen-Ed categories per course.

The catalog only exists from Fall 2016, but credit hours and Gen-Ed rarely
change, so each course keeps the values from its latest catalog entry and
those values are joined to every year of the GPA data.
"""

import re
from pathlib import Path

import pandas as pd

from .utils import log, read_csv_any_encoding

CATALOG_COLUMNS = ["Year", "Term", "Subject", "Number", "Credit Hours", "Degree Attributes"]

# feature name -> text found in the "Degree Attributes" column
GENED_PATTERNS = {
    "gened_humanities": "Humanities",
    "gened_natural_science": "Nat Sci & Tech",
    "gened_social_science": "Social & Beh Sci",
    "gened_quantitative": "Quantitative Reasoning",
    "gened_composition": "Composition",
    "gened_cultural": "Cultural Studies",
}
GENED_COLUMNS = list(GENED_PATTERNS)
CATALOG_FEATURES = ["credit_hours"] + GENED_COLUMNS

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def parse_credit_hours(text) -> float:
    """'3 hours.' -> 3, '3 OR 4 hours.' -> 3.5, '1 TO 4 hours.' -> 2.5."""
    if not isinstance(text, str):
        return float("nan")
    values = [float(v) for v in _NUMBER.findall(text)]
    return sum(values) / len(values) if values else float("nan")


def _read_catalog_files(catalog_dir: Path) -> pd.DataFrame:
    files = sorted(catalog_dir.glob("*.csv"))
    if not files:
        log.warning("no catalog files in %s; catalog features will be empty", catalog_dir)
        return pd.DataFrame(columns=CATALOG_COLUMNS)
    log.info("reading %d catalog files", len(files))
    frames = [read_csv_any_encoding(path, usecols=CATALOG_COLUMNS) for path in files]
    return pd.concat(frames, ignore_index=True)


def build_catalog_courses(catalog_dir: Path) -> pd.DataFrame:
    """One row per course (subject, number) with catalog features."""
    raw = _read_catalog_files(catalog_dir)
    if raw.empty:
        return pd.DataFrame(columns=["subject", "number"] + CATALOG_FEATURES)

    raw = raw.sort_values("Year").drop_duplicates(["Subject", "Number"], keep="last")
    attributes = raw["Degree Attributes"].fillna("")

    courses = pd.DataFrame({
        "subject": raw["Subject"].astype(str).str.strip(),
        "number": raw["Number"].astype(int),
        "credit_hours": raw["Credit Hours"].map(parse_credit_hours),
    })
    for column, pattern in GENED_PATTERNS.items():
        courses[column] = attributes.str.contains(pattern, regex=False).astype(int)
    return courses.reset_index(drop=True)


def join_catalog(df: pd.DataFrame, catalog_courses: pd.DataFrame) -> pd.DataFrame:
    """Left-join catalog features; courses missing from the catalog get NaN."""
    merged = df.merge(catalog_courses, on=["subject", "number"], how="left")
    merged["in_catalog"] = merged["credit_hours"].notna().astype(int)
    merged[GENED_COLUMNS] = merged[GENED_COLUMNS].fillna(0).astype(int)
    return merged
