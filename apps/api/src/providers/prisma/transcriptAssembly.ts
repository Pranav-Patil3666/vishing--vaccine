import { TranscriptSegmentSchema, type TranscriptSegment } from "@vaccine/contracts";
import { ApplicationError } from "../../errors.js";

export function normalizeSegmentText(text: string): string { return text.replace(/\s+/gu, " ").trim(); }

/** Segments are emissions, not verified partials/finals/revisions. Conflicting identities fail closed. */
export class TranscriptAssembler {
  private readonly received: TranscriptSegment[] = [];
  add(input: TranscriptSegment): void {
    const segment = TranscriptSegmentSchema.parse(input);
    segment.text = normalizeSegmentText(segment.text);
    if (!segment.text) return;
    const prior = this.received.find((item) => (segment.segmentId !== undefined && item.segmentId === segment.segmentId)
      || (segment.segmentIndex !== undefined && item.segmentIndex === segment.segmentIndex)
      || (segment.segmentId === undefined && segment.segmentIndex === undefined && item.segmentId === undefined
        && item.segmentIndex === undefined && item.text === segment.text && item.providerTimestamp === segment.providerTimestamp));
    if (prior) {
      if (prior.text !== segment.text || (prior.segmentIndex !== undefined && segment.segmentIndex !== undefined && prior.segmentIndex !== segment.segmentIndex)) {
        throw new ApplicationError("STT_PROTOCOL_ERROR", "Conflicting transcript segments; the turn was not advanced.");
      }
      return;
    }
    if (this.received.length >= 64 || this.received.reduce((n, item) => n + item.text.length, segment.text.length) > 8192) {
      throw new ApplicationError("STT_PROTOCOL_ERROR", "Transcript limit exceeded; the turn was not advanced.");
    }
    this.received.push(segment);
  }
  result(): { text: string; segments: TranscriptSegment[] } {
    // Preserve the relative order of known indexes; metadata-free emissions retain their arrival slots.
    const indexed = this.received.filter((item) => item.segmentIndex !== undefined).sort((a, b) => a.segmentIndex! - b.segmentIndex!);
    let index = 0;
    const segments = this.received.map((item) => ({ ...(item.segmentIndex === undefined ? item : indexed[index++]!) }));
    return { text: segments.map((item) => item.text).join(" "), segments };
  }
  clear(): void { this.received.length = 0; }
}
