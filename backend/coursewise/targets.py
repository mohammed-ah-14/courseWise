"""Targets computed from grade counts (never used as model inputs).

    Average GPA = sum(count x points) / graded          (graded excludes W)
    DFW rate    = (D+ + D + D- + F + W) / (graded + W)
"""

import numpy as np
import pandas as pd

from . import config


def add_targets(offerings: pd.DataFrame) -> pd.DataFrame:
    df = offerings.copy()
    points = np.array([config.GRADE_POINTS[g] for g in config.GRADE_COLUMNS])

    df["grade_points"] = df[config.GRADE_COLUMNS].to_numpy() @ points
    df["dfw_count"] = df[config.DFW_GRADE_COLUMNS].sum(axis=1) + df["withdrawn"]
    df["enrolled"] = df["graded"] + df["withdrawn"]
    df["count_A"] = df[config.LETTER_GROUPS["share_A"]].sum(axis=1)
    df["count_F"] = df["F"]

    df["avg_gpa"] = df["grade_points"] / df["graded"]
    df["dfw_rate"] = df["dfw_count"] / df["enrolled"]
    return df


def add_labels(df: pd.DataFrame) -> pd.DataFrame:
    """Difficulty terciles and high-risk flag, relative to the same year.

    Cut points are computed per year because of grade inflation; with
    fixed cut points almost every recent course would be "Easy".
    """
    df = df.copy()
    by_year = df.groupby("year")

    gpa_rank = by_year["avg_gpa"].rank(pct=True, method="average")
    # 0 = Hard (bottom third), 1 = Medium, 2 = Easy (top third)
    df["difficulty_code"] = np.select(
        [gpa_rank <= 1 / 3, gpa_rank <= 2 / 3], [0, 1], default=2
    )
    df["difficulty"] = df["difficulty_code"].map(dict(enumerate(config.DIFFICULTY_CLASSES)))

    dfw_cut = by_year["dfw_rate"].transform(lambda s: s.quantile(config.HIGH_RISK_QUANTILE))
    df["high_risk"] = (df["dfw_rate"] > dfw_cut).astype(int)

    # Position within the year (0 = lowest, 1 = highest). Used by the
    # "rank" models, which predict this number and then cut it into classes.
    df["gpa_pct"] = gpa_rank
    df["dfw_pct"] = by_year["dfw_rate"].rank(pct=True, method="average")
    return df
