# New Feature Ideas

Providers to add in the future.

---

## Cerebras

Free inference API, OpenAI-compatible. Advertises 20x faster than OpenAI.

- **Base URL**: `https://api.cerebras.ai/v1`
- **API Key**: `cerebras_api_key` (free signup at cloud.cerebras.ai)
- **Config**: Add to `~/.pi/free.json`
- **Free Models**:
  - `llama3.1-8b` — 8K context, production (30 req/min, 60K tokens/min)
  - `qwen-3-235b-a22b-instruct-2507` — 65K context, preview (30 req/min, 30K tokens/min)
- **Docs**: https://inference-docs.cerebras.ai

---

## SambaNova

Free inference API, OpenAI-compatible. Strong model lineup.

- **Base URL**: `https://api.sambanova.ai/v1/`
- **API Key**: `sambanova_api_key` (free signup at cloud.sambanova.ai)
- **Config**: Add to `~/.pi/free.json`
- **Free Models**:
  - `Meta-Llama-3.3-70B-Instruct` — 128K context, production
  - `DeepSeek-V3-0324` — 128K context, production
  - `DeepSeek-V3.1` — 128K context, production
  - `DeepSeek-R1-0528` — 128K context, production
  - `DeepSeek-R1-Distill-Llama-70B` — 128K context, production
  - `MiniMax-M2.5` — 160K context, production
- **Docs**: https://docs.sambanova.ai

---

## Groq

Free inference API, OpenAI-compatible. Very generous rate limits.

- **Base URL**: `https://api.groq.com/openai/v1`
- **API Key**: `groq_api_key` (free at console.groq.com/keys)
- **Config**: Add to `~/.pi/free.json`
- **Free Models** (selected, skip embed/guard models):
  - `llama-3.3-70b-versatile` — 128K context (30 req/min, 12K tokens/min)
  - `meta-llama/llama-4-scout-17b-16e-instruct` — 128K context (30 req/min, 30K tokens/min)
  - `moonshotai/kimi-k2-instruct` — 128K context (60 req/min, 10K tokens/min)
  - `qwen/qwen3-32b` — 128K context (60 req/min, 6K tokens/min)
  - `openai/gpt-oss-120b` — 128K context (30 req/min, 8K tokens/min)
  - `openai/gpt-oss-20b` — 128K context (30 req/min, 8K tokens/min)
  - `groq/compound` — tool-use model (30 req/min, 70K tokens/min)
- **Docs**: https://console.groq.com/docs

---

## Implementation Notes

Both follow the same pattern as `nvidia.ts`:
1. Add base URL to `constants.ts`
2. Add API key resolution to `config.ts`
3. Create provider file (`cerebras.ts`, `sambanova.ts`)
4. Register in `package.json` pi.extensions
