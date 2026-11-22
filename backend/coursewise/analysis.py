"""Error analysis: where does the best model fail on the test years?"""

import pandas as pd

from . import config, plotting
from .tasks import Task
from .utils import load_json, save_json

GROUP_COLUMNS = [
    "level", "dept_group", "term", "sched_type",
    "is_new_course", "is_new_instructor", "is_new_pair", "class_size",
]


def _load_predictions(task: Task) -> pd.DataFrame:
    path = config.REPORTS_DIR / f"{task.name}_test_predictions.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} not found. Run `python3 -m coursewise train` first.")
    predictions = pd.read_csv(path)
    predictions["class_size"] = pd.cut(predictions["graded"], config.CLASS_SIZE_BINS).astype(str)
    return predictions


def _breakdown(predictions: pd.DataFrame, value: str, name: str) -> dict:
    tables = {}
    for column in GROUP_COLUMNS:
        table = (
            predictions.groupby(column)[value]
            .agg(["count", "mean"])
            .rename(columns={"mean": name})
            .sort_values(name, ascending=(name != "mae"))
        )
        tables[column] = table.reset_index().to_dict(orient="records")
    return tables


def run_error_analysis(task: Task) -> dict:
    predictions = _load_predictions(task)

    if task.is_classification:
        predictions["correct"] = (predictions["actual"] == predictions["predicted"]).astype(float)
        report = {"overall_accuracy": predictions["correct"].mean(),
                  "by_group": _breakdown(predictions, "correct", "accuracy")}
        results = load_json(config.REPORTS_DIR / f"{task.name}_results.json")
        plotting.confusion(
            results["test_metrics"]["confusion_matrix"], list(task.class_names),
            f"{task.name}: test confusion matrix",
            path=config.FIGURES_DIR / f"{task.name}_confusion.png",
        )
    else:
        predictions["abs_error"] = (predictions["actual"] - predictions["predicted"]).abs()
        worst = predictions.nlargest(20, "abs_error")
        report = {
            "overall_mae": predictions["abs_error"].mean(),
            "by_group": _breakdown(predictions, "abs_error", "mae"),
            "worst_predictions": worst[
                ["year_term", "course_id", "title", "instructor", "actual", "predicted", "abs_error"]
            ].to_dict(orient="records"),
        }

    comparison = pd.read_csv(config.REPORTS_DIR / f"{task.name}_comparison.csv")
    plotting.model_comparison(
        comparison, task.selection_metric, f"{task.name}: model comparison",
        path=config.FIGURES_DIR / f"{task.name}_model_comparison.png",
    )
    save_json(report, config.REPORTS_DIR / f"{task.name}_errors.json")
    return report
