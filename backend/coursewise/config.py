"""Project-wide settings: paths, data sources, grade scale, splits and seeds.

Every other module reads its constants from here, so changing a setting
(for example the test years) only needs one edit.
"""

from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #
BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
ARTIFACTS_DIR = BACKEND_DIR / "artifacts"
MODELS_DIR = ARTIFACTS_DIR / "models"
REPORTS_DIR = ARTIFACTS_DIR / "reports"
FIGURES_DIR = ARTIFACTS_DIR / "figures"

OFFERINGS_FILE = PROCESSED_DIR / "offerings.csv"
CATALOG_COURSES_FILE = PROCESSED_DIR / "catalog_courses.csv"
FEATURES_FILE = PROCESSED_DIR / "features.csv"

# --------------------------------------------------------------------------- #
# Data sources (UIUC datasets by Prof. Wade Fagen-Ulmschneider)
# --------------------------------------------------------------------------- #
GPA_FILE_NAME = "uiuc-gpa-dataset.csv"
GPA_URL = (
    "https://raw.githubusercontent.com/wadefagen/datasets/main/gpa/"
    "uiuc-gpa-dataset.csv"
)
GPA_ENCODING = "latin-1"  # the GPA file is not valid UTF-8

CATALOG_DIR_NAME = "catalog"
CATALOG_URL_TEMPLATE = (
    "https://raw.githubusercontent.com/wadefagen/datasets/main/course-catalog/"
    "data/{year_term}.csv"
)
# The catalog starts in Fall 2016. Spring + Fall of every year covers almost
# every course; Summer/Winter files add little and cost ~9 MB each.
CATALOG_TERMS = ["2016-fa"] + [
    f"{year}-{term}" for year in range(2017, 2027) for term in ("sp", "fa")
]

# --------------------------------------------------------------------------- #
# Grade scale
# --------------------------------------------------------------------------- #
GRADE_POINTS = {
    "A+": 4.00, "A": 4.00, "A-": 3.67,
    "B+": 3.33, "B": 3.00, "B-": 2.67,
    "C+": 2.33, "C": 2.00, "C-": 1.67,
    "D+": 1.33, "D": 1.00, "D-": 0.67,
    "F": 0.00,
}
GRADE_COLUMNS = list(GRADE_POINTS)
DFW_GRADE_COLUMNS = ["D+", "D", "D-", "F"]  # plus the withdrawn count

# Letter groups used for clustering grade distributions.
LETTER_GROUPS = {
    "share_A": ["A+", "A", "A-"],
    "share_B": ["B+", "B", "B-"],
    "share_C": ["C+", "C", "C-"],
    "share_D": ["D+", "D", "D-"],
    "share_F": ["F"],
}

# --------------------------------------------------------------------------- #
# Terms
# --------------------------------------------------------------------------- #
# Winter is placed first: whichever calendar month it really falls in,
# this order never lets a Winter row "see" a later term as history.
TERM_ORDER = {"Winter": 0, "Spring": 1, "Summer": 2, "Fall": 3}
COVID_YEARS = (2020, 2021)
ONLINE_SCHED_TYPES = {"ONL", "OLC", "OD", "OLB"}
UNKNOWN = "Unknown"

# --------------------------------------------------------------------------- #
# Labels
# --------------------------------------------------------------------------- #
DIFFICULTY_CLASSES = ("Hard", "Medium", "Easy")  # codes 0, 1, 2
HIGH_RISK_QUANTILE = 0.80  # top 20% DFW rate within each year

# --------------------------------------------------------------------------- #
# Time-based split
# --------------------------------------------------------------------------- #
FIRST_TRAIN_YEAR = 2010  # 2005-2009 only feed the history features
TRAIN_YEARS = (2010, 2022)
VAL_YEARS = (2023, 2024)
TEST_YEARS = (2025, 2026)
CV_FOLD_YEARS = (2018, 2019, 2020, 2021, 2022)  # expanding-window CV folds

# --------------------------------------------------------------------------- #
# Modelling
# --------------------------------------------------------------------------- #
RANDOM_STATE = 42
DEFAULT_SEARCH_ITERATIONS = 12
FAST_SEARCH_ITERATIONS = 3
FAST_MAX_TRAIN_ROWS = 20_000
# Training rows are weighted by class_size ** power (0 = no weights). Big
# classes have far less noisy average GPAs, so they deserve more weight;
# sqrt keeps small classes from being ignored.
SAMPLE_WEIGHT_POWER = 0.5
ENSEMBLE_SIZE = 3  # regression: also try the mean of the top-N models
RECENT_OFFERINGS = 3  # window for the "recent average GPA" features
EWM_HALFLIFE_OFFERINGS = 2  # recency weighting: weight halves every 2 offerings
SHRINK_STUDENTS = 60  # prior strength (in students) for shrunk history estimates
SHRINK_OFFSET_ROWS = 3  # prior strength (in offerings) for the instructor offset

# --------------------------------------------------------------------------- #
# Explainability and error analysis
# --------------------------------------------------------------------------- #
SHAP_SAMPLE_SIZE = 1_000
PERMUTATION_SAMPLE_SIZE = 3_000
TOP_FEATURES = 20
CLASS_SIZE_BINS = [0, 30, 50, 100, 200, float("inf")]

# --------------------------------------------------------------------------- #
# Clustering
# --------------------------------------------------------------------------- #
CLUSTER_K_RANGE = range(2, 11)  # k values scored for the elbow / silhouette plots
CLUSTER_MIN_K = 3  # k = 2 ("good" vs "bad") is too coarse to be useful
CLUSTER_SAMPLE_SIZE = 10_000  # rows used for silhouette / plots
COURSE_STYLE_RECENT_YEARS = 3

# --------------------------------------------------------------------------- #
# Frontend export (python3 -m coursewise export)
# --------------------------------------------------------------------------- #
FRONTEND_DATA_DIR = BACKEND_DIR.parent / "frontend" / "data"
EXPORT_FIRST_YEAR = 2016  # only courses offered in or after this year
EXPORT_RECENT_YEARS = 5  # course stats use the course's own last N years
EXPORT_TOP_INSTRUCTORS = 10
EXPORT_TOP_N = 10  # rows in the insights top lists
EXPORT_MIN_COURSE_STUDENTS = 500  # min recent students to enter a top list
EXPORT_MIN_SUBJECT_STUDENTS = 3_000
EXPORT_DFW_BIN = 5  # DFW histogram bin width (%)
EXPORT_DFW_MAX = 40  # last bin collects everything above this

# --------------------------------------------------------------------------- #
# Live forecasts (python3 -m coursewise serve)
# --------------------------------------------------------------------------- #
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"
API_HOST = "127.0.0.1"
API_PORT = 8000
FORECAST_TERMS = ("Spring", "Summer", "Fall")  # term types offered for forecasts
FORECAST_TERM_COUNT = 3  # how many upcoming terms the API offers
FORECAST_INSTRUCTOR_YEARS = 2  # "Any instructor" = instructors of the course's last N years
FORECAST_CACHE_SIZE = 512
