# Ropix Share

**Ropix Share** is a lightweight, real-time file sharing web application with a **Retro Pixel Art UI**. Built with **React + Vite** frontend and **Flask + Socket.IO** backend, it enables instant file sharing through shareable room codes—no installation required.

## ✨ Features

### 🔗 Room-Based Sharing
- **Room Codes**: Create or join rooms with 6-character codes
- **QR Code Sharing**: Generate QR codes for instant room joining
- **QR Scanner**: Scan QR codes with your camera to join rooms
- **Device Limit**: Up to 10 devices per room

### 📁 File Transfer
- **Direct Sharing**: Files stream directly between peers (no server storage)
- **Real-time Progress**: Upload progress bars with percentage
- **Chunk-based Streaming**: Efficient transfer for large files
- **Bulk Actions**: Download all as ZIP or delete all files

### 👥 Connected Devices
- **Device List**: See who's connected to your room
- **Real-time Updates**: Instant join/leave notifications
- **Device Names**: Friendly names (iPhone, Mac, Windows PC, etc.)

### 🎨 Themes & Animations
| Theme 1 (Warm) | Theme 2 (Cool) |
|----------------|----------------|
| Retro pixel color cycling | Neon cyber glitch effects |
| 8-bit style animations | Chromatic aberration glow |
| Bounce hover effects | Pulse glow on buttons |

### 📱 File Previews
- Images, Videos, Audio
- PDFs and Documents
- Code/Text with syntax details
- Archive contents (ZIP)
- EXIF metadata for photos

## 🛠️ Quick Start

```bash
# Clone
git clone https://github.com/your-username/Ropix-Share.git
cd Ropix-Share

# Backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run build

# Run
cd ..
python app.py
```

Open http://localhost:5000

## 📡 How It Works

```
┌─────────────────┐     ┌─────────────────┐
│   Device A      │     │   Device B      │
│  Create Room    │────▶│  Join via Code  │
│    ABC123       │     │   or QR Scan    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
    ┌────────────────────────────────┐
    │        Room: ABC123            │
    │   Files shared in real-time    │
    │   Max 10 devices per room      │
    └────────────────────────────────┘
```

1. **Create/Join Room**: Get a 6-char code or scan QR
2. **Share Files**: Upload files visible to all room members
3. **Download**: Stream files directly to your device
4. **Leave**: Files remain for others until room is empty

## 🧩 Tech Stack

- **Frontend**: React, Vite, Socket.IO Client, QRCode.react, html5-qrcode
- **Backend**: Flask, Flask-SocketIO, Pillow, Mutagen
- **Styling**: Custom CSS with retro pixel art theme

## 📁 Structure

```
Ropix-Share/
├── app.py              # Flask backend + WebSocket handlers
├── frontend/
│   ├── src/
│   │   ├── App.jsx     # Main React component
│   │   └── styles.css  # Theme styles & animations
│   └── dist/           # Production build (served by Flask)
└── requirements.txt    # Python dependencies
```

## 📜 License

MIT License
