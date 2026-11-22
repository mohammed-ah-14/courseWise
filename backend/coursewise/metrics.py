"""Evaluation metrics and the statistical comparison of models."""

import numpy as np
from scipy import stats
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    confusion_matrix,
    f1_score,
    mean_absolute_error,
    precision_recall_curve,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
    root_mean_squared_error,
)

from .tasks import Task


def regression_metrics(y_true, y_pred, weights=None) -> dict:
    """MAE / RMSE / R2 per course offering, plus MAE per student.

    `mae_weighted` weights each offering by its number of students: the
    average error a student would see. Model selection uses plain `mae`.
    """
    result = {
        "mae": mean_absolute_error(y_true, y_pred),
        "rmse": root_mean_squared_error(y_true, y_pred),
        "r2": r2_score(y_true, y_pred),
    }
    if weights is not None:
        result["mae_weighted"] = mean_absolute_error(y_true, y_pred, sample_weight=weights)
    return result


def classification_metrics(y_true, y_pred, scores, task: Task) -> dict:
    """`scores` = probability (or decision value) of the positive class
    for binary tasks; ignored for multi-class."""
    labels = list(range(len(task.class_names)))
    result = {
        "accuracy": accuracy_score(y_true, y_pred),
        "f1_macro": f1_score(y_true, y_pred, average="macro"),
        "precision_macro": precision_score(y_true, y_pred, average="macro", zero_division=0),
        "recall_macro": recall_score(y_true, y_pred, average="macro", zero_division=0),
        "f1_per_class": dict(zip(task.class_names, f1_score(y_true, y_pred, average=None, labels=labels))),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
    }
    if len(labels) == 2 and scores is not None:
        result["roc_auc"] = roc_auc_score(y_true, scores)
        result["pr_auc"] = average_precision_score(y_true, scores)
    return result


def evaluate(task: Task, model, X, y, weights=None) -> tuple[dict, np.ndarray]:
    """Metrics for one fitted model plus its predictions."""
    y_pred = model.predict(X)
    if not task.is_classification:
        return regression_metrics(y, y_pred, weights), y_pred
    return classification_metrics(y, y_pred, positive_scores(model, X), task), y_pred


def positive_scores(model, X):
    """Score of the positive class, from predict_proba or decision_function."""
    if hasattr(model, "predict_proba"):
        try:
            proba = model.predict_proba(X)
            return proba[:, 1] if proba.shape[1] == 2 else None
        except AttributeError:
            pass
    if hasattr(model, "decision_function"):
        values = model.decision_function(X)
        return values if np.ndim(values) == 1 else None
    return None


def best_f1_threshold(y_true, scores) -> float:
    """Decision threshold that maximises the F1 score of the positive class."""
    precision, recall, thresholds = precision_recall_curve(y_true, scores)
    # The last precision/recall pair has no threshold (it is the "predict nothing" end).
    f1 = 2 * precision[:-1] * recall[:-1] / np.clip(precision[:-1] + recall[:-1], 1e-12, None)
    return float(thresholds[np.argmax(f1)])


def confidence_interval(scores, level: float = 0.95) -> dict:
    """Mean and t-based confidence interval of CV fold scores."""
    scores = np.asarray(scores, dtype=float)
    if len(scores) == 0:
        return {"mean": np.nan, "low": np.nan, "high": np.nan}
    mean = scores.mean()
    if len(scores) < 2:
        return {"mean": mean, "low": mean, "high": mean}
    half = stats.t.ppf((1 + level) / 2, len(scores) - 1) * stats.sem(scores)
    return {"mean": mean, "low": mean - half, "high": mean + half}


def paired_test(scores_a, scores_b) -> dict:
    """Paired t-test on the same CV folds: is model A different from model B?"""
    statistic, p_value = stats.ttest_rel(scores_a, scores_b)
    return {"t_statistic": statistic, "p_value": p_value, "significant_at_0.05": bool(p_value < 0.05)}
