import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { createTransferManager } from './lib/transfer.js';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';

const API_BASE = '';

// Parse a cleaner device name from user agent
const getDeviceName = () => {
  const ua = navigator.userAgent;
  if (ua.includes('iPhone')) return 'iPhone';
  if (ua.includes('iPad')) return 'iPad';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('Mac')) return 'Mac';
  if (ua.includes('Windows')) return 'Windows PC';
  if (ua.includes('Linux')) return 'Linux';
  return 'Unknown Device';
};

const deviceInfo = {
  name: getDeviceName(),
  platform: navigator.platform
};

// Fun messages based on file type
const getPlayfulMessage = (file) => {
  const type = file.type || '';
  const name = file.name.toLowerCase();

  // Images
  if (type.startsWith('image/')) {
    const imageMessages = [
      "📸 Ooh, a picture! What kind of memories are you sharing?",
      "🖼️ Nice image! Is this a masterpiece or just a meme?",
      "📷 Photo incoming! Screenshot or actual photography?",
      "🎨 A visual treat! Art or chaos? We're curious!",
    ];
    return imageMessages[Math.floor(Math.random() * imageMessages.length)];
  }

  // Videos
  if (type.startsWith('video/')) {
    const videoMessages = [
      "🎬 A video! Is this Oscar-worthy or fail compilation?",
      "📹 Moving pictures! Memories or memes?",
      "🎥 Video detected! TikTok-worthy content?",
      "🍿 Grab the popcorn! What are we watching?",
    ];
    return videoMessages[Math.floor(Math.random() * videoMessages.length)];
  }

  // Audio
  if (type.startsWith('audio/')) {
    const audioMessages = [
      "🎵 Music to our ears! What's the vibe?",
      "🎧 Audio file! Banger or podcast?",
      "🎤 Sounds interesting! Voice memo or sick beats?",
    ];
    return audioMessages[Math.floor(Math.random() * audioMessages.length)];
  }

  // PDFs and documents
  if (type === 'application/pdf' || name.endsWith('.pdf')) {
    return "📄 A PDF! Work stuff or something fun?";
  }

  // Archives
  if (type.includes('zip') || type.includes('rar') || name.match(/\.(zip|rar|7z|tar|gz)$/)) {
    return "📦 An archive! What secrets are compressed in there?";
  }

  // Code files
  if (name.match(/\.(js|py|java|cpp|html|css|ts|jsx|tsx|go|rs|rb)$/)) {
    return "💻 Code incoming! Building something cool?";
  }

  // Default
  const defaultMessages = [
    "📁 Interesting file! What's the story?",
    "🗂️ Something new! Care to share what it is?",
    "✨ File received! Thanks for sharing!",
  ];
  return defaultMessages[Math.floor(Math.random() * defaultMessages.length)];
};

