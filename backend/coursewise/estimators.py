"""Custom sklearn-compatible estimators used by the model registry.

- HistoryBaseline      regression baseline: a past-average column as prediction
- YearRankClassifier   ranks a score within each year and cuts it into classes
                       (history baseline for classification, and "derived"
                       classifiers built on top of a regression model)
- ResidualRegressor    learns the correction to a history guess (handles grade
                       inflation, which tree models cannot extrapolate)
- AveragingRegressor   mean of several regressors (ensemble)
- ThresholdClassifier  binary classifier with a tuned decision threshold
- CatBoost wrappers    sklearn-clone-safe CatBoost
"""

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin, RegressorMixin, clone

from . import config
from .features import CATEGORICAL_FEATURES


# --------------------------------------------------------------------------- #
# Ranking helpers
# --------------------------------------------------------------------------- #
def rank_within_year(scores, years) -> np.ndarray:
    """Percentile (0-1] of each score among the scores of the same year."""
    return pd.Series(np.asarray(scores, dtype=float)).groupby(np.asarray(years)).rank(pct=True).to_numpy()


def cut_ranks(ranks: np.ndarray, cuts: tuple[float, ...]) -> np.ndarray:
    """Rank <= cuts[0] -> class 0, <= cuts[1] -> class 1, ... (same rule as the labels)."""
    return np.searchsorted(np.asarray(cuts), ranks, side="left")


# --------------------------------------------------------------------------- #
# Baselines and derived classifiers
# --------------------------------------------------------------------------- #
class HistoryBaseline(RegressorMixin, BaseEstimator):
    """Predict a past-average column (e.g. pair -> course -> subject GPA)."""

    def __init__(self, column: str = "best_guess_gpa"):
        self.column = column

    def fit(self, X, y, sample_weight=None):
        self.fallback_ = float(np.mean(y))
        return self

    def predict(self, X):
        return X[self.column].fillna(self.fallback_).to_numpy()


class YearRankClassifier(ClassifierMixin, BaseEstimator):
    """Rank a score within each year, then cut the ranks into classes.

    The score is either a column of X (`column`, used as the history
    baseline) or the prediction of a fitted regressor (`source`, used to
    derive Easy/Medium/Hard from the GPA model). Ranking within the year
    matches how the labels are defined. It only needs the predictions of
    the other courses of that year, never their true grades.
    """

    def __init__(self, cuts: tuple[float, ...] = (1 / 3, 2 / 3), column: str | None = None, source=None):
        self.cuts = cuts
        self.column = column
        self.source = source

    def fit(self, X, y, sample_weight=None):
        self.classes_ = np.arange(len(self.cuts) + 1)
        return self

    def _ranks(self, X) -> np.ndarray:
        scores = self.source.predict(X) if self.source is not None else X[self.column].fillna(X[self.column].median())
        return rank_within_year(scores, X["year"])

    def predict(self, X):
        return cut_ranks(self._ranks(X), self.cuts)

    def predict_proba(self, X):
        ranks = self._ranks(X)
        if len(self.cuts) == 1:  # binary: the rank itself is the positive score
            return np.column_stack([1 - ranks, ranks])
        return np.eye(len(self.cuts) + 1)[cut_ranks(ranks, self.cuts)]


# --------------------------------------------------------------------------- #
# Meta-estimators
# --------------------------------------------------------------------------- #
class ResidualRegressor(RegressorMixin, BaseEstimator):
    """Fit `estimator` on y - X[base_column]; predict X[base_column] + correction.

    The history guess already follows grade inflation, so the model only has
    to learn a correction whose range does not drift over the years.
    """

    def __init__(self, estimator, base_column: str):
        self.estimator = estimator
        self.base_column = base_column

    def _base(self, X) -> np.ndarray:
        return X[self.base_column].to_numpy(dtype=float)

    def fit(self, X, y, **fit_params):
        residual = np.asarray(y, dtype=float) - self._base(X)
        self.estimator_ = clone(self.estimator).fit(X, residual, **fit_params)
        return self

    def predict(self, X):
        return self._base(X) + self.estimator_.predict(X)


