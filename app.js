// --------------------- IMPORTS ---------------------
const express = require("express");
const use = require("@tensorflow-models/universal-sentence-encoder");
const tf = require("@tensorflow/tfjs");
const cors = require("cors");
const levenshtein = require("fast-levenshtein");

// --------------------- APP CONFIG ---------------------
const app = express();
const port = 5000;

// --------------------- MIDDLEWARE ---------------------
app.use(express.json());
app.use(cors());
app.use(express.static("public")); // ✅ serve files at /
app.use("/public", express.static("public")); // ✅ also support /public/* URLs so old links work

const path = require("path");
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// --------------------- MODEL + NLP LOGIC BELOW ---------------------

let model;
let lastIntent = null;
let intentCentroids = {}; // { intentName: tf.Tensor1d }

// --------------------- HINGLISH NORMALIZATION ---------------------
function normalizeHinglish(text) {
  const map = {
    "kitna": "how much",
    "kya": "what",
    "kab": "when",
    "admission kab": "admission",
    "hostel hai": "hostel",
    "college ka": "college",
    "fees": "fee",
    "apply krna": "apply",
    "btana": "tell"
  };

  for (let key in map) {
    text = text.replace(new RegExp(key, 'gi'), map[key]);
  }
  return text;
}

// --------------------- SPELL CORRECTION ---------------------
function correctSpelling(input, list) {
  let best = input;
  let bestDist = 999;

  list.forEach(word => {
    const dist = levenshtein.get(input, word); // fast-levenshtein syntax
    if (dist < bestDist && dist <= 2) { // typo threshold
      bestDist = dist;
      best = word;
    }
  });
  return best;
}

// --------------------- INTENTS DATA (for NLP fallback) ---------------------
// Small example phrases per intent. Expand these to improve accuracy.
const intents = {
  admission: [
    "how to apply",
    "admission process",
    "when do admissions start",
    "how can I enroll",
    "admission dates"
  ],
  fees: ["what are the fees", "fee structure", "tuition cost", "how much is the fee"],
  courses: ["what courses are offered", "list of courses", "which programs do you have"],
  hostel: ["is there a hostel", "hostel facilities", "accommodation available"],
  facilities: ["what facilities", "campus facilities", "labs and sports"],
  placement: ["placement statistics", "companies that hire", "average package"],
  library: ["library timing", "books available", "library hours"],
  timing: ["college timing", "working hours", "what time does college open"]
};

// Threshold for deciding if NLP intent match is confident enough
const NLP_CONFIDENCE_THRESHOLD = 0.70;

// --------------------- SYNONYMS (optional expansion) ---------------------
const synonyms = {
  hostel: ["accommodation", "stay", "rooms", "mess"],
  courses: ["degree", "branch", "subjects"],
  fees: ["payment", "charges", "cost"],
  placement: ["hiring", "career", "package", "salary"],
  library: ["books", "reading room"]
};

// ⚠️ Commented: auto expansion logic (only used with intents)
/*
for (let intent in synonyms) {
  intents[intent].push(...synonyms[intent]);
}
*/

// --------------------- RESPONSES ---------------------
const responses = {
  admission:
    "Admissions usually start between May–June (after 12th board results) and close by July–August.",
  fees:
    "The fees range from ₹22,000 to ₹78,000 depending on the course.",
  courses:
    "We offer UG (BA, B.Sc, B.Com, BBA, BCA, etc.), PG (MA, M.Sc, MBA, MCA, etc.), Diploma, and PhD programs.",
  hostel:
    "Yes! Separate hostels for boys & girls with mess, WiFi, study room, and common room. Limited seats available.",
  facilities:
    "Our facilities include a library, labs, sports grounds, auditorium, cafeteria, and a medical room.",
  placement:
    "Average placement ranges from 4–6 LPA. Companies like TCS, Infosys, Wipro, Tech Mahindra visit regularly.",
  library:
    "Library is open 8 AM – 7 PM (Mon–Sat). ID required at entry.",
  timing:
    "College runs from 9 AM – 5 PM. Admin office closes at 6 PM.",
  default:
    "Hmm, I'm not completely sure. Can you be more specific?"
};

// --------------------- COSINE SIMILARITY ---------------------
function cosineSimilarity(vecA, vecB) {
  // returns a scalar number between -1 and 1
  const dot = tf.sum(tf.mul(vecA, vecB));
  const normA = tf.norm(vecA);
  const normB = tf.norm(vecB);
  const sim = dot.div(normA.mul(normB));
  return sim.arraySync();
}

// --------------------- MEMORY SYSTEM ---------------------
let conversationMemory = []; // Stores last few messages

