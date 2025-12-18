import os
from pathlib import Path
import hashlib
import binascii
from flask import Flask, request, jsonify, Response, send_from_directory, session
import mimetypes
import re
from datetime import datetime
from flask_socketio import SocketIO, emit, join_room, leave_room
import base64
import uuid
from metadata_utils import extract_metadata
import zipfile
import io
import string
import random

app = Flask(__name__)
app.secret_key = os.urandom(24)
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=60, ping_interval=25)
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BASE_DIR / 'frontend' / 'dist'
app.config['UPLOAD_FOLDER'] = str(BASE_DIR)

# =============================================================================
# ROOM-BASED FILE SHARING SYSTEM
# =============================================================================

# Room storage: { room_code: { files: {}, devices: {sid: info}, created_at, last_activity } }
rooms = {}

# Track socket ID to room mapping for disconnect handling
socket_to_room = {}

def generate_room_code():
    """Generate a unique 6-character room code."""
    chars = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choices(chars, k=6))
        if code not in rooms:
            return code

def get_current_room():
    """Get the room code from the current session."""
    return session.get('room_code')

def set_current_room(room_code):
    """Set the room code in the current session."""
    session['room_code'] = room_code

def get_room_files(room_code):
    """Get all files in a room."""
    if room_code and room_code in rooms:
        return rooms[room_code].get('files', {})
    return {}

def get_room_devices(room_code):
    """Get all devices in a room."""
    if room_code and room_code in rooms:
        return rooms[room_code].get('devices', {})
    return {}

MAX_DEVICES_PER_ROOM = 10

def add_device_to_room(room_code, sid, device_info):
    """Add a device to a room. Returns False if room is full."""
    if room_code and room_code in rooms:
        # Check device limit
        current_devices = len(rooms[room_code].get('devices', {}))
        if current_devices >= MAX_DEVICES_PER_ROOM:
            return False  # Room is full
        
        rooms[room_code]['devices'][sid] = {
            'name': device_info.get('name', 'Unknown Device'),
            'platform': device_info.get('platform', 'Unknown'),
            'joined_at': datetime.now().isoformat()
        }
        socket_to_room[sid] = room_code
        rooms[room_code]['last_activity'] = datetime.now().isoformat()
        return True
    return False

def remove_device_from_room(sid):
    """Remove a device from its room."""
    room_code = socket_to_room.pop(sid, None)
    if room_code and room_code in rooms:
        rooms[room_code]['devices'].pop(sid, None)
        return room_code
    return None

def add_file_to_room(room_code, file_id, metadata):
    """Add a file to a room."""
    if room_code and room_code in rooms:
        rooms[room_code]['files'][file_id] = metadata
        rooms[room_code]['last_activity'] = datetime.now().isoformat()
        return True
    return False

def remove_file_from_room(room_code, file_id):
    """Remove a file from a room."""
    if room_code and room_code in rooms:
        if file_id in rooms[room_code]['files']:
            del rooms[room_code]['files'][file_id]
            return True
    return False

# Legacy compatibility - keep file_metadata as alias
file_metadata = {}  # This will be deprecated, rooms store files now

CHUNK_SIZE = 64 * 1024  # 64KB chunks

# Supported preview file types with MIME type validation
PREVIEW_TYPES = {
    'image': {
        'extensions': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'],
        'mime_types': ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp', 'image/svg+xml', 'image/x-icon']
    },
    'video': {
        'extensions': ['.mp4', '.webm', '.ogg', '.avi', '.mov', '.mkv', '.flv', '.wmv'],
        'mime_types': ['video/mp4', 'video/webm', 'video/ogg', 'video/x-msvideo', 'video/quicktime', 'video/x-matroska', 'video/x-flv', 'video/x-ms-wmv']
    },
    'audio': {
        'extensions': ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'],
        'mime_types': ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/flac', 'audio/aac']
    },
    'document': {
        'extensions': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'],
        'mime_types': ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
    },
    'code': {
        'extensions': ['.py', '.js', '.html', '.css', '.json', '.xml', '.java', '.cpp', '.c', '.cs', '.php', '.rb', '.go', '.ts', '.jsx', '.tsx'],
        'mime_types': ['text/x-python', 'text/javascript', 'text/html', 'text/css', 'application/json', 'text/xml', 
                      'text/x-java', 'text/x-c++', 'text/x-c', 'text/x-csharp', 'text/x-php', 'text/x-ruby', 'text/x-go', 'text/typescript']
    },
    'text': {
        'extensions': ['.txt', '.md', '.csv', '.log', '.ini', '.conf', '.yml', '.yaml'],
        'mime_types': ['text/plain', 'text/markdown', 'text/csv']
    },
    'archive': {
        'extensions': ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2'],
        'mime_types': ['application/zip', 'application/x-rar-compressed', 'application/x-7z-compressed', 
                      'application/x-tar', 'application/gzip', 'application/x-bzip2']
    },
    'executable': {
        'extensions': ['.exe', '.msi', '.app', '.dmg', '.deb', '.rpm'],
        'mime_types': ['application/x-msdownload', 'application/x-msi', 'application/x-executable']
    }
}

