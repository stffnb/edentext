// Runs on the audio thread (microphone.ts): hands the input's first channel to the page
// in blocks of 2048 samples, about 40 ms at 48 kHz.
const BLOCK = 2048;

class Capture extends AudioWorkletProcessor {
  block = new Float32Array(BLOCK);
  filled = 0;

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const v of channel) {
      this.block[this.filled++] = v;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('dictation-capture', Capture);
