export function float32ToPcm16Base64(float32: Float32Array): string {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const clamped = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function pcm16Base64ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const outBuffer = new ArrayBuffer(sampleCount * 4);
  const float32 = new Float32Array(outBuffer);
  for (let i = 0; i < sampleCount; i++) {
    float32[i] = view.getInt16(i * 2, true) / 32768;
  }
  return float32;
}

export class Pcm24kPlayer {
  private ctx: AudioContext;
  private nextStartTime = 0;
  private activeNodes = new Set<AudioBufferSourceNode>();

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 24000 });
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  enqueue(base64Pcm: string): void {
    const samples = pcm16Base64ToFloat32(base64Pcm);
    if (samples.length === 0) return;

    const audioBuffer = this.ctx.createBuffer(1, samples.length, 24000);
    audioBuffer.copyToChannel(samples, 0);

    const source = this.ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    const startAt = Math.max(now + 0.015, this.nextStartTime);
    source.start(startAt);
    this.nextStartTime = startAt + audioBuffer.duration;

    this.activeNodes.add(source);
    source.onended = () => {
      this.activeNodes.delete(source);
    };
  }

  interrupt(): void {
    for (const node of this.activeNodes) {
      try {
        node.stop();
      } catch {
        // Ignore already stopped nodes
      }
    }
    this.activeNodes.clear();
    this.nextStartTime = this.ctx.currentTime;
  }

  async close(): Promise<void> {
    this.interrupt();
    if (this.ctx.state !== 'closed') {
      await this.ctx.close();
    }
  }
}
