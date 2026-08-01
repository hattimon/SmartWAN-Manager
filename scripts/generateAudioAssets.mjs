import fs from 'node:fs';
import path from 'node:path';

const sampleRate = 16000;

function wavBuffer(durationSeconds, sampleAt) {
  const samples = Math.floor(sampleRate * durationSeconds);
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const time = index / sampleRate;
    const value = Math.max(-1, Math.min(1, sampleAt(time, index, samples)));
    data.writeInt16LE(Math.round(value * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const outputDir = path.resolve('public', 'audio');
fs.mkdirSync(outputDir, { recursive: true });

const ambient = wavBuffer(12, (time) => {
  const slow = Math.sin(2 * Math.PI * 46 * time) * 0.16;
  const pulse = Math.sin(2 * Math.PI * 92 * time + Math.sin(time * 0.7)) * 0.045;
  const shimmer = Math.sin(2 * Math.PI * (184 + Math.sin(time * 0.4) * 8) * time) * 0.018;
  const breathe = 0.38 + 0.28 * Math.sin(2 * Math.PI * 0.08 * time);
  return (slow + pulse + shimmer) * breathe;
});

const select = wavBuffer(0.22, (time, _index, samples) => {
  const envelope = Math.sin(Math.PI * Math.min(1, time / (samples / sampleRate))) ** 2;
  const tone = Math.sin(2 * Math.PI * 440 * time) * 0.32 + Math.sin(2 * Math.PI * 660 * time) * 0.16;
  return tone * envelope;
});

fs.writeFileSync(path.join(outputDir, 'network-ambient.wav'), ambient);
fs.writeFileSync(path.join(outputDir, 'network-select.wav'), select);
