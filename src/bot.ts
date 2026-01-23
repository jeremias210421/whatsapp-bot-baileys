import "dotenv/config";
import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    WASocket,
    proto,
    downloadMediaMessage,
    WAMessage,
} from "@whiskeysockets/baileys";
import { writeFile } from "fs/promises";
import * as path from "path";
import { Boom } from "@hapi/boom";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import * as fs from "fs";
import * as http from "http";
import * as QRCode from "qrcode";
import { transcribeAudio } from "./services/transcription";
import { askAI } from './services/ai';

// ─────────────────────────────────────────────────────────────
// Supabase setup
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Supabase setup
// ─────────────────────────────────────────────────────────────
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// WORKAROUND: Force MobDrive if Railway persists with old env
if (supabaseUrl && supabaseUrl.includes("mfsuhrtvertzoggvlwxv")) {
    console.warn("⚠️ DETECTED WRONG ENV VAR. FORCING MOBDRIVE CREDENTIALS.");
    supabaseUrl = "https://eqbyygubokilrvvxdptx.supabase.co";
    supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxYnl5Z3Vib2tpbHJ2dnhkcHR4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDk2NzcwMCwiZXhwIjoyMDY2NTQzNzAwfQ.pEPTm5E73kPv2MIpnqYW5DVM4ns78Lded8jKRFXWtTc";
}

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
const MEDIA_FOLDER = process.env.MEDIA_FOLDER || "./public/media";

if (!fs.existsSync(AUTH_FOLDER)) {
    fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}
if (!fs.existsSync(MEDIA_FOLDER)) {
    fs.mkdirSync(MEDIA_FOLDER, { recursive: true });
}

// ─────────────────────────────────────────────────────────────
// Global State for QR Code
// ─────────────────────────────────────────────────────────────
let currentQR: string | undefined;

