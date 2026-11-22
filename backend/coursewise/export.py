"""Export course statistics and model outputs as JSON for the static frontend.

    python3 -m coursewise export        # -> ../frontend/data/

Files written (all read by the website with fetch()):

    courses.json            meta + one summary row per course (explorer, planner, search)
    subjects/<SUBJ>.json    per-course detail: grades, trend, terms, instructors, predictions
    insights.json           university-wide trends for the dashboard
    model.json              model comparison and test metrics per task

Predictions come from the held-out test years (the model never saw them).
"""

import pandas as pd

from . import config
from .subjects import department_group
from .tasks import TASKS
from .utils import ensure_dir, load_json, log, save_json, timed

PREDICTION_KEYS = ["year", "year_term", "course_id", "instructor", "sched_type"]
TERM_NAMES = {"wi": "Winter", "sp": "Spring", "su": "Summer", "fa": "Fall"}


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _gpa(df: pd.DataFrame) -> float:
    graded = df["graded"].sum()
    return round(df["grade_points"].sum() / graded, 3) if graded else None


def _dfw(df: pd.DataFrame) -> float:
    enrolled = df["enrolled"].sum()
    return round(100 * df["dfw_count"].sum() / enrolled, 2) if enrolled else None


def _weighted(values: pd.Series, weights: pd.Series) -> float:
    total = weights.sum()
    return float((values * weights).sum() / total) if total else float(values.mean())


def _difficulty(gpa_pct: float) -> str:
    """Same tercile rule as the labels: low GPA percentile within the year = Hard."""
    hard, medium, easy = config.DIFFICULTY_CLASSES
    return hard if gpa_pct <= 1 / 3 else medium if gpa_pct <= 2 / 3 else easy


def _term_label(year_term: str) -> str:
    year, term = year_term.split("-")
    return f"{TERM_NAMES.get(term, term)} {year}"


def _term_order(year_term: str) -> tuple[int, int]:
    """Chronological sort key: '2025-fa' -> (2025, 3). Plain string order puts Fall first."""
    year, term = year_term.split("-")
    return int(year), config.TERM_ORDER[TERM_NAMES[term]]


