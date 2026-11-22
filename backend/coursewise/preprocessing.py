"""Column transformers that turn the feature table into model input.

Two flavours:
- "encoded": impute + scale numbers, one-hot small categories, target-encode
  subject and instructor. Used by every sklearn / XGBoost / LightGBM model.
  sklearn's TargetEncoder cross-fits internally, so the encoding of a
  training row never uses that row's own target (no leakage).
- "native": numbers untouched, categories kept as strings. Used by CatBoost,
  which encodes categories itself.
"""

from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import KFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler, TargetEncoder

from . import config
from .features import CATEGORICAL_FEATURES, HIGH_CARD_CATEGORICAL, LOW_CARD_CATEGORICAL, NUMERIC_FEATURES
from .tasks import Task

ENCODED = "encoded"
NATIVE = "native"


def build_preprocessor(kind: str, task: Task) -> ColumnTransformer:
    if kind == ENCODED:
        return _encoded_preprocessor(task)
    if kind == NATIVE:
        return _native_preprocessor()
    raise ValueError(f"unknown preprocessor kind: {kind}")


def _encoded_preprocessor(task: Task) -> ColumnTransformer:
    numeric = Pipeline([
        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
    ])
    low_card = OneHotEncoder(handle_unknown="infrequent_if_exist", min_frequency=20, sparse_output=False)
    high_card = Pipeline([
        ("encode", TargetEncoder(
            target_type=task.encoder_target_type,
            cv=KFold(n_splits=5, shuffle=True, random_state=config.RANDOM_STATE),
        )),
        ("scale", StandardScaler()),
    ])
    return ColumnTransformer(
        [
            ("num", numeric, NUMERIC_FEATURES),
            ("low", low_card, LOW_CARD_CATEGORICAL),
            ("high", high_card, HIGH_CARD_CATEGORICAL),
        ],
        verbose_feature_names_out=False,
    )


def _native_preprocessor() -> ColumnTransformer:
    transformer = ColumnTransformer(
        [
            ("num", "passthrough", NUMERIC_FEATURES),
            ("cat", "passthrough", CATEGORICAL_FEATURES),
        ],
        verbose_feature_names_out=False,
    )
    return transformer.set_output(transform="pandas")
