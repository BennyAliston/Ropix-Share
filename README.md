# Ropix Share

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-18+-61DAFB?logo=react)](https://react.dev)
[![Flask](https://img.shields.io/badge/Flask-3.1+-000000?logo=flask)](https://flask.palletsprojects.com)
[![Python](https://img.shields.io/badge/Python-3.8+-3776ab?logo=python)](https://www.python.org)

**Ropix Share** is a lightweight, real-time file sharing application with a retro pixel art UI. Share files instantly across devices on the same network with zero setup required.

Combines a **React + Vite** frontend with a **Flask + Socket.IO** backend to deliver responsive, real-time file synchronization without installation.

## Table of Contents

- [Features](#features)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Recent Updates](#recent-updates)
- [License](#license)

## Features

### Open Sharing (Default)
- **Instant LAN Sharing**: Upload files and they appear on all connected devices automatically
- **No Setup Required**: Just open the app on any device on the same network
- **Real-time Sync**: Files broadcast to all devices via WebSocket lobby

### Room-Based Sharing (Selective)
- **Private Rooms**: Create a room when you want to share with specific people only
- **Room Codes**: 6-character codes for easy sharing
- **QR Code Sharing**: Generate QR codes for instant room joining
- **QR Scanner**: Scan QR codes with your camera to join rooms
- **Device Limit**: Up to 10 devices per room

### File Transfer
- **Real-time Progress**: Upload progress bars with percentage
- **Receiving Animation**: Other devices see live progress when files are being uploaded
- **Chunk-based Integrity**: Manifest-based verification for file integrity
- **Bulk Actions**: Download all as ZIP or delete all files
- **Cancel Upload**: Cancel uploads from either the sender or receivers
- **Auto-Cancel**: Upload automatically cancels if all receivers dismiss
- **Special Character Support**: Filenames with unicode and special characters handled via RFC 5987

### Connected Devices
- **Device List**: See who's connected to your room
- **Real-time Notifications**: Toast alerts when devices join or leave
- **Device Names**: Friendly names (iPhone, Mac, Windows PC, etc.)

### Themes & Animations
| Theme 1 (Warm) | Theme 2 (Cool) |
|----------------|----------------|
| Retro pixel color cycling | Neon cyber glitch effects |
| 8-bit style animations | Chromatic aberration glow |
| Bounce hover effects | Pulse glow on buttons |

### File Previews
- Images, Videos, Audio
- PDFs and Documents (mobile-friendly with open/download options)
- Code/Text with syntax details
- Archive contents (ZIP)
- EXIF metadata for photos

### Responsive Design
- **Mobile-First**: Fully responsive UI for all screen sizes
- **Touch-Friendly**: Large touch targets for buttons and actions
- **Truncated Filenames**: Long filenames display with ellipsis
- **Adaptive Layout**: Cards stack vertically on mobile

## Quick Start

### Prerequisites

- **Python 3.8+**
- **Node.js 16+** and npm
- **Git**

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/BennyAliston/Ropix-Share.git
   cd Ropix-Share
   ```

2. **Set up the backend:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. **Set up the frontend:**
   ```bash
   cd frontend
   npm install
   npm run build
   cd ..
   ```

4. **Start the application:**
   ```bash
   python app.py
   ```

5. **Open in your browser:**
   ```
   http://localhost:5000
   ```

Share the URL with other devices on your network and start sharing files immediately!

## How It Works

```
             Default Mode (No Room)
┌─────────────────┐     ┌─────────────────┐
│   Device A      │     │   Device B      │
│  Upload files   │────▶│  Files appear   │
│  instantly      │◀────│  automatically  │
└─────────────────┘     └─────────────────┘
        All devices on the network share files
                via WebSocket lobby

           Room Mode (Selective Sharing)
┌─────────────────┐     ┌─────────────────┐
│   Device A      │     │   Device B      │
│  Create Room    │────▶│  Join via Code  │
│    ABC123       │     │   or QR Scan    │
└────────┬────────┘     └────────┬────────┘
         │                       │
         ▼                       ▼
    ┌────────────────────────────────┐
    │        Room: ABC123            │
    │   Only room members see files  │
    │   Max 10 devices per room      │
    └────────────────────────────────┘
```

1. **Open the app** on any device on the same network
2. **Upload files** — they appear on all connected devices instantly
3. **Need privacy?** Click "Share via Room" to create a private room
4. **Share the room code** or QR with specific people
5. **Leave the room** to return to open sharing mode

## Tech Stack

| Component | Technology |
|-----------|-----------|
| **Frontend** | React 18+, Vite, Socket.IO Client |
| **UI/UX** | Custom CSS with retro pixel art theme, QRCode.react, html5-qrcode |
| **Backend** | Flask 3.1+, Flask-SocketIO, Python 3.8+ |
| **Image Processing** | Pillow (file metadata extraction) |
| **Audio/Media** | Mutagen (metadata parsing) |

## Project Structure

```
Ropix-Share/
├── app.py              # Flask backend + WebSocket handlers
├── metadata_utils.py   # File metadata extraction utilities
├── frontend/
│   ├── src/
│   │   ├── App.jsx     # Main React component
│   │   └── styles.css  # Theme styles & animations
│   └── dist/           # Production build (served by Flask)
└── requirements.txt    # Python dependencies
```

## Recent Updates

- **Open Sharing Mode**: Files now share across all devices by default without needing a room
- **Optional Rooms**: Room-based sharing is now opt-in for when you need selective/private sharing
- **Lobby System**: WebSocket lobby broadcasts file events to all non-room devices
- **RFC 5987 Filenames**: Content-Disposition headers handle unicode and special characters
- **Auto-Join via URL**: Join rooms directly with `?room=CODE` URL parameter
- **Receiving Animation**: Real-time progress bar on other devices when files are uploading
- **Cancel Upload**: Both sender and receivers can cancel transfers
- **Device Join/Leave Notifications**: Toast alerts when devices connect or disconnect
- **Improved Mobile UI**: Better responsive layout, truncated filenames, touch-friendly buttons
- **PDF Mobile Support**: PDFs open in native viewer on mobile devices

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

MIT License © 2026 BennyAliston. Permission is hereby granted, free of charge, to use, copy, modify, and distribute this software.

