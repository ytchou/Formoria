"""Load and validate LTR training CSVs."""

from __future__ import annotations

import csv
import os
from pathlib import Path

import numpy as np
import pandas as pd


def load_csvs(features_dir: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, list[int], str]:
    """Read all CSVs from *features_dir*, validate spec hashes match.

    Returns (X, y, qid, group_sizes, feature_spec_hash).

    Each CSV has:
      - Line 1: header row (feature columns + ``grade`` + ``qid``)
      - Line 2: ``# featureSpecHash=<hex>``
      - Remaining: data rows
    """
    csv_dir = Path(features_dir)
    csv_files = sorted(csv_dir.glob("*.csv"))
    if not csv_files:
        raise FileNotFoundError(f"No CSV files found in {features_dir}")

    all_frames: list[pd.DataFrame] = []
    spec_hash: str | None = None

    for csv_path in csv_files:
        with open(csv_path) as f:
            header_line = f.readline().strip()
            comment_line = f.readline().strip()

        if not comment_line.startswith("# featureSpecHash="):
            raise ValueError(
                f"{csv_path.name}: line 2 must be '# featureSpecHash=<hex>', "
                f"got: {comment_line!r}"
            )

        file_hash = comment_line.split("=", 1)[1].strip()
        if spec_hash is None:
            spec_hash = file_hash
        elif file_hash != spec_hash:
            raise ValueError(
                f"Feature spec hash mismatch across CSVs: "
                f"{spec_hash} vs {file_hash} in {csv_path.name}"
            )

        df = pd.read_csv(csv_path, comment="#")
        all_frames.append(df)

    assert spec_hash is not None
    combined = pd.concat(all_frames, ignore_index=True)

    feature_cols = [c for c in combined.columns if c not in ("grade", "qid")]
    X = combined[feature_cols].values.astype(np.float32)
    y = combined["grade"].values.astype(np.int32)
    qid = combined["qid"].values

    # Compute group sizes (contiguous runs of the same qid)
    unique_qids = []
    group_sizes = []
    current_qid = None
    current_count = 0
    for q in qid:
        if q != current_qid:
            if current_qid is not None:
                unique_qids.append(current_qid)
                group_sizes.append(current_count)
            current_qid = q
            current_count = 1
        else:
            current_count += 1
    if current_qid is not None:
        unique_qids.append(current_qid)
        group_sizes.append(current_count)

    return X, y, np.array(unique_qids), group_sizes, spec_hash
