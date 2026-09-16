"""Tests for the LTR training pipeline."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest

from ltr.data import load_csvs
from ltr.model import train, _build_groups_from_indices
from ltr.export import export_onnx


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

N_FEATURES = 20
SPEC_HASH_A = "aaaa"
SPEC_HASH_B = "bbbb"


def _write_csv(
    path: Path,
    *,
    n_queries: int = 6,
    products_per_query: int = 5,
    n_features: int = N_FEATURES,
    spec_hash: str = SPEC_HASH_A,
    seed: int = 42,
) -> None:
    rng = np.random.RandomState(seed)
    feature_names = [f"f{i}" for i in range(n_features)]
    header = ",".join(feature_names + ["grade", "qid"])

    rows = []
    for q in range(n_queries):
        for p in range(products_per_query):
            feats = rng.rand(n_features).tolist()
            grade = rng.choice([0, 1, 3])
            rows.append(",".join(str(v) for v in feats + [grade, q]))

    with open(path, "w") as f:
        f.write(header + "\n")
        f.write(f"# featureSpecHash={spec_hash}\n")
        for row in rows:
            f.write(row + "\n")


# ---------------------------------------------------------------------------
# data.py
# ---------------------------------------------------------------------------


class TestLoadCsvs:
    def test_load_csvs_asserts_matching_spec_hash(self, tmp_path: Path) -> None:
        _write_csv(tmp_path / "a.csv", spec_hash=SPEC_HASH_A)
        _write_csv(tmp_path / "b.csv", spec_hash=SPEC_HASH_B, seed=99)

        with pytest.raises(ValueError, match="hash mismatch"):
            load_csvs(str(tmp_path))

    def test_load_csvs_reads_valid_data(self, tmp_path: Path) -> None:
        _write_csv(tmp_path / "data.csv", n_queries=3, products_per_query=4)

        X, y, qid, group_sizes, spec_hash = load_csvs(str(tmp_path))

        assert X.shape == (12, N_FEATURES)
        assert X.dtype == np.float32
        assert y.shape == (12,)
        assert len(group_sizes) == 3
        assert sum(group_sizes) == 12
        assert spec_hash == SPEC_HASH_A


# ---------------------------------------------------------------------------
# model.py
# ---------------------------------------------------------------------------


class TestModel:
    def test_group_kfold_never_splits_a_query(self) -> None:
        """30 synthetic queries — no qid should appear in both train and val."""
        rng = np.random.RandomState(42)
        n_queries = 30
        products_per_query = 5
        n = n_queries * products_per_query

        X = rng.rand(n, N_FEATURES).astype(np.float32)
        y = rng.choice([0, 1, 3], size=n).astype(np.int32)
        qid = np.repeat(np.arange(n_queries), products_per_query)

        from sklearn.model_selection import GroupKFold

        gkf = GroupKFold(n_splits=5)
        for train_idx, val_idx in gkf.split(X, y, groups=qid):
            train_qids = set(qid[train_idx])
            val_qids = set(qid[val_idx])
            assert train_qids.isdisjoint(val_qids), "query split into both train and val"

    def test_train_on_synthetic_ranks_relevant_first(self, tmp_path: Path) -> None:
        """Grade-3 row should be scored highest by the model."""
        rng = np.random.RandomState(1736)
        n_queries = 6
        products_per_query = 5
        n = n_queries * products_per_query

        X = rng.rand(n, N_FEATURES).astype(np.float32)
        y = np.zeros(n, dtype=np.int32)

        # Make grade-3 rows have high feature values so the model can learn
        for q in range(n_queries):
            start = q * products_per_query
            # Best product in each query
            y[start] = 3
            X[start] = rng.rand(N_FEATURES).astype(np.float32) + 2.0
            # Second best
            y[start + 1] = 1
            X[start + 1] = rng.rand(N_FEATURES).astype(np.float32) + 1.0

        qid = np.repeat(np.arange(n_queries), products_per_query)
        group_sizes = [products_per_query] * n_queries
        feature_names = [f"f{i}" for i in range(N_FEATURES)]

        booster, info = train(
            X, y, qid, group_sizes,
            seed=1736,
            grid="none",
            feature_names=feature_names,
            n_rounds=50,
        )

        # Score the first query's products
        scores = booster.predict(X[:products_per_query])
        best_idx = int(np.argmax(scores))
        assert best_idx == 0, f"Expected grade-3 row (idx 0) scored highest, got idx {best_idx}"


# ---------------------------------------------------------------------------
# export.py
# ---------------------------------------------------------------------------


class TestExport:
    def _train_smoke(self) -> tuple:
        rng = np.random.RandomState(1736)
        n_queries = 20
        ppq = 8
        n = n_queries * ppq
        n_feat = N_FEATURES

        X = rng.rand(n, n_feat).astype(np.float32)
        y = np.zeros(n, dtype=np.int32)
        for q in range(n_queries):
            y[q * ppq] = 3
            X[q * ppq, :5] += 2.0
            y[q * ppq + 1] = 1
            X[q * ppq + 1, :5] += 1.0

        qid = np.repeat(np.arange(n_queries), ppq)
        group_sizes = [ppq] * n_queries
        feature_names = [f"f{i}" for i in range(n_feat)]

        booster, info = train(
            X, y, qid, group_sizes,
            seed=1736, grid="none", feature_names=feature_names, n_rounds=100,
        )
        return booster, info, feature_names, X

    def test_export_onnx_matches_lightgbm(self, tmp_path: Path) -> None:
        booster, info, feature_names, X = self._train_smoke()

        onnx_path = export_onnx(
            booster,
            version="test",
            feature_names=feature_names,
            feature_spec_hash="testhash",
            info=info,
            output_dir=str(tmp_path),
            X_parity=X,
        )

        import onnxruntime as ort

        sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        input_name = sess.get_inputs()[0].name
        onnx_scores = sess.run(None, {input_name: X.astype(np.float32)})[0].flatten()
        lgb_scores = booster.predict(X)

        np.testing.assert_allclose(onnx_scores, lgb_scores, atol=1e-5)

    def test_meta_contains_required_keys(self, tmp_path: Path) -> None:
        booster, info, feature_names, X = self._train_smoke()

        export_onnx(
            booster,
            version="test",
            feature_names=feature_names,
            feature_spec_hash="hash123",
            info=info,
            output_dir=str(tmp_path),
            X_parity=X,
        )

        meta_path = tmp_path / "ltr-test.meta.json"
        meta = json.loads(meta_path.read_text())

        required_keys = [
            "git_sha",
            "feature_spec_hash",
            "feature_names",
            "input_name",
            "params",
            "best_iteration",
            "cv",
            "importance",
            "holdout_untouched",
        ]
        for key in required_keys:
            assert key in meta, f"Missing required key: {key}"

        assert meta["feature_spec_hash"] == "hash123"
        assert meta["holdout_untouched"] is True

    def test_parity_fixture_has_50_rows_or_all_rows(self, tmp_path: Path) -> None:
        booster, info, feature_names, X = self._train_smoke()

        export_onnx(
            booster,
            version="test",
            feature_names=feature_names,
            feature_spec_hash="hash",
            info=info,
            output_dir=str(tmp_path),
            X_parity=X,
            max_parity_rows=50,
        )

        parity_path = tmp_path / "ltr-test.parity.json"
        parity = json.loads(parity_path.read_text())

        # X has 160 rows (20 queries * 8 products), capped at 50
        expected_n = min(50, X.shape[0])
        assert len(parity) == expected_n

        for entry in parity:
            assert "features" in entry
            assert "score" in entry
            assert len(entry["features"]) == N_FEATURES
