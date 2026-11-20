import assert from 'node:assert/strict';
import test from 'node:test';
import { Assistant, inRoom, pcmToWav, RATE, SpeechEnd, toBase64, type RunEvent } from '../frontend/assistant';
import type { IoBroker } from '../frontend/iobroker';

/** A chunk of 100 ms at the given loudness (a square wave). */
function chunk(level: number, ms = 100): Int16Array {
    const pcm = new Int16Array((RATE * ms) / 1000);
    pcm.forEach((_, i) => (pcm[i] = i % 2 ? level : -level));
    return pcm;
}

test('SpeechEnd: a sentence ends at the first pause after speech', () => {
    const end = new SpeechEnd();
    // the room's noise, then speech
    for (let i = 0; i < 5; i++) {
        assert.equal(end.push(chunk(40)), false);
    }
    for (let i = 0; i < 10; i++) {
        assert.equal(end.push(chunk(3000)), false);
    }
    // a short breath does not end it
    for (let i = 0; i < 4; i++) {
        assert.equal(end.push(chunk(40)), false);
    }
    assert.equal(end.push(chunk(3000)), false);
    // the pause
    const ended = [];
    for (let i = 0; i < 10; i++) {
        ended.push(end.push(chunk(40)));
    }
    assert.deepEqual(ended.indexOf(true), 7);
    assert.ok(end.speech >= 1000);
});

test('SpeechEnd: nothing said ends after five seconds, without speech', () => {
    const end = new SpeechEnd();
    let n = 0;
    while (!end.push(chunk(100)) && n < 100) {
        n++;
    }
    assert.equal(n, 49);
    assert.equal(end.speech, 0);
});

test('pcmToWav: a WAV of 16-bit mono with the samples of every chunk', () => {
    const wav = pcmToWav([Int16Array.from([1, -2]), Int16Array.from([300])]);
    const view = new DataView(wav.buffer);
    assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), 'RIFF');
    assert.equal(new TextDecoder().decode(wav.subarray(8, 16)), 'WAVEfmt ');
    assert.equal(view.getUint32(24, true), 16000);
    assert.equal(view.getUint16(34, true), 16);
    assert.equal(view.getUint32(40, true), 6);
    assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)], [1, -2, 300]);
    assert.equal(wav.length, 50);
});

test('toBase64 and inRoom', () => {
    assert.equal(toBase64(new TextEncoder().encode('home3d')), btoa('home3d'));
    // longer than one slice of String.fromCharCode
    const big = new Uint8Array(70000).map((_, i) => i % 251);
    assert.deepEqual(Uint8Array.from(atob(toBase64(big)), c => c.charCodeAt(0)), big);
    assert.equal(inRoom('Licht an', null), 'Licht an');
    assert.match(inRoom('Licht an', 'Salon'), /^Licht an .*Salon$/);
});

/** An IoBroker with assistant instances whose sendTo answers by `answer`. */
function fakeIo(
    instances: { id: string; enabled: boolean; native?: Record<string, unknown> }[],
    answer: (instance: string, command: string, message: Record<string, unknown>) => unknown,
): { io: IoBroker; sent: { instance: string; command: string; message: Record<string, unknown> }[] } {
    const sent: { instance: string; command: string; message: Record<string, unknown> }[] = [];
    const conn = {
        getAdapterInstances: async () =>
            instances.map(i => ({
                _id: `system.adapter.${i.id}`,
                common: { enabled: i.enabled },
                native: i.native ?? {},
            })),
        sendTo: async (instance: string, command: string, message: Record<string, unknown>) => {
            sent.push({ instance, command, message });
            return answer(instance, command, message);
        },
    };
    return { io: { conn } as unknown as IoBroker, sent };
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 10));

test('Assistant: the instances switched on are the pipelines, the first one preferred', async () => {
    const { io } = fakeIo(
        [
            { id: 'assistant.1', enabled: true, native: { sttProvider: 'local', voiceLanguage: 'de-DE' } },
            { id: 'assistant.0', enabled: true },
            { id: 'assistant.2', enabled: false },
        ],
        () => null,
    );
    const res = await new Assistant(io, () => 'de', () => null).pipelines();
    assert.deepEqual(
        res.pipelines.map(p => [p.id, p.language, p.stt_engine]),
        [
            ['assistant.0', 'de', 'assistant'],
            ['assistant.1', 'de-DE', 'local'],
        ],
    );
    assert.equal(res.preferred_pipeline, 'assistant.0');
});

