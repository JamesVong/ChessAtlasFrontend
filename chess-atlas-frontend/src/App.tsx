import { useState, useCallback, useEffect } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import axios from 'axios';
import { Chess } from 'chess.js';
import Chessground from '@react-chess/chessground';

// Import the necessary CSS for chessground
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

import './App.css'; 


// --- TYPE DEFINITIONS (The heart of TypeScript) ---
// Define a type for the orientation of the board
type Orientation = 'white' | 'black';

// Define the structure of the data we expect from our API
interface ApiData {
  fen: string;
  cropped_image: string;
}

interface ApiResponse {
  status: 'success' | 'error';
  data: ApiData;
  message?: string;
}

// Custom type for the uploaded file to include the preview URL
interface UploadedFile extends File {
  preview: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'https://api.chess-atlas.com/api/v1/analyze-board';
const MAX_UPLOAD_SIZE_BYTES = 12 * 1024 * 1024; // 12MB
const ACCEPTED_IMAGE_TYPES = {
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/png': ['.png'],
};

const formatBytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

const getFileValidationError = (file: File): string | null => {
  const fileType = file.type.toLowerCase();
  if (!Object.keys(ACCEPTED_IMAGE_TYPES).includes(fileType)) {
    return 'Unsupported image format. Please upload a JPG or PNG image.';
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    return `Image is too large (${formatBytes(file.size)}). Please use a file smaller than ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}.`;
  }

  return null;
};

const getApiErrorMessage = (err: unknown): string => {
  if (!axios.isAxiosError(err)) {
    return 'Upload failed. Please try again.';
  }

  if (err.response) {
    const status = err.response.status;
    const responseData = err.response.data as { message?: string } | undefined;
    const serverMessage = responseData?.message;

    if (status === 400) return serverMessage || 'The image could not be processed. Try another photo with the full board visible.';
    if (status === 413) return 'The uploaded image is too large for the server. Try resizing the photo and upload again.';
    if (status === 415) return 'Unsupported image format. Please upload a JPG or PNG image.';
    if (status === 429) return 'Too many requests right now. Please wait a moment and try again.';
    if (status >= 500) return 'The analysis server returned an error. Please try again in a minute.';

    return serverMessage || `Upload failed (HTTP ${status}).`;
  }

  if (err.code === 'ECONNABORTED') {
    return 'Upload timed out. Please try a smaller image or check your connection.';
  }

  if (err.code === 'ERR_NETWORK') {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'this site';
    return `Network error contacting the API from ${origin}. If you are testing from mobile on local dev, this is often a CORS/origin issue.`;
  }

  return err.message || 'Upload failed. Please try again.';
};

function App() {
  // --- STATE MANAGEMENT (With TypeScript types) ---
  const [uploadedImage, setUploadedImage] = useState<UploadedFile | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [fen, setFen] = useState<string>('');
  const [orientation, setOrientation] = useState<Orientation>('white');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // --- API CALL FUNCTION (With typed parameters) ---
  const handleAnalyze = async (imageFile: File) => {
    setIsLoading(true);
    setError('');
    setCroppedImage(null);
    setFen('');

    const formData = new FormData();
    formData.append('image', imageFile);

    try {
      // Tell axios what type of response to expect
      const response = await axios.post<ApiResponse>(API_URL, formData, {
        timeout: 60000,
      });

      console.log('Received response:', response.data);

      if (response.data && response.data.status === 'success') {
        const { fen: receivedFen, cropped_image: croppedImageUrl } = response.data.data;
        let finalFen = receivedFen;
        if (!finalFen.includes(' ')) {
          console.warn('Backend sent an incomplete FEN. Appending default values for testing.');
          finalFen += ' w KQkq - 0 1';
        }
        // ----------------------------

        try {
          // Use the potentially fixed FEN string here
          new Chess(finalFen); 
          setFen(finalFen);
        } catch (validationError) {
          setError('API returned an invalid FEN string.');
          console.error('FEN Validation Error:', validationError);
        }
        
        setCroppedImage(croppedImageUrl);
      } else {
        setError(response.data.message || 'An unknown error occurred.');
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
      console.error('Analyze request failed:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // --- IMAGE UPLOAD HANDLER (With typed files) ---
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const validationError = getFileValidationError(file);
      if (validationError) {
        setError(validationError);
        return;
      }

      const fileWithPreview = Object.assign(file, {
        preview: URL.createObjectURL(file),
      });
      setUploadedImage(fileWithPreview);
      handleAnalyze(file);
    }
  }, []);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    const firstRejection = fileRejections[0];
    const firstError = firstRejection?.errors[0];

    if (!firstError) {
      setError('Could not upload that file.');
      return;
    }

    if (firstError.code === 'file-invalid-type') {
      setError('Unsupported image format. Please upload a JPG or PNG image.');
      return;
    }

    if (firstError.code === 'file-too-large') {
      setError(`Image is too large. Please use a file smaller than ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}.`);
      return;
    }

    setError(firstError.message);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_UPLOAD_SIZE_BYTES,
    multiple: false,
  });

