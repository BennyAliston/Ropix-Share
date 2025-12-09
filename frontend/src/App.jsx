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
  metadataDetails: null, // For extended metadata
  error: null,
  blobUrl: null
};

function App() {
  const prefersDarkMode = () => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('ropix-dark-mode');
    if (stored !== null) {
      return stored === 'true';
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  };

  const [files, setFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [toast, setToast] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => prefersDarkMode());

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

  const formatFileSize = useCallback((value) => {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }, []);

  const normalizeFile = useCallback(
    (file) => {
      if (!file) return file;
      const rawSize =
        typeof file.size === 'number'
          ? file.size
          : Number.isFinite(Number(file.size_bytes))
            ? Number(file.size_bytes)
            : Number(file.size) || 0;
      return {
        ...file,
        size: Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : 0,
        size_display: file.size_display || formatFileSize(rawSize),
        uploaded_at: file.uploaded_at || file.created_at || file.created || null,
        safe_path: file.safe_path || file.filename,
        mime_type: file.mime_type || 'application/octet-stream'
      };
    },
    [formatFileSize]
  );

  const supportedDocumentExtensions = useMemo(
    () => [
      '.pdf',
      '.doc',
      '.docx',
      '.ppt',
      '.pptx',
      '.xls',
      '.xlsx',
      '.odt',
      '.ods',
      '.odp',
      '.rtf',
      '.txt'
    ],
    []
  );

  const detectPreviewMode = useCallback(
    (file, mimeType = '') => {
      const normalizedMime = (mimeType || file?.mime_type || '').toLowerCase();
      const filename = (file?.filename || file?.safe_path || '').toLowerCase();

      if (normalizedMime.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|svg)$/.test(filename)) {
        return 'image';
      }
      if (normalizedMime.startsWith('video/') || /\.(mp4|webm|ogg|mov|avi|mkv)$/.test(filename)) {
        return 'video';
      }
      if (normalizedMime.startsWith('audio/') || /\.(mp3|wav|flac|m4a|aac|ogg)$/.test(filename)) {
        return 'audio';
      }
      if (normalizedMime === 'application/pdf' || filename.endsWith('.pdf')) {
        return 'pdf';
      }
      if (supportedDocumentExtensions.some((ext) => filename.endsWith(ext))) {
        return 'document';
      }
      if (normalizedMime.startsWith('text/')) {
        return 'text';
      }
      return 'binary';
    },
    [supportedDocumentExtensions]
  );

  const fetchFiles = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/files`);
    if (!response.ok) {
      throw new Error('Unable to load files');
    }
    const data = await response.json();
    setFiles((data.files || []).map(normalizeFile));
  }, [normalizeFile]);

  useEffect(() => {
    fetchFiles().catch((err) => console.error(err));
  }, [fetchFiles]);

  const addToast = useCallback((message, variant = 'info') => {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const [metadataModal, setMetadataModal] = useState({ open: false, loading: false, data: null, error: null });

  const fetchMetadata = useCallback(async (file) => {
    setMetadataModal({ open: true, loading: true, data: null, error: null });
    try {
      const response = await fetch(`${API_BASE}/metadata/${file.file_id}`);
      if (!response.ok) throw new Error('Failed to fetch metadata');
      const data = await response.json();
      setMetadataModal({ open: true, loading: false, data, error: null });
    } catch (err) {
      setMetadataModal({ open: true, loading: false, data: null, error: err.message });
    }
  }, []);

  const closeMetadataModal = () => setMetadataModal({ open: false, loading: false, data: null, error: null });

  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on('file_available', (fileData) => {
      const normalized = normalizeFile(fileData);
      setFiles((prev) => {
        const without = prev.filter((item) => item.file_id !== normalized.file_id);
        return [normalized, ...without];
      });
    });

    socket.on('file_deleted', ({ file_id }) => {
      setFiles((prev) => prev.filter((file) => file.file_id !== file_id));
    });

    socket.on('files_cleared', () => {
      setFiles([]);
      addToast('All files cleared', 'info');
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
  }, [addToast, normalizeFile]);

  // Apply terminal-mode class on mount
  useEffect(() => {
    const root = document.querySelector('.app-shell') || document.body;
    root.classList.add('terminal-mode');
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    const body = document.body;
    const theme = isDarkMode ? 'dark' : 'light';
    root.dataset.theme = theme;
    body.dataset.theme = theme;
    root.classList.toggle('dark-mode', isDarkMode);
    body.classList.toggle('dark-mode', isDarkMode);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('ropix-dark-mode', String(isDarkMode));
    }
  }, [isDarkMode]);

  const toggleTheme = useCallback(() => {
    setIsDarkMode((prev) => !prev);
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

  const requestPreview = useCallback(
    async (file) => {
      setPreviewState((prev) => ({
        ...prev,
        open: true,
        loading: true,
        error: null,
        content: '',
        blobUrl: prev.blobUrl ? (URL.revokeObjectURL(prev.blobUrl), null) : null,
        metadata: {
          name: file.filename,
          type: file.file_type,
          safe_path: file.safe_path,
          file_id: file.file_id
        }
      }));

      try {
        const isTextLike = file.file_type === 'text' || file.file_type === 'code' || file.mime_type?.startsWith('text/');
        if (isTextLike) {
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
              safe_path: file.safe_path,
              file_id: file.file_id
            }
          }));
        } else {
          const response = await fetch(`${API_BASE}/preview/${file.file_id}`);
          if (!response.ok) throw new Error('Preview failed');
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const computedMime = blob.type || file.mime_type || '';
          const mode = detectPreviewMode(file, computedMime);
          setPreviewState((prev) => ({
            ...prev,
            loading: false,
            mode,
            blobUrl,
            metadata: {
              name: file.filename,
              type: file.file_type,
              mime_type: computedMime || file.mime_type,
              size: file.size,
              size_display: file.size_display || formatFileSize(file.size),
              safe_path: file.safe_path,
              file_id: file.file_id
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
    },
    [detectPreviewMode, formatFileSize]
  );

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

  const downloadFile = useCallback(
    (fileOrId) => {
      const fileId = typeof fileOrId === 'string' ? fileOrId : fileOrId?.file_id;
      if (!fileId) {
        addToast('Missing file identifier', 'error');
        return;
      }
      window.open(`${API_BASE}/download/${fileId}`, '_blank');
    },
    [addToast]
  );

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
    <div className="app-shell" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      <header className="hero">
        <div>
          <h1>Ropix Share</h1>
          <p className="tagline">Simple, secure file sharing</p>
        </div>
        <div className="hero-actions">
          <button
            className="btn btn-outline theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
          >
            {isDarkMode ? 'Theme 2' : 'Theme 1'}
          </button>
        </div>
      </header>

      <div className="card-grid">
        <section className="card card-upload">
          <h2>Upload Files</h2>
          <div
            className={`drop-zone ${isDragging ? 'dragover' : ''}`}
            onClick={() => fileInputRef.current?.click()}
          >
            <p>📁 Drop files here or click to select</p>
            <div className="action-row">
              <button
                className="btn btn-primary"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Select Files
              </button>
              <button
                className="btn btn-outline"
                onClick={(e) => {
                  e.stopPropagation();
                  folderInputRef.current?.click();
                }}
              >
                Select Folder
              </button>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInput}
              style={{ display: 'none' }}
              multiple
            />
            <input
              type="file"
              ref={folderInputRef}
              onChange={handleFileInput}
              style={{ display: 'none' }}
              webkitdirectory="true"
              mozdirectory="true"
              directory="true"
            />
          </div>
        </section>

        <section className="card card-files">
          <div className="files-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>Shared Files</h2>
            {files.length > 1 && (
              <div className="bulk-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => window.location.href = `${API_BASE}/api/download-all`}
                >
                  Download All
                </button>
                <button
                  className="btn btn-sm btn-warning"
                  onClick={async () => {
                    if (confirm('Delete all files? This cannot be undone.')) {
                      await fetch(`${API_BASE}/api/delete-all`, { method: 'POST' });
                    }
                  }}
                >
                  Delete All
                </button>
              </div>
            )}
          </div>
          {uploadStatus && <p className="upload-status">{uploadStatus}</p>}
          {files.length === 0 ? (
            <p>No files shared yet. Upload some files to get started.</p>
          ) : (
            <div className="file-list">
              {files.map((file) => (
                <div key={file.file_id} className="file-item">
                  <div className="file-head">
                    <h3 className="file-name">{file.filename}</h3>
                    <span className="file-size">{file.size_display || formatFileSize(file.size)}</span>
                  </div>
                  <p className="file-date">
                    Uploaded:{' '}
                    {file.uploaded_at ? new Date(file.uploaded_at).toLocaleString() : 'Unknown'}
                  </p>
                  <div className="file-actions">
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => downloadFile(file)}
                      disabled={previewState.loading}
                    >
                      Download
                    </button>
                    <button
                      className="btn btn-sm btn-warning"
                      onClick={() => deleteFile(file)}
                      disabled={previewState.loading}
                    >
                      Delete
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => requestPreview(file)}
                      disabled={previewState.loading}
                    >
                      Preview
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => fetchMetadata(file)}
                      title="Check Metadata"
                    >
                      ℹ️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className={`preview-modal ${previewState.open ? 'open' : ''}`}>
        {previewState.open && (
          <div
            className="card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="preview-header">
              <h2>Preview: {previewState.metadata?.name}</h2>
              <button
                className="btn btn-sm btn-outline preview-close"
                onClick={() => setPreviewState(initialPreviewState)}
              >
                Close
              </button>
            </div>

            {previewState.loading ? (
              <div className="preview-empty">
                <p>Loading preview...</p>
              </div>
            ) : previewState.error ? (
              <div className="preview-empty error">
                {previewState.error}
              </div>
            ) : previewState.mode === 'text' ? (
              <div className="preview-text">
                {previewState.content}
              </div>
            ) : previewState.mode === 'image' ? (
              <div className="preview-media image">
                <img
                  src={previewState.blobUrl}
                  alt={previewState.metadata?.name}
                />
              </div>
            ) : previewState.mode === 'video' ? (
              <div className="preview-media video">
                <video
                  src={previewState.blobUrl}
                  controls
                />
              </div>
            ) : previewState.mode === 'audio' ? (
              <div className="preview-media audio">
                <audio
                  src={previewState.blobUrl}
                  controls
                />
              </div>
            ) : previewState.mode === 'pdf' || previewState.mode === 'document' ? (
              <div className="preview-document">
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => window.open(previewState.blobUrl, '_blank')}
                  >
                    ↗ Open in New Tab
                  </button>
                </div>
                <iframe
                  title={`Preview ${previewState.metadata?.name}`}
                  src={previewState.blobUrl}
                />
                <p className="document-hint">
                  If the document does not render, use the button above or download it.
                </p>
              </div>
            ) : previewState.mode === 'binary' ? (
              <div className="preview-empty">
                <p>Preview for this file type is not supported in-browser yet.</p>
                <p>
                  Use the download option to view the file locally.
                </p>
              </div>
            ) : (
              <div className="preview-empty">
                <p>No preview available.</p>
              </div>
            )}

            <div className="preview-info-grid">
              <div>
                <div className="preview-label">File Name</div>
                <div>{previewState.metadata?.name}</div>
              </div>
              <div>
                <div className="preview-label">File Type</div>
                <div>{previewState.metadata?.type || 'Unknown'}</div>
              </div>
              {(previewState.metadata?.size_display || previewState.metadata?.size) && (
                <div>
                  <div className="preview-label">File Size</div>
                  <div>
                    {previewState.metadata?.size_display ||
                      formatFileSize(previewState.metadata?.size)}
                  </div>
                </div>
              )}
            </div>

            <div className="preview-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (previewState.metadata?.file_id) {
                    downloadFile(previewState.metadata.file_id);
                  }
                }}
                disabled={!previewState.metadata?.file_id}
              >
                Download File
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={`preview-modal ${metadataModal.open ? 'open' : ''}`}>
        {metadataModal.open && (
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="preview-header">
              <h2>File Metadata</h2>
              <button className="btn btn-sm btn-outline preview-close" onClick={closeMetadataModal}>Close</button>
            </div>

            {metadataModal.loading ? (
              <div className="preview-empty"><p>Loading metadata...</p></div>
            ) : metadataModal.error ? (
              <div className="preview-empty error">{metadataModal.error}</div>
            ) : metadataModal.data ? (
              <div className="metadata-content">
                <section>
                  <h3>Basic Info</h3>
                  <div className="preview-info-grid">
                    <div><div className="preview-label">Filename</div><div>{metadataModal.data.filename}</div></div>
                    <div><div className="preview-label">Type</div><div>{metadataModal.data.base_info.type}</div></div>
                    <div><div className="preview-label">MIME</div><div>{metadataModal.data.base_info.mime_type}</div></div>
                    <div><div className="preview-label">Size</div><div>{metadataModal.data.base_info.size}</div></div>
                    <div><div className="preview-label">Uploaded</div><div>{new Date(metadataModal.data.base_info.uploaded).toLocaleString()}</div></div>
                  </div>
                </section>

                {metadataModal.data.details && Object.keys(metadataModal.data.details).length > 0 && (
                  <section style={{ marginTop: '1rem' }}>
                    <h3>Extended Details</h3>
                    <div className="metadata-tree">
                      {(() => {
                        const renderValue = (val) => {
                          if (val === null || val === undefined) return <span className="meta-null">n/a</span>;
                          if (typeof val === 'boolean') return <span className="meta-bool">{val ? 'Yes' : 'No'}</span>;
                          if (typeof val === 'string' || typeof val === 'number') return <span>{val}</span>;
                          if (Array.isArray(val)) {
                            return (
                              <ul className="meta-list">
                                {val.map((item, idx) => (
                                  <li key={idx}>{renderValue(item)}</li>
                                ))}
                              </ul>
                            );
                          }
                          if (typeof val === 'object') {
                            return (
                              <div className="meta-object">
                                {Object.entries(val).map(([k, v]) => (
                                  <div key={k} className="meta-row">
                                    <span className="meta-key">{k}:</span>
                                    <span className="meta-val">{renderValue(v)}</span>
                                  </div>
                                ))}
                              </div>
                            );
                          }
                          return String(val);
                        };

                        return Object.entries(metadataModal.data.details).map(([key, value]) => (
                          <div key={key} className="meta-section-item">
                            <h4 className="meta-section-title">{key}</h4>
                            <div className="meta-section-content">{renderValue(value)}</div>
                          </div>
                        ));
                      })()}
                    </div>
                  </section>
                )}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {toast && (
        <div className={`toast ${toast.variant}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;

