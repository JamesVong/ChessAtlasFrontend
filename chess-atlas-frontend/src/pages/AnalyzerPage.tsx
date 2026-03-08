import { useState, useCallback, useEffect, type MouseEvent } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import axios from 'axios';
import { Chess } from 'chess.js';
import Chessground from '@react-chess/chessground';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

type Orientation = 'white' | 'black';

interface ApiData {
  fen: string;
  cropped_image: string;
}

interface ApiResponse {
  status: 'success' | 'error';
  data: ApiData;
  message?: string;
}

interface UploadedFile extends File {
  preview: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? 'https://api.chess-atlas.com/api/v1/analyze-board';
const MAX_UPLOAD_SIZE_BYTES = 12 * 1024 * 1024;
const SAMPLE_IMAGES = [
  '/samples/sample1.png',
  '/samples/sample2.png',
  '/samples/sample3.png',
];
const ACCEPTED_IMAGE_TYPES = {
  'image/jpeg': ['.jpeg', '.jpg'],
  'image/png': ['.png'],
};
const EMPTY_BOARD_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';

const toApiOrientation = (value: Orientation): 'White' | 'Black' =>
  value === 'white' ? 'White' : 'Black';

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
  if (!axios.isAxiosError(err)) return 'Upload failed. Please try again.';
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
  if (err.code === 'ECONNABORTED') return 'Upload timed out. Please try a smaller image or check your connection.';
  if (err.code === 'ERR_NETWORK') {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'this site';
    return `Network error contacting the API from ${origin}. If you are testing from mobile on local dev, this is often a CORS/origin issue.`;
  }
  return err.message || 'Upload failed. Please try again.';
};

