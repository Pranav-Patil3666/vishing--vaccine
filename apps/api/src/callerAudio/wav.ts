/** Bounded PCM WAV inspection, also used to reject corrupt cached/provider audio. */
export function inspectCallerWav(bytes: Uint8Array): { durationMs: number; sampleRateHz: number; channels: number; byteLength: number } {
  if (bytes.length < 44 || bytes.length > 8 * 1024 * 1024) throw new Error("Invalid caller audio size.");
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WAVE"
    || (data.readUInt32LE(4) !== 0xffffffff && data.readUInt32LE(4) + 8 !== bytes.length)) throw new Error("Invalid WAV container.");
  let sampleRateHz = 0, channels = 0, blockAlign = 0, audioBytes = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const kind = data.toString("ascii", offset, offset + 4), declared = data.readUInt32LE(offset + 4), start = offset + 8;
    // Participant REST observation: final data chunk and RIFF use streaming unknown-size sentinels.
    const size = kind === "data" && declared === 0xffffffff ? data.length - start : declared;
    if (start + size > data.length) throw new Error("Truncated WAV chunk.");
    if (kind === "fmt ") {
      if (size < 16 || data.readUInt16LE(start) !== 1 || data.readUInt16LE(start + 14) !== 16) throw new Error("Unsupported WAV encoding.");
      channels = data.readUInt16LE(start + 2); sampleRateHz = data.readUInt32LE(start + 4); blockAlign = data.readUInt16LE(start + 12);
      if (channels !== 1 || sampleRateHz !== 48000 || blockAlign !== 2 || data.readUInt32LE(start + 8) !== 96000) throw new Error("Unexpected caller WAV format.");
    }
    if (kind === "data") audioBytes += size;
    offset = start + size + (size % 2);
  }
  if (!audioBytes || !sampleRateHz || audioBytes % blockAlign !== 0) throw new Error("Empty or invalid WAV samples.");
  const durationMs = audioBytes / (sampleRateHz * blockAlign) * 1000;
  if (durationMs > 60_000) throw new Error("Caller audio duration exceeds limit.");
  return { durationMs, sampleRateHz, channels, byteLength: bytes.length };
}

/** Finalize only streaming WAV length fields; PCM, text, pitch and sample rate are unchanged. */
export function finalizeCallerWav(bytes: Uint8Array): Uint8Array {
  inspectCallerWav(bytes);
  const copy = Buffer.from(bytes);
  if (copy.readUInt32LE(4) === 0xffffffff) copy.writeUInt32LE(copy.length - 8, 4);
  for (let offset = 12; offset + 8 <= copy.length;) {
    const size = copy.readUInt32LE(offset + 4);
    if (copy.toString("ascii", offset, offset + 4) === "data" && size === 0xffffffff) { copy.writeUInt32LE(copy.length - offset - 8, offset + 4); break; }
    offset += 8 + size + (size % 2);
  }
  return copy;
}
