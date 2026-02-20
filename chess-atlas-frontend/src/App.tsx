import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
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
      const API_URL = 'https://api.chess-atlas.com/api/v1/analyze-board';
      // Tell axios what type of response to expect
      const response = await axios.post<ApiResponse>(API_URL, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
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
      setError('Failed to connect to the backend. Please check if the server is running.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  // --- IMAGE UPLOAD HANDLER (With typed files) ---
  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      const file = acceptedFiles[0];
      const fileWithPreview = Object.assign(file, {
        preview: URL.createObjectURL(file),
      });
      setUploadedImage(fileWithPreview);
      handleAnalyze(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png'] },
    multiple: false,
  });

  const toggleOrientation = () => {
    setOrientation(prev => (prev === 'white' ? 'black' : 'white'));
  };

  return (
    // Use className instead of style
    <div className="container">
      {/* --- LEFT PANEL --- */}
      <div className="left-panel">
        <h1>Chess Atlas</h1>
        <div {...getRootProps()} className="dropzone">
          <input {...getInputProps()} />
          {isDragActive ? <p>Drop the image here ...</p> : <p>Drag 'n' drop an image here, paste, or click to select</p>}
        </div>
        
        {isLoading && <div className="loading">Analyzing...</div>}
        {error && <div className="error">{error}</div>}

        {uploadedImage && !isLoading && !error && (
          <div>
            <h3>Your Upload:</h3>
            <img src={uploadedImage.preview} alt="Uploaded chessboard" className="image-preview" onLoad={() => URL.revokeObjectURL(uploadedImage.preview)} />
          </div>
        )}
        
        {croppedImage && !isLoading && !error && (
            <div>
                <h3>Analysis Result (Cropped):</h3>
                <img src={croppedImage} alt="Cropped chessboard from API" className="image-preview" />
            </div>
        )}
      </div>

      {/* --- RIGHT PANEL --- */}
      <div className="right-panel">
        <h2>Detected Position</h2>
        {fen ? (
          <>
            <div style={{ width: '100%', height: 'auto' }}>
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
              <button onClick={toggleOrientation} className="button">Flip Board</button>
            </div>
          </>
        ) : (
          <p>Upload an image to see the board position here.</p>
        )}
      </div>
    </div>
  );
}

export default App;