
import os
import io
import mimetypes
from PIL import Image
import mutagen
from PyPDF2 import PdfReader

def get_image_metadata(file_content_io):
    metadata = {}
    try:
        with Image.open(file_content_io) as img:
            metadata['width'] = img.width
            metadata['height'] = img.height
            metadata['format'] = img.format
            metadata['mode'] = img.mode
            metadata['info'] = {}
            # Extract basic info if available (avoiding complex EXIF for now to keep it safe/simple)
            if hasattr(img, 'info'):
                # Filter out values that are not JSON serializable easily (like bytes)
                for k, v in img.info.items():
                    if isinstance(v, (str, int, float)):
                        metadata['info'][k] = v
    except Exception as e:
        metadata['error'] = f"Error extracting image metadata: {str(e)}"
    return metadata

def get_audio_metadata(file_content_io):
    metadata = {}
    try:
        # mutagen needs a file-like object. BytesIO is fine.
        # file_content_io.seek(0) # Ensure we are at start
        # Some mutagen formats might need a filename hint, but let's try auto detection
        audio = mutagen.File(file_content_io)
        if audio is not None:
            if audio.info:
                metadata['duration'] = getattr(audio.info, 'length', 0)
                metadata['sample_rate'] = getattr(audio.info, 'sample_rate', 0)
                metadata['bitrate'] = getattr(audio.info, 'bitrate', 0)
                metadata['channels'] = getattr(audio.info, 'channels', 0)
            
            # Tags
            metadata['tags'] = {}
            if audio.tags:
                for key, value in audio.tags.items():
                     # Simplify values to string
                    metadata['tags'][key] = str(value)
    except Exception as e:
        metadata['error'] = f"Error extracting audio metadata: {str(e)}"
    return metadata

def get_video_metadata(file_content_io):
    # Mutagen can handle some video containers (like MP4/MKV audio tracks), but for full video 
    # metadata without huge dependencies like ffmpeg, we might be limited.
    # However, for MP4, mutagen can often read the container info.
    return get_audio_metadata(file_content_io) # Re-use audio logic as it covers container tags often

def get_pdf_metadata(file_content_io):
    metadata = {}
    try:
        reader = PdfReader(file_content_io)
        metadata['pages'] = len(reader.pages)
        if reader.metadata:
            for k, v in reader.metadata.items():
                if isinstance(v, (str, int, float)):
                     metadata[k.replace('/', '')] = v # Remove leading slash from PDF keys
    except Exception as e:
         metadata['error'] = f"Error extracting PDF metadata: {str(e)}"
    return metadata

def extract_metadata(file_content_bytes, file_type, mime_type):
    """
    Main entry point for metadata extraction.
    """
    metadata = {}
    file_io = io.BytesIO(file_content_bytes)
    
    if file_type == 'image':
        metadata = get_image_metadata(file_io)
    elif file_type == 'audio':
        metadata = get_audio_metadata(file_io)
    elif file_type == 'video':
        # Video is tricky without ffmpeg, but we try basics
        metadata = get_video_metadata(file_io)
    elif mime_type == 'application/pdf' or (file_type == 'document' and 'pdf' in mime_type):
        metadata = get_pdf_metadata(file_io)
    
    return metadata
