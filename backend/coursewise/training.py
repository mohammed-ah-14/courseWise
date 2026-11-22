"""Train, tune and compare all models for one task.

Flow for each task:
1. For each model: random search on 2010-2022 with expanding year folds.
2. Score the tuned model on validation (2023-2024).
3. Add two extra candidates:
   - regression: the mean of the top models (ensemble);
   - classification: classes derived from the matching regression model
     (difficulty from the GPA model, high-risk from the DFW model).
4. Pick the best candidate on validation, refit it on train + validation,
   score it once on test (2025-2026), and save everything.
5. Binary tasks: the decision threshold is tuned on validation with the
   train-only model (best F1 for "Yes") and stored with the final model.
"""

import time
from dataclasses import dataclass, field

import joblib
import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, clone
from sklearn.model_selection import RandomizedSearchCV, cross_val_score
from sklearn.pipeline import Pipeline

from . import config
from .estimators import AveragingRegressor, ResidualRegressor, ThresholdClassifier, YearRankClassifier
from .features import ALL_FEATURES
from .metrics import best_f1_threshold, confidence_interval, evaluate, paired_test, positive_scores
from .models import MODEL_SPECS, ModelSpec, available_specs, search_space
from .preprocessing import build_preprocessor
from .splits import expanding_year_folds, split_by_years
from .tasks import Task
from .utils import ensure_dir, load_json, log, save_json, timed

PREDICTION_CONTEXT_COLUMNS = [
    "year", "year_term", "course_id", "title", "subject", "instructor", "level",
    "term", "sched_type", "dept_group", "is_new_course", "is_new_instructor",
    "is_new_pair", "graded",
]


@dataclass
class TrainingOptions:
    model_names: list[str] | None = None
    n_iter: int = config.DEFAULT_SEARCH_ITERATIONS
    max_train_rows: int | None = None  # global cap, used by --fast


@dataclass
class ModelResult:
    name: str
    family: str
    estimator: BaseEstimator  # fitted on the training years only
    val_metrics: dict
    spec: ModelSpec | None = None  # None for ensemble / derived candidates
    best_params: dict = field(default_factory=dict)
    cv_scores: list[float] = field(default_factory=list)
    train_rows: int = 0
    fit_seconds: float = 0.0
    extra: dict = field(default_factory=dict)


@dataclass
class TaskOutcome:
    task: Task
    best: ModelResult
    final_model: BaseEstimator  # best candidate refit on train + validation
    summary: dict


# --------------------------------------------------------------------------- #
# Building and fitting
# --------------------------------------------------------------------------- #
def build_estimator(spec: ModelSpec, task: Task) -> tuple[BaseEstimator, str]:
    """Estimator for a spec, plus the prefix of its search parameters."""
    model = spec.make(task)
    if spec.preprocessor is None:
        return model, ""
    pipeline = Pipeline([("prep", build_preprocessor(spec.preprocessor, task)), ("model", model)])
    if task.residual_base:
        return ResidualRegressor(pipeline, task.residual_base), "estimator__model__"
    return pipeline, "model__"


def sample_weights(data: pd.DataFrame) -> np.ndarray:
    weights = data["graded"].to_numpy(dtype=float) ** config.SAMPLE_WEIGHT_POWER
    return weights / weights.mean()


def fit_params(spec: ModelSpec | None, data: pd.DataFrame) -> dict:
    """sample_weight for the final pipeline step, if the model supports it."""
    supported = spec is None or (spec.supports_weights and spec.preprocessor is not None)
    if not supported or config.SAMPLE_WEIGHT_POWER == 0:
        return {}
    return {"model__sample_weight": sample_weights(data)}


def _row_cap(spec: ModelSpec | None, options: TrainingOptions) -> int | None:
    caps = [c for c in ((spec.max_train_rows if spec else None), options.max_train_rows) if c]
    return min(caps) if caps else None


def _subsample(df: pd.DataFrame, max_rows: int | None) -> pd.DataFrame:
    if not max_rows or len(df) <= max_rows:
        return df
    return df.sample(max_rows, random_state=config.RANDOM_STATE).sort_values("term_index").reset_index(drop=True)


def _search_score_to_metric(scores, task: Task) -> list[float]:
    """sklearn maximises, so MAE comes back negative; flip it back."""
    sign = -1 if task.search_scoring.startswith("neg_") else 1
    return [sign * float(s) for s in scores]