  // --- PASTE EVENT HANDLER ---
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      // Look at the items on the clipboard
      const items = event.clipboardData?.items;
      if (!items) return;

      // Loop through clipboard items to find an image
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const validationError = getFileValidationError(file);
            if (validationError) {
              setError(validationError);
              break;
            }

            // Create the preview URL just like we do in onDrop
            const fileWithPreview = Object.assign(file, {
              preview: URL.createObjectURL(file),
            }) as UploadedFile;
            
            setUploadedImage(fileWithPreview);
            handleAnalyze(file);
            break; // Stop after finding the first image
          }
        }
      }
    };

    // Attach the event listener to the whole window
    window.addEventListener('paste', handlePaste);

    // Cleanup the event listener when the component unmounts
    return () => {
      window.removeEventListener('paste', handlePaste);
    };
  }, []);

  const [copied, setCopied] = useState<boolean>(false);

  // --- NEW: Copy to Clipboard Function ---
  const handleCopy = () => {
    if (!fen) return;
    navigator.clipboard.writeText(fen);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000); // Reset after 2 seconds
  };

  const toggleOrientation = () => {
    setOrientation(prev => (prev === 'white' ? 'black' : 'white'));
  };

// --- GENERATE EXTERNAL LINKS ---
// Replace spaces with %20, but leave slashes alone as requested
const encodedFen = fen.replace(/ /g, '%20');
const lichessUrl = `https://lichess.org/analysis/${encodedFen}`;
const chesscomUrl = `https://www.chess.com/analysis?fen=${encodedFen}`;

return (
    <div className="container">
      {/* --- TOP SECTION (Header & Upload) --- */}
      <div className="top-section">
        <h1>Chess Atlas</h1>
        <div {...getRootProps()} className="dropzone">
          <input {...getInputProps()} />
          {isDragActive ? (
            <p>Drop the image here ...</p>
          ) : (
            <p>Drag 'n' drop an image here, press Ctrl+V to paste, or click to select</p>
          )}
        </div>
        
        {isLoading && <div className="loading">Analyzing...</div>}
        {error && <div className="error">{error}</div>}
      </div>

      {/* --- BOTTOM SECTION (3 Columns) --- */}
      {/* Only show this grid if an image is uploaded or FEN exists */}
      {(uploadedImage || fen) && (
        <div className="results-grid">
          
          {/* Column 1: Original Upload */}
          <div className="column">
            <h3>Your Upload</h3>
            {uploadedImage ? (
              <img 
                src={uploadedImage.preview} 
                alt="Uploaded chessboard" 
                className="image-preview" 
                onLoad={() => URL.revokeObjectURL(uploadedImage.preview)} 
              />
            ) : (
              <p className="placeholder">Waiting for image...</p>
            )}
          </div>

          {/* Column 2: Cropped API Result */}
          <div className="column">
            <h3>Analysis Result</h3>
            {croppedImage ? (
              <img 
                src={croppedImage} 
                alt="Cropped chessboard from API" 
                className="image-preview" 
              />
            ) : isLoading ? (
              <p className="placeholder">Processing...</p>
            ) : (
              <p className="placeholder">No result yet.</p>
            )}
          </div>

          {/* Column 3: Detected Chessground Position */}
          <div className="column">
            <h2>Detected Position</h2>
            {fen ? (
              <div className="board-column-content">
                <div className="board-wrapper">
                  <Chessground
                    config={{
                      fen: fen,
                      orientation: orientation,
                      viewOnly: true,
                    }}
                  />
                </div>
                <div className="fen-container">
                  <input type="text" readOnly value={fen} className="fen-input" />
                  
                  {/* NEW: Copy Button with SVGs */}
                  <button onClick={handleCopy} className="icon-button" title="Copy FEN">
                    {copied ? (
                      // Checkmark Icon
                      <svg viewBox="0 0 24 24" fill="none" stroke="green" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    ) : (
                      // Copy Clipboard Icon
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                      </svg>
                    )}
                  </button>

                  <button onClick={toggleOrientation} className="button">Flip Board</button>
                </div>
                <div className="analysis-buttons">
                  <a href={lichessUrl} target="_blank" rel="noopener noreferrer" className="link-button lichess">
                    Lichess
                  </a>
                  <a href={chesscomUrl} target="_blank" rel="noopener noreferrer" className="link-button chesscom">
                    Chess.com
                  </a>
                </div>
              </div>
            ) : (
              <p className="placeholder">Awaiting analysis...</p>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

export default App;
