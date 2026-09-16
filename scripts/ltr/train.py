# @formoria-script
# purpose: Train a LambdaMART model on graded search relevance data and export to ONNX.
# class: operator
# invoke: pnpm ltr:train
# target: none
# safety: writes-on-apply
# owner: engineering

from __future__ import annotations

import argparse
import csv
import os
import sys
import tempfile
from pathlib import Path

import numpy as np

from ltr.data import load_csvs
from ltr.model import train
from ltr.export import export_onnx

# The real 20-feature spec hash (computed from the TS module's FEATURE_SPEC)
FEATURE_SPEC_HASH = "a3745c54e2a4ed40323f1eefbf04a7a95f441cc7aef135a27f14d95d2d3bdf69"

SMOKE_FEATURE_COUNT = 20
SMOKE_N_QUERIES = 30
SMOKE_PRODUCTS_PER_QUERY = 8


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train a LambdaMART ranker and export to ONNX."
    )
    parser.add_argument("--features-dir", type=str, help="Directory containing feature CSVs")
    parser.add_argument("--version", type=str, default="v1")
    parser.add_argument("--grid", choices=["small", "none"], default="small")
    parser.add_argument("--seed", type=int, default=1736)
    parser.add_argument("--write-smoke", action="store_true", help="Generate synthetic smoke model")
    parser.add_argument(
        "--feature-spec-hash",
        type=str,
        default=FEATURE_SPEC_HASH,
        help="Feature spec hash to embed in the smoke model metadata",
    )
    args = parser.parse_args()

    if args.write_smoke:
        _write_smoke(args)
        return

    if not args.features_dir:
        parser.error("--features-dir is required unless --write-smoke is set")

    X, y, qid, group_sizes, spec_hash = load_csvs(args.features_dir)
    feature_names = _read_feature_names(args.features_dir)

    print(f"Loaded {X.shape[0]} rows, {X.shape[1]} features, {len(group_sizes)} queries")
    print(f"Feature spec hash: {spec_hash}")

    booster, info = train(
        X, y, qid, group_sizes,
        seed=args.seed,
        grid=args.grid,
        feature_names=feature_names,
    )

    print(f"Best NDCG@10: {info['cv']['mean_ndcg10']:.4f}")
    print(f"Best iteration: {info['best_iteration']}")

    onnx_path = export_onnx(
        booster,
        version=args.version,
        feature_names=feature_names,
        feature_spec_hash=spec_hash,
        info=info,
        X_parity=X,
    )
    print(f"Exported: {onnx_path}")


def _write_smoke(args: argparse.Namespace) -> None:
    """Generate a synthetic dataset, train, and export smoke model."""
    rng = np.random.RandomState(args.seed)

    feature_names = [f"f{i}" for i in range(SMOKE_FEATURE_COUNT)]
    n_rows = SMOKE_N_QUERIES * SMOKE_PRODUCTS_PER_QUERY

    X = rng.rand(n_rows, SMOKE_FEATURE_COUNT).astype(np.float32)
    # Grades: first few features drive relevance (clear synthetic signal)
    raw_scores = X[:, :5].sum(axis=1)
    y = np.zeros(n_rows, dtype=np.int32)
    for q in range(SMOKE_N_QUERIES):
        start = q * SMOKE_PRODUCTS_PER_QUERY
        end = start + SMOKE_PRODUCTS_PER_QUERY
        q_scores = raw_scores[start:end]
        ranks = q_scores.argsort().argsort()  # rank within query
        for j, r in enumerate(ranks):
            if r >= SMOKE_PRODUCTS_PER_QUERY - 1:
                y[start + j] = 3
                # Boost relevant items so the model can distinguish them
                X[start + j, :5] += 2.0
            elif r >= SMOKE_PRODUCTS_PER_QUERY - 2:
                y[start + j] = 1
                X[start + j, :5] += 1.0
            else:
                y[start + j] = 0

    qid = np.repeat(np.arange(SMOKE_N_QUERIES), SMOKE_PRODUCTS_PER_QUERY)
    group_sizes = [SMOKE_PRODUCTS_PER_QUERY] * SMOKE_N_QUERIES

    booster, info = train(
        X, y, qid, group_sizes,
        seed=args.seed,
        grid="none",
        feature_names=feature_names,
        n_rounds=200,
    )

    onnx_path = export_onnx(
        booster,
        version="smoke",
        feature_names=feature_names,
        feature_spec_hash=args.feature_spec_hash,
        info=info,
        X_parity=X,
    )
    print(f"Smoke model exported: {onnx_path}")


def _read_feature_names(features_dir: str) -> list[str]:
    """Read feature column names from the first CSV header."""
    csv_dir = Path(features_dir)
    csv_files = sorted(csv_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files in {features_dir}")

    with open(csv_files[0]) as f:
        header = f.readline().strip().split(",")

    return [c for c in header if c not in ("grade", "qid")]


if __name__ == "__main__":
    main()
