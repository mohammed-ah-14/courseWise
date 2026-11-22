"""Command line interface.

    python3 -m coursewise download             # fetch raw data into data/raw
    python3 -m coursewise prepare              # clean + build features
    python3 -m coursewise train [--fast]       # tasks 1-4, all models
    python3 -m coursewise cluster              # task 5, grading styles
    python3 -m coursewise explain              # SHAP + error analysis
    python3 -m coursewise all [--fast]         # prepare -> train -> cluster -> explain
    python3 -m coursewise export               # JSON for the website -> ../frontend/data
    python3 -m coursewise threshold            # tune the high-risk decision threshold
    python3 -m coursewise serve [--port 8000]  # website + live prediction API
"""

import argparse

from . import config
from .tasks import TASKS
from .utils import setup_logging


def _parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="coursewise", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["download", "prepare", "train", "cluster", "explain", "all", "export",
                                            "threshold", "serve"])
    parser.add_argument("--tasks", nargs="+", choices=list(TASKS), default=list(TASKS),
                        help="tasks to train / explain (default: all)")
    parser.add_argument("--models", nargs="+", default=None,
                        help="only these models, e.g. --models baseline linear xgboost")
    parser.add_argument("--n-iter", type=int, default=config.DEFAULT_SEARCH_ITERATIONS,
                        help="random-search iterations per model")
    parser.add_argument("--fast", action="store_true",
                        help="quick run: few search iterations and at most 20k training rows")
    parser.add_argument("--k", type=int, default=None,
                        help="number of clusters (default: best silhouette for k >= 3)")
    parser.add_argument("--port", type=int, default=config.API_PORT, help="port for `serve`")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args(argv)


def _training_options(args):
    from .training import TrainingOptions

    if args.fast:
        return TrainingOptions(args.models, config.FAST_SEARCH_ITERATIONS, config.FAST_MAX_TRAIN_ROWS)
    return TrainingOptions(args.models, args.n_iter)


def main(argv=None) -> None:
    args = _parse_args(argv)
    setup_logging(args.verbose)
    # Imports are local so that e.g. `download` works before the ML libraries are installed.
    from . import pipeline

    if args.command == "download":
        from .download import download_all
        download_all(config.RAW_DIR)
    if args.command in ("prepare", "all"):
        pipeline.prepare(config.RAW_DIR)
    if args.command in ("train", "all"):
        pipeline.train(args.tasks, _training_options(args))
    if args.command in ("cluster", "all"):
        pipeline.cluster(args.k)
    if args.command in ("explain", "all"):
        pipeline.explain(args.tasks)
    if args.command == "threshold":
        pipeline.threshold(args.tasks)
    if args.command in ("export", "all"):
        from .export import export_frontend_data
        export_frontend_data()
    if args.command == "serve":
        pipeline.serve(args.port)


if __name__ == "__main__":
    main()
