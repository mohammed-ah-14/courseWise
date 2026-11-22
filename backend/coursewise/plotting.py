"""All figures of the project. Every function is a no-op if matplotlib is missing."""

from functools import wraps
from pathlib import Path

import numpy as np
import pandas as pd

from .utils import ensure_dir, log, module_available


def _figure(function):
    """Create the figure, save it to `path`, close it; skip without matplotlib."""

    @wraps(function)
    def wrapper(*args, path: Path, **kwargs):
        if not module_available("matplotlib"):
            log.warning("matplotlib not usable; skipped figure %s", path.name)
            return
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig = function(plt, *args, **kwargs)
        ensure_dir(path.parent)
        fig.tight_layout()
        fig.savefig(path, dpi=150)
        plt.close(fig)
        log.info("saved figure %s", path.name)

    return wrapper


@_figure
def feature_importance(plt, table: pd.DataFrame, title: str):
    data = table.iloc[::-1]
    fig, ax = plt.subplots(figsize=(8, max(4, 0.3 * len(data))))
    ax.barh(data["feature"], data["importance"], color="#3b6ea5")
    ax.set_title(title)
    ax.set_xlabel("importance")
    return fig


@_figure
def confusion(plt, matrix, class_names, title: str):
    matrix = np.asarray(matrix)
    fig, ax = plt.subplots(figsize=(5, 4.5))
    ax.imshow(matrix, cmap="Blues")
    ax.set_xticks(range(len(class_names)), class_names)
    ax.set_yticks(range(len(class_names)), class_names)
    ax.set_xlabel("predicted")
    ax.set_ylabel("actual")
    for (i, j), value in np.ndenumerate(matrix):
        ax.text(j, i, str(value), ha="center", va="center",
                color="white" if value > matrix.max() / 2 else "black")
    ax.set_title(title)
    return fig


@_figure
def model_comparison(plt, table: pd.DataFrame, metric: str, title: str):
    column = f"val_{metric}"
    data = table.sort_values(column)
    fig, ax = plt.subplots(figsize=(8, 0.45 * len(data) + 1.5))
    ax.barh(data["model"], data[column], color="#3b6ea5")
    ax.set_xlabel(f"validation {metric}")
    ax.set_title(title)
    return fig


@_figure
def cluster_selection(plt, scores: pd.DataFrame, chosen_k: int):
    fig, (left, right) = plt.subplots(1, 2, figsize=(10, 4))
    left.plot(scores["k"], scores["inertia"], marker="o")
    left.set_title("Elbow method")
    left.set_xlabel("k")
    left.set_ylabel("inertia")
    right.plot(scores["k"], scores["silhouette"], marker="o", color="#c0504d")
    right.set_title("Silhouette score")
    right.set_xlabel("k")
    for axis in (left, right):
        axis.axvline(chosen_k, linestyle="--", color="gray")
    return fig


@_figure
def cluster_scatter(plt, coords: np.ndarray, labels: np.ndarray, names: list[str]):
    fig, ax = plt.subplots(figsize=(7, 6))
    for cluster, name in enumerate(names):
        mask = labels == cluster
        ax.scatter(coords[mask, 0], coords[mask, 1], s=6, alpha=0.5, label=name)
    ax.set_xlabel("PC 1")
    ax.set_ylabel("PC 2")
    ax.set_title("Grading styles (PCA projection)")
    ax.legend(markerscale=3)
    return fig


@_figure
def cluster_profiles(plt, summary: pd.DataFrame, share_columns: list[str]):
    fig, ax = plt.subplots(figsize=(9, 4.5))
    width = 0.8 / len(summary)
    x = np.arange(len(share_columns))
    for i, row in enumerate(summary.itertuples()):
        values = [getattr(row, c) for c in share_columns]
        ax.bar(x + i * width, values, width, label=row.name)
    ax.set_xticks(x + width * (len(summary) - 1) / 2, [c.removeprefix("share_") for c in share_columns])
    ax.set_ylabel("share of students")
    ax.set_title("Average grade distribution per grading style")
    ax.legend()
    return fig
