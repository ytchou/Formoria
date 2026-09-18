"""Export a LightGBM booster to ONNX and write metadata + parity fixtures."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import lightgbm as lgb
import numpy as np
import onnxmltools
import onnxruntime as ort
from onnxmltools.convert.common.data_types import FloatTensorType


def export_onnx(
    booster: lgb.Booster,
    *,
    version: str,
    feature_names: list[str],
    feature_spec_hash: str,
    info: dict[str, Any],
    output_dir: str = "models/ltr",
    max_parity_rows: int = 50,
    X_parity: np.ndarray | None = None,
) -> Path:
    """Convert *booster* to ONNX format and write companion files.

    Returns the path to the saved ``.onnx`` file.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    n_features = len(feature_names)
    onnx_model = onnxmltools.convert_lightgbm(
        booster,
        initial_types=[("features", FloatTensorType([None, n_features]))],
        target_opset=15,
    )

    onnx_path = out / f"{version}.onnx"
    onnxmltools.utils.save_model(onnx_model, str(onnx_path))

    # Determine input name from the ONNX model
    input_name = onnx_model.graph.input[0].name

    # Git SHA (best-effort)
    git_sha = _git_sha()

    # Meta JSON
    meta = {
        "git_sha": git_sha,
        "feature_spec_hash": feature_spec_hash,
        "feature_names": feature_names,
        "input_name": input_name,
        "params": info.get("params", {}),
        "best_iteration": info.get("best_iteration"),
        "cv": info.get("cv", {}),
        "importance": info.get("importance", {}),
        "holdout_untouched": True,
    }

    meta_path = out / f"{version}.meta.json"
    meta_path.write_text(json.dumps(meta, indent=2, default=str) + "\n")

    # Parity fixture
    if X_parity is not None:
        _write_parity(onnx_path, input_name, X_parity, max_parity_rows, out, version)

    return onnx_path


def _write_parity(
    onnx_path: Path,
    input_name: str,
    X: np.ndarray,
    max_rows: int,
    out: Path,
    version: str,
) -> None:
    n = min(max_rows, X.shape[0])
    X_subset = X[:n].astype(np.float32)

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    results = sess.run(None, {input_name: X_subset})
    scores = results[0].flatten().tolist()

    parity = [
        {"features": X_subset[i].tolist(), "score": scores[i]}
        for i in range(n)
    ]

    parity_path = out / f"{version}.parity.json"
    parity_path.write_text(json.dumps(parity, indent=2) + "\n")


def _git_sha() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.stdout.strip() or None
    except Exception:
        return None