def fit_with_search(spec: ModelSpec, task: Task, train: pd.DataFrame, options: TrainingOptions):
    """Return (fitted estimator, best params, per-fold CV scores, rows used)."""
    data = _subsample(train, _row_cap(spec, options))
    X, y = data[ALL_FEATURES], data[task.target]
    folds = expanding_year_folds(data["year"])
    estimator, prefix = build_estimator(spec, task)
    space = search_space(spec, task, prefix)
    params = fit_params(spec, data)

    if not space:
        scores = cross_val_score(estimator, X, y, cv=folds, scoring=task.search_scoring, params=params)
        return estimator.fit(X, y, **params), {}, _search_score_to_metric(scores, task), len(data)

    iterations = min(options.n_iter, spec.max_iterations or options.n_iter)
    search = RandomizedSearchCV(
        estimator, space, n_iter=iterations, cv=folds,
        scoring=task.search_scoring, refit=True,
        n_jobs=-1 if spec.parallel_search else 1,
        random_state=config.RANDOM_STATE, error_score="raise",
    )
    search.fit(X, y, **params)
    best = search.best_index_
    scores = [search.cv_results_[f"split{i}_test_score"][best] for i in range(len(folds))]
    return search.best_estimator_, search.best_params_, _search_score_to_metric(scores, task), len(data)


def _validate(task: Task, estimator, splits: dict) -> dict:
    val = splits["val"]
    metrics, _ = evaluate(task, estimator, val[ALL_FEATURES], val[task.target], weights=val["graded"])
    return metrics


def _log_result(task: Task, result: ModelResult) -> None:
    cv = f"cv {np.mean(result.cv_scores):.4f}, " if result.cv_scores else ""
    log.info(
        "  %-16s val %s = %.4f   (%s%.0fs)",
        result.name, task.selection_metric, result.val_metrics[task.selection_metric], cv, result.fit_seconds,
    )


def train_one(spec: ModelSpec, task: Task, splits: dict, options: TrainingOptions) -> ModelResult:
    start = time.perf_counter()
    estimator, params, cv_scores, rows = fit_with_search(spec, task, splits["train"], options)
    result = ModelResult(
        name=spec.name, family=spec.family, estimator=estimator,
        val_metrics=_validate(task, estimator, splits), spec=spec,
        best_params=params, cv_scores=cv_scores, train_rows=rows,
        fit_seconds=time.perf_counter() - start,
    )
    if spec.family == "linear":
        result.extra["coefficients"] = linear_coefficients(estimator, task)
    _log_result(task, result)
    return result


# --------------------------------------------------------------------------- #
# Extra candidates: ensemble and derived classifiers
# --------------------------------------------------------------------------- #
def ensemble_candidate(task: Task, results: list[ModelResult], splits: dict) -> ModelResult | None:
    """Mean of the top regression models (fast, weight-supporting ones only)."""
    eligible = [
        r for r in rank_results(results, task)
        if r.spec and not r.spec.is_baseline and r.spec.supports_weights and not r.spec.max_train_rows
    ][: config.ENSEMBLE_SIZE]
    if task.is_classification or len(eligible) < 2:
        return None
    ensemble = AveragingRegressor.from_fitted([r.estimator for r in eligible])
    result = ModelResult(
        name="ensemble", family="ensemble", estimator=ensemble,
        val_metrics=_validate(task, ensemble, splits),
        extra={"members": [r.name for r in eligible]},
    )
    _log_result(task, result)
    return result


def derived_candidate(task: Task, sources: dict[str, TaskOutcome], splits: dict) -> ModelResult | None:
    """Classes from the regression model of `task.derived_from`, ranked within the year."""
    source = sources.get(task.derived_from) if task.derived_from else None
    if source is None:
        if task.derived_from:
            log.info("  (train '%s' in the same run to also try classes derived from it)", task.derived_from)
        return None
    classifier = YearRankClassifier(cuts=task.rank_cuts, source=source.best.estimator).fit(None, None)
    result = ModelResult(
        name=f"from_{source.task.name}_model", family="derived", estimator=classifier,
        val_metrics=_validate(task, classifier, splits),
        extra={"source_task": source.task.name, "source_model": source.best.name},
    )
    _log_result(task, result)
    return result


