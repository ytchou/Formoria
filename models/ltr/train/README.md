# LTR (Learning to Rank) Training

Train a LambdaMART model on graded search relevance data and export to ONNX for Node.js inference.

## Setup

```bash
uv sync --project models/ltr/train
```

## Usage

### Train a model

```bash
pnpm search:eval export-features --dataset v3 --split train,val,holdout
mkdir -p /tmp/formoria-ltr-v2-train
cp scripts/enrichment/eval/search-eval/runs/situation-search-v3-features-{train,val}.csv /tmp/formoria-ltr-v2-train/
pnpm ltr:train --features-dir /tmp/formoria-ltr-v2-train --version v2 --grid small --seed 1900
```

The trainer reads every CSV in its feature directory. Keep the holdout export
out of that directory.

### Generate smoke model (synthetic data)

```bash
pnpm ltr:train --write-smoke --seed 1900
```

### Run tests

```bash
pnpm ltr:test
```

## CSV format

Each CSV file must have:
- Line 1: header row with feature columns + `grade` + `qid`
- Line 2: `# featureSpecHash=<64-hex-sha256>`
- Remaining lines: data rows

The `featureSpecHash` must match across all CSVs and corresponds to `featureSpecHash` in `src/lib/services/ltr-features.ts`.

## Output

Models are written to `models/ltr/`:
- `<version>.onnx` — the ONNX model
- `<version>.meta.json` — training metadata
- `<version>.parity.json` — parity fixture for Node.js tests
