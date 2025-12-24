import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    WASocket,
    proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import * as fs from "fs";
import * as path from "path";

// ─────────────────────────────────────────────────────────────
// Supabase setup
// ─────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    process.exit(1);
}

const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey);

// ─────────────────────────────────────────────────────────────
// Logger
// ─────────────────────────────────────────────────────────────
const logger = pino({ level: "info" });

// ─────────────────────────────────────────────────────────────
// Auth state folder (persisted between restarts)
// ─────────────────────────────────────────────────────────────
const AUTH_FOLDER = process.env.AUTH_FOLDER || "./auth_state";
if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// Save message to Supabase
// ─────────────────────────────────────────────────────────────
async function saveMessage(
    fromNumber: string,
    body: string,
    direction: "inbound" | "outbound"
) {
    const { error } = await supabase.from("messages").insert({
        from_number: fromNumber,
        body,
        direction,
    });
    if (error) {
        logger.error({ error }, "Failed to save message");
    }
}

// ─────────────────────────────────────────────────────────────
// Handle incoming messages
// ─────────────────────────────────────────────────────────────
async function handleMessage(sock: WASocket, msg: proto.IWebMessageInfo) {
    // Ignore status broadcasts and messages sent by us
    if (!msg.message || msg.key.fromMe || msg.key.remoteJid === "status@broadcast") {
        return;
    }

    const jid = msg.key.remoteJid!;
    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

    if (!text) return; // Ignore media-only messages for now

    logger.info({ from: jid, text }, "📩 Message received");

    // Save inbound
    await saveMessage(jid, text, "inbound");

    // ─── Bot logic (simple echo, customize as needed) ───
    const reply = `Echo: ${text}`;

    await sock.sendMessage(jid, { text: reply });
    logger.info({ to: jid, reply }, "📤 Message sent");

    // Save outbound
    await saveMessage(jid, reply, "outbound");
}

// ─────────────────────────────────────────────────────────────
// Start bot
// ─────────────────────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        logger: pino({ level: "silent" }) as any, // quiet internal logs
    });

    // Persist credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Handle connection updates
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            logger.info("📱 Scan the QR code above with your WhatsApp app");
        }

        if (connection === "close") {
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;

            logger.warn({ reason }, "Connection closed");

            if (shouldReconnect) {
                logger.info("🔄 Reconnecting...");
                startBot();
            } else {
                logger.info("🚪 Logged out. Delete auth_state folder to re-login.");
            }
        }

        if (connection === "open") {
            logger.info("✅ Connected to WhatsApp");
        }
    });

    // Listen for new messages
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify") return;
        for (const msg of messages) {
            await handleMessage(sock, msg);
        }
    });
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────
startBot().catch((err) => {
    logger.error(err, "Bot crashed");
    process.exit(1);
});
