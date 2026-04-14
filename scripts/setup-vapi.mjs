/**
 * setup-vapi.mjs
 *
 * Creates (or updates) the Vapi assistant + provisions a phone number.
 * Run ONCE after deploying to Vercel:
 *
 *   node scripts/setup-vapi.mjs https://your-app.vercel.app
 *
 * On success it prints the phone number to call.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// ── Load .env manually (no dotenv dependency needed in scripts) ───────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, "../.env");

const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim();
  env[key] = val;
}

const VAPI_KEY = env.VAPI_PRIVATE_KEY;
if (!VAPI_KEY) {
  console.error("❌  VAPI_PRIVATE_KEY not found in .env");
  process.exit(1);
}

const BACKEND_URL = process.argv[2]?.replace(/\/$/, "");
if (!BACKEND_URL || !BACKEND_URL.startsWith("http")) {
  console.error("Usage: node scripts/setup-vapi.mjs https://your-app.vercel.app");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${VAPI_KEY}`,
  "Content-Type": "application/json",
};

const USER_NAME = (env.USER_NAME ?? "Harsh_Vardhan_Singhania").replace(/_/g, " ");

// ── Assistant config ──────────────────────────────────────────────────────────

const ASSISTANT_CONFIG = {
  name: "Harsh AI Rep",
  firstMessage:
    `Hi there! I'm the AI representative of ${USER_NAME}, a software engineer. ` +
    "I can answer questions about his background, skills, and projects — " +
    "and I can check his calendar and book an interview for you right now. " +
    "What brings you here today?",

  model: {
    provider: "custom-llm",
    url: `${BACKEND_URL}/api/vapi`,
    model: "harsh-persona-rag",
  },

  voice: {
    provider: "vapi",
    voiceId: "Elliot",
  },

  transcriber: {
    provider: "deepgram",
    model: "nova-2",
    language: "en-US",
    smartFormat: true,
  },

  serverUrl: `${BACKEND_URL}/api/voice`,
  serverMessages: ["end-of-call-report", "hang"],

  // Behaviour
  silenceTimeoutSeconds: 30,
  maxDurationSeconds: 900, // 15 min max
  backgroundSound: "off",
  backchannelingEnabled: false,
  backgroundDenoisingEnabled: true,

  endCallMessage:
    "Great speaking with you! " +
    "If we booked a slot, you'll receive a calendar confirmation shortly. Have a wonderful day!",

  endCallPhrases: ["goodbye", "bye", "talk to you later", "thanks bye"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function vapiGet(path) {
  const r = await fetch(`https://api.vapi.ai${path}`, { headers: HEADERS });
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function vapiPost(path, body) {
  const r = await fetch(`https://api.vapi.ai${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

async function vapiPatch(path, body) {
  const r = await fetch(`https://api.vapi.ai${path}`, {
    method: "PATCH",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`PATCH ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔧  Setting up Vapi voice agent for: ${BACKEND_URL}\n`);

  // 1. Check for existing assistant with same name
  let assistantId;
  try {
    const existing = await vapiGet("/assistant");
    const found = (Array.isArray(existing) ? existing : existing.data ?? [])
      .find((a) => a.name === ASSISTANT_CONFIG.name);

    if (found) {
      console.log(`⚙️   Found existing assistant: ${found.id} — updating…`);
      const updated = await vapiPatch(`/assistant/${found.id}`, ASSISTANT_CONFIG);
      assistantId = updated.id;
      console.log(`✅  Assistant updated: ${assistantId}`);
    } else {
      console.log("🆕  Creating new assistant…");
      const created = await vapiPost("/assistant", ASSISTANT_CONFIG);
      assistantId = created.id;
      console.log(`✅  Assistant created: ${assistantId}`);
    }
  } catch (err) {
    console.error("❌  Assistant create/update failed:", err.message);
    process.exit(1);
  }

  // 2. Check for existing phone numbers
  let phoneNumber;
  try {
    const numbers = await vapiGet("/phone-number");
    const list = Array.isArray(numbers) ? numbers : numbers.data ?? [];

    if (list.length > 0) {
      // Reuse first existing number and attach to assistant
      const existing = list[0];
      console.log(`📞  Found existing number: ${existing.number} — attaching to assistant…`);
      await vapiPatch(`/phone-number/${existing.id}`, { assistantId });
      phoneNumber = existing.number;
      console.log(`✅  Phone number linked: ${phoneNumber}`);
    } else {
      // Buy a new Vapi number (US by default)
      console.log("📞  Buying a new Vapi phone number…");
      const bought = await vapiPost("/phone-number", {
        provider: "vapi",
        name: `${USER_NAME} Voice Line`,
        assistantId,
        numberDesiredArea: "415", // SF area code — change if preferred
      });
      phoneNumber = bought.number;
      console.log(`✅  Phone number bought: ${phoneNumber}`);
    }
  } catch (err) {
    console.warn("⚠️   Phone number setup failed:", err.message);
    console.warn(
      "    → Go to https://dashboard.vapi.ai/phone-numbers and manually buy a number,\n" +
      `      then attach assistant ID: ${assistantId}`
    );
    phoneNumber = "(see dashboard)";
  }

  // 3. Summary
  console.log(`
╔══════════════════════════════════════════════════════╗
║          Vapi Voice Agent Setup Complete             ║
╠══════════════════════════════════════════════════════╣
║  Assistant ID : ${assistantId.padEnd(36)} ║
║  Phone Number : ${(phoneNumber ?? "").padEnd(36)} ║
║  Webhook URL  : ${(BACKEND_URL + "/api/voice").padEnd(36)} ║
║  LLM URL      : ${(BACKEND_URL + "/api/vapi/llm").padEnd(36)} ║
╚══════════════════════════════════════════════════════╝

  📞  Call ${phoneNumber} to test the voice agent.

  Next steps:
    1. Update BACKEND_URL in .env to: ${BACKEND_URL}
    2. Redeploy if you changed any env vars
    3. Call the number above — the agent should answer within 2s
`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