test('Assistant: the microphone is recorded until the pause and written down by stt', async () => {
    const { io, sent } = fakeIo([{ id: 'assistant.0', enabled: true }], (_i, command) =>
        command === 'stt' ? { text: ' Licht an ' } : null,
    );
    const assistant = new Assistant(io, () => 'de', () => null);
    const events: RunEvent[] = [];
    const stop = assistant.run(e => events.push(e), {
        type: 'assist_pipeline/run',
        start_stage: 'stt',
        end_stage: 'stt',
        input: { sample_rate: 16000 },
    });
    await flush();
    assert.equal(events[0].type, 'run-start');
    const handler = (events[0].data as { runner_data: { stt_binary_handler_id: number } }).runner_data
        .stt_binary_handler_id;
    const send = (pcm: Int16Array): void => {
        const msg = new Uint8Array(1 + pcm.byteLength);
        msg[0] = handler;
        msg.set(new Uint8Array(pcm.buffer), 1);
        assistant.send(msg);
    };
    for (let i = 0; i < 3; i++) {
        send(chunk(30));
    }
    for (let i = 0; i < 8; i++) {
        send(chunk(4000));
    }
    for (let i = 0; i < 12; i++) {
        send(chunk(30));
    }
    await flush();
    assert.deepEqual(
        events.map(e => e.type),
        ['run-start', 'stt-end', 'run-end'],
    );
    assert.deepEqual(events[1].data, { stt_output: { text: 'Licht an' } });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].command, 'stt');
    assert.equal(sent[0].message.format, 'wav');
    // the recording up to the end of the sentence, not the chunks after it
    const wav = Uint8Array.from(atob(sent[0].message.audio as string), c => c.charCodeAt(0));
    assert.equal(new DataView(wav.buffer).getUint32(40, true), 19 * 1600 * 2);
    await stop();
});

test('Assistant: a run ended by the 3D view without speech asks nothing', async () => {
    const { io, sent } = fakeIo([{ id: 'assistant.0', enabled: true }], () => ({ text: 'x' }));
    const assistant = new Assistant(io, () => 'de', () => null);
    const events: RunEvent[] = [];
    assistant.run(e => events.push(e), { type: 'assist_pipeline/run', start_stage: 'stt', end_stage: 'stt' });
    await flush();
    assistant.send(Uint8Array.from([1]));
    await flush();
    assert.deepEqual(events[1], { type: 'stt-end', data: { stt_output: { text: '' } } });
    assert.equal(sent.length, 0);
});

test('Assistant: without an instance the run reports no pipeline', async () => {
    const { io } = fakeIo([], () => null);
    const events: RunEvent[] = [];
    new Assistant(io, () => 'de', () => null).run(e => events.push(e), {
        type: 'assist_pipeline/run',
        start_stage: 'stt',
    });
    await flush();
    assert.equal(events[0].type, 'error');
    assert.equal((events[0].data as { code: string }).code, 'no_pipeline');
});

test('Assistant: a sentence goes to ask, with the room of the device', async () => {
    const { io, sent } = fakeIo([{ id: 'assistant.0', enabled: true }], () => ({ answer: 'Erledigt' }));
    const assistant = new Assistant(io, () => 'de', id => (id === 'enum.rooms.salon' ? 'Salon' : null));
    const res = await assistant.converse({ text: 'Licht an', area_id: 'enum.rooms.salon' });
    assert.equal(res.response.speech.plain.speech, 'Erledigt');
    assert.equal(sent[0].command, 'ask');
    assert.equal(sent[0].message.source, 'home3d');
    assert.match(String(sent[0].message.text), /^Licht an .*Salon$/);
    await assistant.converse({ text: 'Wie warm ist es?' });
    assert.equal(sent[1].message.text, 'Wie warm ist es?');
});

test('Assistant: an error of ask is thrown, so the 3D view shows it', async () => {
    const { io } = fakeIo([{ id: 'assistant.0', enabled: true }], () => ({ error: 'agent not ready' }));
    await assert.rejects(new Assistant(io, () => 'de', () => null).converse({ text: 'Licht an' }), /agent not ready/);
});
