/**
 * Test double for Nebius Token Factory. Answers in the shape the phase asks
 * for (classify = one reading, plan = readings[]), records every request, and
 * reports token usage like the real API. No network, no credit spent.
 */
export interface FakeReply {
  readings: Array<Record<string, unknown>>;
  confidence: number;
}
/** Return null from a reply function to simulate an unusable (schema-failing) answer. */
export function fakeNebius(reply: FakeReply | ((phase: "classify" | "plan", n: number) => FakeReply | null)) {
  const calls: Array<{ phase: "classify" | "plan"; body: Record<string, any> }> = [];
  const f = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const phase = body.response_format.json_schema.schema.properties.readings ? "plan" : "classify";
    calls.push({ phase, body });
    const r = typeof reply === "function" ? reply(phase, calls.length) : reply;
    const content = r === null ? { nonsense: true } : phase === "plan" ? { readings: r.readings, confidence: r.confidence } : { request: r.readings[0], confidence: r.confidence };
    const reasoning = body.chat_template_kwargs.enable_thinking ? 300 : 0;
    return new Response(JSON.stringify({
      model: "nemotron-test",
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 250, completion_tokens: 60 + reasoning, completion_tokens_details: { reasoning_tokens: reasoning } },
    }));
  }) as typeof fetch;
  return { f, calls };
}
