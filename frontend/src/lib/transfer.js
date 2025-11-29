const textEncoder = new TextEncoder();

const bufferToHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const sha256Hex = async (bufferSource) => {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bufferSource);
  return bufferToHex(hashBuffer);
};

const computeManifestSignature = async (manifest) => {
  const chunkHashes = manifest.chunks.map((chunk) => chunk.hash).join('|');
  const payload = `${manifest.file_id}:${manifest.total_size}:${manifest.chunks.length}:${chunkHashes}`;
  const payloadBytes = textEncoder.encode(payload);
  return sha256Hex(payloadBytes);
};

const base64ToUint8Array = (base64String) => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
};

export const createTransferManager = (onComplete) => {
  const sessions = new Map();

  const handleManifest = async (data) => {
    if (!crypto?.subtle) {
      throw new Error('Web Crypto API is required for secure transfers.');
    }
    if (!data.manifest || !data.manifest_signature) {
      throw new Error('Manifest payload missing required fields.');
    }
    const signature = await computeManifestSignature(data.manifest);
    if (signature !== data.manifest_signature) {
      throw new Error('Manifest signature mismatch.');
    }

    sessions.set(data.file_id, {
      manifest: data.manifest,
      filename: data.filename,
      mimeType: data.mime_type,
      chunkBuffers: new Array(data.manifest.chunks.length),
      receivedChunks: 0,
    });
  };

  const handleChunk = async (data) => {
    const transfer = sessions.get(data.file_id);
    if (!transfer) {
      throw new Error('Received chunk before manifest negotiation.');
    }
    const expected = transfer.manifest.chunks[data.chunk_index];
    if (!expected) {
      throw new Error(`Unexpected chunk index ${data.chunk_index}`);
    }
    const chunkBytes = base64ToUint8Array(data.content);
    const digest = await sha256Hex(chunkBytes);
    if (digest !== expected.hash) {
      sessions.delete(data.file_id);
      throw new Error(`Hash mismatch for chunk ${data.chunk_index}`);
    }
    transfer.chunkBuffers[data.chunk_index] = chunkBytes;
    transfer.receivedChunks += 1;
  };

  const finalize = (fileId) => {
    const transfer = sessions.get(fileId);
    if (!transfer) {
      throw new Error('Transfer complete for unknown file.');
    }
    if (transfer.receivedChunks !== transfer.manifest.chunks.length) {
      sessions.delete(fileId);
      throw new Error('Transfer incomplete; missing chunks detected.');
    }
    const blob = new Blob(transfer.chunkBuffers, { type: transfer.mimeType });
    onComplete(fileId, blob, transfer.filename || `file-${fileId}`);
    sessions.delete(fileId);
  };

  return { handleManifest, handleChunk, finalize };
};