def get_file_type(filename):
    """Determine the type of file based on its extension"""
    if not filename:
        return 'other'
        
    ext = os.path.splitext(filename)[1].lower()
    
    # Check if it's a directory
    if not ext and os.path.isdir(os.path.join(app.config['UPLOAD_FOLDER'], filename)):
        return 'folder'
        
    # Check file extension against known types
    for file_type, info in PREVIEW_TYPES.items():
        if ext in info['extensions']:
            return file_type
            
    # Try to guess based on mime type
    mime_type = mimetypes.guess_type(filename)[0]
    if mime_type:
        for file_type, info in PREVIEW_TYPES.items():
            if mime_type in info['mime_types']:
                return file_type
                
    return 'other'

def get_file_icon(file_type):
    """Get the appropriate icon class for the file type"""
    icon_map = {
        'image': 'fa-image',
        'video': 'fa-video',
        'audio': 'fa-music',
        'document': 'fa-file-alt',
        'code': 'fa-code',
        'text': 'fa-file-text',
        'archive': 'fa-file-archive',
        'executable': 'fa-cog',
        'folder': 'fa-folder',
        'other': 'fa-file'
    }
    return icon_map.get(file_type, 'fa-file')


def format_file_size(size):
    """Format file size in human-readable format"""
    try:
        size = float(size)  # Ensure size is a number
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024.0:
                return f"{size:.2f} {unit}"
            size /= 1024.0
        return f"{size:.2f} TB"
    except (ValueError, TypeError):
        return "0 B"  # Return a default value if size is invalid


def compute_manifest_signature(manifest):
    """
    Build a deterministic signature for the manifest so receivers can verify
    they got an untampered chunk list. We purposely rely on predictable strings
    instead of arbitrary JSON ordering to make client-side verification easy.
    """
    chunk_hashes = '|'.join(chunk['hash'] for chunk in manifest['chunks'])
    payload = f"{manifest['file_id']}:{manifest['total_size']}:{len(manifest['chunks'])}:{chunk_hashes}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def compute_chunk_manifest(file_id, file_bytes):
    """Split a file buffer into hashed chunks and return manifest + signature."""
    chunks = []
    offset = 0
    index = 0
    total_size = len(file_bytes)

    while offset < total_size:
        chunk_bytes = file_bytes[offset:offset + CHUNK_SIZE]
        chunk_hash = hashlib.sha256(chunk_bytes).hexdigest()
        chunks.append({
            'index': index,
            'offset': offset,
            'size': len(chunk_bytes),
            'hash': chunk_hash
        })
        index += 1
        offset += len(chunk_bytes)

    manifest = {
        'file_id': file_id,
        'chunk_size': CHUNK_SIZE,
        'total_size': total_size,
        'chunks': chunks
    }
    return manifest, compute_manifest_signature(manifest)


def sanitize_relative_path(path_value):
    """
    Ensure any relative path supplied by peers cannot break out of our controlled
    scope. We strip dangerous tokens and normalize separators so that the value
    can only ever describe a logical folder structure for display purposes.
    """
    if not path_value:
        return ''

    normalized = path_value.replace('\\', '/').strip()
    normalized = re.sub(r'/+', '/', normalized)
    safe_parts = [
        part for part in normalized.split('/')
        if part not in ('', '.', '..')
    ]
    return '/'.join(safe_parts)


