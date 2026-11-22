# CourseWise backend: course difficulty model

Predicts, for a course + instructor + term:

| Task | Type | Target |
|---|---|---|
| `gpa` | regression | average GPA |
| `dfw` | regression | DFW rate (D, F, Withdraw) |
| `difficulty` | 3-class classification | Hard / Medium / Easy (relative to the same year) |
| `high_risk` | binary classification | top 20% DFW rate of the year |
| clustering | K-Means | grading style of each course |

Full design: [`course_difficulty_proposal.md`](course_difficulty_proposal.md).

## Setup (Python 3.14)

Run every command from the `backend/` folder.

```bash
python3 -m pip install -r requirements.txt
```

Only the core packages are required. Models or features whose packages are missing are
skipped with a warning (for example, no `shap` -> permutation importance instead).

## Run

```bash
python3 -m coursewise download        # ~12 MB GPA file + ~190 MB catalog files -> data/raw/
python3 -m coursewise prepare         # clean, merge sections, build features -> data/processed/
python3 -m coursewise train --fast    # quick check (~5-10 min): few iterations, 20k rows
python3 -m coursewise train           # full run: all tasks, all models
python3 -m coursewise cluster         # grading styles (add --k 6 to force k)
python3 -m coursewise explain         # SHAP / importance, error analysis, figures
python3 -m coursewise all             # prepare -> train -> cluster -> explain -> export
python3 -m coursewise export          # JSON for the website -> ../frontend/data/
python3 -m coursewise threshold       # tune the high-risk threshold of the saved model (~10 s)
python3 -m coursewise serve           # website + live model API on http://127.0.0.1:8000
```

Useful options: `--tasks gpa dfw`, `--models baseline linear xgboost`, `--n-iter 20`.

If `download` fails with `CERTIFICATE_VERIFY_FAILED`, run once:
`open "/Applications/Python 3.14/Install Certificates.command"`.

## Outputs

| Path | Content |
|---|---|
| `data/processed/features.csv` | one row per offering: ids, targets, features |
| `artifacts/models/<task>.joblib` | best model of each task (refit on 2010-2024) |
| `artifacts/reports/<task>_results.json` | test metrics, model comparison, paired t-test, linear coefficients |
| `artifacts/reports/<task>_comparison.csv` | all models: validation metrics, CV mean + 95% CI, best params |
| `artifacts/reports/<task>_test_predictions.csv` | test-year predictions |
| `artifacts/reports/<task>_errors.json` | error by level, department, term, new course/instructor, class size |
| `artifacts/reports/<task>_explanation.json` | feature importance + one example explanation |
| `artifacts/reports/clustering.json`, `course_grading_styles.csv` | clusters and each course's style |
| `artifacts/figures/*.png` | comparison, importance, confusion matrix, cluster plots |
| `../frontend/data/courses.json` | `export`: one summary row per course (offered since 2016) + site meta |
| `../frontend/data/subjects/<SUBJ>.json` | `export`: per-course grades, yearly trend, terms, instructors, test-year predictions |
| `../frontend/data/insights.json`, `model.json` | `export`: dashboard aggregates and model comparison |

## Live predictions (website)

`serve` starts one local server (standard library only) that serves the `frontend/` folder and a JSON API:

| Endpoint | Returns |
|---|---|
| `GET /api/health` | last term in the data, upcoming terms, high-risk threshold |
| `GET /api/options?course=CS225` | upcoming terms, instructors of the course's last 2 years, usual format |
| `GET /api/predict?course=CS225&term=2026-fa[&instructor=...][&format=online]` | GPA, DFW, difficulty + probabilities, high-risk chance |

A future offering is added as an empty row and gets its features from the same `build_features()` as
training (only earlier terms), so a forecast sees exactly the kind of input the models were trained on.
"Any instructor" is the student-weighted average over the course's recent instructors.
The Predictor page uses the API when it is running and falls back to the exported 2025-2026 test
predictions when it is not.

## Method in short

- **Split by time:** 2005-2009 history only, train 2010-2022, validation 2023-2024, test 2025-2026.
- **No leakage:** every history feature uses strictly earlier terms; target encoding is cross-fitted;
  grade counts are only used to build targets.
- **History features:** course, instructor, course+instructor, subject and subject+level history;
  recency-weighted (EWM) and measured as the gap to that term's university average, so grade
  inflation does not distort them. Small-sample history is shrunk toward its parent group
  (pair -> course -> subject+level -> subject).
- **GPA model learns a correction:** the model predicts `actual - shrunk_guess_gpa`, so tree models
  do not have to extrapolate the upward grade trend.
- **Absolute-error losses** are in the search space of the boosting models (they optimise MAE directly).
- **Sample weights:** training rows are weighted by sqrt(class size); big classes have less noisy averages.
- **Extra candidates:** the mean of the top 3 regression models (ensemble), and Easy/Medium/Hard and
  high-risk derived from the GPA / DFW models by ranking predictions within the year.
- **Fair baselines:** regression = most specific past average; classification = the same past
  average ranked within the year.
- **Tuning:** random search with expanding-window CV (validate on 2018, 2019, ..., 2022).
- **Selection:** best validation score; the winner is refit on train + validation and scored once on test.
- **Decision threshold (high-risk):** chosen on validation with the train-only model (best F1 for "Yes"),
  instead of the default 0.5, which missed most high-risk offerings.
- **Metrics:** `mae` per course offering (used for selection) and `mae_weighted` per student.

## Code map

| Module | Role |
|---|---|
| `config.py` | all paths and settings |
| `download.py` | fetch raw files |
| `cleaning.py` | clean raw rows, merge sections into offerings |
| `targets.py` | GPA, DFW rate, difficulty and high-risk labels |
| `catalog.py` | credit hours and Gen-Ed from the course catalog |
| `history.py` | past-only course / instructor / subject features |
| `features.py` | feature table and feature column lists |
| `preprocessing.py` | imputing, scaling, one-hot and target encoding |
| `tasks.py`, `models.py` | task definitions and model registry with search spaces |
| `estimators.py` | custom estimators: baselines, residual model, ensemble, rank classifier, CatBoost wrapper |
| `splits.py`, `metrics.py` | time split, CV folds, metrics, confidence intervals, paired t-test |
| `training.py` | tune, compare, refit, save |
| `clustering.py` | K-Means grading styles |
| `explain.py`, `analysis.py` | SHAP / permutation importance, error analysis |
| `plotting.py` | all figures |
| `export.py` | JSON files for the static website |
| `forecast.py`, `server.py` | live forecasts for upcoming terms and the local web server / API |
| `pipeline.py`, `__main__.py` | the CLI steps |