// --------------------- API ENDPOINT ---------------------
app.post("/ask", async (req, res) => {
  let userInput = req.body.question.toLowerCase();

  // Normalize Hinglish
  userInput = normalizeHinglish(userInput);

  // Add message to memory
  conversationMemory.push(`User: ${userInput}`);

  // Keep only last 3 interactions
  if (conversationMemory.length > 6) {
    conversationMemory = conversationMemory.slice(-6);
  }

  // Combine context (last bot reply + new user input)
  let contextInput = userInput;
  if (conversationMemory.length >= 2) {
    const lastBotReply = conversationMemory[conversationMemory.length - 1];
    if (lastBotReply.startsWith("Bot:")) {
      contextInput = `${lastBotReply} | User: ${userInput}`;
    }
  }

  // ---------------- RULE-BASED SHORTCUTS ----------------
  if (
    userInput.includes("hostel") ||
    userInput.includes("accommodation") ||
    userInput.includes("stay") ||
    userInput.includes("room")
  ) {
    const reply = responses.hostel;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "hostel";
    return res.json({ reply });
  }

  if (
    userInput.includes("admission") ||
    userInput.includes("apply") ||
    userInput.includes("enroll")
  ) {
    const reply = responses.admission;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "admission";
    return res.json({ reply });
  }

  if (
    userInput.includes("fees") ||
    userInput.includes("fee") ||
    userInput.includes("payment")
  ) {
    const reply = responses.fees;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "fees";
    return res.json({ reply });
  }

  if (
    userInput.includes("courses") ||
    userInput.includes("program") ||
    userInput.includes("subjects")
  ) {
    const reply = responses.courses;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "courses";
    return res.json({ reply });
  }

  if (
    userInput.includes("facility") ||
    userInput.includes("facilities") ||
    userInput.includes("campus")
  ) {
    const reply = responses.facilities;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "facilities";
    return res.json({ reply });
  }

  if (
    userInput.includes("placement") ||
    userInput.includes("job") ||
    userInput.includes("company") ||
    userInput.includes("hiring")
  ) {
    const reply = responses.placement;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "placement";
    return res.json({ reply });
  }

  if (userInput.includes("library") || userInput.includes("books")) {
    const reply = responses.library;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "library";
    return res.json({ reply });
  }

  if (
    userInput.includes("timing") ||
    userInput.includes("schedule") ||
    userInput.includes("hours")
  ) {
    const reply = responses.timing;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "timing";
    return res.json({ reply });
  }

  // Context-aware follow-up (e.g., after admission → hostel)
  if (
    lastIntent === "admission" &&
    (userInput.includes("after") ||
      userInput.includes("stay") ||
      userInput.includes("accommodation"))
  ) {
    const reply = responses.hostel;
    conversationMemory.push(`Bot: ${reply}`);
    lastIntent = "hostel";
    return res.json({ reply });
  }

  // ---------------- DEFAULT RESPONSE ----------------
  // If no rule matched, use NLP fallback (semantic intent detection)
  try {
    const nlpResult = await getBestIntent(userInput);
    if (nlpResult && nlpResult.score >= NLP_CONFIDENCE_THRESHOLD) {
      const reply = responses[nlpResult.intent] || responses.default;
      conversationMemory.push(`Bot: ${reply}`);
      lastIntent = nlpResult.intent;
      return res.json({
        reply,
        source: "nlp",
        intent: nlpResult.intent,
        confidence: Number(nlpResult.score.toFixed(3))
      });
    }
  } catch (err) {
    console.error("NLP fallback error:", err);
  }

  const reply = responses.default;
  conversationMemory.push(`Bot: ${reply}`);
  return res.json({ reply, source: "rule-or-default" });
});

// --------------------- LOAD MODEL & START SERVER ---------------------
// --------------------- NLP HELPERS & MODEL LOADING ---------------------
async function buildIntentCentroids() {
  // compute centroid embedding for each intent
  for (const intentName of Object.keys(intents)) {
    const examples = intents[intentName];
    // embed examples in a batch
    const embeddings = await model.embed(examples); // 2D tensor [N, dim]
    // mean across axis 0 to get centroid
    const centroid = embeddings.mean(0);
    intentCentroids[intentName] = centroid; // tf.Tensor1d
    embeddings.dispose();
  }
}

async function getBestIntent(text) {
  if (!model) return null;
  const emb = await model.embed([text]); // shape [1, dim]
  const vec = emb.squeeze(); // 1D tensor
  let best = { intent: null, score: -1 };

  for (const intentName of Object.keys(intentCentroids)) {
    try {
      const centroid = intentCentroids[intentName];
      const score = cosineSimilarity(vec, centroid);
      if (score > best.score) {
        best = { intent: intentName, score };
      }
    } catch (err) {
      console.warn("similarity error", err);
    }
  }

  emb.dispose();
  vec.dispose();
  return best;
}

use
  .load()
  .then(async loadedModel => {
    model = loadedModel;
    try {
      await buildIntentCentroids();
      console.log("✅ Intent centroids built for NLP fallback");
    } catch (err) {
      console.warn("Failed to build intent centroids:", err);
    }

    app.listen(port, () => {
      console.log(`✅ Server running on http://localhost:${port}`);
    });
  })
  .catch(err => {
    console.error("Failed to load model:", err);
    // still start server so rule-based responses work
    app.listen(port, () => {
      console.log(`⚠️ Server started without NLP model on http://localhost:${port}`);
    });
  });