def resolve_file_metadata(file_id, room_code=None):
    """
    Look up file metadata, optionally within a specific room.
    """
    # First check room-based storage
    if room_code and room_code in rooms:
        room_files = rooms[room_code].get('files', {})
        if file_id in room_files:
            metadata = room_files[file_id]
            if 'content' not in metadata:
                raise ValueError('Missing file content')
            if 'manifest' not in metadata or 'manifest_signature' not in metadata:
                raise ValueError('Missing manifest data')
            return metadata
    
    # Fallback to legacy global storage
    metadata = file_metadata.get(file_id)
    if not metadata:
        raise KeyError('File not found')
    if 'content' not in metadata:
        raise ValueError('Missing file content')
    if 'manifest' not in metadata or 'manifest_signature' not in metadata:
        raise ValueError('Missing manifest data')
    return metadata


# =============================================================================
# ROOM API ENDPOINTS
# =============================================================================

@app.route('/api/room/create', methods=['POST'])
def create_room():
    """Create a new room and return the room code."""
    room_code = generate_room_code()
    rooms[room_code] = {
        'files': {},
        'devices': {},
        'created_at': datetime.now().isoformat(),
        'last_activity': datetime.now().isoformat()
    }
    set_current_room(room_code)
    print(f'Room created: {room_code}')
    return jsonify({
        'success': True,
        'room_code': room_code,
        'message': f'Room {room_code} created. Share this code with others to let them join.'
    })

@app.route('/api/room/join/<room_code>', methods=['POST'])
def join_room_api(room_code):
    """Join an existing room."""
    room_code = room_code.upper()
    if room_code not in rooms:
        return jsonify({'error': 'Room not found. Check the code and try again.'}), 404
    
    # Check device limit
    current_devices = len(rooms[room_code].get('devices', {}))
    if current_devices >= MAX_DEVICES_PER_ROOM:
        return jsonify({'error': f'Room is full ({current_devices}/{MAX_DEVICES_PER_ROOM} devices)'}), 403
    
    set_current_room(room_code)
    rooms[room_code]['last_activity'] = datetime.now().isoformat()
    
    # Count files in room
    file_count = len(rooms[room_code].get('files', {}))
    print(f'Client joined room: {room_code}')
    
    return jsonify({
        'success': True,
        'room_code': room_code,
        'file_count': file_count,
        'message': f'Joined room {room_code}'
    })

@app.route('/api/room/info')
def room_info():
    """Get info about current room."""
    room_code = get_current_room()
    if not room_code or room_code not in rooms:
        return jsonify({
            'in_room': False,
            'message': 'Not in a room. Create or join a room to start sharing.'
        })
    
    room = rooms[room_code]
    return jsonify({
        'in_room': True,
        'room_code': room_code,
        'file_count': len(room.get('files', {})),
        'device_count': len(room.get('devices', {})),
        'created_at': room.get('created_at'),
        'last_activity': room.get('last_activity')
    })

@app.route('/api/room/devices')
def room_devices():
    """Get list of devices in current room."""
    room_code = get_current_room()
    if not room_code or room_code not in rooms:
        return jsonify({'devices': [], 'error': 'Not in a room'})
    
    devices = get_room_devices(room_code)
    device_list = [
        {
            'id': sid[:8],  # Shortened ID for privacy
            'name': info.get('name', 'Unknown'),
            'platform': info.get('platform', 'Unknown'),
            'joined_at': info.get('joined_at')
        }
        for sid, info in devices.items()
    ]
    return jsonify({'devices': device_list, 'count': len(device_list)})

@app.route('/api/room/leave', methods=['POST'])
def leave_room_api():
    """Leave current room."""
    room_code = get_current_room()
    if room_code:
        session.pop('room_code', None)
    return jsonify({'success': True, 'message': 'Left room'})


# =============================================================================
# STATIC FILES
# =============================================================================

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path and (FRONTEND_DIST / path).exists():
        return send_from_directory(FRONTEND_DIST, path)
    
    # Check if it's an API route that wasn't caught
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
        
    index_file = FRONTEND_DIST / 'index.html'
    if index_file.exists():
        return send_from_directory(FRONTEND_DIST, 'index.html')
    return jsonify({
        'message': 'React build not found. Run `npm install && npm run dev` inside the frontend/ directory for development, or build the project with `npm run build`.'
    })


