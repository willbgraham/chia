// Thin OpenAI client. We don't pull in the official SDK to keep the bundle
// small — every call we need is a simple POST to the chat completions endpoint.

const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const TRANSCRIPTION_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const EMBEDDING_ENDPOINT = "https://api.openai.com/v1/embeddings";

// text-embedding-3-small is the cheap, fast, 1536-dim embedding model.
// Sufficient for chat-message semantic retrieval. Bump to large only
// if retrieval quality stalls.
const EMBEDDING_MODEL = "text-embedding-3-small";
// Default for utility tasks (memory extraction, phrase classifier).
const DEFAULT_MODEL = "gpt-4o-mini";
// Model used for personality-heavy turns where warmth matters: free chat,
// lesson formatting, voice-note pronunciation analysis. Override via
// CHIA_PERSONALITY_MODEL — keep on gpt-4o full for now.
const PERSONALITY_MODEL =
  process.env.CHIA_PERSONALITY_MODEL ?? "gpt-4o";

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
//
// `relevantHistory` is the optional pgvector-retrieved long-range
// context — older messages semantically related to the current
// student input. Surfaces under [RELEVANT_HISTORY] in the system
// prompt template; if the template doesn't include that placeholder
// it's a no-op (graceful fallback for older prompts).
export async function chiaTextTurn(args: {
  systemPromptTemplate: string;
  memoryJson: object;
  state: string;
  recentMessages: ChatMessage[];
  relevantHistory?: ChatMessage[];
  userMessage: string;
  userPlan?: "free" | "premium";
}): Promise<string> {
  const relevantText = args.relevantHistory && args.relevantHistory.length > 0
    ? args.relevantHistory
        .map((m) => `${m.role}: ${m.content}`)
        .join("\n")
    : "(none yet — this is early in your relationship with the student)";

  const systemPrompt = args.systemPromptTemplate
    .replace("[MEMORY_JSON]", JSON.stringify(args.memoryJson, null, 2))
    .replace("[STATE]", args.state)
    .replace("[USER_PLAN]", args.userPlan ?? "free")
    .replace("[RELEVANT_HISTORY]", relevantText)
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
    { model: PERSONALITY_MODEL, temperature: 0.85, max_tokens: 500 },
  );
}

// Whisper transcription — turn audio bytes into text. Used for the
// voice-note correction loop. We pass language=es so Whisper is biased
// toward recognising Spanish.
export async function transcribeAudio(
  audio: ArrayBuffer,
  options: { language?: string; mimeType?: string } = {},
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const blob = new Blob([audio], {
    type: options.mimeType ?? "audio/ogg",
  });
  const form = new FormData();
  form.append("file", blob, "voice.ogg");
  form.append("model", "whisper-1");
  form.append("language", options.language ?? "es");

  const res = await fetch(TRANSCRIPTION_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Whisper ${res.status}: ${text}`);
  }
  const j = (await res.json()) as { text?: string };
  return j.text ?? "";
}

// Generate a 1536-dim embedding for a chunk of text via
// text-embedding-3-small. Best-effort — returns null on any error
// so callers can log the message without an embedding (it'll just be
// excluded from semantic retrieval).
//
// Empty / very short strings (< 3 chars) skip the API call entirely
// because their embeddings are noise and cost real money in
// aggregate.
export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const trimmed = text.trim();
  if (trimmed.length < 3) return null;

  try {
    const res = await fetch(EMBEDDING_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: trimmed.slice(0, 8000), // hard cap to avoid runaway tokens
      }),
    });
    if (!res.ok) {
      console.error(`[embed] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const j = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = j.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length === 1536 ? vec : null;
  } catch (err) {
    console.error("[embed] failed:", err);
    return null;
  }
}

// Pronunciation analysis — given the target phrase the student was
// attempting and what they actually said, produce Chia's warm correction
// in 1-2 sentences.
export async function analysePronunciation(args: {
  targetPhrase: string;
  transcription: string;
  studentName?: string | null;
  agentVoicePrompt: string;
}): Promise<string> {
  const systemPrompt = args.agentVoicePrompt
    .replace("[PENDING_PHRASE]", args.targetPhrase)
    .replace("[STUDENT_NAME]", args.studentName ?? "amig@");

  return chatCompletion(
    [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `What I said was: "${args.transcription}"`,
      },
    ],
    { model: PERSONALITY_MODEL, temperature: 0.75, max_tokens: 200 },
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
