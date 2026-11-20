/**
 * Voice control of the 3D view through the adapter Assistant (ioBroker.assistant). The 3D view speaks the protocol of
 * its upstream platform: the list of voice pipelines, a run that streams the microphone (16-bit PCM at 16 kHz, binary
 * over the connection's socket, the first byte names the run) and stops after speech to text, a run that speaks a text,
 * and the conversation. Here each becomes a `sendTo` to an instance of assistant: `stt` (a WAV recording → its text),
 * `tts` (a text → a WAV), `ask` (a sentence → the answer). The upstream platform ends a sentence at the first pause;
 * here `SpeechEnd` does that.
 *
 * Its pipelines are the instances of assistant that are switched on; the first one is preferred.
 */
import type { IoBroker } from './iobroker.js';
import { t } from './lang.js';

/** The rate the 3D view records at. */
export const RATE = 16000;
/** No answer of the instance within this time: it is not running. */
const TIMEOUT = 30_000;

/** A voice pipeline as the 3D view lists it: here an instance of assistant. */
export interface Pipeline {
    id: string;
    name: string;
    language: string;
    stt_engine: string | null;
    tts_engine: string | null;
}

/** An event of a run as the 3D view expects it (run-start, stt-end, tts-end, error, run-end). */
export interface RunEvent {
    type: string;
    data?: Record<string, unknown>;
}

/** A run of the 3D view: from speech to text, or from text to speech. */
export interface RunMessage {
    type: string;
    start_stage?: string;
    end_stage?: string;
    input?: { sample_rate?: number; text?: string };
    pipeline?: string;
}

/** Below this loudness (RMS of 16-bit samples) nothing is said. */
const QUIET = 300;
/** That much speech makes a sentence (ms). */
const SPEECH = 200;
/** That much silence after speech ends it (ms). */
const PAUSE = 800;
/** Nothing said within this time: no sentence (ms). */
const NOTHING = 5000;

/**
 * The end of a spoken sentence in the recorded chunks: speech, then a pause. Loud is what stands clearly above the
 * quietest chunk heard so far (the room's noise), and above `QUIET`.
 */
export class SpeechEnd {
    /** ms of speech heard */
    speech = 0;
    private silence = 0;
    private elapsed = 0;
    private floor = Number.POSITIVE_INFINITY;

    /** Takes the next chunk; true when the sentence is over (or nothing was said for too long). */
    push(pcm: Int16Array): boolean {
        if (!pcm.length) {
            return false;
        }
        const ms = (pcm.length / RATE) * 1000;
        let sum = 0;
        for (const v of pcm) {
            sum += v * v;
        }
        const rms = Math.sqrt(sum / pcm.length);
        this.elapsed += ms;
        this.floor = Math.min(this.floor, rms);
        if (rms > Math.max(QUIET, this.floor * 3)) {
            this.speech += ms;
            this.silence = 0;
        } else if (this.speech >= SPEECH) {
            this.silence += ms;
        }
        return this.speech >= SPEECH ? this.silence >= PAUSE : this.elapsed >= NOTHING;
    }
}

