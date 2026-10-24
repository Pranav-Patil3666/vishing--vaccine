import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeCallerWav } from "./wav.js";

export interface CallerAudioCache { get(key: string): Promise<Uint8Array | undefined>; set(key: string, bytes: Uint8Array): Promise<void>; }
/** Only the approved caller service writes here. Bounded, replaceable, no learner data or provider auth. */
export class FileCallerAudioCache implements CallerAudioCache {
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly directory: string, private readonly maxBytes = 32 * 1024 * 1024, private readonly maxEntries = 32) {}
  private path(key: string): string {
    if (!/^tts-[a-f0-9]{64}$/u.test(key)) throw new Error("Invalid caller cache identity.");
    return join(this.directory, `${key}.json`);
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    const path = this.path(key);
    try {
      if ((await stat(path)).size > 12 * 1024 * 1024) throw new Error("Oversized cache entry.");
      const entry = JSON.parse(await readFile(path, "utf8")) as { key: string; mediaType: string; sha256: string; audio: string };
      const bytes = Buffer.from(entry.audio, "base64");
      if (entry.key !== key || entry.mediaType !== "audio/wav" || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Corrupt caller cache entry.");
      return finalizeCallerWav(bytes);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") await rm(path, { force: true });
      return undefined; // One miss may make one explicitly gated request; never a regeneration loop.
    }
  }
  set(key: string, input: Uint8Array): Promise<void> {
    const work = this.writes.then(() => this.persist(key, input));
    this.writes = work.catch(() => {}); return work;
  }
  private async persist(key: string, input: Uint8Array): Promise<void> {
    const bytes = finalizeCallerWav(input), path = this.path(key);
    await mkdir(this.directory, { recursive: true });
    const payload = JSON.stringify({ key, mediaType: "audio/wav", byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"), audio: Buffer.from(bytes).toString("base64") });
    const entries = await Promise.all((await readdir(this.directory)).filter((name) => /^tts-[a-f0-9]{64}\.json$/u.test(name))
      .map(async (name) => ({ name, info: await stat(join(this.directory, name)) })));
    entries.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);
    let used = entries.reduce((sum, entry) => sum + entry.info.size, 0), count = entries.length;
    for (const entry of entries) {
      if (used + payload.length <= this.maxBytes && count < this.maxEntries) break;
      await rm(join(this.directory, entry.name), { force: true }); used -= entry.info.size; count--;
    }
    if (payload.length > this.maxBytes) throw new Error("Caller cache capacity exceeded.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, payload); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
  }
}
