"""The four prediction tasks of the project."""

from dataclasses import dataclass

from . import config


@dataclass(frozen=True)
class Task:
    name: str
    target: str
    kind: str  # "regression" or "classification"
    encoder_target_type: str  # target_type for sklearn's TargetEncoder
    search_scoring: str  # sklearn scorer used during hyper-parameter search
    selection_metric: str  # key in the metrics dict used to pick the best model
    higher_is_better: bool
    baseline_column: str  # history column used by the baseline model
    residual_base: str | None = None  # regression: learn the correction to this guess
    class_names: tuple[str, ...] = ()
    rank_cuts: tuple[float, ...] = ()  # classification: label = cut of within-year rank
    derived_from: str | None = None  # classification: regression task to derive from

    @property
    def is_classification(self) -> bool:
        return self.kind == "classification"

    @property
    def is_binary(self) -> bool:
        return self.is_classification and len(self.class_names) == 2


TASKS = {
    task.name: task
    for task in (
        Task(
            name="gpa", target="avg_gpa", kind="regression",
            encoder_target_type="continuous",
            search_scoring="neg_mean_absolute_error",
            selection_metric="mae", higher_is_better=False,
            baseline_column="best_guess_gpa",
            residual_base="shrunk_guess_gpa",
        ),
        Task(
            name="dfw", target="dfw_rate", kind="regression",
            encoder_target_type="continuous",
            search_scoring="neg_mean_absolute_error",
            selection_metric="mae", higher_is_better=False,
            baseline_column="best_guess_dfw",
        ),
        Task(
            name="difficulty", target="difficulty_code", kind="classification",
            encoder_target_type="multiclass",
            search_scoring="f1_macro",
            selection_metric="f1_macro", higher_is_better=True,
            baseline_column="best_guess_gpa",
            class_names=config.DIFFICULTY_CLASSES,
            rank_cuts=(1 / 3, 2 / 3),
            derived_from="gpa",
        ),
        Task(
            name="high_risk", target="high_risk", kind="classification",
            encoder_target_type="binary",
            search_scoring="average_precision",
            selection_metric="pr_auc", higher_is_better=True,
            baseline_column="best_guess_dfw",
            class_names=("No", "Yes"),
            rank_cuts=(config.HIGH_RISK_QUANTILE,),
            derived_from="dfw",
        ),
    )
}
