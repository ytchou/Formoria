# LTR (Learning to Rank) Training

Train a LambdaMART model on graded search relevance data and export to ONNX for Node.js inference.

## Setup

```bash
uv sync --project scripts/ltr
```

## Usage

### Train a model

```bash
pnpm ltr:train -- --features-dir <path-to-csvs> --version v1 --grid small --seed 1736
```

### Generate smoke model (synthetic data)

```bash
pnpm ltr:train -- --write-smoke --seed 1736
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

Models are written to the repo root `models/` directory:
- `ltr-<version>.onnx` — the ONNX model
- `ltr-<version>.meta.json` — training metadata
- `ltr-<version>.parity.json` — parity fixture for Node.js tests