# =============================================================================
# WEBSOCKET HANDLERS
# =============================================================================

@socketio.on('connect')
def handle_connect():
    print(f'Client connected: {request.sid}')

@socketio.on('join_room')
def handle_join_room(data):
    """Handle client joining a room via WebSocket."""
    room_code = data.get('room_code', '').upper()
    device_info = data.get('device_info', {})
    
    if not room_code or room_code not in rooms:
        emit('room_error', {'error': 'Room not found'})
        return
    
    # Add device to room tracking (checks limit)
    if not add_device_to_room(room_code, request.sid, device_info):
        emit('room_error', {'error': 'Room is full (max 10 devices)'})
        return
    
    # Join the WebSocket room
    join_room(room_code)
    
    print(f'Client {request.sid[:8]} joined room: {room_code}')
    
    # Send all files in the room to the newly joined client
    room_files = rooms[room_code].get('files', {})
    for file_id, metadata in room_files.items():
        emit('file_available', {
            'file_id': file_id,
            'filename': metadata['filename'],
            'file_type': metadata['file_type'],
            'mime_type': metadata['mime_type'],
            'size': metadata['size'],
            'size_display': format_file_size(metadata['size']),
            'device_info': metadata['device_info'],
            'safe_path': metadata.get('safe_path', metadata['filename']),
            'chunks': len(metadata['manifest']['chunks']),
            'uploaded_at': metadata['created_at']
        })
    
    # Get updated device list
    devices = get_room_devices(room_code)
    device_list = [
        {'id': sid[:8], 'name': info.get('name', 'Unknown'), 'platform': info.get('platform')}
        for sid, info in devices.items()
    ]
    
    emit('room_joined', {
        'room_code': room_code, 
        'file_count': len(room_files),
        'device_count': len(devices)
    })
    
    # Broadcast updated device list to all in room
    socketio.emit('devices_updated', {'devices': device_list, 'count': len(device_list)}, room=room_code)

@socketio.on('leave_room')
def handle_leave_room(data):
    """Handle client leaving a room."""
    room_code = data.get('room_code', '').upper()
    if room_code:
        leave_room(room_code)
        # Remove device tracking
        remove_device_from_room(request.sid)
        
        # Broadcast updated device list
        if room_code in rooms:
            devices = get_room_devices(room_code)
            device_list = [
                {'id': sid[:8], 'name': info.get('name', 'Unknown'), 'platform': info.get('platform')}
                for sid, info in devices.items()
            ]
            socketio.emit('devices_updated', {'devices': device_list, 'count': len(device_list)}, room=room_code)
        
        print(f'Client {request.sid[:8]} left room: {room_code}')

@socketio.on('disconnect')
def handle_disconnect():
    # Clean up device from any room they were in
    room_code = remove_device_from_room(request.sid)
    if room_code and room_code in rooms:
        devices = get_room_devices(room_code)
        device_list = [
            {'id': sid[:8], 'name': info.get('name', 'Unknown'), 'platform': info.get('platform')}
            for sid, info in devices.items()
        ]
        socketio.emit('devices_updated', {'devices': device_list, 'count': len(device_list)}, room=room_code)
    print(f'Client disconnected: {request.sid[:8]}')

@socketio.on('request_file')
def handle_file_request(data):
    file_id = data.get('file_id')
    room_code = data.get('room_code', '').upper()
    
    if not file_id:
        emit('file_error', {'error': 'Missing file_id'})
        return
    
    try:
        metadata = resolve_file_metadata(file_id, room_code)
    except (KeyError, ValueError) as exc:
        emit('file_error', {'error': str(exc)})
        return
    
    manifest = metadata['manifest']
    emit('file_manifest', {
        'file_id': file_id,
        'filename': metadata['filename'],
        'mime_type': metadata['mime_type'],
        'size': metadata['size'],
        'manifest': manifest,
        'manifest_signature': metadata['manifest_signature']
    })

    try:
        file_bytes = base64.b64decode(metadata['content'])
    except (ValueError, binascii.Error) as exc:
        emit('file_error', {'error': f'Corrupted file content: {exc}'})
        return

    for chunk in manifest['chunks']:
        start = chunk['offset']
        end = start + chunk['size']
        chunk_bytes = file_bytes[start:end]
        emit('file_chunk', {
            'file_id': file_id,
            'chunk_index': chunk['index'],
            'size': chunk['size'],
            'hash': chunk['hash'],
            'content': base64.b64encode(chunk_bytes).decode('utf-8')
        })

    emit('file_transfer_complete', {'file_id': file_id})

