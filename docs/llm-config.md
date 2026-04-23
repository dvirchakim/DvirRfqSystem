# LLM Configuration

The dashboard supports three AI providers. All calls go directly from your browser to the provider — no backend or proxy needed.

---

## Anthropic (Claude) — Default

**Recommended.** Uses `claude-sonnet-4-6` by default.

### Steps

1. Get an API key from [console.anthropic.com](https://console.anthropic.com)
2. In the Config tab → **LLM Provider** → select **Anthropic (Claude)**
3. Paste your API key into the **API Key** field
4. Optionally change the model (e.g. `claude-opus-4-7` for higher accuracy, `claude-haiku-4-5-20251001` for speed)

### Available models

| Model ID | Notes |
|---|---|
| `claude-sonnet-4-6` | Default — best balance of speed and accuracy |
| `claude-opus-4-7` | Highest accuracy, slower and more expensive |
| `claude-haiku-4-5-20251001` | Fastest and cheapest |

### CORS note

The Anthropic API is called directly from the browser using the `anthropic-dangerous-direct-browser-access: true` header. This is intentional for this browser-only app — keep your API key in Config only and do not share it.

---

## OpenAI-compatible

Works with OpenAI, Azure OpenAI, Together.ai, Groq, LM Studio, or any OpenAI-compatible endpoint.

### Steps

1. In the Config tab → select **OpenAI-compatible**
2. Set **Base URL** (e.g. `https://api.openai.com/v1`)
3. Set **API Key** (leave blank if not required, e.g. local LM Studio)
4. Set **Model** (e.g. `gpt-4o`, `gpt-4o-mini`, `meta-llama/Llama-3-70b-chat-hf`)

### Example base URLs

| Provider | Base URL |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Azure OpenAI | `https://<resource>.openai.azure.com/openai/deployments/<deployment>` |
| Groq | `https://api.groq.com/openai/v1` |
| Together.ai | `https://api.together.xyz/v1` |
| LM Studio (local) | `http://localhost:1234/v1` |

---

## Ollama (Local)

Runs models entirely on your machine — no API key, no data sent to the cloud.

### Steps

1. Install [Ollama](https://ollama.ai) and pull a model:
   ```bash
   ollama pull llama3.1
   # or
   ollama pull mistral
   ```
2. In the Config tab → select **Ollama (Local)**
3. Set **Base URL** to `http://localhost:11434` (default)
4. Set **Model** to the model you pulled (e.g. `llama3.1`)

### CORS with Ollama

Ollama must be started with CORS enabled to accept browser requests:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

Or set it permanently in your system environment variables.

---

## Verifying your setup

Go to the **Test / Manual** tab, paste any RFQ email text, and click **עבד עם Claude AI**. If the provider is configured correctly you'll see extracted fields appear in the Dashboard tab within a few seconds.
