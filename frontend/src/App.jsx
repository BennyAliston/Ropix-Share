import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createTransferManager } from './lib/transfer.js';

const API_BASE = '';
const deviceInfo = {
  name: navigator.userAgent,
  platform: navigator.platform
};

const initialPreviewState = {
  open: false,
  loading: false,
  mode: 'text',
  content: '',
  metadata: null,
  error: null,
  blobUrl: null
};

function App() {
  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [toast, setToast] = useState(null);

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const socketRef = useRef(null);
  const transferManagerRef = useRef(
    createTransferManager((fileId, blob, filename) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.info(`Verified download completed for ${fileId}`);
    })
  );

  const fetchFiles = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/files`);
    if (!response.ok) {
      throw new Error('Unable to load files');
    }
    const data = await response.json();
    setFiles(data.files || []);
  }, []);

  useEffect(() => {
    fetchFiles().catch((err) => console.error(err));
  }, [fetchFiles]);

  const addToast = useCallback((message, variant = 'info') => {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 3500);
  }, []);

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('file_available', (fileData) => {
      setFiles((prev) => {
        const without = prev.filter((item) => item.file_id !== fileData.file_id);
        return [{ ...fileData }, ...without];
      });
    });

    socket.on('file_deleted', ({ file_id }) => {
      setFiles((prev) => prev.filter((file) => file.file_id !== file_id));
    });

    socket.on('file_manifest', (data) => {
      transferManagerRef.current
        .handleManifest(data)
        .catch((error) => addToast(error.message, 'error'));
    });

    socket.on('file_chunk', (data) => {
      transferManagerRef.current
        .handleChunk(data)
        .catch((error) => addToast(error.message, 'error'));
    });

    socket.on('file_transfer_complete', ({ file_id }) => {
      try {
        transferManagerRef.current.finalize(file_id);
      } catch (error) {
        addToast(error.message, 'error');
      }
    });

    socket.on('file_error', ({ error }) => addToast(error, 'error'));

    return () => {
      socket.disconnect();
    };
  }, [addToast]);

  // Apply terminal-mode class on mount
  useEffect(() => {
    const root = document.querySelector('.app-shell') || document.body;
    root.classList.add('terminal-mode');
  }, []);

  const handleFilesUpload = useCallback(
    async (fileList) => {
      if (!fileList || !fileList.length) return;
      setUploadStatus(`Uploading ${fileList.length} file(s)…`);
      for (const file of fileList) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('device_info', deviceInfo.name);
        formData.append('path', file.webkitRelativePath || file.name);
        try {
          const response = await fetch(`${API_BASE}/upload`, {
            method: 'POST',
            body: formData
          });
          const payload = await response.json();
          if (!response.ok || !payload.success) {
            throw new Error(payload.error || 'Upload failed');
          }
        } catch (error) {
          addToast(error.message, 'error');
        }
      }
      setUploadStatus('');
      addToast('Upload complete', 'success');
    },
    [addToast]
  );

  const handleFileInput = useCallback(
    (event) => {
      handleFilesUpload(event.target.files);
      event.target.value = '';
    },
    [handleFilesUpload]
  );

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      setIsDragging(false);
      if (event.dataTransfer?.files?.length) {
        handleFilesUpload(event.dataTransfer.files);
      }
    },
    [handleFilesUpload]
  );

  const requestPreview = useCallback(async (file) => {
    setPreviewState((prev) => ({
      ...prev,
      open: true,
      loading: true,
      error: null,
      content: '',
      blobUrl: prev.blobUrl ? (URL.revokeObjectURL(prev.blobUrl), null) : null,
      metadata: { name: file.filename, type: file.file_type }
    }));

    try {
      if (file.file_type === 'text' || file.file_type === 'code') {
        const response = await fetch(`${API_BASE}/preview/${file.file_id}`);
        if (!response.ok) throw new Error('Preview failed');
        const data = await response.json();
        setPreviewState((prev) => ({
          ...prev,
          loading: false,
          mode: 'text',
          content: data.content,
          metadata: {
            ...data.info,
            safe_path: file.safe_path
          }
        }));
      } else {
        const response = await fetch(`${API_BASE}/preview/${file.file_id}`);
        if (!response.ok) throw new Error('Preview failed');
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        setPreviewState((prev) => ({
          ...prev,
          loading: false,
          mode: 'binary',
          blobUrl,
          metadata: {
            name: file.filename,
            type: file.file_type,
            mime_type: file.mime_type,
            size: file.size
          }
        }));
      }
    } catch (error) {
      setPreviewState((prev) => ({
        ...prev,
        loading: false,
        error: error.message
      }));
    }
  }, []);

  const closePreview = useCallback(() => {
    setPreviewState((prev) => {
      if (prev.blobUrl) {
        URL.revokeObjectURL(prev.blobUrl);
      }
      return initialPreviewState;
    });
  }, []);

  const deleteFile = useCallback(
    async (file) => {
      if (!window.confirm(`Delete ${file.filename}?`)) {
        return;
      }
      const formData = new FormData();
      formData.append('device_info', deviceInfo.name);
      const response = await fetch(`${API_BASE}/delete/${file.file_id}`, {
        method: 'POST',
        body: formData
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        addToast(payload.error || 'Delete failed', 'error');
      } else {
        addToast('File deleted', 'success');
      }
    },
    [addToast]
  );

  const downloadFile = useCallback((file) => {
    window.open(`${API_BASE}/download/${file.file_id}`, '_blank');
  }, []);

  const dragListeners = useMemo(
    () => ({
      onDragOver: (event) => {
        event.preventDefault();
        setIsDragging(true);
      },
      onDragLeave: () => setIsDragging(false),
      onDrop: handleDrop
    }),
    [handleDrop]
  );

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <h1>FileShare</h1>
          <p className="tagline">Neubrutal peer-to-peer vibes ✨</p>
        </div>
        <div className="status-badge success">
          <span role="img" aria-label="online">
            🛰
          </span>
          Live sync enabled
        </div>
      </header>

      <section className="card">
        <div
          className={`drop-zone ${isDragging ? 'dragover' : ''}`}
          {...dragListeners}
        >
          <p className="text-lg">
            Drag files anywhere or blast them in via buttons below.
          </p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
              Select files
            </button>
            <button className="btn secondary" onClick={() => folderInputRef.current?.click()}>
              Select folder
            </button>
            {uploadStatus && (
              <span className="uploading">
                <span className="dot" />
                {uploadStatus}
              </span>
            )}
          </div>
          <input ref={fileInputRef} type="file" multiple hidden onChange={handleFileInput} />
          <input
            ref={folderInputRef}
            type="file"
            webkitdirectory="true"
            directory="true"
            multiple
            hidden
            onChange={handleFileInput}
          />
        </div>
      </section>

      <section className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ margin: 0 }}>Shared Files</h2>
          <span className="pill">{files.length} available</span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="files-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Device</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.file_id}>
                  <td>
                    <strong>{file.filename}</strong>
                    <div style={{ fontSize: '0.85rem', color: '#475569' }}>{file.safe_path || '—'}</div>
                  </td>
                  <td>
                    <span className="file-chip">{file.file_type}</span>
                  </td>
                  <td>{file.size}</td>
                  <td>{file.device_info || 'Unknown device'}</td>
                  <td>
                    <div className="actions">
                      <button className="btn primary" onClick={() => requestPreview(file)}>
                        Preview
                      </button>
                      <button className="btn secondary" onClick={() => downloadFile(file)}>
                        Download
                      </button>
                      <button className="btn error" onClick={() => deleteFile(file)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!files.length && (
                <tr>
                  <td colSpan="5" style={{ textAlign: 'center', padding: '2rem' }}>
                    No files shared yet. Drop something rad!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {previewState.open && (
        <div className="neubrutal-modal" onClick={closePreview}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{previewState.metadata?.name || 'Preview'}</h3>
                <p style={{ margin: 0, color: '#475569' }}>{previewState.metadata?.mime_type}</p>
              </div>
              <button className="btn" onClick={closePreview}>
                Close
              </button>
            </header>

            {previewState.loading && <p>Loading preview…</p>}
            {previewState.error && <p className="status-badge danger">{previewState.error}</p>}

            {!previewState.loading && !previewState.error && (
              <div className="preview-pane">
                {previewState.mode === 'text' ? (
                  <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{previewState.content}</pre>
                ) : (
                  <div style={{ textAlign: 'center' }}>
                    <p>Preview not available. Download to inspect the file.</p>
                    {previewState.blobUrl && (
                      <button
                        className="btn primary"
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = previewState.blobUrl;
                          a.download = previewState.metadata?.name || 'file';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                      >
                        Download preview binary
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {previewState.metadata && (
              <div style={{ marginTop: '1.5rem' }} className="info-grid">
                {Object.entries(previewState.metadata).map(([key, value]) => (
                  <div key={key} className="info-card">
                    <strong style={{ textTransform: 'capitalize', fontSize: '0.75rem', letterSpacing: '0.08em' }}>
                      {key.replace('_', ' ')}
                    </strong>
                    <div>{value}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            background: toast.variant === 'error' ? '#fecaca' : '#bbf7d0',
            border: '3px solid #0f172a',
            borderRadius: '18px',
            padding: '0.85rem 1.25rem',
            boxShadow: '4px 4px 0 #0f172a'
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;