# =============================================================================
# UPLOAD PROGRESS BROADCASTING (for receiving animation on other devices)
# =============================================================================

# Track active uploads: { room_code: { uploader_sid, filename, receiver_count, dismissed_count } }
active_uploads = {}


@socketio.on('upload_start')
def handle_upload_start(data):
    """Broadcast that a file upload has started."""
    room_code = data.get('room_code', '').upper() or socket_to_room.get(request.sid)
    print(f'[DEBUG] upload_start from {request.sid[:8]}, room: {room_code}, file: {data.get("filename")}')
    if not room_code or room_code not in rooms:
        return
    
    # Count receivers (other devices in room)
    receiver_count = len(rooms[room_code].get('devices', {})) - 1
    
    # Track this upload
    active_uploads[room_code] = {
        'uploader_sid': request.sid,
        'filename': data.get('filename', 'Unknown file'),
        'receiver_count': max(receiver_count, 0),
        'dismissed_count': 0
    }
    
    # Broadcast to other clients in the room (exclude sender)
    socketio.emit('receiving_file', {
        'filename': data.get('filename', 'Unknown file'),
        'size': data.get('size', 0),
        'device_info': data.get('device_info', 'Unknown Device'),
        'progress': 0
    }, room=room_code, skip_sid=[request.sid])


@socketio.on('upload_progress')
def handle_upload_progress(data):
    """Broadcast upload progress to other devices."""
    room_code = data.get('room_code', '').upper() or socket_to_room.get(request.sid)
    if not room_code:
        return
    
    socketio.emit('receiving_progress', {
        'filename': data.get('filename', 'Unknown file'),
        'progress': data.get('progress', 0),
        'device_info': data.get('device_info', 'Unknown Device')
    }, room=room_code, skip_sid=[request.sid])


@socketio.on('upload_complete')
def handle_upload_complete(data):
    """Broadcast that upload is complete."""
    room_code = data.get('room_code', '').upper() or socket_to_room.get(request.sid)
    print(f'[DEBUG] upload_complete from {request.sid[:8]}, room: {room_code}')
    if not room_code:
        return
    
    # Clear active upload tracking
    active_uploads.pop(room_code, None)
    
    socketio.emit('receiving_complete', {
        'filename': data.get('filename', 'Unknown file'),
        'device_info': data.get('device_info', 'Unknown Device')
    }, room=room_code, skip_sid=[request.sid])


@socketio.on('dismiss_receiving')
def handle_dismiss_receiving(data):
    """Handle when a receiver dismisses the receiving notification."""
    room_code = data.get('room_code', '').upper() or socket_to_room.get(request.sid)
    if not room_code or room_code not in active_uploads:
        return
    
    upload = active_uploads[room_code]
    upload['dismissed_count'] += 1
    print(f'[DEBUG] dismiss_receiving: {upload["dismissed_count"]}/{upload["receiver_count"]} dismissed')
    
    # If all receivers dismissed, notify the uploader to cancel
    if upload['dismissed_count'] >= upload['receiver_count'] and upload['receiver_count'] > 0:
        print(f'[DEBUG] All receivers dismissed, cancelling upload for {upload["uploader_sid"][:8]}')
        socketio.emit('cancel_upload', {
            'reason': 'All receiving devices dismissed the transfer'
        }, to=upload['uploader_sid'])
        active_uploads.pop(room_code, None)


