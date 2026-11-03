# Local model context profiles

This page explains why a local 27B model can fail a medium analysis with:

```text
Session compaction failed · 7K in · 512 out
Compaction summary reached the output token limit
request (8245 tokens) exceeds the available context size (8192 tokens)
```

The model is usually capable; the window and output budget are too small.
Ollama applies limits in this order:

1. **Request option** (`options.num_ctx`, `options.num_predict`) overrides
   everything. Sam-Harness uses the native `/api/chat` API and sends these.
2. **Modelfile parameter** (`PARAMETER num_ctx`, `PARAMETER num_predict`) is the
   default for that tag.
3. **Server default** (`OLLAMA_CONTEXT_LENGTH`) applies when neither of the
   above sets a value.

The OpenAI-compatible endpoint (`/v1/chat/completions`) does not expose
`num_ctx`, so desktop clients that use `/v1` cannot raise the window per
request. The model tag or the server default must be large enough.

## Diagnose

```powershell
ollama ps
ollama show --modelfile qwen-claude:27b-fast
[Environment]::GetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "User")
```

A healthy long-context profile should show:

```text
NAME                         ... CONTEXT
qwen-claude:27b-fast-32k     ... 32768
```

`ollama show` should list `num_ctx 32768` and `num_predict 4096` (or more),
not `8192` / `512`.

## Build a long-context profile

Reuse the existing model layers; only the manifest changes, so this does not
duplicate the 14 GB blob.

```powershell
@'
FROM qwen-claude:27b-fast
PARAMETER num_thread 24
PARAMETER temperature 0.3
PARAMETER num_batch 2048
PARAMETER num_ctx 32768
PARAMETER num_predict 4096
'@ | Set-Content -Encoding ascii "$env:TEMP\Modelfile.27b-32k"

ollama create qwen-claude:27b-fast-32k -f "$env:TEMP\Modelfile.27b-32k"
```

Use `65536` instead of `32768` for large sessions. On a 64 GB CPU host the
quantized model uses roughly 17 GB at 32K and 19 GB at 64K; the KV cache is
small compared with the weights.

Also raise the server default so models without an explicit `num_ctx` do not
fall back to 8K:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_CONTEXT_LENGTH", "32768", "User")
# Restart the Ollama app/service so the server inherits the new value.
```

## Sam-Harness settings

`SAM_LOCAL_NUM_CTX` is sent with every native Ollama call and overrides the
tag. The output budget is split by role:

| Variable | Default | Used for |
| --- | ---: | --- |
| `SAM_LOCAL_NUM_CTX` | 16384 | Prompt window for every local call |
| `SAM_LOCAL_NUM_PREDICT` | 768 | Short calls: routing, chat, extraction |
| `SAM_LOCAL_LONG_PREDICT` | 2048 | Long-form roles: strategy, audit, architecture, help |

Long-form roles already request 1200-1600 output tokens in `config/team.json`;
the old single cap of 768 silently truncated them. Raise
`SAM_LOCAL_LONG_PREDICT` to `4096` for 27B+ models when a review needs more
room.

## Desktop client settings (OpenCode example)

The client's `limit.context` is metadata used to decide when to compact. It
must match the model tag's real window, and `limit.output` must leave enough
room for a summary. For a 32K tag:

```jsonc
{
  "providers": {
    "ollama": {
      "settings": { "baseURL": "http://127.0.0.1:11434/v1" },
      "models": {
        "qwen-claude:27b-fast-32k": {
          "name": "Qwen3.5 27B Claude Distilled (32K)",
          "limit": { "context": 32768, "output": 4096 }
        }
      }
    }
  },
  "compaction": {
    "auto": true,
    "keep": { "tokens": 8000 },
    "buffer": 8192
  }
}
```

For a 64K tag use `"context": 65536`, `"keep": { "tokens": 12000 }`, and
`"buffer": 16384`.

Default compaction retains 15,000 recent tokens and keeps at least 16K free.
That is reasonable for 128K models but impossible for an 8K window: the
summary request itself overflows before it can produce output.

## Reasoning models

`qwen-claude:27b-fast*` is an Opus-reasoning-distilled Qwen3.5 tag. Its GGUF
chat template opens a `<think>` block unconditionally, so `think: false` on the
native API and `reasoning_effort: "none"` on `/v1` do not disable reasoning for
this tag. Budget roughly 40-60% of `num_predict` for hidden thinking:

- a 1600-token role request yields roughly 700-1000 visible tokens;
- a 4096-token compaction summary has enough room for thinking plus the summary;
- the old 512-token cap could be consumed entirely by thinking, leaving an
  empty answer.

Measured on a 24-core CPU-only host: about **2.7 tokens/s** of generation.
A 1600-token review takes about 10 minutes; a full multi-role cycle is an
overnight job. Use a smaller local model or a cloud/free tier for long-form
roles when turnaround matters, and keep the 27B for the final review.

## What to expect

- A full agency cycle is possible on CPU, but it is serial and slow. Each role
  call is bounded; the model is not the blocker once the window and output
  caps match.
- Do not run a desktop agent and a Sam-Harness run against the same Ollama tag
  at the same time. Ollama reloads the model when the requested window
  differs, which can add minutes per switch.
- If a role still returns short or cut-off output, check `finish_reason` and
  `eval_count`; a `length` finish means the output cap, not the context, is
  still too small.