class AveragingRegressor(RegressorMixin, BaseEstimator):
    """Mean prediction of several regressors."""

    def __init__(self, estimators: list):
        self.estimators = estimators

    def fit(self, X, y, **fit_params):
        self.estimators_ = [clone(e).fit(X, y, **fit_params) for e in self.estimators]
        return self

    @classmethod
    def from_fitted(cls, fitted: list) -> "AveragingRegressor":
        ensemble = cls(estimators=fitted)
        ensemble.estimators_ = fitted
        return ensemble

    def predict(self, X):
        return np.mean([e.predict(X) for e in self.estimators_], axis=0)


class ThresholdClassifier(ClassifierMixin, BaseEstimator):
    """Wrap a fitted binary classifier: predict "Yes" when P(Yes) >= threshold.

    The default cut-off of 0.5 is rarely best for a 20% minority class; the
    threshold is chosen on the validation years (see metrics.best_f1_threshold).
    Probabilities are passed through unchanged, so ROC-AUC / PR-AUC do not move.
    """

    def __init__(self, estimator, threshold: float = 0.5):
        self.estimator = estimator
        self.threshold = threshold

    def fit(self, X, y, **fit_params):
        """The wrapped model is already fitted; nothing to learn here."""
        return self

    @property
    def classes_(self):
        return self.estimator.classes_

    def predict_proba(self, X):
        return self.estimator.predict_proba(X)

    def predict(self, X):
        return (self.predict_proba(X)[:, 1] >= self.threshold).astype(int)


# --------------------------------------------------------------------------- #
# CatBoost
# --------------------------------------------------------------------------- #
class _CatBoostBase(BaseEstimator):
    """sklearn-safe CatBoost wrapper.

    CatBoost changes `cat_features` inside its constructor, which breaks
    sklearn's `clone()` (used by every search). Here the CatBoost model is
    only created in `fit`, and the categorical columns are passed there.
    """

    def __init__(self, iterations=1000, depth=6, learning_rate=0.1, l2_leaf_reg=3.0, loss_function=None):
        self.iterations = iterations
        self.depth = depth
        self.learning_rate = learning_rate
        self.l2_leaf_reg = l2_leaf_reg
        self.loss_function = loss_function

    def _catboost_class(self):
        raise NotImplementedError

    def _extra_params(self) -> dict:
        return {"loss_function": self.loss_function} if self.loss_function else {}

    def fit(self, X, y, sample_weight=None):
        self.model_ = self._catboost_class()(
            iterations=self.iterations, depth=self.depth,
            learning_rate=self.learning_rate, l2_leaf_reg=self.l2_leaf_reg,
            random_seed=config.RANDOM_STATE, verbose=0, thread_count=-1,
            allow_writing_files=False, **self._extra_params(),
        )
        cat_features = [c for c in CATEGORICAL_FEATURES if c in X.columns]
        self.model_.fit(X, y, cat_features=cat_features, sample_weight=sample_weight)
        return self

    def predict(self, X):
        return np.asarray(self.model_.predict(X)).ravel()


class CatBoostRegressorModel(RegressorMixin, _CatBoostBase):
    def _catboost_class(self):
        import catboost as cb

        return cb.CatBoostRegressor


class CatBoostClassifierModel(ClassifierMixin, _CatBoostBase):
    def _catboost_class(self):
        import catboost as cb

        return cb.CatBoostClassifier

    def _extra_params(self) -> dict:
        return {"auto_class_weights": "Balanced"}

    def fit(self, X, y, sample_weight=None):
        super().fit(X, y, sample_weight)
        self.classes_ = self.model_.classes_
        return self

    def predict(self, X):
        return super().predict(X).astype(int)

    def predict_proba(self, X):
        return self.model_.predict_proba(X)
