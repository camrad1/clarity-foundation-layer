/**
 * Plain-English wording for an already-computed Search Console insight.
 *
 * BOUNDARY
 * --------
 * The deterministic engine (insights.ts) computes every number first. This
 * function receives those finished values and may only rephrase them. It must
 * never calculate a metric, invent a cause, claim causation, or connect search
 * data to leads, tours or move-ins — Search Console is aggregate data and this
 * platform has no record-level attribution.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const input = z.object({
  subject: z.string().min(1).max(400),
  kind: z.string().min(1).max(40),
  signal: z.string().min(1).max(600),
  rule: z.string().min(1).max(600),
  evidence: z
    .array(z.object({ label: z.string().max(80), value: z.string().max(120) }))
    .max(8),
});

const SYSTEM = [
  "You explain a pre-computed SEO signal from Google Search Console data for a senior living operator.",
  "Hard rules:",
  "- Never calculate, restate incorrectly, or invent any number. Use only the figures supplied.",
  "- Never state or imply a cause for a change. No 'because', 'due to', 'driven by'.",
  "- Never claim search data produced leads, tours, deposits or move-ins. There is no attribution data.",
  "- Use 'visibility', 'clicks', 'impressions', 'associated with', 'coincided with'.",
  "- Two sentences maximum, plain business English, no bullet points, no headings, no emojis.",
  "- Say what the signal means and what a marketer could look at next.",
].join("\n");

export const explainInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => input.parse(data))
  .handler(async ({ data }) => {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) {
      return { text: null, error: "AI explanations are not configured for this workspace." };
    }

    const facts = [
      `Signal type: ${data.kind}`,
      `Subject: ${data.subject}`,
      `Deterministic signal: ${data.signal}`,
      `Rule used: ${data.rule}`,
      "Measured evidence:",
      ...data.evidence.map((e) => `- ${e.label}: ${e.value}`),
    ].join("\n");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: facts },
        ],
      }),
    });

    if (response.status === 429) {
      return { text: null, error: "Too many explanation requests right now. Try again shortly." };
    }
    if (response.status === 402) {
      return { text: null, error: "AI credits are exhausted for this workspace." };
    }
    if (!response.ok) {
      const body = await response.text();
      console.error(`AI explanation failed [${response.status}]: ${body}`);
      return { text: null, error: `The explanation service returned ${response.status}.` };
    }

    const payload = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? null;
    return { text, error: text ? null : "No explanation was returned." };
  });