// ─────────────────────────────────────────────────────────────
// HTTP Server for Health Checks & QR Display
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
    // Headers for CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Bypass-Tunnel-Reminder");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === "/simulate" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", async () => {
            try {
                logger.info({ body }, "Received simulate body");
                const { jid, message } = JSON.parse(body);

                if (!jid || !message) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Missing jid or message" }));
                    return;
                }

                logger.info({ jid, message }, "🔄 Simulating inbound message");

                // Create a mock socket for simulation that doesn't send real WhatsApp messages
                const mockSock = {
                    sendMessage: async (targetJid: string, content: { text: string }) => {
                        logger.info({ to: targetJid, reply: content.text }, "📤 [SIMULATED] Message sent");
                        // Don't save here - handleMessage already saves after calling sendMessage
                        return { status: "simulated" };
                    }
                } as any;

                // Construct a fake WebMessageInfo proto
                const fakeProto: proto.IWebMessageInfo = {
                    key: {
                        remoteJid: jid,
                        fromMe: false,
                        id: "SIMULATED_" + Date.now()
                    },
                    message: {
                        conversation: message
                    },
                    messageTimestamp: Date.now() / 1000
                };

                // Inject into handler with mock socket
                await handleMessage(mockSock, fakeProto);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "simulated", jid, message }));
            } catch (err: any) {
                logger.error({ err }, "Failed to simulate message");
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error", details: err?.message || String(err) }));
            }
        });
        return;
    }

    // ... (keep /send and others as is, only change debug-env below)

    // Debug endpoint
    if (req.url === "/debug-env") {
        let dbStatus = "CHECKING";
        let dbError = null;
        try {
            const { count, error } = await supabase.from('messages').select('*', { count: 'exact', head: true });
            if (error) {
                dbStatus = "ERROR";
                dbError = error.message;
            } else {
                dbStatus = `OK (Rows: ${count})`;
            }
        } catch (e: any) {
            dbStatus = "EXCEPTION";
            dbError = e.message;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            url: process.env.SUPABASE_URL,
            activeUrl: supabaseUrl, // Show the actual URL being used (from workaround or env)
            keyLen: process.env.SUPABASE_SERVICE_ROLE_KEY?.length,
            dbStatus,
            dbError
        }));
        return;
    }

    if (req.url === "/send" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", async () => {
            try {
                const { jid, message } = JSON.parse(body);

                if (!jid || !message) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Missing jid or message" }));
                    return;
                }

                if (!sock || !sock.user) {
                    res.writeHead(503, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Bot not connected (Scan QR first)" }));
                    return;
                }

                await sock.sendMessage(jid, { text: message });
                logger.info({ to: jid, message }, "📤 API Message sent");

                // Save to Supabase as outbound
                await saveMessage(jid, message, "outbound");

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "sent", jid, message }));
            } catch (err: any) {
                const errorMessage = err?.message || err?.toString() || "Unknown error";
                logger.error({ err, errorMessage }, "Failed to send message via API");
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error", details: errorMessage }));
            }
        });
        return;
    }

    if (req.url === "/simulate-audio" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", async () => {
            try {
                const { jid, audioBase64 } = JSON.parse(body);

                if (!jid || !audioBase64) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Missing jid or audioBase64" }));
                    return;
                }

                const audioBuffer = Buffer.from(audioBase64, 'base64');

                // Save audio file locally to serve it
                const fileName = `sim_outbound_${Date.now()}.webm`;
                const filePath = path.join(MEDIA_FOLDER, fileName);
                await writeFile(filePath, audioBuffer);
                const domain = process.env.RAILWAY_PUBLIC_DOMAIN
                    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                    : `http://localhost:${PORT}`;
                const publicUrl = `${domain}/media/${fileName}`;

                logger.info({ to: jid }, "📤 [SIMULATED] API Audio sent");

                // Save to Supabase (User Audio = Inbound)
                await saveMessage(jid, "[Audio Sent Simulated]", "inbound", "audio", publicUrl);

                // Respond to Frontend immediately
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "simulated_audio", jid, url: publicUrl }));

                // Process Transcription in Background
                (async () => {
                    let replyText = "🔊 Áudio simulado recebido! Processando transcrição...";
                    try {
                        const transcription = await transcribeAudio(filePath);
                        let aiResponse = "";
                        if (transcription && !transcription.startsWith("[DEBUG")) {
                            aiResponse = await askAI(transcription);
                            replyText = `🗣️ Ouvido: "${transcription}"\n\n🤖 IA: ${aiResponse}`;
                        } else {
                            replyText = `⚠️ Erro na audição: ${transcription}`;
                        }
                    } catch (e) {
                        logger.error({ err: e }, "Transcription failed");
                        replyText = "⚠️ Erro: " + (e as any).message;
                    }

                    await saveMessage(jid, replyText, "outbound");
                    logger.info({ to: jid, reply: replyText }, "📥 [SIMULATED] Reply saved (Async)");
                })();
            } catch (err) {
                logger.error({ err }, "Failed to simulate audio");
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error " + err }));
            }
        });
        return;
    }

    if (req.url === "/send-audio" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", async () => {
            try {
                const { jid, audioBase64 } = JSON.parse(body);

                if (!jid || !audioBase64) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Missing jid or audioBase64" }));
                    return;
                }

                if (!sock || !sock.user) {
                    res.writeHead(503, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Bot not connected" }));
                    return;
                }

                const audioBuffer = Buffer.from(audioBase64, 'base64');

                await sock.sendMessage(jid, {
                    audio: audioBuffer,
                    mimetype: 'audio/mp4',
                    ptt: true // Send as voice note
                });

                logger.info({ to: jid }, "📤 API Audio sent");

                // Save audio file locally to serve it
                const fileName = `outbound_${Date.now()}.webm`;
                const filePath = path.join(MEDIA_FOLDER, fileName);
                await writeFile(filePath, audioBuffer);
                const domain = process.env.RAILWAY_PUBLIC_DOMAIN
                    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                    : `http://localhost:${PORT}`;
                const publicUrl = `${domain}/media/${fileName}`;

                // Save to Supabase
                await saveMessage(jid, "[Audio Sent]", "outbound", "audio", publicUrl);

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "sent", jid, url: publicUrl }));
            } catch (err) {
                logger.error({ err }, "Failed to send audio via API");
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error " + err }));
            }
        });
        return;
    }

    // AI Control Endpoint
    if (req.url === "/ai-settings" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString();
        });
        req.on("end", async () => {
            try {
                const { jid, mode, durationHours } = JSON.parse(body);

                if (!jid || !['active', 'disabled', 'paused'].includes(mode)) {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Invalid parameters. Mode must be 'active', 'disabled', or 'paused'." }));
                    return;
                }

                const updates: any = {
                    ai_mode: mode,
                    updated_at: new Date().toISOString()
                };

                if (mode === 'paused' && durationHours) {
                    const pausedUntil = new Date();
                    pausedUntil.setHours(pausedUntil.getHours() + durationHours);
                    updates.ai_paused_until = pausedUntil.toISOString();
                } else {
                    updates.ai_paused_until = null;
                }

                const { error } = await supabase
                    .from('contacts')
                    .upsert({ phone_number: jid, ...updates }, { onConflict: 'phone_number' });

                if (error) {
                    logger.error({ error }, "Failed to update AI settings");
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Database error" }));
                    return;
                }

                logger.info({ jid, mode, updates }, "⚙️ AI Settings Updated");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "updated", mode, pausedUntil: updates.ai_paused_until }));

            } catch (err) {
                logger.error({ err }, "Failed to process AI settings");
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Internal Server Error" }));
            }
        });
        return;
    }

    // Status endpoint for frontend (JSON)
    if (req.url === "/status") {
        res.writeHead(200, { "Content-Type": "application/json" });

        let qrDataUrl: string | null = null;
        if (currentQR) {
            try {
                qrDataUrl = await QRCode.toDataURL(currentQR);
            } catch (err) {
                logger.error({ err }, "Failed to generate QR data URL");
            }
        }

        res.end(JSON.stringify({
            connected: !currentQR,
            qrCode: qrDataUrl,
            timestamp: new Date().toISOString()
        }));
        return;
    }

    if (req.url === "/logout" && req.method === "POST") {
        logger.info("🚪 Logout requested via API");

        try {
            // Try to gracefully logout from WhatsApp servers
            if (sock) {
                try {
                    await sock.logout();
                } catch (e) {
                    logger.error({ err: e }, "Failed to send logout packet, proceeding with local cleanup");
                }
                sock.end(undefined);
            }

            // Wait a moment for file handles to be released
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Delete auth folder
            if (fs.existsSync(AUTH_FOLDER)) {
                try {
                    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                    logger.info("🗑️ Auth folder deleted.");
                } catch (rmError: any) {
                    logger.error({ err: rmError }, "Failed to delete auth folder");
                }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "logged_out" }));

            // Exit process to allow restart/cleanup
            setTimeout(() => {
                process.exit(0);
            }, 500);

        } catch (err) {
            logger.error({ err }, "Failed to logout");
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Logout failed" }));
        }
        return;
    }

    if (req.url === "/") {
        res.writeHead(200, { "Content-Type": "text/html" });

        if (currentQR) {
            try {
                const url = await QRCode.toDataURL(currentQR);
                res.end(`
                    <html>
                        <head>
                            <title>WhatsApp Bot QR</title>
                            <meta http-equiv="refresh" content="3">
                        </head>
                        <body style="display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column; font-family:sans-serif;">
                            <h1>Scan QR Code</h1>
                            <img src="${url}" alt="QR Code" style="width:300px; height:300px; border:1px solid #ccc;"/>
                            <p>Refresh if needed.</p>
                        </body>
                    </html>
                `);
            } catch (err) {
                res.end(`<h1>Error generating QR</h1><p>${err}</p>`);
            }
        } else {
            res.end(`
                <html>
                    <head><title>WhatsApp Bot QR</title></head>
                    <body style="display:flex; justify-content:center; align-items:center; height:100vh; font-family:sans-serif;">
                        <h1>Bot is connected or generating QR...</h1>
                        <p>Check back in a moment.</p>
                    </body>
                </html>
            `);
        }
        return;
    }

    // Serve static files from MEDIA_FOLDER
    if (req.url?.startsWith("/media/")) {
        const filePath = path.join(process.cwd(), "public", req.url);
        if (fs.existsSync(filePath)) {
            res.writeHead(200);
            fs.createReadStream(filePath).pipe(res);
            return;
        }
    }

    // Debug endpoint
    if (req.url?.startsWith("/debug-env")) {
        let dbStatus = "CHECKING";
        let dbError = null;
        try {
            if (req.url.includes("type=write")) {
                const { error } = await supabase.from('messages').insert({
                    from_number: 'DEBUG_PROBE',
                    body: 'Write Test ' + new Date().toISOString(),
                    direction: 'inbound',
                    status: 'sent'
                });
                if (error) {
                    dbStatus = "WRITE_ERROR";
                    dbError = error.message + " | Details: " + JSON.stringify(error);
                } else {
                    dbStatus = "WRITE_OK";
                }
            } else {
                const { count, error } = await supabase.from('messages').select('*', { count: 'exact', head: true });
                if (error) {
                    dbStatus = "READ_ERROR";
                    dbError = error.message;
                } else {
                    dbStatus = `READ_OK (Rows: ${count})`;
                }
            }
        } catch (e: any) {
            dbStatus = "EXCEPTION";
            dbError = e.message;
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            url: process.env.SUPABASE_URL,
            activeUrl: supabaseUrl,
            keyLen: process.env.SUPABASE_SERVICE_ROLE_KEY?.length,
            dbStatus,
            dbError
        }));
        return;
    }

    res.writeHead(404);
    res.end("Not Found");
});

