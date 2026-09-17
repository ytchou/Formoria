"""Train a LambdaMART ranker with optional hyperparameter grid search."""

from __future__ import annotations

from itertools import product as cartesian
from typing import Any

import lightgbm as lgb
import numpy as np
from sklearn.model_selection import GroupKFold


# ---------------------------------------------------------------------------
# Grid
# ---------------------------------------------------------------------------

GRID_SMALL = {
    "num_leaves": [15, 31],
    "min_data_in_leaf": [20, 50],
    "learning_rate": [0.05, 0.1],
}

_BASE_PARAMS: dict[str, Any] = {
    "objective": "lambdarank",
    "metric": "ndcg",
    "eval_at": [5, 10],
    "lambdarank_truncation_level": 13,
    "label_gain": [0, 1, 3, 7],
    "feature_fraction": 0.8,
    "bagging_fraction": 0.8,
    "bagging_freq": 1,
    "verbose": -1,
}


def _expand_grid(grid: dict[str, list]) -> list[dict[str, Any]]:
    keys = list(grid.keys())
    combos = list(cartesian(*[grid[k] for k in keys]))
    return [dict(zip(keys, vals)) for vals in combos]


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------


def train(
    X: np.ndarray,
    y: np.ndarray,
    qid: np.ndarray,
    group_sizes: list[int],
    *,
    seed: int = 1736,
    grid: str = "small",
    feature_names: list[str] | None = None,
    n_rounds: int = 500,
) -> tuple[lgb.Booster, dict[str, Any]]:
    """Train a LambdaMART model with GroupKFold cross-validation.

    Returns (booster, info) where info contains params, best_iteration,
    cv results, and feature importance.
    """
    if grid == "none":
        combos = [{}]
    elif grid == "small":
        combos = _expand_grid(GRID_SMALL)
    else:
        raise ValueError(f"Unknown grid: {grid}")

    gkf = GroupKFold(n_splits=min(5, len(set(qid))))
    splits = list(gkf.split(X, y, groups=qid))

    best_score = -1.0
    best_params: dict[str, Any] = {}
    best_iterations: list[int] = []

    for combo in combos:
        params = {**_BASE_PARAMS, "seed": seed, **combo}
        fold_scores: list[float] = []
        fold_iters: list[int] = []

        for train_idx, val_idx in splits:
            # Build group sizes for train and val
            train_groups = _build_groups_from_indices(qid, train_idx)
            val_groups = _build_groups_from_indices(qid, val_idx)

            train_ds = lgb.Dataset(
                X[train_idx],
                label=y[train_idx],
                group=train_groups,
                feature_name=feature_names,
            )
            val_ds = lgb.Dataset(
                X[val_idx],
                label=y[val_idx],
                group=val_groups,
                feature_name=feature_names,
                reference=train_ds,
            )

            callbacks = [lgb.early_stopping(50, verbose=False)]
            booster = lgb.train(
                params,
                train_ds,
                num_boost_round=n_rounds,
                valid_sets=[val_ds],
                callbacks=callbacks,
            )
            # ndcg@10 is the second eval metric (index 1 in eval_at=[5,10])
            fold_scores.append(booster.best_score["valid_0"]["ndcg@10"])
            fold_iters.append(booster.best_iteration)

        mean_score = float(np.mean(fold_scores))
        if mean_score > best_score:
            best_score = mean_score
            best_params = params
            best_iterations = fold_iters

    # Refit on all data with the median best iteration
    median_iter = int(np.median(best_iterations))
    full_ds = lgb.Dataset(
        X, label=y, group=group_sizes, feature_name=feature_names
    )
    final_booster = lgb.train(
        best_params, full_ds, num_boost_round=median_iter
    )

    importance = dict(
        zip(
            feature_names or [f"f{i}" for i in range(X.shape[1])],
            final_booster.feature_importance(importance_type="gain").tolist(),
        )
    )

    info = {
        "params": best_params,
        "best_iteration": median_iter,
        "cv": {
            "mean_ndcg10": best_score,
            "fold_iterations": best_iterations,
        },
        "importance": importance,
    }

    return final_booster, info


def _build_groups_from_indices(
    qid: np.ndarray, indices: np.ndarray
) -> list[int]:
    """Build group sizes from a subset of indices, preserving order."""
    sub_qid = qid[indices]
    groups: list[int] = []
    current = None
    count = 0
    for q in sub_qid:
        if q != current:
            if current is not None:
                groups.append(count)
            current = q
            count = 1
        else:
            count += 1
    if current is not None:
        groups.append(count)
    return groups
