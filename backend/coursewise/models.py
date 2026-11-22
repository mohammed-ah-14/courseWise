"""Registry of every model compared in the project.

Each `ModelSpec` says how to build the estimator for a task, which
preprocessor it needs and which hyper-parameters to search. Optional
libraries (XGBoost, LightGBM, CatBoost) are skipped if not usable.

Search-space keys:
    "alpha"      -> same name for regression and classification
    "alpha|C"    -> "alpha" for regression, "C" for classification
    "loss|"      -> regression only
"""

from dataclasses import dataclass, field
from typing import Callable

from scipy.stats import loguniform
from sklearn.base import BaseEstimator
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    HistGradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import Lasso, LogisticRegression, Ridge
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.neural_network import MLPClassifier, MLPRegressor
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from . import config
from .estimators import CatBoostClassifierModel, CatBoostRegressorModel, HistoryBaseline, YearRankClassifier
from .preprocessing import ENCODED, NATIVE
from .tasks import Task
from .utils import log, module_available

SEED = config.RANDOM_STATE


@dataclass(frozen=True)
class ModelSpec:
    name: str
    build: Callable[[Task], BaseEstimator]
    params: dict = field(default_factory=dict)  # search space (see module docstring)
    preprocessor: str | None = ENCODED  # None = estimator reads raw columns
    max_train_rows: int | None = None  # subsample for slow models (SVM)
    max_iterations: int | None = None  # cap on random-search iterations
    requires: str | None = None  # optional package name
    parallel_search: bool = True  # False when the model already uses all cores
    family: str = "other"  # "baseline", "linear", "tree", ...
    scale_target: bool = False  # standardize y for scale-sensitive regressors
    supports_weights: bool = True  # accepts sample_weight in fit
    regression_only: bool = False

    @property
    def is_baseline(self) -> bool:
        return self.family == "baseline"

    def is_available(self) -> bool:
        return self.requires is None or module_available(self.requires)

    def wraps_target(self, task: Task) -> bool:
        return self.scale_target and not task.is_classification

    def make(self, task: Task) -> BaseEstimator:
        """Build the estimator; SVR / MLP regressors learn a standardized target.

        Without this, SVR's epsilon (0.1) is wider than the whole spread of
        the DFW rate, and the model predicts almost a constant.
        """
        estimator = self.build(task)
        if self.wraps_target(task):
            return TransformedTargetRegressor(regressor=estimator, transformer=StandardScaler())
        return estimator


# --------------------------------------------------------------------------- #
# Builders. Each returns the regressor or classifier version for the task.
# --------------------------------------------------------------------------- #
def _baseline(task):
    if task.is_classification:
        return YearRankClassifier(cuts=task.rank_cuts, column=task.baseline_column)
    return HistoryBaseline(column=task.baseline_column)


def _linear(task):
    if task.is_classification:
        return LogisticRegression(max_iter=2000, class_weight="balanced")
    return Ridge()


def _lasso(task):
    return Lasso(max_iter=5000)


def _svm(task):
    if task.is_classification:
        return SVC(kernel="rbf", class_weight="balanced", cache_size=1000)
    return SVR(kernel="rbf", cache_size=1000)


def _knn(task):
    return KNeighborsClassifier() if task.is_classification else KNeighborsRegressor()


def _tree(task):
    if task.is_classification:
        return DecisionTreeClassifier(class_weight="balanced", random_state=SEED)
    return DecisionTreeRegressor(random_state=SEED)


def _forest(task):
    common = dict(n_jobs=-1, random_state=SEED)
    if task.is_classification:
        return RandomForestClassifier(class_weight="balanced_subsample", **common)
    return RandomForestRegressor(**common)


def _hist_gb(task):
    # Early stopping on a 10% hold-out: stops adding trees once the score
    # stops improving (much faster than a fixed number of trees).
    common = dict(
        max_iter=1000, early_stopping=True, validation_fraction=0.1,
        n_iter_no_change=30, random_state=SEED,
    )
    if task.is_classification:
        return HistGradientBoostingClassifier(class_weight="balanced", **common)
    return HistGradientBoostingRegressor(**common)


def _xgboost(task):
    import xgboost as xgb

    common = dict(tree_method="hist", n_jobs=-1, random_state=SEED, verbosity=0)
    return xgb.XGBClassifier(**common) if task.is_classification else xgb.XGBRegressor(**common)


def _lightgbm(task):
    import lightgbm as lgb

    common = dict(n_jobs=-1, random_state=SEED, verbose=-1)
    if task.is_classification:
        return lgb.LGBMClassifier(class_weight="balanced", **common)
    return lgb.LGBMRegressor(**common)


def _catboost(task):
    return CatBoostClassifierModel() if task.is_classification else CatBoostRegressorModel()


