import OpenAI from "openai";
import { env } from "@/config/env";

export const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export async function complete(
  system: string,
  user: string,
  history: Array<{ role: "user" | "assistant"; content: string }> = [],
) {
  const res = await openai.chat.completions.create({
    model: env.MODEL_TEXT,
    messages: [{ role: "system", content: system }, ...history, { role: "user", content: user }],
    temperature: 0.7,
  });
  return res.choices[0]?.message?.content ?? "";
}
