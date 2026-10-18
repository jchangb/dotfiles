# local-llm

A free local model that Claude Code can hand cheap work to: llama.cpp in router mode, an MCP server with no dependencies, and a [`local-llm` skill](../skills/local-llm/SKILL.md) that tells Claude when to use it.

```
Claude Code ──MCP──▶ mcp/local-llm.mjs ──HTTP──▶ llama-server :8080 ──▶ RTX 4070 Ti
                         (starts it if down)        (unloads after 5 min idle)
```

Claude stays the planner and reviewer. The local model does bulk text transforms — tagging, summarizing, formatting checks — and, through `local_llm_files`, reads the files itself so their contents never cost Claude tokens.

## What lives where

| In this repo | Outside (`Z:\Apps\LLM`, or `$env:LLM_ROOT`) |
|---|---|
| `models.ini` — model presets | `llama-cuda\` — llama.cpp binaries |
| `start-llm.ps1` — launches the router | `models\` — GGUF files |
| `test-model.ps1` — speed + sanity check | `server.log` |
| `mcp/local-llm.mjs` — MCP server | |
| `install.ps1` — registers MCP + skill | |

## Setup on a new machine

1. **llama.cpp, CUDA build** from the [official releases](https://github.com/ggml-org/llama.cpp/releases): `llama-<build>-bin-win-cuda-13.4-x64.zip` and `cudart-llama-bin-win-cuda-13.4-x64.zip`, both extracted into `Z:\Apps\LLM\llama-cuda`. Not the winget package: that one is the Vulkan build, which generates at 2.6 tok/s on the 4070 Ti against ~45 for CUDA.
2. **Models** into `Z:\Apps\LLM\models`:
   - [`unsloth/gemma-4-12B-it-qat-GGUF`](https://huggingface.co/unsloth/gemma-4-12B-it-qat-GGUF) → `gemma-4-12B-it-qat-UD-Q4_K_XL.gguf` (6.7 GB)
   - [`unsloth/Qwen3.6-35B-A3B-GGUF`](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF) → `Qwen3.6-35B-A3B-UD-Q4_K_M.gguf` (22.1 GB)
3. **Register with Claude Code** (every profile on the machine):

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

4. Check it: `.\test-model.ps1` should answer in under ~20 s at 40+ tok/s.

A different drive means editing the absolute paths in `models.ini` and setting `LLM_ROOT`.

## Choices worth knowing

- **16k context, one slot.** 32k × 4 slots overflowed VRAM once four monitors had taken their ~3 GB, and llama.cpp silently fell back to system RAM.
- **One model loaded at a time** (`--models-max 1`) — the two don't fit together.
- **Qwen keeps its experts in RAM** (`cpu-moe`). Only ~3B of its 35B parameters are active per token, so it still generates at ~38 tok/s while using little VRAM.
- **No power cap.** The card games too; inference is memory-bound and draws less than a game does.
- **Thinking off by default** in the MCP tools. Qwen otherwise spends ~2,500 tokens reasoning about a one-line answer.
