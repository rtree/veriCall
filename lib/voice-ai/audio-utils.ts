/**
 * Audio conversion utilities for Twilio Media Streams
 * Twilio sends 8kHz μ-law encoded audio
 * Google Speech-to-Text expects 16-bit Linear PCM
 */

// μ-law to Linear16 conversion table
const MULAW_TABLE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  let mu = ~i;
  const sign = mu & 0x80 ? -1 : 1;
  mu &= 0x7f;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + 0x84) << exponent;
  sample -= 0x84;
  MULAW_TABLE[i] = sign * sample;
}

/**
 * Convert μ-law audio to Linear16 PCM
 * @param mulawBuffer - μ-law encoded audio buffer
 * @returns Linear16 PCM buffer
 */
export function mulawToLinear16(mulawBuffer: Buffer): Buffer {
  const linear16 = Buffer.alloc(mulawBuffer.length * 2);
  for (let i = 0; i < mulawBuffer.length; i++) {
    const sample = MULAW_TABLE[mulawBuffer[i]];
    linear16.writeInt16LE(sample, i * 2);
  }
  return linear16;
}

// Linear16 to μ-law conversion
const BIAS = 0x84;
const CLIP = 32635;

/**
 * Convert Linear16 PCM to μ-law
 * @param linear16Buffer - Linear16 PCM buffer
 * @returns μ-law encoded buffer
 */
export function linear16ToMulaw(linear16Buffer: Buffer): Buffer {
  const mulaw = Buffer.alloc(linear16Buffer.length / 2);
  for (let i = 0; i < mulaw.length; i++) {
    let sample = linear16Buffer.readInt16LE(i * 2);
    const sign = sample < 0 ? 0x80 : 0;
    if (sample < 0) sample = -sample;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;

    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);

    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    mulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xff;
  }
  return mulaw;
}

/**
 * Resample audio from one sample rate to another (simple linear interpolation)
 * @param buffer - Input audio buffer (Linear16)
 * @param fromRate - Source sample rate
 * @param toRate - Target sample rate
 * @returns Resampled audio buffer
 */
export function resample(buffer: Buffer, fromRate: number, toRate: number): Buffer {
  if (fromRate === toRate) return buffer;

  const ratio = fromRate / toRate;
  const inputSamples = buffer.length / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const output = Buffer.alloc(outputSamples * 2);

  for (let i = 0; i < outputSamples; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples - 1);
    const frac = srcIndex - srcIndexFloor;

    const sample1 = buffer.readInt16LE(srcIndexFloor * 2);
    const sample2 = buffer.readInt16LE(srcIndexCeil * 2);
    const interpolated = Math.round(sample1 * (1 - frac) + sample2 * frac);

    output.writeInt16LE(interpolated, i * 2);
  }

  return output;
}
