// Thin OpenAI client. We don't pull in the official SDK to keep the bundle
// small — every call we need is a simple POST to the chat completions endpoint.

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4o-mini";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model ?? DEFAULT_MODEL,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.max_tokens ?? 600,
      ...(options.response_format
        ? { response_format: options.response_format }
        : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }

  const j = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return j.choices[0]?.message.content ?? "";
}

// Run the Chia text-turn prompt: build the system prompt with placeholders
// substituted, append the conversation history and the latest user message.
export async function chiaTextTurn(args: {
  systemPromptTemplate: string;
  memoryJson: object;
  state: string;
  recentMessages: ChatMessage[];
  userMessage: string;
}): Promise<string> {
  const systemPrompt = args.systemPromptTemplate
    .replace("[MEMORY_JSON]", JSON.stringify(args.memoryJson, null, 2))
    .replace("[STATE]", args.state)
    .replace(
      "[LAST_20_MESSAGES]",
      args.recentMessages
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n") || "(no previous messages)",
    );

  return chatCompletion(
    [
      { role: "system", content: systemPrompt },
      ...args.recentMessages.slice(-20),
      { role: "user", content: args.userMessage },
    ],
    { temperature: 0.8, max_tokens: 400 },
  );
}

// Memory extraction prompt — runs after a session ends and merges new facts
// into the user's existing memory_json.
export async function extractMemoryUpdate(args: {
  existingMemory: object;
  recentTranscript: ChatMessage[];
}): Promise<object> {
  const systemPrompt = `You update a JSON memory object that a Spanish teacher named Chia keeps about her student. Read the existing memory and the recent conversation. Return ONLY valid JSON — the FULL updated memory object (not a diff).

Rules:
- Add new personal details (job, location, interests) that the student has shared
- Add language progress observations (what they're getting right, what they're struggling with)
- Add inside references and milestones if relevant
- Don't invent anything. If a fact isn't in the conversation, don't add it.
- Don't remove existing fields unless directly contradicted
- Keep arrays bounded (max 20 items each)
- Update last_session to now (ISO 8601)`;

  const result = await chatCompletion(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `Existing memory:\n${JSON.stringify(args.existingMemory, null, 2)}\n\nRecent conversation:\n${args.recentTranscript
          .map((m) => `${m.role}: ${m.content}`)
          .join("\n")}`,
      },
    ],
    { temperature: 0.2, max_tokens: 1000, response_format: { type: "json_object" } },
  );

  try {
    return JSON.parse(result) as object;
  } catch {
    // If GPT returned malformed JSON, leave memory untouched.
    return args.existingMemory;
  }
}
