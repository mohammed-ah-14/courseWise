"""Task 5: group offerings into "grading styles" with K-Means.

Each offering is described by its grade distribution (share of A, B, C, D,
F and W). Shares are standardized so rare but important outcomes (F, W)
count as much as the common ones.
"""

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.metrics import davies_bouldin_score, silhouette_score
from sklearn.preprocessing import StandardScaler

from . import config, plotting
from .utils import ensure_dir, log, save_json

SHARE_COLUMNS = [*config.LETTER_GROUPS, "share_W"]


def grade_shares(offerings: pd.DataFrame) -> pd.DataFrame:
    enrolled = offerings["graded"] + offerings["withdrawn"]
    shares = pd.DataFrame(index=offerings.index)
    for column, grades in config.LETTER_GROUPS.items():
        shares[column] = offerings[grades].sum(axis=1) / enrolled
    shares["share_W"] = offerings["withdrawn"] / enrolled
    return shares


def _kmeans(k: int) -> KMeans:
    return KMeans(n_clusters=k, n_init=10, random_state=config.RANDOM_STATE)


def score_k_values(X: np.ndarray, sample: np.ndarray) -> pd.DataFrame:
    """Inertia (elbow), silhouette and Davies-Bouldin for each k."""
    rows = []
    for k in config.CLUSTER_K_RANGE:
        model = _kmeans(k).fit(X)
        labels = model.labels_[sample]
        rows.append({
            "k": k,
            "inertia": model.inertia_,
            "silhouette": silhouette_score(X[sample], labels),
            "davies_bouldin": davies_bouldin_score(X[sample], labels),
        })
        log.info("  k=%d silhouette=%.3f", k, rows[-1]["silhouette"])
    return pd.DataFrame(rows)


def choose_k(scores: pd.DataFrame) -> int:
    candidates = scores[scores["k"] >= config.CLUSTER_MIN_K]
    return int(candidates.loc[candidates["silhouette"].idxmax(), "k"])


# (name, score of a centroid for that name, minimum score to earn the name)
# Scores are z-scores of the centroid vs. the average offering.
STYLE_RULES = [
    ("High-withdrawal", lambda z: z["share_W"], 1.0),
    ("High-failure", lambda z: z["share_F"] + z["share_D"], 1.0),
    ("Generous", lambda z: z["share_A"], 0.5),
    ("Strict", lambda z: -z["share_A"], 0.5),
]


def name_clusters(summary: pd.DataFrame, shares: pd.DataFrame) -> list[str]:
    """Give each style name to the one cluster that fits it best.

    Names are handed out in STYLE_RULES order; a cluster that earns no
    name is "Balanced". This keeps names unique and meaningful.
    """
    z = (summary[SHARE_COLUMNS] - shares.mean()) / shares.std()
    names = {cluster: None for cluster in z.index}
    for name, score, threshold in STYLE_RULES:
        free = [c for c, assigned in names.items() if assigned is None]
        if not free:
            break
        scores = score(z.loc[free])
        if scores.max() >= threshold:
            names[scores.idxmax()] = name
    return _make_unique([name or "Balanced" for name in names.values()])


def _make_unique(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    unique = []
    for name in names:
        seen[name] = seen.get(name, 0) + 1
        unique.append(name if seen[name] == 1 else f"{name} {seen[name]}")
    return unique


def course_styles(assignments: pd.DataFrame) -> pd.DataFrame:
    """Most common grading style of each course in its recent offerings."""
    recent = assignments[assignments["year"] > assignments["year"].max() - config.COURSE_STYLE_RECENT_YEARS]
    counts = recent.groupby(["course_id", "grading_style"]).size().rename("n").reset_index()
    counts["share"] = counts["n"] / counts.groupby("course_id")["n"].transform("sum")
    top = counts.sort_values("n", ascending=False).drop_duplicates("course_id")
    return top[["course_id", "grading_style", "share"]].sort_values("course_id").reset_index(drop=True)


def run_clustering(offerings: pd.DataFrame, k: int | None = None) -> dict:
    ensure_dir(config.REPORTS_DIR)
    shares = grade_shares(offerings)
    X = StandardScaler().fit_transform(shares)
    rng = np.random.default_rng(config.RANDOM_STATE)
    sample = rng.choice(len(X), size=min(config.CLUSTER_SAMPLE_SIZE, len(X)), replace=False)

    scores = score_k_values(X, sample)
    k = k or choose_k(scores)
    model = _kmeans(k).fit(X)
    labels = model.labels_

    profile = shares.assign(cluster=labels, avg_gpa=offerings["avg_gpa"], dfw_rate=offerings["dfw_rate"])
    summary = profile.groupby("cluster").mean()
    summary["size"] = profile.groupby("cluster").size()
    summary["name"] = name_clusters(summary, shares)
    names = summary["name"].tolist()

    assignments = offerings[["year", "year_term", "course_id", "instructor"]].assign(
        cluster=labels, grading_style=[names[c] for c in labels]
    )
    assignments.to_csv(config.PROCESSED_DIR / "cluster_assignments.csv", index=False)
    course_styles(assignments).to_csv(config.REPORTS_DIR / "course_grading_styles.csv", index=False)

    coords = PCA(n_components=2, random_state=config.RANDOM_STATE).fit_transform(X[sample])
    plotting.cluster_selection(scores, k, path=config.FIGURES_DIR / "cluster_selection.png")
    plotting.cluster_scatter(coords, labels[sample], names, path=config.FIGURES_DIR / "cluster_pca.png")
    plotting.cluster_profiles(summary, SHARE_COLUMNS, path=config.FIGURES_DIR / "cluster_profiles.png")

    chosen = scores.set_index("k").loc[k]
    result = {
        "k": k,
        "silhouette": chosen["silhouette"],
        "davies_bouldin": chosen["davies_bouldin"],
        "k_scores": scores.to_dict(orient="records"),
        "clusters": summary.reset_index().to_dict(orient="records"),
    }
    save_json(result, config.REPORTS_DIR / "clustering.json")
    log.info("clustering: k=%d, styles: %s", k, ", ".join(names))
    return result