@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        # Check if user is in a room - allow explicit room_code from form (for cross-device sync)
        room_code = (request.form.get('room_code', '') or '').upper() or get_current_room()
        if not room_code or room_code not in rooms:
            return jsonify({'error': 'You must join a room before uploading files'}), 400
        
        file = request.files['file']
        device_info = request.form.get('device_info', 'Unknown Device')
        requested_path = request.form.get('path', file.filename)
        safe_relative_path = sanitize_relative_path(requested_path) or os.path.basename(file.filename)
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Read file content into memory
        file_content = file.read()
        file_size = len(file_content)
        
        if file_size == 0:
            return jsonify({'error': 'Empty file'}), 400
        
        # Generate unique file ID
        file_id = str(uuid.uuid4())
        manifest, manifest_signature = compute_chunk_manifest(file_id, file_content)
        
        # Store file metadata
        file_type = get_file_type(file.filename)
        mime_type = mimetypes.guess_type(file.filename)[0] or 'application/octet-stream'
        
        metadata = {
            'filename': file.filename,
            'file_type': file_type,
            'mime_type': mime_type,
            'size': file_size,
            'content': base64.b64encode(file_content).decode('utf-8'),
            'created_at': datetime.now().isoformat(),
            'device_info': device_info,
            'safe_path': safe_relative_path,
            'manifest': manifest,
            'manifest_signature': manifest_signature,
            'room_code': room_code
        }
        
        # Add file to the room
        add_file_to_room(room_code, file_id, metadata)
        
        # Broadcast to all clients in the room
        socketio.emit('file_available', {
            'file_id': file_id,
            'filename': file.filename,
            'file_type': file_type,
            'mime_type': metadata['mime_type'],
            'size': metadata['size'],
            'size_display': format_file_size(metadata['size']),
            'device_info': metadata['device_info'],
            'safe_path': metadata.get('safe_path', metadata['filename']),
            'chunks': len(metadata['manifest']['chunks']),
            'uploaded_at': metadata['created_at']
        }, room=room_code)
        
        print(f'File uploaded: {file.filename} (Room: {room_code})')
        
        return jsonify({
            'success': True,
            'file_id': file_id,
            'filename': file.filename,
            'type': file_type,
            'room_code': room_code
        })
                
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/<file_id>')
def download_file(file_id):
    try:
        room_code = get_current_room()
        metadata = resolve_file_metadata(file_id, room_code)
        
        file_content = base64.b64decode(metadata['content'])
        
        return Response(
            file_content,
            mimetype=metadata['mime_type'],
            headers={
                'Content-Disposition': f'attachment; filename="{metadata["filename"]}"',
                'Content-Length': str(metadata['size'])
            }
        )
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/file-info/<file_id>')
def file_info(file_id):
    try:
        room_code = get_current_room()
        if not room_code or room_code not in rooms:
            return jsonify({'error': 'Not in a room'}), 400
            
        room_files = rooms[room_code].get('files', {})
        if file_id not in room_files:
            return jsonify({'error': 'File not found'}), 404
            
        metadata = room_files[file_id]
        
        return jsonify({
            'name': metadata['filename'],
            'type': metadata['file_type'],
            'mime_type': metadata['mime_type'],
            'size': metadata['size'],
            'size_display': format_file_size(metadata['size']),
            'created': metadata['created_at'],
            'device_info': metadata['device_info'],
            'safe_path': metadata.get('safe_path', metadata['filename']),
            'integrity': {
                'chunks': len(metadata['manifest']['chunks']),
                'chunk_size': metadata['manifest']['chunk_size'],
                'manifest_signature': metadata['manifest_signature']
            }
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/files')
def api_files():
    try:
        # Allow explicit room_code query param (for cross-device sync)
        room_code = request.args.get('room_code', '').upper() or get_current_room()
        if not room_code or room_code not in rooms:
            return jsonify({'files': [], 'in_room': False, 'message': 'Not in a room'})
        
        room_files = rooms[room_code].get('files', {})
        files = []
        for file_id, metadata in room_files.items():
            files.append({
                'file_id': file_id,
                'filename': metadata['filename'],
                'file_type': metadata['file_type'],
                'mime_type': metadata['mime_type'],
                'size': metadata['size'],
                'size_display': format_file_size(metadata['size']),
                'device_info': metadata['device_info'],
                'safe_path': metadata.get('safe_path', metadata['filename']),
                'uploaded_at': metadata['created_at'],
                'chunks': len(metadata['manifest']['chunks'])
            })
        return jsonify({'files': files, 'room_code': room_code, 'in_room': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/metadata/<file_id>')
def get_metadata(file_id):
    try:
        room_code = get_current_room()
        metadata = resolve_file_metadata(file_id, room_code)
        
        # Decode content for extraction
        try:
            file_content = base64.b64decode(metadata['content'])
        except (ValueError, binascii.Error):
            return jsonify({'error': 'Corrupted file content'}), 500
            
        extracted = extract_metadata(file_content, metadata['file_type'], metadata['mime_type'])
        
        return jsonify({
            'filename': metadata['filename'],
            'base_info': {
                'type': metadata['file_type'],
                'mime_type': metadata['mime_type'], 
                'size': format_file_size(metadata['size']),
                'uploaded': metadata['created_at']
            },
            'details': extracted
        })
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/preview/<file_id>')
def preview_file(file_id):
    try:
        room_code = get_current_room()
        metadata = resolve_file_metadata(file_id, room_code)
        
        file_content = base64.b64decode(metadata['content'])
        
        if metadata['file_type'] == 'text' or metadata['file_type'] == 'code':
            try:
                content = file_content.decode('utf-8')
                return jsonify({
                    'content': content, 
                    'type': metadata['file_type'], 
                    'info': {
                        'name': metadata['filename'],
                        'type': metadata['file_type'],
                        'mime_type': metadata['mime_type'],
                        'size': metadata['size'],
                        'size_display': format_file_size(metadata['size']),
                        'created': metadata['created_at']
                    }
                })
            except UnicodeDecodeError:
                return jsonify({'error': 'File contains binary data and cannot be previewed as text'}), 400
        else:
            return Response(
                file_content,
                mimetype=metadata['mime_type'],
                headers={'Content-Disposition': f'inline; filename="{metadata["filename"]}"'}
            )
    except KeyError:
        return jsonify({'error': 'File not found'}), 404
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/delete/<file_id>', methods=['POST'])
def delete_file(file_id):
    try:
        room_code = get_current_room()
        if not room_code or room_code not in rooms:
            return jsonify({'error': 'Not in a room'}), 400
            
        room_files = rooms[room_code].get('files', {})
        if file_id not in room_files:
            return jsonify({'error': 'File not found'}), 404
        
        metadata = room_files[file_id]
        device_info = request.form.get('device_info', 'Unknown Device')
        filename = metadata['filename']
        
        # Remove from room
        remove_file_from_room(room_code, file_id)
        
        # Broadcast deletion to the room
        socketio.emit('file_deleted', {
            'file_id': file_id,
            'filename': filename,
            'device_info': device_info
        }, room=room_code)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download-all')
def download_all():
    try:
        room_code = get_current_room()
        if not room_code or room_code not in rooms:
            return jsonify({'error': 'Not in a room'}), 400
        
        room_files = rooms[room_code].get('files', {})
        
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w') as zf:
            for file_id, metadata in room_files.items():
                content = base64.b64decode(metadata['content'])
                zf.writestr(metadata['filename'], content)
        memory_file.seek(0)
        return Response(
            memory_file,
            mimetype='application/zip',
            headers={
                'Content-Disposition': f'attachment; filename="ropix-room-{room_code}.zip"'
            }
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/delete-all', methods=['POST'])
def delete_all():
    try:
        room_code = get_current_room()
        if not room_code or room_code not in rooms:
            return jsonify({'error': 'Not in a room'}), 400
        
        file_count = len(rooms[room_code].get('files', {}))
        rooms[room_code]['files'] = {}
        
        # Broadcast to room
        socketio.emit('files_cleared', room=room_code)
        return jsonify({'success': True, 'deleted_count': file_count})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/room-status')
def room_status():
    """Debug endpoint for room status."""
    room_code = get_current_room()
    
    if not room_code or room_code not in rooms:
        return jsonify({
            'in_room': False,
            'message': 'Create or join a room to start sharing files.',
            'total_rooms': len(rooms)
        })
    
    room = rooms[room_code]
    room_files = room.get('files', {})
    
    return jsonify({
        'in_room': True,
        'room_code': room_code,
        'file_count': len(room_files),
        'files': [{'id': fid[:8], 'name': m.get('filename')} for fid, m in room_files.items()],
        'created_at': room.get('created_at'),
        'total_rooms': len(rooms)
    })

if __name__ == '__main__':
    print("\n=== Ropix Share - Room-Based File Sharing ===")
    print("Create or join a room to share files securely.")
    print("Only people with the room code can see your files.")
    print("==============================================\n")
    socketio.run(app, debug=True, host='0.0.0.0', port=5000) 