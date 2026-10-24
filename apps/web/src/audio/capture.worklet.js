/* global AudioWorkletProcessor, registerProcessor, sampleRate */
// Served as a standalone JS asset by Vite. No provider, clock, storage or React dependency.
class LocalCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.block = new Float32Array(Math.round(sampleRate * 0.02));
    this.count = 0;
    this.credits = 8;
    this.live = true;
    this.diagnosticPending = options?.processorOptions?.diagnostics === true;
    this.port.onmessage = ({ data }) => {
      if (data === "ack") this.credits = Math.min(8, this.credits + 1);
      if (data === "stop") { this.live = false; this.block.fill(0); }
      if ((data === "flush" || data === "flush-turn") && this.live) {
        // A standalone capture ends here; a reusable session only drains/resets this turn.
        if (data === "flush") this.live = false;
        const samples = this.block.slice(0, this.count);
        this.block.fill(0); this.count = 0;
        this.port.postMessage({ samples, flushed: true }, [samples.buffer]);
      }
    };
  }
  process(inputs) {
    if (!this.live) return false;
    if (this.diagnosticPending) { this.diagnosticPending = false; this.port.postMessage({ type: "PROCESSOR_ACTIVE" }); }
    const channels = inputs[0];
    if (!channels?.length) return true;
    for (let i = 0; i < channels[0].length; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i] || 0;
      this.block[this.count++] = sum / channels.length;
      if (this.count === this.block.length) {
        if (this.credits === 0) {
          this.port.postMessage({ error: "BACKPRESSURE" }); this.live = false; this.block.fill(0); return false;
        }
        this.credits--;
        this.port.postMessage({ samples: this.block }, [this.block.buffer]);
        this.block = new Float32Array(Math.round(sampleRate * 0.02)); this.count = 0;
      }
    }
    return true;
  }
}
registerProcessor("local-audio-capture", LocalCaptureProcessor);
