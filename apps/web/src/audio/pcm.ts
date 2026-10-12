export const TARGET_RATE = 16_000;
export const FRAME_SAMPLES = 512;

export function mono(channels: readonly Float32Array[]): Float32Array {
  const size = channels[0]?.length ?? 0;
  if (!channels.length || channels.some((channel) => channel.length !== size)) throw new Error("Invalid audio channels.");
  const result = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    let sum = 0;
    for (const channel of channels) sum += Number.isFinite(channel[i]) ? channel[i]! : 0;
    result[i] = sum / channels.length;
  }
  return result;
}

export function rms(samples: Float32Array): number {
  let energy = 0;
  for (const sample of samples) energy += Number.isFinite(sample) ? sample * sample : 0;
  return samples.length ? Math.sqrt(energy / samples.length) : 0;
}

export function pcm16le(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((value, index) => {
    const sample = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    view.setInt16(index * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  });
  return bytes;
}

/** Streaming area-average resampler. Absolute source/sample counters avoid per-chunk rounding drift.
 * The box filter is deliberately small; it is not a high-fidelity or telephony DSP claim. */
export class StreamingResampler {
  private inputCount = 0;
  private outputCount = 0;
  private area = 0;
  private weight = 0;
  private readonly ratio: number;
  constructor(readonly sourceRate: number, readonly targetRate = TARGET_RATE) {
    if (!Number.isFinite(sourceRate) || sourceRate < 8000 || sourceRate > 192000 || targetRate !== TARGET_RATE) throw new Error("Unsupported sample rate.");
    this.ratio = sourceRate / targetRate;
  }
  push(samples: Float32Array): Float32Array {
    const output: number[] = [];
    for (const input of samples) {
      let position = this.inputCount;
      const end = ++this.inputCount;
      const sample = Number.isFinite(input) ? input : 0;
      while (position < end - 1e-9) {
        const boundary = (this.outputCount + 1) * this.ratio;
        const next = Math.min(end, boundary);
        const span = next - position;
        this.area += sample * span; this.weight += span; position = next;
        if (next >= boundary - 1e-9) {
          output.push(this.area / this.ratio);
          this.outputCount++; this.area = 0; this.weight = 0;
        }
      }
    }
    return Float32Array.from(output);
  }
  /** Preserve the final fraction as one sample padded with silence; at most one target sample. */
  finish(): Float32Array {
    const tail = this.weight > 1e-9 ? Float32Array.of(this.area / this.ratio) : new Float32Array(0);
    this.clear(); return tail;
  }
  clear(): void { this.area = 0; this.weight = 0; this.inputCount = 0; this.outputCount = 0; }
}

export class PcmFrameAssembler {
  private pending = new Float32Array(FRAME_SAMPLES);
  private count = 0;
  constructor(private readonly emit: (bytes: Uint8Array, paddedSamples: number) => void) {}
  push(samples: Float32Array): void {
    let offset = 0;
    while (offset < samples.length) {
      const size = Math.min(FRAME_SAMPLES - this.count, samples.length - offset);
      this.pending.set(samples.subarray(offset, offset + size), this.count);
      offset += size; this.count += size;
      if (this.count === FRAME_SAMPLES) { this.emit(pcm16le(this.pending), 0); this.pending.fill(0); this.count = 0; }
    }
  }
  finish(): void {
    if (this.count) this.emit(pcm16le(this.pending), FRAME_SAMPLES - this.count);
    this.clear();
  }
  clear(): void { this.pending.fill(0); this.count = 0; }
  get remainderSamples(): number { return this.count; }
}