function AnalyzerPage() {
  const [uploadedImage, setUploadedImage] = useState<UploadedFile | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [fen, setFen] = useState<string>('');
  const [analysisOrientation, setAnalysisOrientation] = useState<Orientation>('white');
  const [boardOrientation, setBoardOrientation] = useState<Orientation>('white');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const handleAnalyze = useCallback(async (imageFile: File, requestedOrientation: Orientation) => {
    setIsLoading(true);
    setError('');
    setCroppedImage(null);
    setFen('');

    const formData = new FormData();
    formData.append('image', imageFile);
    formData.append('orientation', toApiOrientation(requestedOrientation));

    try {
      const response = await axios.post<ApiResponse>(API_URL, formData, { timeout: 60000 });

      if (response.data && response.data.status === 'success') {
        const { fen: receivedFen, cropped_image: croppedImageUrl } = response.data.data;
        let finalFen = receivedFen;
        if (!finalFen.includes(' ')) {
          finalFen += ' w KQkq - 0 1';
        }
        try {
          new Chess(finalFen);
          setFen(finalFen);
        } catch {
          setError('API returned an invalid FEN string.');
        }
        setCroppedImage(croppedImageUrl);
      } else {
        setError(response.data.message || 'An unknown error occurred.');
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const validationError = getFileValidationError(file);
      if (validationError) { setError(validationError); return; }
      const fileWithPreview = Object.assign(file, { preview: URL.createObjectURL(file) });
      setUploadedImage(fileWithPreview);
      void handleAnalyze(file, analysisOrientation);
    }
  }, [analysisOrientation, handleAnalyze]);

  const onDropRejected = useCallback((fileRejections: FileRejection[]) => {
    const firstError = fileRejections[0]?.errors[0];
    if (!firstError) { setError('Could not upload that file.'); return; }
    if (firstError.code === 'file-invalid-type') { setError('Unsupported image format. Please upload a JPG or PNG image.'); return; }
    if (firstError.code === 'file-too-large') { setError(`Image is too large. Please use a file smaller than ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}.`); return; }
    setError(firstError.message);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_IMAGE_TYPES,
    maxSize: MAX_UPLOAD_SIZE_BYTES,
    multiple: false,
  });

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            const validationError = getFileValidationError(file);
            if (validationError) { setError(validationError); break; }
            const fileWithPreview = Object.assign(file, { preview: URL.createObjectURL(file) }) as UploadedFile;
            setUploadedImage(fileWithPreview);
            void handleAnalyze(file, analysisOrientation);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [analysisOrientation, handleAnalyze]);

  const [copied, setCopied] = useState<boolean>(false);
  const handleCopy = () => {
    if (!fen) return;
    navigator.clipboard.writeText(fen);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSampleClick = useCallback(async (samplePath: string) => {
    try {
      const response = await fetch(samplePath);
      const blob = await response.blob();
      const filename = samplePath.split('/').pop() ?? 'sample.jpg';
      const file = new File([blob], filename, { type: blob.type });
      const validationError = getFileValidationError(file);
      if (validationError) { setError(validationError); return; }
      const fileWithPreview = Object.assign(file, { preview: URL.createObjectURL(file) }) as UploadedFile;
      setUploadedImage(fileWithPreview);
      void handleAnalyze(file, analysisOrientation);
    } catch {
      setError('Failed to load sample image.');
    }
  }, [analysisOrientation, handleAnalyze]);

  const requestAnalysisForOrientation = (nextOrientation: Orientation) => {
    if (!uploadedImage) return;
    void handleAnalyze(uploadedImage, nextOrientation);
  };

  const handleOrientationSelection = (nextOrientation: Orientation) => {
    setBoardOrientation(nextOrientation);
    if (nextOrientation === analysisOrientation) return;
    setAnalysisOrientation(nextOrientation);
    requestAnalysisForOrientation(nextOrientation);
  };

  const toggleOrientation = () => setBoardOrientation(prev => prev === 'white' ? 'black' : 'white');

  const sideToMove = fen ? (fen.split(' ')[1] as 'w' | 'b') : null;

  const handleSideToMoveChange = (side: 'w' | 'b') => {
    setFen(prev => {
      if (!prev) return prev;
      const parts = prev.split(' ');
      parts[1] = side;
      return parts.join(' ');
    });
  };

  const castlingRights = fen ? (fen.split(' ')[2] ?? '-') : null;

  const handleCastlingToggle = (right: 'K' | 'Q' | 'k' | 'q') => {
    setFen(prev => {
      if (!prev) return prev;
      const parts = prev.split(' ');
      const current = parts[2] ?? '-';
      const active = current === '-' ? '' : current;
      const next = active.includes(right) ? active.replace(right, '') : active + right;
      parts[2] = (['K', 'Q', 'k', 'q'] as const).filter(r => next.includes(r)).join('') || '-';
      return parts.join(' ');
    });
  };

  const handleAnalysisLinkClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!fen) event.preventDefault();
  };

  const encodedFen = fen ? fen.replace(/ /g, '%20') : '';
  const lichessUrl = encodedFen ? `https://lichess.org/analysis/${encodedFen}` : 'https://lichess.org/analysis';
  const chesscomUrl = encodedFen ? `https://www.chess.com/analysis?fen=${encodedFen}` : 'https://www.chess.com/analysis';
  const boardFen = fen || EMPTY_BOARD_FEN;

  return (
    <div className="container">
      <div className="top-section">
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

        <div className="sample-thumbnails">
          {SAMPLE_IMAGES.map((src, i) => (
            <button
              key={src}
              type="button"
              className="sample-thumbnail"
              onClick={() => void handleSampleClick(src)}
              disabled={isLoading}
              title={`Try sample ${i + 1}`}
            >
              <img src={src} alt={`Sample ${i + 1}`} />
            </button>
          ))}
        </div>
      </div>

      <div className="results-grid">
        <div className="column">
          <h3>Your Upload</h3>
          <div className="preview-frame">
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
        </div>

        <div className="column">
          <h3>Cropped Image</h3>
          <div className="preview-frame">
            {croppedImage ? (
              <img src={croppedImage} alt="Cropped chessboard from API" className="image-preview" />
            ) : isLoading ? (
              <p className="placeholder">Processing...</p>
            ) : (
              <p className="placeholder">No result yet.</p>
            )}
          </div>
          <div className="orientation-controls">
            <button
              type="button"
              className={`button orientation-button ${analysisOrientation === 'white' ? 'is-active' : ''}`}
              onClick={() => handleOrientationSelection('white')}
              aria-pressed={analysisOrientation === 'white'}
            >White</button>
            <button
              type="button"
              className={`button orientation-button ${analysisOrientation === 'black' ? 'is-active' : ''}`}
              onClick={() => handleOrientationSelection('black')}
              aria-pressed={analysisOrientation === 'black'}
            >Black</button>
          </div>
        </div>

        <div className="column">
          <h3>Detected Position</h3>
          <div className="board-column-content">
            <div className="board-wrapper">
              <Chessground config={{ fen: boardFen, orientation: boardOrientation, viewOnly: true }} />
            </div>
            <div className="fen-container">
              <input type="text" readOnly value={fen} placeholder="FEN will appear here after analysis" className="fen-input" />
              <button onClick={handleCopy} className="icon-button" title="Copy FEN" disabled={!fen} type="button">
                {copied ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="green" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                )}
              </button>
              <button onClick={toggleOrientation} className="button" type="button">Flip Board</button>
            </div>
            <div className="analysis-buttons">
              <a href={lichessUrl} target="_blank" rel="noopener noreferrer"
                className={`link-button lichess ${!fen ? 'is-disabled' : ''}`}
                onClick={handleAnalysisLinkClick} aria-disabled={!fen}>Lichess</a>
              <a href={chesscomUrl} target="_blank" rel="noopener noreferrer"
                className={`link-button chesscom ${!fen ? 'is-disabled' : ''}`}
                onClick={handleAnalysisLinkClick} aria-disabled={!fen}>Chess.com</a>
            </div>
            <div className="fen-settings">
              <span className="fen-settings-label">Side to move</span>
              <div className="fen-settings-switches">
                <button type="button" className={`switch-button ${sideToMove === 'w' ? 'is-active' : ''}`}
                  onClick={() => handleSideToMoveChange('w')} disabled={!fen}>White</button>
                <button type="button" className={`switch-button ${sideToMove === 'b' ? 'is-active' : ''}`}
                  onClick={() => handleSideToMoveChange('b')} disabled={!fen}>Black</button>
              </div>
            </div>
            <div className="fen-settings castling-settings">
              <span className="fen-settings-label">Castling</span>
              <div className="castling-groups">
                <div className="castling-group">
                  <span className="castling-group-label">W</span>
                  <button type="button" className={`switch-button ${castlingRights?.includes('K') ? 'is-active' : ''}`}
                    onClick={() => handleCastlingToggle('K')} disabled={!fen} title="White kingside (O-O)">O-O</button>
                  <button type="button" className={`switch-button ${castlingRights?.includes('Q') ? 'is-active' : ''}`}
                    onClick={() => handleCastlingToggle('Q')} disabled={!fen} title="White queenside (O-O-O)">O-O-O</button>
                </div>
                <div className="castling-group">
                  <span className="castling-group-label">B</span>
                  <button type="button" className={`switch-button ${castlingRights?.includes('k') ? 'is-active' : ''}`}
                    onClick={() => handleCastlingToggle('k')} disabled={!fen} title="Black kingside (O-O)">O-O</button>
                  <button type="button" className={`switch-button ${castlingRights?.includes('q') ? 'is-active' : ''}`}
                    onClick={() => handleCastlingToggle('q')} disabled={!fen} title="Black queenside (O-O-O)">O-O-O</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AnalyzerPage;
