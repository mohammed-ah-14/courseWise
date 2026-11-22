"""Download the raw UIUC files into data/raw (run by the user, once)."""

import urllib.error
import urllib.request
from pathlib import Path

from . import config
from .utils import ensure_dir, log


def _fetch(url: str, target: Path) -> bool:
    if target.exists():
        log.info("exists, skipped: %s", target.name)
        return True
    try:
        urllib.request.urlretrieve(url, target)
    except urllib.error.HTTPError as error:
        log.warning("not available (%s): %s", error.code, url)
        return False
    log.info("downloaded: %s", target.name)
    return True


def download_all(raw_dir: Path = config.RAW_DIR) -> None:
    ensure_dir(raw_dir)
    _fetch(config.GPA_URL, raw_dir / config.GPA_FILE_NAME)

    catalog_dir = ensure_dir(raw_dir / config.CATALOG_DIR_NAME)
    for year_term in config.CATALOG_TERMS:
        url = config.CATALOG_URL_TEMPLATE.format(year_term=year_term)
        _fetch(url, catalog_dir / f"{year_term}.csv")
