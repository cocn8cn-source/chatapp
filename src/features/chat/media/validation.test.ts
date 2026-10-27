import { downsampleWaveform, formatDuration, kindOf, safeFileName, validateFile } from './validation';

describe('media validation', () => {
  it('accepts allowed files and rejects others', () => {
    expect(validateFile({ name: 'a.png', type: 'image/png', size: 1000 })).toBeNull();
    expect(validateFile({ name: 'x.exe', type: 'application/x-msdownload', size: 1000 })).toMatch(/not allowed/);
    expect(validateFile({ name: 'big.mp4', type: 'video/mp4', size: 26 * 1024 * 1024 })).toMatch(/25 MB/);
    expect(validateFile({ name: 'e.pdf', type: 'application/pdf', size: 0 })).toMatch(/empty/);
  });
  it('ignores codec parameters on audio types', () => {
    expect(validateFile({ name: 'v.webm', type: 'audio/webm;codecs=opus', size: 5000 })).toBeNull();
  });
  it('classifies kinds', () => {
    expect(kindOf('image/gif')).toBe('image');
    expect(kindOf('audio/webm')).toBe('audio');
    expect(kindOf('application/pdf')).toBe('file');
  });
  it('sanitizes file names', () => {
    expect(safeFileName('../my photo (1).png')).toBe('..my-photo-1.png');
    expect(safeFileName('???')).toBe('file');
  });
  it('formats durations and builds waveforms', () => {
    expect(formatDuration(65000)).toBe('1:05');
    const w = downsampleWaveform([0, 0.5, 1, 0.2], 4);
    expect(w).toHaveLength(4);
    expect(Math.max(...w)).toBeLessThanOrEqual(100);
    expect(downsampleWaveform([], 8)).toEqual(Array(8).fill(4));
  });
});
