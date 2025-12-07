# Ropix Share

**Ropix Share** is a lightweight, real-time, peer-to-peer file sharing web application. It combines a **Retro Pixel Art UI** frontend built with **React** and **Vite** with a robust **Flask** and **Socket.IO** backend. It enables devices on the same network (or across networks, if hosted) to instantly share files with each other without storing them on the server. All transfers are direct, ephemeral, and streamed in real time.

The goal of this project is to create an accessible, browser-based alternative to tools like SHAREit or AirDrop—simple, fast, visually unique, and requiring no installation.

## ✨ Features

- **Retro Pixel Art UI**: A nostalgic, responsive interface with pixelated aesthetics.
- **Real-time Discovery**: Automatic device discovery and presence updates.
- **Direct File Sharing**: No permanent server storage; files stream directly between peers.
- **Live Updates**: Instant feedback via WebSockets.
- **Chunk-based Streaming**: Efficient file transfer for large files.
- **File Previews**: Metadata and previews for various file types.
- **Mobile Friendly**: Responsive design works on desktop and mobile.

## 📁 Project Structure

```
P2P-Sharing/
│
├── app.py              # Flask backend server
├── frontend/           # React + Vite frontend
│   ├── src/           # Component source code
│   ├── public/        # Static assets
│   └── dist/          # Built production assets (served by Flask)
├── scripts/            # Utility scripts
├── requirements.txt    # Python dependencies
└── vienv/              # Virtual environment
```

## 🛠️ Installation & Setup

### 1. Clone the Repository
```bash
git clone https://github.com/your-username/P2P-Sharing.git
cd P2P-Sharing
```

### 2. Backend Setup
Create and activate a virtual environment, then install Python dependencies.

```bash
# Create venv
python3 -m venv venv

# Activate venv
source venv/bin/activate    # Linux/macOS
# OR
venv\Scripts\activate       # Windows

# Install dependencies
pip install -r requirements.txt
```

### 3. Frontend Setup
Navigate to the frontend directory to install dependencies and build the React application.

```bash
cd frontend
npm install

# Build only (if you just want to run the Flask server)
npm run build

# OR Run development server (for frontend hacking)
npm run dev
```

### 4. Run the Application
The Flask server is configured to serve the built React frontend from `frontend/dist`.

```bash
# From the root directory (ensure venv is active)
python app.py
```

Access the app at:
```
http://localhost:5000
```
(If running `npm run dev` separately, the frontend will be at http://localhost:5173 but requires the backend running on port 5000).

## 📡 How It Works

1. **Connect**: Devices visit the URL and register with the server via Socket.IO.
2. **Discover**: The backend broadcasts connected devices to all users.
3. **Share**: Users select files; the server stores metadata and buffers streaming chunks in memory.
4. **Download**: Other peers request the file, which streams in chunks to their device.
5. **Vanish**: Files are ephemeral and disappear when the sender leaves or deletes them.

## 🧩 Technologies Used

- **Frontend**: React, Vite, Classnames, CSS Modules (Retro UI)
- **Backend**: Flask, Flask-SocketIO
- **Communication**: WebSockets (Socket.IO)
- **Language**: Python 3.x, JavaScript/TypeScript

## 🚀 Future Improvements

- Offline/LAN auto device detection
- Password-protected sharing rooms
- QR-based quick connect
- Drag-and-drop sharing
- Multi-file transfer support

## 📜 License

MIT License