def refit_final(result: ModelResult, task: Task, splits: dict, options: TrainingOptions,
                sources: dict[str, TaskOutcome]) -> BaseEstimator:
    """Refit the chosen candidate on train + validation."""
    if result.family == "derived":
        source = sources[result.extra["source_task"]].final_model
        return YearRankClassifier(cuts=task.rank_cuts, source=source).fit(None, None)

    combined = pd.concat([splits["train"], splits["val"]], ignore_index=True)
    data = _subsample(combined, _row_cap(result.spec, options))
    X, y = data[ALL_FEATURES], data[task.target]
    if result.family == "ensemble":
        members = AveragingRegressor(estimators=list(result.estimator.estimators_))
        return members.fit(X, y, **fit_params(None, data))
    return clone(result.estimator).fit(X, y, **fit_params(result.spec, data))


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #
def rank_results(results: list[ModelResult], task: Task) -> list[ModelResult]:
    return sorted(results, key=lambda r: r.val_metrics[task.selection_metric], reverse=task.higher_is_better)


def comparison_table(results: list[ModelResult], task: Task) -> pd.DataFrame:
    rows = []
    for rank, result in enumerate(rank_results(results, task), start=1):
        ci = confidence_interval(result.cv_scores)
        scalar_val = {k: v for k, v in result.val_metrics.items() if np.isscalar(v)}
        rows.append({
            "rank": rank,
            "model": result.name,
            **{f"val_{k}": v for k, v in scalar_val.items()},
            f"cv_{task.selection_metric}_mean": ci["mean"],
            f"cv_{task.selection_metric}_ci_low": ci["low"],
            f"cv_{task.selection_metric}_ci_high": ci["high"],
            "train_rows": result.train_rows,
            "fit_seconds": round(result.fit_seconds, 1),
            "best_params": _clean_params(result.best_params) or result.extra.get("members") or {},
        })
    return pd.DataFrame(rows)


def _clean_key(key: str) -> str:
    for prefix in ("estimator__", "model__", "regressor__"):
        key = key.removeprefix(prefix)
    return key


def _clean_params(params: dict) -> dict:
    return {_clean_key(key): value for key, value in params.items()}


def linear_coefficients(estimator, task: Task, top: int = 15) -> dict:
    """Largest linear-model coefficients, for comparison with SHAP."""
    pipeline = estimator.estimator_ if isinstance(estimator, ResidualRegressor) else estimator
    names = pipeline[:-1].get_feature_names_out()
    coefs = np.atleast_2d(pipeline[-1].coef_)
    labels = task.class_names[-coefs.shape[0]:] if task.is_classification else ["coefficient"]
    out = {}
    for label, row in zip(labels, coefs):
        order = np.argsort(-np.abs(row))[:top]
        out[label] = {names[i]: float(row[i]) for i in order}
    return out


def _save_predictions(task: Task, model, test: pd.DataFrame) -> None:
    predictions = test[PREDICTION_CONTEXT_COLUMNS].copy()
    predictions["actual"] = test[task.target].to_numpy()
    predictions["predicted"] = model.predict(test[ALL_FEATURES])
    predictions.to_csv(config.REPORTS_DIR / f"{task.name}_test_predictions.csv", index=False)


def _compare(best: ModelResult, others: list[ModelResult]) -> dict | None:
    """Paired t-test against the next candidate that has CV scores."""
    other = next((r for r in others if len(r.cv_scores) == len(best.cv_scores) >= 2), None)
    if other is None or len(best.cv_scores) < 2:
        return None
    return {"best": best.name, "runner_up": other.name, **paired_test(best.cv_scores, other.cv_scores)}


def _short(metrics: dict) -> str:
    return ", ".join(f"{k}={v:.4f}" for k, v in metrics.items() if np.isscalar(v))


# --------------------------------------------------------------------------- #
# Decision threshold (binary tasks)
# --------------------------------------------------------------------------- #
def tune_threshold(task: Task, train_only_model, final_model, splits: dict):
    """Pick the threshold on validation with the train-only model, apply it to the final model.

    Returns (final model, report dict); both unchanged if the task is not
    binary or the model has no probabilities.
    """
    if not task.is_binary or not hasattr(train_only_model, "predict_proba"):
        return final_model, None
    val = splits["val"]
    threshold = best_f1_threshold(val[task.target], positive_scores(train_only_model, val[ALL_FEATURES]))
    tuned_val = _validate(task, ThresholdClassifier(train_only_model, threshold), splits)
    log.info("  threshold %.3f: val %s", threshold, _short(tuned_val))
    return ThresholdClassifier(final_model, threshold), {"threshold": threshold, "val_metrics": tuned_val}


