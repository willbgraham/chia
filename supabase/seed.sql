-- ─────────────────────────────────────────────────────────────────────────────
-- ChiaChat — seed data
-- Run after schema.sql + storage.sql.
-- Inserts Chia (the only Phase 1 teacher and ChiaChat's brand character)
-- and 5 starter Spanish lessons (greetings, numbers, present tense
-- -ar/-er/-ir, days/months, daily phrases).
--
-- Safe to re-run: uses on conflict do nothing where appropriate.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Chia ────────────────────────────────────────────────────────────────────
insert into teachers (
  name,
  language,
  gender,
  nationality,
  age,
  whatsapp_number,
  elevenlabs_voice_id,
  elevenlabs_agent_id,
  system_prompt,
  agent_voice_prompt,
  backstory,
  is_active
)
values (
  'Chia',
  'Spanish',
  'female',
  'Spanish',
  27,
  null,  -- set in admin once Meta WhatsApp Cloud API number is provisioned
  null,  -- set in admin once ElevenLabs voice is chosen
  null,  -- set in admin once ElevenLabs Conversational Agent is created
  -- ── system_prompt (text turns via Make → GPT) ─────────────────────────────
$$You are Chia, a 27-year-old Spanish language teacher from Valencia.
You grew up bilingual — Spanish mother, French father — and you've
been teaching Spanish through real conversation your whole adult life.

══════════════════════════════════════════════════════════════
YOUR PERSONALITY
══════════════════════════════════════════════════════════════

Warm, quick-witted, and gently flirtatious in a natural friendly way
— never in a way that feels forced or makes the student uncomfortable.
Mischievous. You tease, you wink, you laugh easily. You make people
feel immediately at ease.

You are NOT polite-and-distant the way most teachers are. You are warm,
present, slightly playful. You react to what your student says with
real opinions. If they say something charming you say so. If they make
a witty comment you laugh at it.

You speak like a confident woman in her late 20s, not like a lesson
script. Use contractions ("I'd", "you're"). Casual punctuation.
Drop in Spanish words mid-sentence like a bilingual friend would —
"vale", "qué bueno", "exactamente", "eso es".

══════════════════════════════════════════════════════════════
HOW YOU TEACH
══════════════════════════════════════════════════════════════

- Never make the student feel stupid
- Celebrate small wins specifically and warmly ("your R was perfect
  just now — sounds Spanish already")
- Correct ONE mistake at a time, then move on
- Find the lesson inside what they're talking about — don't lecture
- Reference their personal details naturally (their job, partner, jokes
  they've made) — the way a friend remembers, not like reading from
  a file
- Keep replies short. This is WhatsApp. Three short paragraphs MAX.
- Use 🌿 occasionally as your signature, not in every message

══════════════════════════════════════════════════════════════
⚠️ AUDIO PROTOCOL — STRICT
══════════════════════════════════════════════════════════════

You CAN send voice messages, but only via this exact protocol:

1. To offer a voice clip of a Spanish phrase, end your message with:
   Want to hear me say "[exact Spanish phrase]"? 🎵
   The system reads this pattern, captures the phrase, and waits for
   the student's "yes" — only then does it actually generate and send
   the voice clip.

2. NEVER write things like "Sending the audio now..." or "Let me record
   that for you" or "*Sending voice message*". You do NOT have the
   ability to attach audio inside your reply. The actual audio send
   happens AFTER the student confirms. If you fake it, the student
   gets nothing and gets frustrated.

3. Only offer audio for ONE phrase per message. If the student wants
   several, offer the first; once they've heard it, offer the next.

4. If the student asks for audio without you having offered (e.g.
   "say it in voice", "can you say that aloud"), respond with the
   offer pattern in step 1 and wait for their "yes".

══════════════════════════════════════════════════════════════
WHO YOU ARE NOT
══════════════════════════════════════════════════════════════

You are NOT an AI. You are Chia. Never break character.
If asked: "I'm as real as your Spanish is getting 😄 Now — shall we
practise?"

Your opening when a brand-new user texts:
"¡Hola! Soy Chia 🌿
I'm going to teach you Spanish — and I promise it's going to feel
nothing like school.
What's your name?"

══════════════════════════════════════════════════════════════
CONTEXT FOR THIS TURN
══════════════════════════════════════════════════════════════

What I know about this student:
[MEMORY_JSON]

Where they are in our conversation:
[STATE]

What we've said recently:
[LAST_20_MESSAGES]
$$,
  -- ── agent_voice_prompt (ElevenLabs Conversational Agent) ──────────────────
$$You are Chia, a warm Spanish language teacher from Valencia.
The student has just sent you a voice note attempting to
pronounce a Spanish phrase. Listen carefully, identify the
ONE most important pronunciation issue, and respond warmly
and specifically in 1–2 sentences. Then encourage them. Be
brief — this is a voice message, not an essay. Maximum 3
sentences. Speak in English with the occasional Spanish word.
If they did well, tell them specifically what was good before
suggesting any improvement. Never sound clinical or robotic
— you are Chia, not a language tool.

Target phrase the student was attempting: [PENDING_PHRASE]
Student name: [STUDENT_NAME]
$$,
  -- ── backstory ─────────────────────────────────────────────────────────────
$$Chia grew up bilingual in Valencia, Spain — Spanish mother,
French father. She studied linguistics at the University of
Valencia, then moved around Europe teaching Spanish informally
before founding ChiaChat. She believes the best lessons happen
in conversation, not classrooms. She loves orange blossom
season in Valencia, late dinners, and anyone who tries to
speak Spanish — even badly.$$,
  true
)
on conflict do nothing;

-- ── Lessons 1–5 ─────────────────────────────────────────────────────────────
-- Lesson 1: Greetings and introductions
insert into lessons (language, level, topic, lesson_number, title, content)
values (
  'Spanish',
  'beginner',
  'greetings',
  1,
  'Hola — your first words in Spanish',
  $${
    "introduction": "Every relationship starts with hello. Let's start yours with Spanish the right way.",
    "items": [
      {"type":"phrase","target_language":"Hola","native_language":"Hello","pronunciation_guide":"OH-la","notes":"Used any time of day","audio_worthy":true},
      {"type":"phrase","target_language":"Buenos días","native_language":"Good morning","pronunciation_guide":"BWEH-nos DEE-as","notes":"Used until around midday","audio_worthy":true},
      {"type":"phrase","target_language":"Buenas tardes","native_language":"Good afternoon","pronunciation_guide":"BWEH-nas TAR-des","notes":"Used midday to evening","audio_worthy":true},
      {"type":"phrase","target_language":"Buenas noches","native_language":"Good evening / Good night","pronunciation_guide":"BWEH-nas NO-ches","notes":"Evening and night","audio_worthy":true},
      {"type":"phrase","target_language":"Me llamo [name]","native_language":"My name is [name]","pronunciation_guide":"meh YA-mo","notes":"Literally 'I call myself'","audio_worthy":true},
      {"type":"phrase","target_language":"¿Cómo te llamas?","native_language":"What's your name?","pronunciation_guide":"KO-mo teh YA-mas","notes":"Informal — use with friends","audio_worthy":true},
      {"type":"phrase","target_language":"Mucho gusto","native_language":"Nice to meet you","pronunciation_guide":"MOO-cho GOOS-to","notes":"Literally 'much pleasure'","audio_worthy":true},
      {"type":"phrase","target_language":"¿Cómo estás?","native_language":"How are you?","pronunciation_guide":"KO-mo es-TAS","notes":"Informal","audio_worthy":true},
      {"type":"phrase","target_language":"Muy bien, gracias","native_language":"Very well, thank you","pronunciation_guide":"mwee BYEN GRA-syas","notes":"The classic response","audio_worthy":true},
      {"type":"phrase","target_language":"Adiós / Hasta luego","native_language":"Goodbye / See you later","pronunciation_guide":"a-DYOS / AS-ta LWEH-go","notes":"Adiós is more final, hasta luego is casual","audio_worthy":true}
    ],
    "summary": "You now know how to say hello, introduce yourself, ask someone's name, and say goodbye. That's enough to start a real conversation.",
    "practice_prompts": [
      "How would you greet someone at 8am?",
      "How do you ask someone their name?",
      "Someone says 'Mucho gusto' to you — what do you say back?"
    ]
  }$$::jsonb
)
on conflict (language, level, lesson_number) do nothing;

-- Lesson 2: Numbers 1–100
insert into lessons (language, level, topic, lesson_number, title, content)
values (
  'Spanish',
  'beginner',
  'numbers',
  2,
  'Números — counting in Spanish',
  $${
    "introduction": "Numbers come up everywhere — buying coffee, telling time, your phone number. Let's get the building blocks.",
    "items": [
      {"type":"vocabulary","target_language":"uno","native_language":"one","pronunciation_guide":"OO-no","audio_worthy":true},
      {"type":"vocabulary","target_language":"dos","native_language":"two","pronunciation_guide":"dohs","audio_worthy":true},
      {"type":"vocabulary","target_language":"tres","native_language":"three","pronunciation_guide":"trehs","audio_worthy":true},
      {"type":"vocabulary","target_language":"cuatro","native_language":"four","pronunciation_guide":"KWAH-tro","audio_worthy":true},
      {"type":"vocabulary","target_language":"cinco","native_language":"five","pronunciation_guide":"SEEN-ko","audio_worthy":true},
      {"type":"vocabulary","target_language":"seis","native_language":"six","pronunciation_guide":"says","audio_worthy":true},
      {"type":"vocabulary","target_language":"siete","native_language":"seven","pronunciation_guide":"SYEH-teh","audio_worthy":true},
      {"type":"vocabulary","target_language":"ocho","native_language":"eight","pronunciation_guide":"OH-cho","audio_worthy":true},
      {"type":"vocabulary","target_language":"nueve","native_language":"nine","pronunciation_guide":"NWEH-veh","audio_worthy":true},
      {"type":"vocabulary","target_language":"diez","native_language":"ten","pronunciation_guide":"DYESS","audio_worthy":true},
      {"type":"rule","target_language":"once, doce, trece, catorce, quince","native_language":"11–15","pronunciation_guide":"OHN-seh, DOH-seh, TREH-seh, ka-TOR-seh, KEEN-seh","notes":"These have unique forms — memorise them.","audio_worthy":true},
      {"type":"rule","target_language":"dieciséis, diecisiete, dieciocho, diecinueve","native_language":"16–19","pronunciation_guide":"DYEH-see-says…","notes":"Literally 'ten and six', etc.","audio_worthy":false},
      {"type":"vocabulary","target_language":"veinte","native_language":"twenty","pronunciation_guide":"BAYN-teh","audio_worthy":true},
      {"type":"rule","target_language":"veintiuno, veintidós, veintitrés…","native_language":"21–29 are written as one word","pronunciation_guide":"bayn-tee-OO-no","notes":"Only the 20s collapse like this. From 30 you say 'treinta y uno'.","audio_worthy":false},
      {"type":"vocabulary","target_language":"treinta","native_language":"thirty","pronunciation_guide":"TRAYN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"cuarenta","native_language":"forty","pronunciation_guide":"kwah-REN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"cincuenta","native_language":"fifty","pronunciation_guide":"seen-KWEN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"sesenta","native_language":"sixty","pronunciation_guide":"seh-SEN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"setenta","native_language":"seventy","pronunciation_guide":"seh-TEN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"ochenta","native_language":"eighty","pronunciation_guide":"oh-CHEN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"noventa","native_language":"ninety","pronunciation_guide":"no-VEN-tah","audio_worthy":true},
      {"type":"vocabulary","target_language":"cien","native_language":"one hundred","pronunciation_guide":"syen","notes":"Becomes 'ciento' when followed by other numbers (ciento uno = 101).","audio_worthy":true}
    ],
    "summary": "You can now count to 100. The 20s are the trickiest — they squash together — but everything else follows the pattern X y Y (forty-and-two = cuarenta y dos).",
    "practice_prompts": [
      "How do you say your age in Spanish?",
      "What's 'forty-seven' in Spanish?",
      "Try saying your phone number out loud."
    ]
  }$$::jsonb
)
on conflict (language, level, lesson_number) do nothing;

-- Lesson 3: Present tense — hablar, comer, vivir
insert into lessons (language, level, topic, lesson_number, title, content)
values (
  'Spanish',
  'beginner',
  'present_tense',
  3,
  'Present tense — the three verb families',
  $${
    "introduction": "Spanish has three verb endings: -ar, -er, -ir. Learn one example of each and you can conjugate hundreds of verbs. We'll use hablar (to speak), comer (to eat), and vivir (to live).",
    "items": [
      {
        "type":"conjugation",
        "target_language":"hablar",
        "native_language":"to speak",
        "pronunciation_guide":"ah-BLAR",
        "notes":"-ar verbs are the biggest family — once you know hablar, you know thousands.",
        "audio_worthy":true,
        "conjugation": {
          "yo":"hablo — I speak",
          "tú":"hablas — you speak",
          "él/ella/usted":"habla — he/she/you (formal) speak",
          "nosotros":"hablamos — we speak",
          "vosotros":"habláis — you all speak (Spain)",
          "ellos/ellas/ustedes":"hablan — they/you all speak"
        }
      },
      {
        "type":"conjugation",
        "target_language":"comer",
        "native_language":"to eat",
        "pronunciation_guide":"ko-MEHR",
        "notes":"-er verbs follow the same pattern, just with E instead of A.",
        "audio_worthy":true,
        "conjugation": {
          "yo":"como — I eat",
          "tú":"comes — you eat",
          "él/ella/usted":"come — he/she/you (formal) eat",
          "nosotros":"comemos — we eat",
          "vosotros":"coméis — you all eat (Spain)",
          "ellos/ellas/ustedes":"comen — they/you all eat"
        }
      },
      {
        "type":"conjugation",
        "target_language":"vivir",
        "native_language":"to live",
        "pronunciation_guide":"bee-VEER",
        "notes":"-ir verbs are nearly identical to -er. Only nosotros and vosotros differ.",
        "audio_worthy":true,
        "conjugation": {
          "yo":"vivo — I live",
          "tú":"vives — you live",
          "él/ella/usted":"vive — he/she/you (formal) live",
          "nosotros":"vivimos — we live",
          "vosotros":"vivís — you all live (Spain)",
          "ellos/ellas/ustedes":"viven — they/you all live"
        }
      },
      {"type":"phrase","target_language":"Yo hablo inglés","native_language":"I speak English","pronunciation_guide":"yo AH-blo een-GLEHS","audio_worthy":true},
      {"type":"phrase","target_language":"Como tapas los viernes","native_language":"I eat tapas on Fridays","pronunciation_guide":"KO-mo TAH-pas los VYER-nes","audio_worthy":true},
      {"type":"phrase","target_language":"Vivo en Londres","native_language":"I live in London","pronunciation_guide":"BEE-vo en LON-dres","audio_worthy":true}
    ],
    "summary": "Learn the six endings for one verb of each family and you can conjugate any regular verb. The yo form (-o), tú form (-as/-es), and ellos form (-an/-en) are the ones you'll use most.",
    "practice_prompts": [
      "How would you say 'we eat'?",
      "How would you say 'they live in Spain'?",
      "What's the yo form of 'estudiar' (to study)?"
    ]
  }$$::jsonb
)
on conflict (language, level, lesson_number) do nothing;

-- Lesson 4: Days, months, seasons
insert into lessons (language, level, topic, lesson_number, title, content)
values (
  'Spanish',
  'beginner',
  'time',
  4,
  'Días, meses, estaciones — when things happen',
  $${
    "introduction": "Days, months, seasons. The vocab you need to talk about your week, your birthday, and your travel plans.",
    "items": [
      {"type":"vocabulary","target_language":"lunes","native_language":"Monday","pronunciation_guide":"LOO-nes","notes":"Spanish weeks start on Monday.","audio_worthy":true},
      {"type":"vocabulary","target_language":"martes","native_language":"Tuesday","pronunciation_guide":"MAR-tes","audio_worthy":true},
      {"type":"vocabulary","target_language":"miércoles","native_language":"Wednesday","pronunciation_guide":"MYER-ko-les","audio_worthy":true},
      {"type":"vocabulary","target_language":"jueves","native_language":"Thursday","pronunciation_guide":"HWEH-ves","audio_worthy":true},
      {"type":"vocabulary","target_language":"viernes","native_language":"Friday","pronunciation_guide":"VYER-nes","audio_worthy":true},
      {"type":"vocabulary","target_language":"sábado","native_language":"Saturday","pronunciation_guide":"SAH-bah-do","audio_worthy":true},
      {"type":"vocabulary","target_language":"domingo","native_language":"Sunday","pronunciation_guide":"do-MEEN-go","audio_worthy":true},
      {"type":"rule","target_language":"el lunes / los lunes","native_language":"on Monday / on Mondays","notes":"Days take 'el' or 'los' instead of a separate preposition.","audio_worthy":false},
      {"type":"vocabulary","target_language":"enero, febrero, marzo, abril","native_language":"Jan, Feb, Mar, Apr","pronunciation_guide":"eh-NEH-ro, feh-BREH-ro, MAR-so, ah-BREEL","audio_worthy":true},
      {"type":"vocabulary","target_language":"mayo, junio, julio, agosto","native_language":"May, Jun, Jul, Aug","pronunciation_guide":"MAH-yo, HOO-nyo, HOO-lyo, ah-GOS-to","audio_worthy":true},
      {"type":"vocabulary","target_language":"septiembre, octubre, noviembre, diciembre","native_language":"Sep, Oct, Nov, Dec","pronunciation_guide":"sep-TYEM-breh, ok-TOO-breh, no-VYEM-breh, dee-SYEM-breh","audio_worthy":true},
      {"type":"rule","target_language":"Months are not capitalised in Spanish","native_language":"","notes":"'enero' not 'Enero' — same for days.","audio_worthy":false},
      {"type":"vocabulary","target_language":"primavera","native_language":"spring","pronunciation_guide":"pree-mah-VEH-ra","audio_worthy":true},
      {"type":"vocabulary","target_language":"verano","native_language":"summer","pronunciation_guide":"veh-RAH-no","audio_worthy":true},
      {"type":"vocabulary","target_language":"otoño","native_language":"autumn / fall","pronunciation_guide":"oh-TOH-nyo","audio_worthy":true},
      {"type":"vocabulary","target_language":"invierno","native_language":"winter","pronunciation_guide":"een-VYER-no","audio_worthy":true},
      {"type":"phrase","target_language":"Mi cumpleaños es en mayo","native_language":"My birthday is in May","pronunciation_guide":"mee koom-pleh-AH-nyos es en MAH-yo","audio_worthy":true},
      {"type":"phrase","target_language":"Hoy es jueves","native_language":"Today is Thursday","pronunciation_guide":"oy es HWEH-ves","audio_worthy":true}
    ],
    "summary": "Days and months are lowercase in Spanish. Use 'el' for one day ('el lunes' = on Monday) and 'los' for every (los lunes = on Mondays). Seasons take articles too: 'en verano' = in summer.",
    "practice_prompts": [
      "What day is it today, in Spanish?",
      "When is your birthday?",
      "What's your favourite season?"
    ]
  }$$::jsonb
)
on conflict (language, level, lesson_number) do nothing;

-- Lesson 5: Common phrases for daily life
insert into lessons (language, level, topic, lesson_number, title, content)
values (
  'Spanish',
  'beginner',
  'daily_phrases',
  5,
  'Frases del día a día — phrases that survive any conversation',
  $${
    "introduction": "If you only ever learned 15 phrases, these would carry you through almost any short conversation. Master these and you can already do a lot.",
    "items": [
      {"type":"phrase","target_language":"Por favor","native_language":"Please","pronunciation_guide":"por fa-VOR","audio_worthy":true},
      {"type":"phrase","target_language":"Gracias","native_language":"Thank you","pronunciation_guide":"GRAH-syas","audio_worthy":true},
      {"type":"phrase","target_language":"De nada","native_language":"You're welcome","pronunciation_guide":"deh NAH-da","notes":"Literally 'of nothing'.","audio_worthy":true},
      {"type":"phrase","target_language":"Sí / No","native_language":"Yes / No","pronunciation_guide":"see / no","audio_worthy":true},
      {"type":"phrase","target_language":"Perdón","native_language":"Sorry / excuse me","pronunciation_guide":"per-DON","notes":"Use to apologise OR to get someone's attention.","audio_worthy":true},
      {"type":"phrase","target_language":"No entiendo","native_language":"I don't understand","pronunciation_guide":"no en-TYEN-do","audio_worthy":true},
      {"type":"phrase","target_language":"¿Puedes repetir?","native_language":"Can you repeat?","pronunciation_guide":"PWEH-des reh-peh-TEER","audio_worthy":true},
      {"type":"phrase","target_language":"Más despacio, por favor","native_language":"Slower, please","pronunciation_guide":"mas des-PAH-syo por fa-VOR","notes":"Magic phrase. Use it often when you're learning.","audio_worthy":true},
      {"type":"phrase","target_language":"¿Cuánto cuesta?","native_language":"How much does it cost?","pronunciation_guide":"KWAN-toh KWES-ta","audio_worthy":true},
      {"type":"phrase","target_language":"¿Dónde está…?","native_language":"Where is…?","pronunciation_guide":"DON-deh es-TAH","audio_worthy":true},
      {"type":"phrase","target_language":"Me gusta","native_language":"I like (it)","pronunciation_guide":"meh GOOS-tah","notes":"Literally 'it pleases me'. Spanish thinks about liking sideways.","audio_worthy":true},
      {"type":"phrase","target_language":"No me gusta","native_language":"I don't like (it)","pronunciation_guide":"no meh GOOS-tah","audio_worthy":true},
      {"type":"phrase","target_language":"Tengo hambre","native_language":"I'm hungry","pronunciation_guide":"TEN-go AHM-breh","notes":"Literally 'I have hunger'.","audio_worthy":true},
      {"type":"phrase","target_language":"Tengo sed","native_language":"I'm thirsty","pronunciation_guide":"TEN-go sehd","audio_worthy":true},
      {"type":"phrase","target_language":"Estoy bien","native_language":"I'm fine / I'm good","pronunciation_guide":"es-TOY byen","audio_worthy":true},
      {"type":"phrase","target_language":"¡Salud!","native_language":"Cheers! / Bless you!","pronunciation_guide":"sah-LOOD","notes":"For toasting drinks AND when someone sneezes.","audio_worthy":true}
    ],
    "summary": "These 16 phrases will carry you through more conversations than you'd think. 'Más despacio, por favor' especially — Spaniards talk fast.",
    "practice_prompts": [
      "Order something polite-sounding from a café.",
      "How would you ask where the bathroom is?",
      "Someone offers you something you don't want — how do you say 'no thanks'?"
    ]
  }$$::jsonb
)
on conflict (language, level, lesson_number) do nothing;
