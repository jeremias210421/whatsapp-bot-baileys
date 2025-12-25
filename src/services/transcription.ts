import { pipeline } from '@xenova/transformers';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import * as fs from 'fs';
import * as path from 'path';
// @ts-ignore
const wavefile = require('wavefile');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Singleton for the model pipeline
let transcriber: any = null;

async function getTranscriber() {
    if (!transcriber) {
        console.log("⏳ Loading Whisper model 'Xenova/whisper-base'...");
        transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-base');
        console.log("✅ Whisper model loaded!");
    }
    return transcriber;
}

// Convert OGG/WEBM/MP3 to WAV 16kHz Mono (required by Whisper)
async function convertToWav(inputPath: string): Promise<string> {
    const outputPath = inputPath.replace(path.extname(inputPath), '.wav');

    return new Promise((resolve, reject) => {
        ffmpeg(inputPath)
            .toFormat('wav')
            .audioChannels(1)
            .audioFrequency(16000)
            .on('end', () => resolve(outputPath))
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

export async function transcribeAudio(audioPath: string): Promise<string> {
    try {
        console.log(`[Transcribe] Starting for: ${audioPath}`);
        if (!fs.existsSync(audioPath)) {
            return `[DEBUG ERROR] File not found: ${audioPath}`;
        }

        // 1. Convert to WAV
        const wavPath = await convertToWav(audioPath);

        let stats;
        try {
            stats = fs.statSync(wavPath);
            console.log(`[Transcribe] WAV created: ${wavPath} (${stats.size} bytes)`);
        } catch (e) {
            return `[DEBUG ERROR] Failed to stat WAV: ${(e as any).message}`;
        }

        if (stats.size < 100) {
            return `[DEBUG ERROR] WAV muito pequeno (${stats.size} bytes). Falha na conversão FFmpeg.`;
        }

        // 2. Load Audio Data manually (Node.js fix)
        const buffer = fs.readFileSync(wavPath);
        const wav = new wavefile.WaveFile(buffer);
        wav.toBitDepth('32f');
        wav.toSampleRate(16000);
        let audioData = wav.getSamples();

        if (Array.isArray(audioData)) {
            console.log("[Transcribe] Stereo detected, picking channel 0");
            audioData = audioData[0];
        }

        // 3. Transcribe
        const pipe = await getTranscriber();
        console.log("[Transcribe] Running Whisper (pt)...");

        // Use Portuguese language AND force transcription (prevent translation)
        const result = await pipe(audioData, {
            language: 'portuguese',
            task: 'transcribe'
        });

        console.log("[Transcribe] Result:", JSON.stringify(result));

        // Cleanup wav
        try { fs.unlinkSync(wavPath); } catch (e) { }

        const text = result.text || "";
        if (!text || text.trim().length === 0) {
            return `[DEBUG ERROR] IA rodou mas retornou texto vazio. WAV Size: ${stats.size} bytes.`;
        }

        return text;
    } catch (error) {
        console.error("Transcription error:", error);
        return `[DEBUG EXCEPTION] Erro: ${(error as any).message}`;
    }
}
