const MULAW_FRAME_BYTES = 160; // 20ms at 8kHz μ-law

function chunkMulaw(buffer, frameBytes = MULAW_FRAME_BYTES) {
  const chunks = [];
  for (let i = 0; i < buffer.length; i += frameBytes) {
    chunks.push(buffer.subarray(i, i + frameBytes));
  }
  return chunks;
}

module.exports = { MULAW_FRAME_BYTES, chunkMulaw };
