export const DEFAULT_VAD_CONFIG = {
  calibrationMs: 750, activationMs: 80, minimumSpeechMs: 120, hangoverMs: 300,
  minOn: 0.012, maxOn: 0.25, noiseMultiplier: 3, offRatio: 0.6,
};
export type VadConfig = typeof DEFAULT_VAD_CONFIG;
export interface VadBoundary { kind: "start" | "end"; monotonicMs: number }

/** Energy VAD: observable audio activity, not semantic speech, speaker identity or emotion. */
export class LocalVad {
  state: "calibrating" | "silence" | "speech" = "calibrating";
  noiseFloor = 0;
  speechOn = DEFAULT_VAD_CONFIG.minOn;
  speechOff = DEFAULT_VAD_CONFIG.minOn * DEFAULT_VAD_CONFIG.offRatio;
  private calibration: Array<{ level: number; duration: number }> = [];
  private calibrationDuration = 0;
  private candidateMs = 0;
  private candidateStartedAt: number | undefined;
  private lastActiveAt: number | undefined;
  private activeMs = 0;
  private silentMs = 0;
  private lastTime = -1;
  constructor(readonly config: VadConfig = DEFAULT_VAD_CONFIG) {
    if (Object.values(config).some((value) => !Number.isFinite(value) || value <= 0)
      || config.offRatio >= 1 || config.activationMs > config.minimumSpeechMs || config.minOn > config.maxOn) throw new Error("Invalid VAD configuration.");
  }
  process(level: number, durationMs: number, monotonicMs: number): VadBoundary[] {
    if (!Number.isFinite(level) || level < 0 || !Number.isFinite(durationMs) || durationMs <= 0
      || !Number.isFinite(monotonicMs) || monotonicMs < this.lastTime) throw new Error("Invalid VAD input.");
    this.lastTime = monotonicMs;
    if (this.state === "calibrating") {
      this.calibration.push({ level, duration: durationMs }); this.calibrationDuration += durationMs;
      if (this.calibrationDuration >= this.config.calibrationMs) {
        // Lower quartile reduces contamination by a brief impulse or someone speaking during setup.
        const ordered = this.calibration.sort((a, b) => a.level - b.level);
        let weight = 0;
        for (const item of ordered) { weight += item.duration; if (weight >= this.calibrationDuration / 4) { this.noiseFloor = item.level; break; } }
        this.calibration = []; this.updateThresholds(); this.state = "silence";
      }
      return [];
    }
    if (this.state === "silence") {
      if (level >= this.speechOn) {
        this.candidateStartedAt ??= Math.max(0, monotonicMs - durationMs);
        this.candidateMs += durationMs;
      }
      else {
        this.candidateMs = 0; this.candidateStartedAt = undefined;
        // Slow adaptation only below the speech-off threshold; no voice profile is retained.
        if (level < this.speechOff) { this.noiseFloor += (level - this.noiseFloor) * Math.min(0.02, durationMs / 10_000); this.updateThresholds(); }
      }
      if (this.candidateMs >= Math.max(this.config.activationMs, this.config.minimumSpeechMs)) {
        const startedAt = this.candidateStartedAt!;
        this.state = "speech"; this.activeMs = this.candidateMs; this.candidateMs = 0; this.silentMs = 0;
        this.candidateStartedAt = undefined; this.lastActiveAt = monotonicMs;
        // Confirm later, but estimate the boundary at the first candidate block's start.
        return [{ kind: "start", monotonicMs: startedAt }];
      }
      return [];
    }
    this.activeMs += durationMs;
    if (level < this.speechOff) this.silentMs += durationMs;
    else { this.silentMs = 0; this.lastActiveAt = monotonicMs; }
    if (this.silentMs >= this.config.hangoverMs && this.activeMs >= this.config.minimumSpeechMs) {
      const endedAt = this.lastActiveAt!;
      this.state = "silence"; this.silentMs = 0; this.activeMs = 0;
      this.lastActiveAt = undefined;
      return [{ kind: "end", monotonicMs: endedAt }];
    }
    return [];
  }
  private updateThresholds(): void {
    this.speechOn = Math.max(this.config.minOn, Math.min(this.config.maxOn, this.noiseFloor * this.config.noiseMultiplier));
    this.speechOff = this.speechOn * this.config.offRatio;
  }
  clear(): void { this.calibration = []; this.candidateMs = 0; this.activeMs = 0; this.silentMs = 0; this.candidateStartedAt = undefined; this.lastActiveAt = undefined; }
}