const initialPreviewState = {
  open: false,
  loading: false,
  mode: 'text',
  content: '',
  metadata: null,
  metadataDetails: null,
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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [previewState, setPreviewState] = useState(initialPreviewState);
  const [toast, setToast] = useState(null);
  const [isDarkMode, setIsDarkMode] = useState(() => prefersDarkMode());

  // Room management state
  const [roomCode, setRoomCode] = useState(null);
  const [roomModalOpen, setRoomModalOpen] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [roomLoading, setRoomLoading] = useState(false);
  const [roomError, setRoomError] = useState('');

  // New features state
  const [devices, setDevices] = useState([]);
  const [showQR, setShowQR] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  // QR Scanner state
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState('');
  const qrScannerRef = useRef(null);

  // Receiving file state (for showing animation on other devices)
  const [receivingFile, setReceivingFile] = useState(null); // { filename, progress, device_info }

  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const socketRef = useRef(null);
  const uploadXhrRef = useRef(null); // For cancelling uploads
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

  const fetchFiles = useCallback(async (roomCodeParam) => {
    const code = roomCodeParam || roomCode;
    const url = code ? `${API_BASE}/api/files?room_code=${code}` : `${API_BASE}/api/files`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Unable to load files');
    }
    const data = await response.json();
    setFiles((data.files || []).map(normalizeFile));
  }, [normalizeFile, roomCode]);

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

    // Room-related socket events
    socket.on('room_joined', ({ room_code, file_count, device_count }) => {
      console.log(`Joined room ${room_code} with ${file_count} files, ${device_count} devices`);
    });

    socket.on('room_error', ({ error }) => {
      addToast(error, 'error');
    });

    // Device list updates
    socket.on('devices_updated', ({ devices: deviceList }) => {
      setDevices((prevDevices) => {
        const newDevices = deviceList || [];
        // Check if a new device joined (more devices than before)
        if (newDevices.length > prevDevices.length && prevDevices.length > 0) {
          // Find the new device(s)
          const prevIds = new Set(prevDevices.map(d => d.id));
          const joinedDevices = newDevices.filter(d => !prevIds.has(d.id));
          joinedDevices.forEach(d => {
            addToast(`📱 ${d.name || 'A device'} joined the room!`, 'success');
          });
        } else if (newDevices.length < prevDevices.length) {
          // A device left
          addToast(`👋 A device left the room`, 'info');
        }
        return newDevices;
      });
    });

    // Receiving file events (for showing animation when another device uploads)
    socket.on('receiving_file', (data) => {
      setReceivingFile({
        filename: data.filename,
        progress: 0,
        device_info: data.device_info,
        size: data.size
      });
    });

    socket.on('receiving_progress', (data) => {
      setReceivingFile((prev) => prev ? { ...prev, progress: data.progress } : null);
    });

    socket.on('receiving_complete', () => {
      // Keep showing for a moment then clear
      setTimeout(() => setReceivingFile(null), 1500);
    });

    // Listen for cancel signal from server (when all receivers dismiss)
    socket.on('cancel_upload', ({ reason }) => {
      console.log('Upload cancelled by server:', reason);
      // Abort current upload if any
      if (uploadXhrRef.current) {
        uploadXhrRef.current.abort();
      }
      addToast(`⚠️ ${reason}`, 'info');
    });

    // Re-join room on reconnection
    socket.on('connect', () => {
      console.log('Socket connected');
      // Re-join room if we have one
      const storedRoom = sessionStorage.getItem('ropix-room-code');
      if (storedRoom) {
        socket.emit('join_room', { room_code: storedRoom, device_info: deviceInfo });
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [addToast, normalizeFile]);

  // Join WebSocket room when roomCode changes
  useEffect(() => {
    if (roomCode && socketRef.current) {
      // Store in sessionStorage for reconnection
      sessionStorage.setItem('ropix-room-code', roomCode);
      socketRef.current.emit('join_room', { room_code: roomCode, device_info: deviceInfo });
      fetchFiles();
    } else if (!roomCode) {
      sessionStorage.removeItem('ropix-room-code');
    }
  }, [roomCode, fetchFiles]);

  // Room action functions
  const createRoom = async () => {
    setRoomLoading(true);
    setRoomError('');
    try {
      const response = await fetch(`${API_BASE}/api/room/create`, { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setRoomCode(data.room_code);
        setRoomModalOpen(false);
        addToast(`Room ${data.room_code} created!`, 'success');
      } else {
        setRoomError(data.error || 'Failed to create room');
      }
    } catch (err) {
      setRoomError(err.message);
    } finally {
      setRoomLoading(false);
    }
  };

  const joinRoom = async () => {
    if (!joinCode.trim()) {
      setRoomError('Please enter a room code');
      return;
    }
    setRoomLoading(true);
    setRoomError('');
    try {
      const response = await fetch(`${API_BASE}/api/room/join/${joinCode.trim().toUpperCase()}`, { method: 'POST' });
      const data = await response.json();
      if (response.ok && data.success) {
        setRoomCode(data.room_code);
        setRoomModalOpen(false);
        addToast(`Joined room ${data.room_code}`, 'success');
      } else {
        setRoomError(data.error || 'Room not found');
      }
    } catch (err) {
      setRoomError(err.message);
    } finally {
      setRoomLoading(false);
    }
  };

  const leaveRoom = async () => {
    if (roomCode && socketRef.current) {
      socketRef.current.emit('leave_room', { room_code: roomCode });
    }
    await fetch(`${API_BASE}/api/room/leave`, { method: 'POST' });
    setRoomCode(null);
    setFiles([]);
    setJoinCode('');
    setRoomModalOpen(true);
  };

  const copyRoomCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      addToast('Room code copied!', 'success');
    }
  };

  // QR Scanner functions
  const startScanner = async () => {
    setScannerOpen(true);
    setScannerError('');

    // Wait for the DOM element to be rendered
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode('qr-reader');
        qrScannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 }
          },
          (decodedText) => {
            // QR code scanned successfully
            handleScanSuccess(decodedText);
          },
          (errorMessage) => {
            // Ignore scan errors (happens when no QR in frame)
          }
        );
      } catch (err) {
        console.error('Scanner error:', err);
        setScannerError(err.message || 'Failed to access camera. Please allow camera permissions.');
      }
    }, 100);
  };

  const stopScanner = async () => {
    if (qrScannerRef.current) {
      try {
        await qrScannerRef.current.stop();
        qrScannerRef.current = null;
      } catch (err) {
        console.error('Error stopping scanner:', err);
      }
    }
    setScannerOpen(false);
    setScannerError('');
  };

  const handleScanSuccess = async (decodedText) => {
    // Stop the scanner first
    await stopScanner();

    // Extract room code from URL or plain code
    let code = decodedText;

    // Check if it's a URL with room parameter
    try {
      const url = new URL(decodedText);
      const roomParam = url.searchParams.get('room');
      if (roomParam) {
        code = roomParam;
      }
    } catch {
      // Not a URL, use as-is (might be just the room code)
    }

    // Clean the code
    code = code.toUpperCase().trim();

    // Validate it looks like a room code (6 alphanumeric chars)
    if (/^[A-Z0-9]{6}$/.test(code)) {
      setJoinCode(code);
      // Auto-join the room
      setRoomLoading(true);
      try {
        const response = await fetch(`${API_BASE}/api/room/join/${code}`, { method: 'POST' });
        const data = await response.json();
        if (response.ok && data.success) {
          setRoomCode(data.room_code);
          setRoomModalOpen(false);
          addToast(`Joined room ${data.room_code}`, 'success');
        } else {
          addToast(data.error || 'Room not found', 'error');
        }
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setRoomLoading(false);
      }
    } else {
      addToast('Invalid QR code. Expected a room code.', 'error');
    }
  };

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

      const totalFiles = fileList.length;
      let completedFiles = 0;

      setUploadStatus(`Uploading ${totalFiles} file(s)…`);
      setUploadProgress(0);

      for (const file of fileList) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('device_info', deviceInfo.name);
        formData.append('path', file.webkitRelativePath || file.name);
        if (roomCode) {
          formData.append('room_code', roomCode);
        }

        // Notify other devices that upload is starting
        if (socketRef.current && roomCode) {
          socketRef.current.emit('upload_start', {
            room_code: roomCode,
            filename: file.name,
            size: file.size,
            device_info: deviceInfo.name
          });
        }

        try {
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            uploadXhrRef.current = xhr; // Store for cancellation

            xhr.upload.onprogress = (e) => {
              if (e.lengthComputable) {
                const fileProgress = (e.loaded / e.total) * 100;
                const overallProgress = ((completedFiles + fileProgress / 100) / totalFiles) * 100;
                setUploadProgress(Math.round(overallProgress));

                // Broadcast progress to other devices
                if (socketRef.current && roomCode) {
                  socketRef.current.emit('upload_progress', {
                    room_code: roomCode,
                    filename: file.name,
                    progress: Math.round(fileProgress),
                    device_info: deviceInfo.name
                  });
                }
              }
            };

            xhr.onload = () => {
              uploadXhrRef.current = null;
              if (xhr.status >= 200 && xhr.status < 300) {
                const payload = JSON.parse(xhr.responseText);
                if (payload.success) {
                  // Notify other devices that upload is complete
                  if (socketRef.current && roomCode) {
                    socketRef.current.emit('upload_complete', {
                      room_code: roomCode,
                      filename: file.name,
                      device_info: deviceInfo.name
                    });
                  }
                  resolve(payload);
                } else {
                  reject(new Error(payload.error || 'Upload failed'));
                }
              } else {
                reject(new Error('Upload failed'));
              }
            };

            xhr.onerror = () => {
              uploadXhrRef.current = null;
              reject(new Error('Network error'));
            };

            xhr.onabort = () => {
              uploadXhrRef.current = null;
              // Notify other devices upload was cancelled
              if (socketRef.current && roomCode) {
                socketRef.current.emit('upload_complete', {
                  room_code: roomCode,
                  filename: file.name,
                  device_info: deviceInfo.name,
                  cancelled: true
                });
              }
              reject(new Error('Upload cancelled'));
            };

            xhr.open('POST', `${API_BASE}/upload`);
            xhr.send(formData);
          });

          completedFiles++;
          setUploadProgress(Math.round((completedFiles / totalFiles) * 100));

          // Show playful message for uploaded file
          addToast(getPlayfulMessage(file), 'info');
        } catch (error) {
          if (error.message !== 'Upload cancelled') {
            addToast(error.message, 'error');
          }
        }
      }

      uploadXhrRef.current = null;
      setUploadStatus('');
      setUploadProgress(0);
      // Playful messages are already shown per file
    },
    [addToast, roomCode]
  );

  // Cancel upload function
  const cancelUpload = useCallback(() => {
    if (uploadXhrRef.current) {
      uploadXhrRef.current.abort();
      addToast('Upload cancelled', 'info');
    }
    setUploadStatus('');
    setUploadProgress(0);
  }, [addToast]);

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
      {/* Room Modal - Shows when not in a room */}
      {roomModalOpen && (
        <div className="room-modal-overlay">
          <div className="room-modal">
            <h2>🔗 Join or Create Room</h2>
            <p>Share files securely with others using a room code.</p>

            {roomError && <div className="room-error">{roomError}</div>}

            <div className="room-actions">
              <div className="room-section">
                <h3>Create New Room</h3>
                <p>Generate a new room code to share with others</p>
                <button
                  className="btn btn-primary btn-large"
                  onClick={createRoom}
                  disabled={roomLoading}
                >
                  {roomLoading ? 'Creating...' : '🆕 Create Room'}
                </button>
              </div>

              <div className="room-divider">or</div>

              <div className="room-section">
                <h3>Join Existing Room</h3>
                <p>Enter a 6-character room code or scan QR</p>
                <div className="room-join-form">
                  <input
                    type="text"
                    className="room-code-input"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="ABCD12"
                    maxLength={6}
                    onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
                  />
                  <button
                    className="btn btn-primary"
                    onClick={joinRoom}
                    disabled={roomLoading || !joinCode.trim()}
                  >
                    {roomLoading ? 'Joining...' : 'Join'}
                  </button>
                </div>
                <button
                  className="btn btn-outline btn-scan-qr"
                  onClick={startScanner}
                  disabled={roomLoading}
                >
                  📷 Scan QR Code
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner Modal */}
      {scannerOpen && (
        <div className="scanner-modal-overlay">
          <div className="scanner-modal">
            <div className="scanner-header">
              <h3>📷 Scan Room QR Code</h3>
              <button className="btn btn-sm btn-outline" onClick={stopScanner}>
                ✕ Close
              </button>
            </div>

            {scannerError ? (
              <div className="scanner-error">
                <p>{scannerError}</p>
                <button className="btn btn-primary" onClick={stopScanner}>
                  Close
                </button>
              </div>
            ) : (
              <div className="scanner-content">
                <div id="qr-reader" className="qr-reader-container"></div>
                <p className="scanner-hint">Point your camera at a room QR code</p>
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* Room Banner - Shows current room */}
      {roomCode && (
        <div className="room-banner">
          <div className="room-info">
            <span className="room-label">Room:</span>
            <span className="room-code">{roomCode}</span>
            <button className="btn btn-sm btn-outline" onClick={copyRoomCode} title="Copy room code">
              📋 Copy
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setShowQR(!showQR)} title="Show QR Code">
              {showQR ? '✕ Hide QR' : '📱 QR'}
            </button>
            <button className="btn btn-sm btn-outline" onClick={() => setShowDevices(!showDevices)} title="Show Devices">
              👥 {devices.length} device{devices.length !== 1 ? 's' : ''}
            </button>
          </div>
          <button className="btn btn-sm btn-warning" onClick={leaveRoom}>
            Leave Room
          </button>
        </div>
      )}

      {/* QR Code Panel */}
      {showQR && roomCode && (
        <div className="qr-panel">
          <div className="qr-content">
            <h3>Scan to Join Room</h3>
            <QRCodeSVG
              value={`${window.location.origin}?room=${roomCode}`}
              size={180}
              bgColor="transparent"
              fgColor="var(--color-primary)"
              level="M"
            />
            <p className="qr-code-text">{roomCode}</p>
          </div>
        </div>
      )}

      {/* Device List Panel */}
      {showDevices && roomCode && (
        <div className="devices-panel">
          <h3>Connected Devices ({devices.length})</h3>
          {devices.length === 0 ? (
            <p className="no-devices">No other devices connected yet</p>
          ) : (
            <ul className="device-list">
              {devices.map((device) => (
                <li key={device.id} className="device-item">
                  <span className="device-icon">
                    {device.platform?.includes('Mac') || device.name?.includes('Mac') ? '💻' :
                      device.name?.includes('iPhone') || device.name?.includes('iPad') ? '📱' :
                        device.name?.includes('Android') ? '📱' :
                          device.name?.includes('Windows') ? '🖥️' : '💻'}
                  </span>
                  <span className="device-name">{device.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
              accept="*/*"
            />
            {/* Folder input - note: webkitdirectory doesn't work on mobile */}
            <input
              type="file"
              ref={folderInputRef}
              onChange={handleFileInput}
              style={{ display: 'none' }}
              multiple
              webkitdirectory=""
              directory=""
            />
          </div>

          {/* Upload Progress */}
          {uploadStatus && (
            <div className="upload-progress-container">
              <div className="progress-header">
                <div className="upload-progress-text">{uploadStatus} {uploadProgress}%</div>
                <button
                  className="btn btn-sm btn-warning cancel-btn"
                  onClick={cancelUpload}
                >
                  ✕ Cancel
                </button>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {/* Receiving File Progress (from another device) */}
          {receivingFile && (
            <div className="upload-progress-container receiving">
              <div className="progress-header">
                <div className="upload-progress-text">
                  📥 Receiving "{receivingFile.filename}" from {receivingFile.device_info}… {receivingFile.progress}%
                </div>
                <button
                  className="btn btn-sm btn-outline cancel-btn"
                  onClick={() => {
                    // Notify server that this receiver dismissed
                    if (socketRef.current && roomCode) {
                      socketRef.current.emit('dismiss_receiving', { room_code: roomCode });
                    }
                    setReceivingFile(null);
                  }}
                >
                  ✕ Dismiss
                </button>
              </div>
              <div className="progress-bar">
                <div
                  className="progress-fill receiving-fill"
                  style={{ width: `${receivingFile.progress}%` }}
                />
              </div>
            </div>
          )}
        </section>

        <section className="card card-files">
          <div className="files-header">
            <h2>Shared Files</h2>
            {files.length > 1 && (
              <div className="bulk-actions">
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
                {/* Mobile fallback - shown instead of iframe on mobile */}
                <div className="mobile-pdf-fallback">
                  <p>📄 PDF preview is not supported in mobile browsers.</p>
                  <button
                    className="btn btn-primary"
                    onClick={() => window.open(previewState.blobUrl, '_blank')}
                  >
                    📂 Open PDF
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => downloadFile(previewState.metadata?.file_id)}
                  >
                    ⬇ Download File
                  </button>
                </div>
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

