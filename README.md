# Chess Atlas — Frontend

The web interface for Chess Atlas, a tool that converts a photo of a physical chessboard into a FEN string for analysis.

Upload or paste a photo, get the detected board position, then open it directly in Lichess or Chess.com.

---

## How It Works

1. You provide a chessboard image (drag-and-drop, click, paste, or sample)
2. The image is sent to the [Chess Atlas API](https://github.com/JamesMitchell-Dev/ChessAtlasBackend)
3. The API runs two models: a YOLOv8 detector to crop the board, then a MobileNetV3 classifier to identify each of the 64 squares
4. The FEN string and cropped board image are returned and displayed
5. You can adjust the side to move, flip the board, copy the FEN, or open in Lichess / Chess.com

---

## Features

- **Flexible input** — drag-and-drop, click to browse, Ctrl+V to paste, or click a sample thumbnail
- **Sample images** — three quick-demo thumbnails for instant testing without uploading
- **Live board preview** — interactive chessboard rendered from the returned FEN via Chessground
- **Orientation control** — White / Black toggle re-submits the image to the API with the correct perspective, since piece classification depends on board orientation
- **Side to move** — manually set whether it's White or Black to move in the FEN (affects Lichess/Chess.com analysis)
- **Flip board** — independently flip the visual board display
- **Copy FEN** — one-click clipboard copy
- **Analysis links** — direct links to Lichess and Chess.com analysis using the detected FEN

---

## Getting Started

### Prerequisites

- Node.js 18+
- The [Chess Atlas API](https://github.com/JamesMitchell-Dev/ChessAtlasBackend) running locally or deployed

### Install and run

```bash
cd chess-atlas-frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### Configuration

By default the app points to `https://api.chess-atlas.com/api/v1/analyze-board`.

To use a different API (e.g. a local backend), create a `.env.local` file:

```env
VITE_API_URL=http://localhost:5000/api/v1/analyze-board
```

### Adding sample images

Place up to three chessboard images in `chess-atlas-frontend/public/samples/`:

```
public/
  samples/
    sample1.png
    sample2.png
    sample3.png
```

These appear as clickable thumbnails below the drop zone.

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |

---

## Tech Stack

| | |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite |
| Chess board | `@react-chess/chessground` |
| Chess logic | `chess.js` (FEN validation) |
| HTTP client | `axios` |
| File input | `react-dropzone` |

---

## Related Repositories

| Repo | Description |
|---|---|
| [ChessAtlasBackend](https://github.com/JamesVong/ChessAtlasBackend) | Flask API — board detection and piece classification pipeline |
| [ChessCVModel](https://github.com/JamesVong/ChessCVModel) | MobileNetV3 training notebooks — 13-class piece classifier (99.96% F1) |
