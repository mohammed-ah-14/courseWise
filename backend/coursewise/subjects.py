"""Manual mapping of UIUC subject codes to broad department groups.

Subjects not listed fall into "Other". The model also sees the exact
subject code, so this grouping mainly helps rare subjects.
"""

DEPARTMENT_GROUPS = {
    "Engineering": [
        "ABE", "AE", "BIOE", "CEE", "CHBE", "CS", "CSE", "ECE", "ENG", "IE",
        "ME", "MSE", "NPRE", "SE", "TAM", "TE",
    ],
    "Sciences": [
        "ASTR", "ATMS", "BIOC", "BIOP", "CHEM", "ESE", "GEOL", "IB", "MATH",
        "MCB", "NEUR", "PHYS", "PLPA", "STAT", "ENVS", "GLBL",
    ],
    "Business": ["ACCY", "BADM", "BDI", "BUS", "FIN", "MBA", "TMGT", "LER"],
    "Social Sciences": [
        "AAS", "AFRO", "AIS", "ANTH", "ECON", "GEOG", "GWS", "LAST", "LLS",
        "PS", "PSYC", "SOC", "SOCW", "URBP", "UP",
    ],
    "Humanities & Arts": [
        "ARCH", "ART", "ARTD", "ARTE", "ARTH", "ARTS", "CHIN", "CLCV", "CMN",
        "CWL", "DANC", "EALC", "ENGL", "FAA", "FR", "GER", "GRK", "HIST",
        "ITAL", "JAPN", "KOR", "LAT", "LING", "MUS", "MUSE", "PHIL", "PORT",
        "REL", "RHET", "RUSS", "SLAV", "SPAN", "THEA", "CW", "ESL", "EIL",
        "ARAB", "HEBR", "SAME", "SCAN", "TURK", "MDIA",
    ],
    "Agriculture & Health": [
        "ACE", "ACES", "AGED", "ANSC", "CHLH", "CPSC", "FSHN", "HDFS", "HK",
        "KIN", "NRES", "NUTR", "RST", "SHS", "TSM", "CHP", "HORT", "AHS",
    ],
    "Education": ["CI", "EDPR", "EDUC", "EOL", "EPOL", "EPS", "EPSY", "HRD", "SPED"],
    "Media": ["ADV", "JOUR", "MACS", "MS", "INFO", "IS", "LIS"],
}

SUBJECT_TO_GROUP = {
    subject: group for group, subjects in DEPARTMENT_GROUPS.items() for subject in subjects
}


def department_group(subject: str) -> str:
    return SUBJECT_TO_GROUP.get(subject, "Other")
