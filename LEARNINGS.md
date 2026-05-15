# LEARNINGS

- Local Ollama cold loads can exceed short endpoint timeouts. When a
  probe is reachable but test reply times out, compare direct Ollama
  latency before treating it as an application bug.
- If an LLM reply must name a specific context item, make that answer
  requirement explicit in the system prompt; merely including the data
  may not be enough.
- Preference toggles that remove model context should often add an
  explicit unavailable-context note, so the model can say what it does
  not know instead of guessing.
