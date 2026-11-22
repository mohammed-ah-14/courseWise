"""Explain the saved best model of each task.

- Tree models + SHAP installed: mean |SHAP value| per feature, plus the
  explanation of one example course.
- Otherwise: permutation importance on the raw features (works for any model).
"""

import joblib
import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance

from . import config, plotting
from .estimators import ResidualRegressor
from .features import ALL_FEATURES
from .splits import split_by_years
from .tasks import Task
from .utils import ensure_dir, log, module_available, save_json

TREE_MODELS = {"decision_tree", "random_forest", "hist_gb", "xgboost", "lightgbm", "catboost"}


def load_bundle(task: Task) -> dict:
    path = config.MODELS_DIR / f"{task.name}.joblib"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `python3 -m coursewise train` first.")
    return joblib.load(path)


def _sample(df: pd.DataFrame, size: int) -> pd.DataFrame:
    return df.sample(min(size, len(df)), random_state=config.RANDOM_STATE).reset_index(drop=True)


def _as_table(names, values) -> pd.DataFrame:
    table = pd.DataFrame({"feature": names, "importance": values})
    return table.sort_values("importance", ascending=False).head(config.TOP_FEATURES).reset_index(drop=True)


# --------------------------------------------------------------------------- #
# SHAP
# --------------------------------------------------------------------------- #
def _shap_matrix(values, task: Task) -> np.ndarray:
    """Reduce SHAP output to (rows, features)."""
    values = np.asarray(values)
    if values.ndim == 3:  # (rows, features, classes)
        return values[:, :, 1] if values.shape[2] == 2 else np.abs(values).mean(axis=2)
    return values


def shap_explanation(bundle: dict, sample: pd.DataFrame, task: Task) -> tuple[pd.DataFrame, dict]:
    """SHAP of the tree model. For GPA it explains the correction to the history guess."""
    import shap

    pipeline = bundle["model"]
    if isinstance(pipeline, ResidualRegressor):
        pipeline = pipeline.estimator_
    preprocessor, model = pipeline[:-1], pipeline[-1]
    model = getattr(model, "model_", model)  # unwrap the CatBoost wrapper
    X = preprocessor.transform(sample[ALL_FEATURES])
    names = preprocessor.get_feature_names_out()

    values = _shap_matrix(shap.TreeExplainer(model).shap_values(X), task)
    importance = _as_table(names, np.abs(values).mean(axis=0))

    row = int(np.argmax(np.abs(values).sum(axis=1)))  # the course the model is most decided about
    order = np.argsort(-np.abs(values[row]))[:10]
    example = {
        "course_id": sample.loc[row, "course_id"],
        "year_term": sample.loc[row, "year_term"],
        "instructor": sample.loc[row, "instructor"],
        "contributions": {names[i]: float(values[row, i]) for i in order},
    }
    return importance, example


# --------------------------------------------------------------------------- #
# Permutation importance (fallback)
# --------------------------------------------------------------------------- #
def permutation_explanation(bundle: dict, sample: pd.DataFrame, task: Task) -> pd.DataFrame:
    result = permutation_importance(
        bundle["model"], sample[ALL_FEATURES], sample[task.target],
        scoring=task.search_scoring, n_repeats=5,
        random_state=config.RANDOM_STATE, n_jobs=-1,
    )
    return _as_table(ALL_FEATURES, result.importances_mean)


def explain_task(task: Task, features: pd.DataFrame) -> dict:
    ensure_dir(config.REPORTS_DIR)
    bundle = load_bundle(task)
    test = split_by_years(features)["test"]

    has_shap = module_available("shap")
    if has_shap and bundle["model_name"] in TREE_MODELS:
        importance, example = shap_explanation(bundle, _sample(test, config.SHAP_SAMPLE_SIZE), task)
        method = "shap"
    else:
        if not has_shap:
            log.warning("shap not usable; using permutation importance")
        importance = permutation_explanation(bundle, _sample(test, config.PERMUTATION_SAMPLE_SIZE), task)
        example, method = None, "permutation"

    importance.to_csv(config.REPORTS_DIR / f"{task.name}_feature_importance.csv", index=False)
    plotting.feature_importance(
        importance, f"{task.name}: {bundle['model_name']} ({method})",
        path=config.FIGURES_DIR / f"{task.name}_feature_importance.png",
    )
    result = {
        "task": task.name,
        "model": bundle["model_name"],
        "method": method,
        "importance": importance.to_dict(orient="records"),
        "example": example,
    }
    save_json(result, config.REPORTS_DIR / f"{task.name}_explanation.json")
    return result
