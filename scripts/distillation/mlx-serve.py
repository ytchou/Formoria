"""Minimal HTTP server wrapping mlx_lm.generate for the fine-tuned model.
Exposes an Ollama-compatible /api/chat endpoint on port 11435.
Usage: python scripts/distillation/mlx-serve.py [--model PATH] [--port PORT]
"""
import argparse
import json
import re
from http.server import HTTPServer, BaseHTTPRequestHandler

import mlx.core as mx
from mlx_lm import load, generate


parser = argparse.ArgumentParser()
parser.add_argument("--model", default="runs/qwen3-0.6b-finetuned")
parser.add_argument("--port", type=int, default=11435)
cli_args = parser.parse_args()

MODEL_PATH = cli_args.model
PORT = cli_args.port

print(f"Loading model from {MODEL_PATH}...")
model, tokenizer = load(MODEL_PATH)
print(f"Model loaded. Serving on http://localhost:{PORT}")


def extract_json(text: str) -> str:
    """Extract JSON from model output, handling think blocks and wrapping text."""
    # Strip <think>...</think> blocks
    cleaned = re.sub(r"<think>.*?</think>\s*", "", text, flags=re.DOTALL).strip()
    # Try to find a JSON object in the output
    match = re.search(r"\{[^{}]*\}", cleaned)
    if match:
        return match.group(0)
    return cleaned


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/api/chat":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length))

        messages = body.get("messages", [])
        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
            enable_thinking=False,
        )

        response_text = generate(
            model, tokenizer, prompt=prompt,
            max_tokens=256, verbose=False,
        )

        cleaned = extract_json(response_text)

        result = {
            "message": {"role": "assistant", "content": cleaned},
            "done": True,
        }

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())

    def log_message(self, format, *args):
        print(f"[mlx-serve] {args[0]}")


if __name__ == "__main__":
    import os
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"Listening on http://localhost:{PORT}/api/chat")
    server.serve_forever()