def _refit_on_train(task: Task, results: dict, splits: dict) -> BaseEstimator:
    """Rebuild the saved best model with its tuned parameters, fitted on the training years only."""
    spec = next((s for s in MODEL_SPECS if s.name == results["best_model"]), None)
    if spec is None:
        raise ValueError(f"cannot refit '{results['best_model']}' on its own; run `train --tasks {task.name}`")
    estimator, prefix = build_estimator(spec, task)
    best = results["best_params"]
    params = {
        key: tuple(best[name]) if isinstance(best[name], list) else best[name]  # JSON turns tuples into lists
        for key in search_space(spec, task, prefix)
        if (name := _clean_key(key)) in best
    }
    data = _subsample(splits["train"], _row_cap(spec, TrainingOptions()))
    estimator.set_params(**params)
    return estimator.fit(data[ALL_FEATURES], data[task.target], **fit_params(spec, data))


def retune_saved_threshold(task: Task, features: pd.DataFrame) -> dict:
    """Add a tuned threshold to an already trained model without a full retrain.

    Updates <task>.joblib, <task>_test_predictions.csv and <task>_results.json.
    """
    model_path = config.MODELS_DIR / f"{task.name}.joblib"
    results_path = config.REPORTS_DIR / f"{task.name}_results.json"
    bundle, results = joblib.load(model_path), load_json(results_path)
    final = bundle["model"]
    final = final.estimator if isinstance(final, ThresholdClassifier) else final

    splits = split_by_years(features)
    with timed(f"{task.name}: refit {results['best_model']} on train to tune the threshold"):
        train_only = _refit_on_train(task, results, splits)
    final, tuning = tune_threshold(task, train_only, final, splits)
    if tuning is None:
        log.warning("%s: not a binary probability model; nothing to tune", task.name)
        return results

    test = splits["test"]
    results["test_metrics_default_threshold"] = results.get("test_metrics_default_threshold", results["test_metrics"])
    results["test_metrics"], _ = evaluate(task, final, test[ALL_FEATURES], test[task.target], weights=test["graded"])
    results["threshold"] = tuning
    log.info("task %s: test with threshold %s", task.name, _short(results["test_metrics"]))

    joblib.dump({**bundle, "model": final}, model_path)
    _save_predictions(task, final, test)
    save_json(results, results_path)
    return results


# --------------------------------------------------------------------------- #
# Task entry point
# --------------------------------------------------------------------------- #
def train_task(task: Task, features: pd.DataFrame, options: TrainingOptions,
               sources: dict[str, TaskOutcome] | None = None) -> TaskOutcome:
    sources = sources or {}
    ensure_dir(config.MODELS_DIR)
    ensure_dir(config.REPORTS_DIR)
    splits = split_by_years(features)
    log.info(
        "task %s: train %d, val %d, test %d rows",
        task.name, len(splits["train"]), len(splits["val"]), len(splits["test"]),
    )

    results = [train_one(spec, task, splits, options) for spec in available_specs(task, options.model_names)]
    extras = [ensemble_candidate(task, results, splits), derived_candidate(task, sources, splits)]
    results += [r for r in extras if r is not None]
    ranked = rank_results(results, task)
    best = ranked[0]

    with timed(f"{task.name}: refit {best.name} on train + val"):
        final_model = refit_final(best, task, splits, options, sources)
    final_model, threshold = tune_threshold(task, best.estimator, final_model, splits)
    test = splits["test"]
    test_metrics, _ = evaluate(task, final_model, test[ALL_FEATURES], test[task.target], weights=test["graded"])
    log.info("task %s: best %s, test %s", task.name, best.name, _short(test_metrics))

    joblib.dump(
        {"model": final_model, "model_name": best.name, "task": task.name, "features": ALL_FEATURES},
        config.MODELS_DIR / f"{task.name}.joblib",
    )
    _save_predictions(task, final_model, test)
    table = comparison_table(results, task)
    table.to_csv(config.REPORTS_DIR / f"{task.name}_comparison.csv", index=False)

    summary = {
        "task": task.name,
        "target": task.target,
        "selection_metric": task.selection_metric,
        "best_model": best.name,
        "best_params": table.loc[0, "best_params"],
        "best_details": best.extra or None,
        "test_metrics": test_metrics,
        "val_metrics_best": best.val_metrics,
        "threshold": threshold,
        "comparison": table.to_dict(orient="records"),
        "best_vs_runner_up": _compare(best, ranked[1:]),
        "linear_coefficients": next((r.extra["coefficients"] for r in results if "coefficients" in r.extra), None),
    }
    save_json(summary, config.REPORTS_DIR / f"{task.name}_results.json")
    return TaskOutcome(task, best, final_model, summary)
