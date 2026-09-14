# Classification Distillation Experiment

Distill gpt-5.6-luna's brand classification knowledge into Qwen3-1.7B via QLoRA fine-tuning, then evaluate with a 3-way comparison.

## Prerequisites

- **Node.js 20+** and **pnpm** — for export and eval scripts
- **Python 3.10+** with `pip` — for MLX fine-tuning
- **mlx-lm** — `pip install mlx-lm` (Apple Silicon only)
- **Ollama** — for local model serving ([ollama.com](https://ollama.com))
- **Supabase access** — service role key for exporting audit data

## Workflow

### 1. Export training data

```bash
pnpm distill:export
# Dry run (stats only, no file writes):
pnpm distill:export -- --dry-run
```

Reads `brand_ai_results` classification audit rows and produces:
- `scripts/distillation/runs/train.jsonl` — 80% stratified by category
- `scripts/distillation/runs/eval.jsonl` — 20% holdout
- `scripts/distillation/runs/export-stats.json` — category distribution and counts

### 2. Fine-tune via MLX (Apple Silicon)

```bash
./scripts/distillation/fine-tune-mlx.sh
```

Runs the full QLoRA pipeline: download → convert → train → fuse → GGUF → Ollama import. Edit hyperparams (batch-size, lora-layers, epochs) directly in the script.

### 3. Evaluate

```bash
# Full 3-way comparison (requires Ollama + OpenAI API key):
pnpm distill:eval

# Single arm for iterative testing:
pnpm distill:eval -- --arm luna
pnpm distill:eval -- --arm foundation
pnpm distill:eval -- --arm fineTuned   # also accepts: finetuned
```

Produces `scripts/distillation/runs/eval-results.json` with per-arm accuracy, per-category breakdown, parse failure counts, and latency percentiles.

## Expected output

```
scripts/distillation/runs/
├── train.jsonl           # Training data (80%)
├── eval.jsonl            # Evaluation data (20%)
├── export-stats.json     # Export statistics
├── adapter/              # QLoRA adapter weights
├── qwen3-1.7b-finetuned/ # Fused model
├── Modelfile             # Ollama model definition
└── eval-results.json     # 3-way eval results
```

## Colab / Unsloth alternative

For non-Mac users or GPU-accelerated training:

1. Upload `runs/train.jsonl` to Google Drive
2. Open the [Unsloth Qwen3 fine-tuning notebook](https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune)
3. Replace the dataset path with your uploaded JSONL
4. Export as GGUF and download
5. Import into Ollama locally: `ollama create formoria-classifier -f Modelfile`

Unsloth supports Qwen3 out of the box and runs on Colab's free T4 GPU tier.

## Troubleshooting

- **`mlx_lm` import error**: Requires Apple Silicon (M1+). Use Unsloth/Colab on Intel/AMD.
- **Ollama connection refused**: Ensure `ollama serve` is running (`ollama list` to verify).
- **Out of memory during training**: Reduce `--batch-size` to 2 or `--lora-layers` to 4.
- **GGUF conversion fails**: Check llama.cpp is up to date (`git pull && make`).
