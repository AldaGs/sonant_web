// MP4 audio codec for this browser. Safari before 26 (older Macs/iPhones) has no WebCodecs AudioEncoder,
// so neither AAC nor Opus encode natively: load a wasm AAC encoder for them (only then, it's not small).
let codec: Promise<'aac' | 'opus'> | null = null;
export function audioCodec(): Promise<'aac' | 'opus'> {
  return (codec ??= (async () => {
    const { canEncodeAudio } = await import('mediabunny');
    if (await canEncodeAudio('aac')) return 'aac';
    try {
      (await import('@mediabunny/aac-encoder')).registerAacEncoder();
      if (await canEncodeAudio('aac')) return 'aac';
    } catch {}
    return 'opus';
  })());
}