server.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
});

// ─────────────────────────────────────────────────────────────
// Typing Indicator Functions
// ─────────────────────────────────────────────────────────────
async function setTypingStatus(chatId: string, isTyping: boolean) {
    const { error } = await supabase
        .from("typing_status")
        .upsert({ chat_id: chatId, is_typing: isTyping, updated_at: new Date().toISOString() }, { onConflict: "chat_id" });

    if (error) {
        logger.warn({ error }, "Failed to update typing status");
    }
}

async function sendWithTyping(sock: WASocket, jid: string, message: string, delayMs: number = 1500) {
    // Set typing status
    await setTypingStatus(jid, true);

    // Send presence update (shows "typing..." in WhatsApp)
    try {
        await sock.sendPresenceUpdate("composing", jid);
    } catch (e) {
        logger.warn({ err: e }, "Failed to send presence update");
    }

    // Wait for natural typing feel
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Clear typing status
    await setTypingStatus(jid, false);

    // Send actual message
    await sock.sendMessage(jid, { text: message });

    // Stop typing presence
    try {
        await sock.sendPresenceUpdate("paused", jid);
    } catch (e) { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────
// Save message to Supabase
// ─────────────────────────────────────────────────────────────
async function saveMessage(
    fromNumber: string,
    body: string,
    direction: "inbound" | "outbound",
    messageType: "text" | "audio" | "image" = "text",
    mediaUrl: string | null = null,
    status: "sending" | "sent" | "delivered" | "read" = "sent"
) {
    const { error } = await supabase.from("messages").insert({
        from_number: fromNumber,
        body,
        direction,
        message_type: messageType,
        media_url: mediaUrl,
        status: direction === "outbound" ? status : "delivered"
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
    if (!msg.message || !msg.key || msg.key.fromMe || msg.key.remoteJid === "status@broadcast") {
        return;
    }

    const jid = msg.key.remoteJid!;

    // Only respond to direct chats (s.whatsapp.net)
    // Ignore groups (@g.us), broadcasts, newsletters, etc.
    if (!jid.endsWith("@s.whatsapp.net")) {
        logger.info({ jid }, "⏭️ Ignoring non-direct message");
        return;
    }

    const text =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

    const audio = msg.message.audioMessage;

    if (audio) {
        try {
            const buffer = await downloadMediaMessage(
                msg as WAMessage,
                "buffer",
                {},
                {
                    logger,
                    reuploadRequest: sock.updateMediaMessage
                }
            );
            const fileName = `audio_${msg.key.id}.ogg`;
            const filePath = path.join(MEDIA_FOLDER, fileName);
            await writeFile(filePath, buffer);

            const publicUrl = `http://localhost:${PORT}/media/${fileName}`;
            logger.info({ from: jid, url: publicUrl }, "🎤 Audio received");

            await saveMessage(jid, "[Audio Message]", "inbound", "audio", publicUrl);

            // Transcription + AI
            const transcription = await transcribeAudio(filePath);
            if (transcription && !transcription.startsWith("[DEBUG")) {
                await sock.sendMessage(jid, { text: `🗣️ Ouvido: "${transcription}"` });
                const aiResponse = await askAI(transcription);
                await sock.sendMessage(jid, { text: aiResponse });
                await saveMessage(jid, aiResponse, "outbound");
            } else {
                await sock.sendMessage(jid, { text: `⚠️ Não entendi o áudio` });
            }
            return;
        } catch (err) {
            logger.error({ err }, "Failed to download audio");
            return;
        }
    }

    if (!text) return; // Ignore other media types

    logger.info({ from: jid, text }, "📩 Message received");

    // Save inbound
    await saveMessage(jid, text, "inbound");

    // ─── AI Control Check ───
    const { data: contactConfig } = await supabase
        .from('contacts')
        .select('ai_mode, ai_paused_until')
        .eq('phone_number', jid)
        .single();

    if (contactConfig) {
        if (contactConfig.ai_mode === 'disabled') {
            logger.info({ jid }, "⛔ AI is disabled for this contact");
            return;
        }

        if (contactConfig.ai_mode === 'paused' && contactConfig.ai_paused_until) {
            const pausedUntil = new Date(contactConfig.ai_paused_until);
            if (new Date() < pausedUntil) {
                logger.info({ jid, pausedUntil }, "zzz AI is paused for this contact");
                return;
            } else {
                // Auto-resume
                logger.info({ jid }, "⏰ AI pause expired, resuming...");
                await supabase
                    .from('contacts')
                    .update({ ai_mode: 'active', ai_paused_until: null })
                    .eq('phone_number', jid);
            }
        }
    }

    // ─── Bot logic (Brain with History) ───
    // Fetch last 10 messages for context
    const { data: history } = await supabase
        .from('messages')
        .select('body, direction')
        .eq('from_number', jid)
        .order('received_at', { ascending: false })
        .limit(10);

    // Convert to conversation format (reverse to chronological order)
    const conversationHistory = (history || []).reverse().map((msg: any) => ({
        role: (msg.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: msg.body
    }));

    const reply = await askAI(text, conversationHistory);

    // DEBUG: Log the raw reply to see if it has line breaks
    logger.info({ rawReply: reply, hasLineBreaks: reply.includes('\n') }, "🔍 AI Response Debug");

    // Force proper line breaks (in case AI didn't add them)
    let processedReply = reply
        // Remove markdown bold/italic (WhatsApp uses different syntax)
        .replace(/\*\*([^*]+)\*\*/g, '*$1*')  // **text** -> *text*
        // Add line break after bullet points if missing
        .replace(/•\s*([^\n•]+)(?!\n)/g, '• $1\n')
        // Add line break after numbered items if missing
        .replace(/(\d+\.)\s*([^\n\d]+)(?!\n)/g, '$1 $2\n')
        // Add double line break before section emojis
        .replace(/(📋|📱|⏱️|✅|🚗|💰|🎯|📍|💳)/g, '\n\n$1')
        // Add line break after "Passo X:" patterns
        .replace(/(\*\*Passo \d+:.*?\*\*)/g, '\n$1\n')
        // Ensure spacing after sentences ending with emoji
        .replace(/([.!?])\s*([😊🎉✨👍])\s*(?=[A-Z])/g, '$1 $2\n\n')
        // Clean up excessive line breaks (max 2 in a row)
        .replace(/\n{3,}/g, '\n\n')
        .trim();

    logger.info({ processedReply, hasLineBreaks: processedReply.includes('\n') }, "✅ Processed Reply");

    // Set typing status before generating response
    await setTypingStatus(jid, true);
    try {
        await sock.sendPresenceUpdate("composing", jid);
    } catch (e) { /* ignore */ }

    // Split long messages into chunks (by double line breaks or max 800 chars)
    const messageParts = splitMessage(processedReply);

    for (let i = 0; i < messageParts.length; i++) {
        const part = messageParts[i];

        // Add typing delay for natural feel (shorter for subsequent parts)
        const typingDelay = i === 0 ? Math.min(part.length * 20, 2000) : 500;
        await new Promise(resolve => setTimeout(resolve, typingDelay));

        await sock.sendMessage(jid, { text: part });
        logger.info({ to: jid, part: i + 1, total: messageParts.length }, "📤 Message part sent");
    }

    // Clear typing status
    await setTypingStatus(jid, false);
    try {
        await sock.sendPresenceUpdate("paused", jid);
    } catch (e) { /* ignore */ }

    // Save outbound (full reply)
    await saveMessage(jid, processedReply, "outbound");
}

// ─────────────────────────────────────────────────────────────
// Save Contact Info (Profile Pic)
// ─────────────────────────────────────────────────────────────
async function saveContact(jid: string, pushName?: string) {
    try {
        let profilePicUrl: string | null = null;
        try {
            // 'image' returns the high res image. Use 'preview' for low res if preferred.
            const url = await sock!.profilePictureUrl(jid, 'image');
            profilePicUrl = url || null;
        } catch (e) {
            // Profile pic might be private or not set
            // logger.warn({ jid, err: e }, "Failed to fetch profile picture");
        }

        // Upsert contact
        const { error } = await supabase
            .from('contacts')
            .upsert({
                phone_number: jid,
                name: pushName || jid, // Use pushName if available, else fallback to JID
                profile_pic_url: profilePicUrl,
                updated_at: new Date().toISOString()
            }, { onConflict: 'phone_number' });

        if (error) {
            // If table doesn't exist, this will error. We log it but don't crash.
            logger.warn({ error }, "Failed to save contact. Does the 'contacts' table exist?");
        } else {
            logger.info({ jid, hasPic: !!profilePicUrl }, "👤 Contact info saved");
        }

    } catch (err) {
        logger.error({ err }, "Error in saveContact");
    }
}

// Helper: Split long messages intelligently
function splitMessage(text: string, maxLength: number = 800): string[] {
    // If short enough, return as-is
    if (text.length <= maxLength) return [text];

    // Try to split by double line breaks (natural sections)
    const sections = text.split('\n\n');
    const parts: string[] = [];
    let currentPart = '';

    for (const section of sections) {
        // If adding this section exceeds limit, push current and start new
        if (currentPart && (currentPart + '\n\n' + section).length > maxLength) {
            parts.push(currentPart.trim());
            currentPart = section;
        } else {
            currentPart += (currentPart ? '\n\n' : '') + section;
        }
    }

    if (currentPart) parts.push(currentPart.trim());

    return parts.length > 0 ? parts : [text];
}

// ─────────────────────────────────────────────────────────────
// Global Sock
// ─────────────────────────────────────────────────────────────
let sock: WASocket | undefined;

// ─────────────────────────────────────────────────────────────
// Start bot
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Start bot
// ─────────────────────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, // Fix: Deprecated option removed
        logger: pino({ level: "info" }) as any,
    });

    // Persist credentials on update
    sock.ev.on("creds.update", saveCreds);

    // Handle connection updates
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            currentQR = qr;
            logger.info("📱 QR Code received from Baileys");

            // Print QR to terminal for Railway logs
            // Use small: true for better fit in narrow logs
            require("qrcode-terminal").generate(qr, { small: true }, (qrcode: string) => {
                console.log("\n" + qrcode + "\n");
                logger.info("Scan the QR code above to login!");
            });
        }

        if (connection === "close") {
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
            const shouldReconnect = reason !== DisconnectReason.loggedOut;

            logger.warn({ reason }, "Connection closed");

            if (shouldReconnect) {
                logger.info("🔄 Reconnecting...");
                setTimeout(startBot, 2000); // Add small delay before reconnect
            } else {
                logger.error("🚪 Logged out. Cleaning up session and restarting...");
                // Clean up auth folder to prevent loop
                try {
                    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
                    logger.info("🗑️ Auth folder deleted.");
                } catch (e) {
                    logger.error({ err: e }, "Failed to delete auth folder");
                }
                // Exit process to let Railway restart it clean
                process.exit(0);
            }
        }

        if (connection === "open") {
            logger.info("✅ Connected to WhatsApp");
            currentQR = undefined; // Clear QR code on successful connection
        }
    });

    // Listen for new messages
    sock.ev.on("messages.upsert", async ({ messages, type }) => {
        if (type !== "notify" || !sock) return;
        for (const msg of messages) {
            await handleMessage(sock, msg);

            // Sync contact info (async to not block)
            if (msg.key.remoteJid && !msg.key.fromMe) {
                saveContact(msg.key.remoteJid, msg.pushName || undefined).catch(err => logger.error({ err }, "Background contact sync failed"));
            }
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
