"""Historical features that only look at strictly earlier terms.

For a row in term t, every value here is computed from terms < t, so the
model never sees the grades of the term it is predicting (no leakage).

The trick used throughout: aggregate per (group, term), then take a
cumulative sum within the group and subtract the current term's value.
That leaves the total of all *earlier* terms.
"""

import numpy as np
import pandas as pd

from . import config

GLOBAL_KEY = "_all"

# per-term total name -> source column in the offerings table
SUM_COLUMNS = {
    "points": "grade_points",
    "graded": "graded",
    "dfw": "dfw_count",
    "enrolled": "enrolled",
    "sections": "n_sections",
    "count_A": "count_A",
    "count_F": "count_F",
    "withdrawn": "withdrawn",
    "dev_points": "dev_points",
}


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _safe_divide(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator / denominator.where(denominator > 0)


def _past_sum(totals: pd.DataFrame, keys: list[str], column: str) -> pd.Series:
    """Sum of `column` over all earlier terms of the same group."""
    return totals.groupby(keys, sort=False)[column].cumsum() - totals[column]


def _per_term_totals(df: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    aggregations = {name: (source, "sum") for name, source in SUM_COLUMNS.items()}
    totals = df.groupby(keys + ["term_index"], sort=True).agg(**aggregations).reset_index()
    totals["term_gpa"] = _safe_divide(totals["points"], totals["graded"])
    totals["term_dev"] = _safe_divide(totals["dev_points"], totals["graded"])
    totals["term_dfw"] = _safe_divide(totals["dfw"], totals["enrolled"])
    return totals


def _past_ewm(totals: pd.DataFrame, keys: list[str], column: str) -> pd.Series:
    """Recency-weighted mean of earlier terms (recent offerings count more)."""
    ewm = (
        totals.groupby(keys, sort=False)[column]
        .ewm(halflife=config.EWM_HALFLIFE_OFFERINGS, ignore_na=True)
        .mean()
        .reset_index(level=list(range(len(keys))), drop=True)
        .sort_index()
    )
    return ewm.groupby([totals[k] for k in keys], sort=False).shift()


def _past_recent_mean(totals: pd.DataFrame, keys: list[str], column: str, window: int) -> pd.Series:
    """Mean of `column` over the last `window` earlier terms of the group."""
    groups = [totals[k] for k in keys]
    cumulative = totals[column].fillna(0).groupby(groups).cumsum()
    count = totals[column].notna().astype(int).groupby(groups).cumsum()
    frame = totals[keys].assign(_cum=cumulative, _cnt=count)
    grouped = frame.groupby(keys, sort=False)
    sum_recent = grouped["_cum"].shift(1) - grouped["_cum"].shift(window + 1).fillna(0)
    cnt_recent = grouped["_cnt"].shift(1) - grouped["_cnt"].shift(window + 1).fillna(0)
    return _safe_divide(sum_recent, cnt_recent)


def _past_std(totals: pd.DataFrame, keys: list[str], n_past: pd.Series) -> pd.Series:
    """Standard deviation of past term GPAs (how stable the group is)."""
    groups = [totals[k] for k in keys]
    gpa = totals["term_gpa"].fillna(0)
    sum_x = gpa.groupby(groups).cumsum() - gpa
    sum_x2 = (gpa**2).groupby(groups).cumsum() - gpa**2
    n = n_past.where(n_past >= 2).astype(float)
    return np.sqrt((sum_x2 / n - (sum_x / n) ** 2).clip(lower=0))


# --------------------------------------------------------------------------- #
# Group history
# --------------------------------------------------------------------------- #
def group_history(df: pd.DataFrame, keys: list[str], prefix: str, detailed: bool = False) -> pd.DataFrame:
    """Past statistics of every (group, term) pair.

    Returns one row per (keys, term_index) with columns named `<prefix>_*`.
    """
    totals = _per_term_totals(df, keys)
    grouped = totals.groupby(keys, sort=False)
    past = {name: _past_sum(totals, keys, name) for name in SUM_COLUMNS}
    n_past = grouped.cumcount()

    out = totals[keys + ["term_index"]].copy()
    out[f"{prefix}_n_past_terms"] = n_past
    out[f"{prefix}_past_students"] = past["graded"]
    out[f"{prefix}_past_enrolled"] = past["enrolled"]
    out[f"{prefix}_past_gpa"] = _safe_divide(past["points"], past["graded"])
    out[f"{prefix}_past_dev"] = _safe_divide(past["dev_points"], past["graded"])
    out[f"{prefix}_past_dfw"] = _safe_divide(past["dfw"], past["enrolled"])
    out[f"{prefix}_past_share_A"] = _safe_divide(past["count_A"], past["graded"])
    out[f"{prefix}_past_fail_rate"] = _safe_divide(past["count_F"], past["graded"])
    out[f"{prefix}_past_w_rate"] = _safe_divide(past["withdrawn"], past["enrolled"])
    out[f"{prefix}_last_gpa"] = grouped["term_gpa"].shift()
    out[f"{prefix}_ewm_gpa"] = _past_ewm(totals, keys, "term_gpa")
    out[f"{prefix}_ewm_dev"] = _past_ewm(totals, keys, "term_dev")
    out[f"{prefix}_ewm_dfw"] = _past_ewm(totals, keys, "term_dfw")
    out[f"{prefix}_terms_since_last"] = totals["term_index"] - grouped["term_index"].shift()

    if detailed:
        out[f"{prefix}_recent_gpa"] = _past_recent_mean(totals, keys, "term_gpa", config.RECENT_OFFERINGS)
        out[f"{prefix}_past_gpa_std"] = _past_std(totals, keys, n_past)
        out[f"{prefix}_past_avg_size"] = _safe_divide(past["graded"], past["sections"])
        out[f"{prefix}_past_sections_per_term"] = _safe_divide(past["sections"], n_past.astype(float))
    return out


def course_past_instructors(df: pd.DataFrame) -> pd.DataFrame:
    """Number of different instructors who taught the course before term t."""
    first_term = df.groupby(["course_id", "instructor"])["term_index"].min().reset_index()
    new_per_term = first_term.groupby(["course_id", "term_index"]).size().rename("new")
    course_terms = df[["course_id", "term_index"]].drop_duplicates().sort_values(["course_id", "term_index"])
    course_terms = course_terms.join(new_per_term, on=["course_id", "term_index"]).fillna({"new": 0})
    course_terms["crs_past_instructors"] = _past_sum(course_terms, ["course_id"], "new")
    return course_terms.drop(columns="new")


def instructor_offset(df: pd.DataFrame) -> pd.DataFrame:
    """How much higher/lower the instructor graded than each course's history.

    For every past row of the instructor, residual = row GPA - course past GPA
    (both known at that time). The feature is the mean residual so far.
    Requires the column `crs_past_gpa`.
    """
    residual = df["avg_gpa"] - df["crs_past_gpa"]
    frame = df[["instructor", "term_index"]].assign(
        resid_sum=residual.fillna(0), resid_n=residual.notna().astype(int)
    )
    totals = frame.groupby(["instructor", "term_index"], sort=True).sum().reset_index()
    totals["ins_offset_n"] = _past_sum(totals, ["instructor"], "resid_n")
    totals["ins_grading_offset"] = _safe_divide(_past_sum(totals, ["instructor"], "resid_sum"), totals["ins_offset_n"])
    return totals[["instructor", "term_index", "ins_grading_offset", "ins_offset_n"]]


def university_level(df: pd.DataFrame) -> pd.DataFrame:
    """University GPA of the previous term of the same type (Fall -> last Fall).

    Summer and Fall grade differently, so last year's same term is a better
    estimate of the coming term's level than the term right before it.
    """
    term = df.groupby(["term_index", "term"])[["grade_points", "graded"]].sum().reset_index()
    term["gpa"] = _safe_divide(term["grade_points"], term["graded"])
    term["glob_same_term_last_gpa"] = term.sort_values("term_index").groupby("term")["gpa"].shift()
    return term[["term_index", "glob_same_term_last_gpa"]]


def _add_term_deviation(df: pd.DataFrame) -> pd.DataFrame:
    """dev_points = (row GPA - that term's university GPA) x students.

    History built on deviations is free of grade inflation: a course that is
    always 0.3 below the university average stays "-0.3" in every year.
    The current term's own deviation is never used for that same term.
    """
    term = df.groupby("term_index")[["grade_points", "graded"]].transform("sum")
    term_gpa = _safe_divide(term["grade_points"], term["graded"])
    df["dev_points"] = ((df["avg_gpa"] - term_gpa) * df["graded"]).fillna(0)
    return df


def add_history_features(df: pd.DataFrame) -> pd.DataFrame:
    """Attach all course / instructor / pair / subject / global history."""
    df = _add_term_deviation(df.assign(**{GLOBAL_KEY: 0}))
    specs = [
        (["course_id"], "crs", True),
        (["instructor"], "ins", False),
        (["course_id", "instructor"], "pair", False),
        (["subject"], "sub", False),
        (["subject", "level"], "sublvl", False),
        ([GLOBAL_KEY], "glob", True),
    ]
    for keys, prefix, detailed in specs:
        df = df.merge(group_history(df, keys, prefix, detailed=detailed), on=keys + ["term_index"], how="left")

    df = df.merge(course_past_instructors(df), on=["course_id", "term_index"], how="left")
    df = df.merge(instructor_offset(df), on=["instructor", "term_index"], how="left")
    df = df.merge(university_level(df), on="term_index", how="left")
    df = _blank_unknown_instructor(df)
    return df.drop(columns=[GLOBAL_KEY, "dev_points"]).copy()  # copy() de-fragments the frame


def _blank_unknown_instructor(df: pd.DataFrame) -> pd.DataFrame:
    """'Unknown' is not one person, so its instructor history is meaningless."""
    unknown = df["instructor"] == config.UNKNOWN
    columns = [c for c in df.columns if c.startswith(("ins_", "pair_"))]
    df.loc[unknown, columns] = np.nan
    return df
