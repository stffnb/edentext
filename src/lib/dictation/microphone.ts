// The microphone as raw samples for an engine that recognizes on its own: getUserMedia
// into an AudioWorklet that posts the first channel to the page in blocks of about 40 ms.
// The worklet is a file of the app, never inlined: script-src does not allow data: URLs.

export type Microphone = { rate: number; stop(): void };

export async function listen(onSamples: (samples: Float32Array) => void): Promise<Microphone> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const stop = () => {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  };
  try {
    await ctx.audioWorklet.addModule(new URL('./capture.worklet.js?no-inline', import.meta.url));
    const node = new AudioWorkletNode(ctx, 'dictation-capture', { numberOfOutputs: 0 });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
    ctx.createMediaStreamSource(stream).connect(node);
    await ctx.resume();
  } catch (e) {
    stop();
    throw e;
  }
  return { rate: ctx.sampleRate, stop };
}