def _mlp(task):
    common = dict(early_stopping=True, max_iter=300, random_state=SEED)
    return MLPClassifier(**common) if task.is_classification else MLPRegressor(**common)


# --------------------------------------------------------------------------- #
# Search spaces
# --------------------------------------------------------------------------- #
# Absolute-error losses optimise MAE directly and ignore extreme courses;
# they won clearly in the experiments (GPA and DFW).
_BOOSTING_PARAMS = {
    "n_estimators": [300, 600, 1000],
    "learning_rate": loguniform(0.02, 0.2),
    "max_depth": [4, 6, 8],
    "subsample": [0.7, 0.85, 1.0],
    "colsample_bytree": [0.6, 0.8, 1.0],
}

MODEL_SPECS = [
    ModelSpec("baseline", _baseline, preprocessor=None, family="baseline", supports_weights=False),
    ModelSpec("linear", _linear, {"alpha|C": loguniform(1e-3, 1e3)}, family="linear"),
    ModelSpec("lasso", _lasso, {"alpha": loguniform(1e-5, 1e-1)}, family="linear", regression_only=True),
    ModelSpec(
        "svm", _svm,
        {
            "C": loguniform(0.1, 100),
            "gamma": ["scale", 0.01, 0.03, 0.1],
            "epsilon|": [0.05, 0.1, 0.3],  # in standardized units
        },
        max_train_rows=15_000, max_iterations=6, family="kernel", scale_target=True,
    ),
    ModelSpec(
        "knn", _knn,
        {"n_neighbors": [10, 25, 50, 100], "weights": ["uniform", "distance"]},
        max_iterations=6, family="distance", supports_weights=False,
    ),
    ModelSpec(
        "decision_tree", _tree,
        {"max_depth": [4, 6, 8, 12, 16], "min_samples_leaf": [10, 25, 50, 100, 200]},
        family="tree",
    ),
    ModelSpec(
        "random_forest", _forest,
        {
            "n_estimators": [200, 400],
            "max_depth": [12, 20, None],
            "min_samples_leaf": [2, 5, 10, 20],
            "max_features": ["sqrt", 0.3, 0.5],
        },
        max_iterations=6, parallel_search=False, family="tree",
    ),
    ModelSpec(
        "hist_gb", _hist_gb,
        {
            "learning_rate": loguniform(0.02, 0.15),
            "max_leaf_nodes": [15, 31, 63],
            "min_samples_leaf": [20, 40, 80],
            "l2_regularization": loguniform(1e-2, 10),
            "loss|": ["squared_error", "absolute_error"],
        },
        parallel_search=False, family="tree",
    ),
    ModelSpec(
        "xgboost", _xgboost,
        {
            **_BOOSTING_PARAMS, "min_child_weight": [1, 5, 10],
            "objective|": ["reg:squarederror", "reg:absoluteerror"],
        },
        requires="xgboost", parallel_search=False, family="tree",
    ),
    ModelSpec(
        "lightgbm", _lightgbm,
        {
            **_BOOSTING_PARAMS, "num_leaves": [31, 63, 127], "min_child_samples": [10, 20, 50],
            "objective|": ["regression", "regression_l1"],
        },
        requires="lightgbm", parallel_search=False, family="tree",
    ),
    ModelSpec(
        "catboost", _catboost,
        {
            "iterations": [500, 1000],
            "depth": [4, 6, 8],
            "learning_rate": loguniform(0.03, 0.2),
            "l2_leaf_reg": [1, 3, 10],
            "loss_function|": ["RMSE", "MAE"],
        },
        preprocessor=NATIVE, requires="catboost", max_iterations=6,
        parallel_search=False, family="tree",
    ),
    ModelSpec(
        "mlp", _mlp,
        {
            "hidden_layer_sizes": [(64,), (128, 64), (256, 128)],
            "alpha": loguniform(1e-5, 1e-2),
            "learning_rate_init": loguniform(1e-4, 1e-2),
        },
        max_iterations=6, family="neural", scale_target=True,
    ),
]


def search_space(spec: ModelSpec, task: Task, prefix: str) -> dict:
    """Search space with pipeline prefixes, resolved for the task kind."""
    if spec.wraps_target(task):
        prefix += "regressor__"
    space = {}
    for key, values in spec.params.items():
        regression_name, separator, classification_name = key.partition("|")
        name = classification_name if (task.is_classification and separator) else regression_name
        if name:
            space[prefix + name] = values
    return space


def available_specs(task: Task, names: list[str] | None = None) -> list[ModelSpec]:
    specs = []
    for spec in MODEL_SPECS:
        if names and spec.name not in names and not spec.is_baseline:
            continue
        if task.is_classification and spec.regression_only:
            continue
        if not spec.is_available():
            log.warning("skipping %s: package '%s' is not usable", spec.name, spec.requires)
            continue
        specs.append(spec)
    return specs