/** 16-bit mono PCM at `rate` as a WAV file. */
export function pcmToWav(chunks: Int16Array[], rate = RATE): Uint8Array {
    const samples = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(44 + samples * 2);
    const view = new DataView(out.buffer);
    const text = (at: number, s: string): void => {
        for (let i = 0; i < s.length; i++) {
            out[at + i] = s.charCodeAt(i);
        }
    };
    text(0, 'RIFF');
    view.setUint32(4, 36 + samples * 2, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    text(36, 'data');
    view.setUint32(40, samples * 2, true);
    let at = 44;
    for (const chunk of chunks) {
        for (const v of chunk) {
            view.setInt16(at, v, true);
            at += 2;
        }
    }
    return out;
}

/** Bytes as base64 (in slices: `String.fromCharCode` takes only so many arguments). */
export function toBase64(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
}

/** A sentence for the room the device hangs in: "Licht an" + Salon → "Licht an im Raum Salon". */
export function inRoom(text: string, room: string | null | undefined): string {
    return room ? t('voice_in_room', { text, room }) : text;
}

interface AssistantNative {
    sttProvider?: string;
    ttsProvider?: string;
    voiceLanguage?: string;
}

/** The answer of `stt`, `tts` and `ask` of assistant. */
interface Answer {
    text?: string;
    answer?: string;
    audio?: string;
    mime?: string;
    error?: string;
}

/** A recording that is going on. */
interface SttRun {
    instance: string;
    emit: (event: RunEvent) => void;
    chunks: Int16Array[];
    end: SpeechEnd;
    done: boolean;
}

export class Assistant {
    private runs = new Map<number, SttRun>();
    private nextHandler = 1;
    /** The instance the last recording went to: the sentence after it goes there too. */
    private lastInstance: string | null = null;
    private spoken: string | null = null;

    constructor(
        private io: IoBroker,
        private language: () => string,
        private areaName: (id: string) => string | null,
    ) {}

    /** The instances of assistant that are switched on; the first one is preferred. */
    async pipelines(): Promise<{ pipelines: Pipeline[]; preferred_pipeline: string | null }> {
        const list = await this.io.conn.getAdapterInstances('assistant').catch(() => []);
        const pipelines = list
            .filter(o => o?.common?.enabled)
            .map(o => {
                const id = o._id.replace(/^system\.adapter\./, '');
                const native = (o.native || {}) as AssistantNative;
                return {
                    id,
                    name: `Assistant (${id})`,
                    language: native.voiceLanguage || this.language(),
                    stt_engine: native.sttProvider || 'assistant',
                    tts_engine: native.ttsProvider || 'assistant',
                };
            })
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
        return { pipelines, preferred_pipeline: pipelines[0]?.id ?? null };
    }

    /** A run of the 3D view; returns its end. */
    run(callback: (event: RunEvent) => void, msg: RunMessage): () => Promise<void> {
        let open = true;
        const emit = (event: RunEvent): void => {
            if (open) {
                callback(event);
            }
        };
        let handler: number | null = null;
        void this.instance(msg.pipeline).then(instance => {
            if (!open) {
                return;
            }
            if (!instance) {
                emit({ type: 'error', data: { code: 'no_pipeline', message: t('voice_no_assistant') } });
                return;
            }
            if (msg.start_stage === 'tts') {
                void this.speak(instance, String(msg.input?.text ?? ''), emit);
                return;
            }
            handler = this.nextHandler++;
            this.lastInstance = instance;
            this.runs.set(handler, { instance, emit, chunks: [], end: new SpeechEnd(), done: false });
            emit({ type: 'run-start', data: { runner_data: { stt_binary_handler_id: handler } } });
        });
        return () => {
            open = false;
            if (handler !== null) {
                this.runs.delete(handler);
            }
            return Promise.resolve();
        };
    }

    /** A binary message of the 3D view: the first byte names the run, the rest is 16-bit PCM; nothing more: the end. */
    send(data: ArrayBufferLike | ArrayBufferView): void {
        const bytes = ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);
        const run = this.runs.get(bytes[0]);
        if (!run || run.done) {
            return;
        }
        if (bytes.length < 3) {
            void this.transcribe(bytes[0], run);
            return;
        }
        // a copy: the 3D view may reuse its buffer, and an Int16Array needs an even offset
        const pcm = new Int16Array(bytes.slice(1, 1 + ((bytes.length - 1) & ~1)).buffer);
        run.chunks.push(pcm);
        if (run.end.push(pcm)) {
            void this.transcribe(bytes[0], run);
        }
    }

    /** `conversation/process` and `home3d/voice/converse`: the sentence to assistant, its answer as the 3D view wants it. */
    async converse(msg: {
        text?: unknown;
        area_id?: unknown;
    }): Promise<{ response: { speech: { plain: { speech: string } } } }> {
        const instance = await this.instance(this.lastInstance ?? undefined);
        if (!instance) {
            throw new Error(t('voice_no_assistant'));
        }
        const room = typeof msg.area_id === 'string' && msg.area_id ? this.areaName(msg.area_id) : null;
        const text = inRoom(typeof msg.text === 'string' ? msg.text.trim() : '', room);
        const res = await this.ask(instance, 'ask', { text, source: 'home3d' });
        if (res.error) {
            throw new Error(res.error);
        }
        return { response: { speech: { plain: { speech: String(res.answer ?? '') } } } };
    }

    /** The instance to use: the one chosen, if it is still switched on, else the preferred one. */
    private async instance(chosen?: string | null): Promise<string | null> {
        const { pipelines, preferred_pipeline } = await this.pipelines();
        return pipelines.find(p => p.id === chosen)?.id ?? preferred_pipeline;
    }

    /** The recording to `stt`; its text to the 3D view. Nothing said: an empty text without asking. */
    private async transcribe(handler: number, run: SttRun): Promise<void> {
        run.done = true;
        this.runs.delete(handler);
        let text = '';
        if (run.end.speech > 0) {
            const res = await this.ask(run.instance, 'stt', {
                audio: toBase64(pcmToWav(run.chunks)),
                format: 'wav',
            });
            if (res.error) {
                run.emit({ type: 'error', data: { code: 'stt-failed', message: res.error } });
                return;
            }
            text = String(res.text ?? '').trim();
        }
        run.emit({ type: 'stt-end', data: { stt_output: { text } } });
        run.emit({ type: 'run-end' });
    }

    /** A text through `tts`: the WAV as a URL the 3D view plays. */
    private async speak(instance: string, text: string, emit: (event: RunEvent) => void): Promise<void> {
        const res = await this.ask(instance, 'tts', { text });
        if (res.error || !res.audio) {
            emit({ type: 'error', data: { code: 'tts-failed', message: res.error || 'no audio' } });
            return;
        }
        const bytes = Uint8Array.from(atob(res.audio), c => c.charCodeAt(0));
        if (this.spoken) {
            URL.revokeObjectURL(this.spoken);
        }
        this.spoken = URL.createObjectURL(new Blob([bytes], { type: res.mime || 'audio/wav' }));
        emit({ type: 'tts-end', data: { tts_output: { url: this.spoken } } });
        emit({ type: 'run-end' });
    }

    /** A command to the instance; a missing answer or a failure becomes `error`. */
    private async ask(instance: string, command: string, message: Record<string, unknown>): Promise<Answer> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const res = await Promise.race([
                this.io.conn.sendTo<Answer | null>(instance, command, message),
                new Promise<null>(resolve => (timer = setTimeout(() => resolve(null), TIMEOUT))),
            ]);
            return res && typeof res === 'object' ? res : { error: t('voice_no_answer', { instance }) };
        } catch (e) {
            return { error: (e as Error).message || String(e) };
        } finally {
            clearTimeout(timer);
        }
    }
}
