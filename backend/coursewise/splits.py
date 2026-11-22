"""Time-based train / validation / test split and year-based CV folds."""

import numpy as np
import pandas as pd

from . import config


def _between(years: pd.Series, bounds: tuple[int, int]) -> pd.Series:
    return years.between(*bounds)


def split_by_years(df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """2005-2009 rows are dropped here: they only fed the history features."""
    return {
        "train": df[_between(df["year"], config.TRAIN_YEARS)].reset_index(drop=True),
        "val": df[_between(df["year"], config.VAL_YEARS)].reset_index(drop=True),
        "test": df[_between(df["year"], config.TEST_YEARS)].reset_index(drop=True),
    }


def expanding_year_folds(years: pd.Series, fold_years=config.CV_FOLD_YEARS):
    """Expanding-window CV: train on all years before Y, validate on Y.

    Returns positional (train_idx, val_idx) pairs usable as `cv=` in sklearn.
    """
    years = np.asarray(years)
    folds = []
    for year in fold_years:
        train_idx = np.flatnonzero(years < year)
        val_idx = np.flatnonzero(years == year)
        if len(train_idx) and len(val_idx):
            folds.append((train_idx, val_idx))
    return folds
