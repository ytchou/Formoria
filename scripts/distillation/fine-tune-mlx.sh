#!/usr/bin/env bash
# @formoria-script
# Classification distillation: QLoRA fine-tune Qwen3-1.7B via MLX on Apple Silicon
# Prerequisite: run `pnpm distill:export` first to produce runs/train.jsonl + runs/eval.jsonl

set -euo pipefail
cd "$(dirname "$0")"

MODEL_NAME="Qwen/Qwen3-1.7B"
MLX_MODEL="models/qwen3-1.7b-mlx"
ADAPTER_PATH="runs/adapter"
FUSED_PATH="runs/qwen3-1.7b-finetuned"
OLLAMA_MODEL="formoria-classifier"

# --------------------------------------------------------------------------
# 1. Install MLX fine-tuning tools
# --------------------------------------------------------------------------
echo "=== Step 1: Install mlx-lm ==="
pip install mlx-lm

# --------------------------------------------------------------------------
# 2. Download and convert model to MLX format
# --------------------------------------------------------------------------
echo "=== Step 2: Download + convert $MODEL_NAME ==="
python -m mlx_lm.convert \
  --hf-path "$MODEL_NAME" \
  --mlx-path "$MLX_MODEL"

# --------------------------------------------------------------------------
# 3. QLoRA fine-tune
# --------------------------------------------------------------------------
echo "=== Step 3: QLoRA fine-tune ==="
python -m mlx_lm.lora \
  --model "$MLX_MODEL" \
  --train \
  --data runs/ \
  --adapter-path "$ADAPTER_PATH" \
  --batch-size 4 \
  --lora-layers 8 \
  --epochs 3

# --------------------------------------------------------------------------
# 4. Fuse adapter weights into the base model
# --------------------------------------------------------------------------
echo "=== Step 4: Fuse adapter ==="
python -m mlx_lm.fuse \
  --model "$MLX_MODEL" \
  --adapter-path "$ADAPTER_PATH" \
  --save-path "$FUSED_PATH"

# --------------------------------------------------------------------------
# 5. Convert to GGUF (MANUAL — depends on local llama.cpp setup)
# --------------------------------------------------------------------------
echo "=== Step 5: Convert to GGUF (manual) ==="
echo ""
echo "This step requires manual execution. Choose one:"
echo ""
echo "Option A — via mlx_lm (if supported):"
echo "  python -m mlx_lm.convert --mlx-path $FUSED_PATH --upload-repo <user>/qwen3-1.7b-formoria --quantize q4_k_m"
echo ""
echo "Option B — via llama.cpp:"
echo "  git clone https://github.com/ggerganov/llama.cpp && cd llama.cpp"
echo "  python convert_hf_to_gguf.py ../$FUSED_PATH --outtype q4_k_m --outfile ../runs/qwen3-1.7b-formoria.gguf"
echo ""
echo "After conversion, proceed with Step 6 below."

# --------------------------------------------------------------------------
# 6. Import into Ollama (run manually after GGUF conversion)
# --------------------------------------------------------------------------
GGUF_PATH="runs/qwen3-1.7b-formoria.gguf"
if [ ! -f "$GGUF_PATH" ]; then
  echo "=== Step 6: Skipped — $GGUF_PATH not found. Run Step 5 first. ==="
  exit 0
fi

echo "=== Step 6: Create Ollama model ==="

# The Modelfile sits next to the GGUF so FROM uses a relative path.
# No SYSTEM block — callers must supply the category-classify system prompt
# that matches training (the Langfuse category-classify prompt).
cat > runs/Modelfile <<MODELFILE
FROM ./$( basename "$GGUF_PATH" )

PARAMETER temperature 0
PARAMETER num_ctx 4096
MODELFILE

ollama create "$OLLAMA_MODEL" -f runs/Modelfile
echo "=== Done! Model available as: ollama run $OLLAMA_MODEL ==="