def _level(number: int) -> int:
    return min(max(int(number) // 100 * 100, 100), 500)


def _recent(df: pd.DataFrame) -> pd.DataFrame:
    """The course's own last N years, so retired courses still get stats."""
    return df[df["year"] > df["year"].max() - config.EXPORT_RECENT_YEARS]


# --------------------------------------------------------------------------- #
# Inputs
# --------------------------------------------------------------------------- #
def _load_offerings() -> pd.DataFrame:
    offerings = pd.read_csv(config.OFFERINGS_FILE)
    offerings["level"] = offerings["number"].map(_level)
    return offerings


def _load_catalog() -> pd.DataFrame:
    catalog = pd.read_csv(config.CATALOG_COURSES_FILE)
    catalog["course_id"] = catalog["subject"] + catalog["number"].astype(str)
    gened_cols = [c for c in catalog.columns if c.startswith("gened_")]
    catalog["gened"] = catalog[gened_cols].apply(
        lambda row: [c.removeprefix("gened_").replace("_", " ").title() for c in gened_cols if row[c]],
        axis=1,
    )
    return catalog.set_index("course_id")[["credit_hours", "gened"]]


def _load_predictions() -> pd.DataFrame:
    """One row per test offering with the predictions of all four tasks side by side."""
    merged = None
    for task in TASKS:
        path = config.REPORTS_DIR / f"{task}_test_predictions.csv"
        if not path.exists():
            log.warning("%s missing; run `train` first. Predictions skipped.", path.name)
            return pd.DataFrame()
        df = pd.read_csv(path).rename(columns={"actual": f"{task}_actual", "predicted": f"{task}_pred"})
        if merged is None:
            merged = df
            continue
        keep = PREDICTION_KEYS + [f"{task}_actual", f"{task}_pred"]
        merged = merged.merge(df[keep].drop_duplicates(PREDICTION_KEYS), on=PREDICTION_KEYS, how="left")
    return merged


# --------------------------------------------------------------------------- #
# Courses
# --------------------------------------------------------------------------- #
def _course_prediction(rows: pd.DataFrame) -> dict:
    """Latest predicted term of a course, averaged over its instructors by class size."""
    if rows.empty:
        return {}
    latest_term = max(rows["year_term"], key=_term_order)
    latest = rows[rows["year_term"] == latest_term]
    weights = latest["graded"]
    code = round(_weighted(latest["difficulty_pred"], weights))
    return {
        "predTerm": _term_label(latest["year_term"].iat[0]),
        "predGpa": round(_weighted(latest["gpa_pred"], weights), 3),
        "predDfw": round(100 * _weighted(latest["dfw_pred"], weights), 2),
        "predDifficulty": config.DIFFICULTY_CLASSES[code],
    }


def _course_summary(course_id: str, rows: pd.DataFrame, catalog: pd.DataFrame, preds: pd.DataFrame) -> dict:
    recent = _recent(rows)
    last = rows.iloc[-1]
    info = catalog.loc[course_id] if course_id in catalog.index else None
    gpa_pct = _weighted(recent["gpa_pct"], recent["graded"])
    dfw_pct = _weighted(recent["dfw_pct"], recent["enrolled"])
    return {
        "id": course_id,
        "code": f"{last['subject']} {last['number']}",
        "title": last["title"],
        "subject": last["subject"],
        "group": department_group(last["subject"]),
        "level": int(last["level"]),
        "credits": float(info["credit_hours"]) if info is not None else None,
        "gened": info["gened"] if info is not None else [],
        "avgGpa": _gpa(recent),
        "dfw": _dfw(recent),
        "classSize": round(recent["enrolled"].mean()),
        "students": int(recent["enrolled"].sum()),
        "offerings": int(len(rows)),
        "instructors": int(recent["instructor"].nunique()),
        "lastTerm": _term_label(last["year_term"]),
        "difficulty": _difficulty(gpa_pct),
        "highRisk": dfw_pct > config.HIGH_RISK_QUANTILE,
        **_course_prediction(preds),
    }


def _course_detail(rows: pd.DataFrame, preds: pd.DataFrame) -> dict:
    recent = _recent(rows)
    grade_cols = config.GRADE_COLUMNS + ["withdrawn"]
    grades = recent[grade_cols].sum().astype(int)
    grades = grades.rename({"withdrawn": "W"})

    trend = [[int(year), _gpa(g), _dfw(g), int(g["enrolled"].sum())] for year, g in rows.groupby("year")]
    terms = {term: {"gpa": _gpa(g), "dfw": _dfw(g)} for term, g in recent.groupby("term")}

    instructors = [
        {
            "name": name,
            "offerings": int(len(g)),
            "students": int(g["enrolled"].sum()),
            "gpa": _gpa(g),
            "dfw": _dfw(g),
            "last": _term_label(max(g["year_term"], key=_term_order)),
        }
        for name, g in recent.groupby("instructor")
    ]
    instructors.sort(key=lambda i: i["students"], reverse=True)

    predictions = [
        {
            "term": _term_label(p.year_term),
            "termKey": p.year_term,
            "instructor": p.instructor,
            "students": int(p.graded),
            "gpa": round(p.gpa_pred, 3),
            "dfw": round(100 * p.dfw_pred, 2),
            "difficulty": config.DIFFICULTY_CLASSES[int(p.difficulty_pred)],
            "highRisk": bool(p.high_risk_pred),
            "actualGpa": round(p.gpa_actual, 3),
            "actualDfw": round(100 * p.dfw_actual, 2),
            "actualDifficulty": config.DIFFICULTY_CLASSES[int(p.difficulty_actual)],
        }
        for p in sorted(preds.itertuples(), key=lambda p: (_term_order(p.year_term), -p.graded))
    ]
    return {
        "grades": grades.to_dict(),
        "trend": trend,
        "terms": terms,
        "instructors": instructors[: config.EXPORT_TOP_INSTRUCTORS],
        "predictions": predictions,
    }


def build_courses(offerings: pd.DataFrame, catalog: pd.DataFrame, predictions: pd.DataFrame):
    """Summary list for every course offered since EXPORT_FIRST_YEAR, plus details by subject."""
    offerings = offerings.sort_values(["course_id", "term_index"])
    active = offerings.groupby("course_id")["year"].transform("max") >= config.EXPORT_FIRST_YEAR
    preds_by_course = dict(tuple(predictions.groupby("course_id"))) if not predictions.empty else {}
    empty = predictions.iloc[0:0]

    summaries, details = [], {}
    for course_id, rows in offerings[active].groupby("course_id"):
        preds = preds_by_course.get(course_id, empty)
        summary = _course_summary(course_id, rows, catalog, preds)
        summaries.append(summary)
        details.setdefault(summary["subject"], {})[course_id] = _course_detail(rows, preds)
    return summaries, details


# --------------------------------------------------------------------------- #
# Insights
# --------------------------------------------------------------------------- #
def _grouped(df: pd.DataFrame, column: str, min_students: int = 0) -> list[dict]:
    out = []
    for key, g in df.groupby(column):
        students = int(g["enrolled"].sum())
        if students >= min_students:
            out.append({"key": key if isinstance(key, str) else int(key), "gpa": _gpa(g), "dfw": _dfw(g),
                        "students": students})
    return out


def _dfw_histogram(summaries: list[dict]) -> list[dict]:
    width, top = config.EXPORT_DFW_BIN, config.EXPORT_DFW_MAX
    edges = list(range(0, top, width))
    counts = [0] * len(edges)
    for course in summaries:
        counts[min(int(course["dfw"] // width), len(edges) - 1)] += 1
    return [{"from": lo, "to": lo + width, "courses": n} for lo, n in zip(edges, counts)]


def build_insights(offerings: pd.DataFrame, summaries: list[dict]) -> dict:
    last_year = int(offerings["year"].max())
    recent = offerings[offerings["year"] > last_year - config.EXPORT_RECENT_YEARS].copy()
    recent["group"] = recent["subject"].map(department_group)

    subjects = sorted(_grouped(recent, "subject", config.EXPORT_MIN_SUBJECT_STUDENTS), key=lambda s: s["gpa"])
    big = [c for c in summaries if c["students"] >= config.EXPORT_MIN_COURSE_STUDENTS]
    pick = ("id", "code", "title", "avgGpa", "dfw", "students", "difficulty")
    return {
        "recentYears": [last_year - config.EXPORT_RECENT_YEARS + 1, last_year],
        "byYear": _grouped(offerings, "year"),
        "byLevel": _grouped(recent, "level"),
        "byTerm": _grouped(recent, "term"),
        "byGroup": sorted(_grouped(recent, "group"), key=lambda g: g["gpa"]),
        "hardestSubjects": subjects[: config.EXPORT_TOP_N],
        "easiestSubjects": subjects[::-1][: config.EXPORT_TOP_N],
        "dfwHistogram": _dfw_histogram(summaries),
        "hardestCourses": [{k: c[k] for k in pick} for c in sorted(big, key=lambda c: c["avgGpa"])[: config.EXPORT_TOP_N]],
        "highestDfw": [{k: c[k] for k in pick} for c in sorted(big, key=lambda c: -c["dfw"])[: config.EXPORT_TOP_N]],
    }


# --------------------------------------------------------------------------- #
# Model report
# --------------------------------------------------------------------------- #
def build_model_report() -> dict:
    tasks = {}
    for task in TASKS:
        path = config.REPORTS_DIR / f"{task}_results.json"
        if not path.exists():
            continue
        results = load_json(path)
        tasks[task] = {
            "target": results["target"],
            "selectionMetric": results["selection_metric"],
            "bestModel": results["best_model"],
            "test": results["test_metrics"],
            "threshold": (results.get("threshold") or {}).get("threshold"),
            "testDefaultThreshold": results.get("test_metrics_default_threshold"),
            "comparison": [
                {"model": row["model"], **{k.removeprefix("val_"): v for k, v in row.items() if k.startswith("val_")}}
                for row in results["comparison"]
            ],
        }
        explanation = config.REPORTS_DIR / f"{task}_explanation.json"
        if explanation.exists():
            tasks[task]["importance"] = load_json(explanation).get("importance", [])
    return {
        "split": {"history": [2005, config.FIRST_TRAIN_YEAR - 1], "train": config.TRAIN_YEARS,
                  "validation": config.VAL_YEARS, "test": config.TEST_YEARS},
        "tasks": tasks,
    }


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
def _meta(offerings: pd.DataFrame, summaries: list[dict], predictions: pd.DataFrame) -> dict:
    test_terms = sorted(predictions["year_term"].unique(), key=_term_order) if not predictions.empty else []
    return {
        "source": "UIUC grade distributions (Wade Fagen-Ulmschneider)",
        "firstYear": int(offerings["year"].min()),
        "lastYear": int(offerings["year"].max()),
        "years": int(offerings["year"].nunique()),
        "totalCourses": len(summaries),
        "gradeRecords": int(offerings["enrolled"].sum()),
        "instructors": int(offerings["instructor"].nunique()),
        "subjects": sorted({c["subject"] for c in summaries}),
        "predictedTerms": [_term_label(t) for t in test_terms],
        "recentYears": config.EXPORT_RECENT_YEARS,
    }


def export_frontend_data(out_dir=config.FRONTEND_DATA_DIR) -> None:
    ensure_dir(out_dir)
    with timed("loading inputs"):
        offerings = _load_offerings()
        catalog = _load_catalog()
        predictions = _load_predictions()

    with timed("building course files"):
        summaries, details = build_courses(offerings, catalog, predictions)
        save_json({"meta": _meta(offerings, summaries, predictions), "courses": summaries},
                  out_dir / "courses.json", indent=None)
        for subject, courses in details.items():
            save_json(courses, out_dir / "subjects" / f"{subject}.json", indent=None)

    with timed("building insights and model report"):
        save_json(build_insights(offerings, summaries), out_dir / "insights.json")
        save_json(build_model_report(), out_dir / "model.json")

    log.info("exported %d courses in %d subjects -> %s", len(summaries), len(details), out_dir)
