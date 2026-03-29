import { useState, useCallback, useMemo, useEffect, useRef, useTransition } from 'react';
import { Chess } from 'chess.js';
import Chessground from '@react-chess/chessground';
import type { Key } from 'chessground/types';
import axios from 'axios';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';

const LOOKUP_API_URL =
  import.meta.env.VITE_LOOKUP_API_URL ?? 'https://api.chess-atlas.com/api/v1/lookup-position';

const TIMESTAMP_OFFSET_SECONDS = 1;
const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PAGE_SIZE = 100;

interface VideoResult {
  video_id: string;
  timestamp_seconds: number;
  orientation: 'white' | 'black';
}

interface HistoryEntry {
  fen: string;
  lastMove?: [Key, Key];
  san?: string;
}

/** Keep the earliest timestamp per video; drop any within 3 s of a kept one. */
function deduplicateResults(results: VideoResult[]): VideoResult[] {
  const grouped = new Map<string, number[]>();
  for (const r of results) {
    if (!grouped.has(r.video_id)) grouped.set(r.video_id, []);
    grouped.get(r.video_id)!.push(r.timestamp_seconds);
  }
  const keepMap = new Map<string, Set<number>>();
  for (const [vid, timestamps] of grouped) {
    const sorted = [...timestamps].sort((a, b) => a - b);
    const kept = new Set<number>();
    let last = -Infinity;
    for (const ts of sorted) {
      if (ts - last > 3) { kept.add(ts); last = ts; }
    }
    keepMap.set(vid, kept);
  }
  return results.filter(r => keepMap.get(r.video_id)?.has(r.timestamp_seconds));
}

function getLegalMoves(fen: string): Map<Key, Key[]> {
  const chess = new Chess(fen);
  const dests = new Map<Key, Key[]>();
  for (const move of chess.moves({ verbose: true })) {
    const from = move.from as Key;
    const to = move.to as Key;
    if (!dests.has(from)) dests.set(from, []);
    dests.get(from)!.push(to);
  }
  return dests;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ExplorerPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([{ fen: INITIAL_FEN }]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [boardOrientation, setBoardOrientation] = useState<'white' | 'black'>('white');
  const [videoResults, setVideoResults] = useState<VideoResult[]>([]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedVideo, setSelectedVideo] = useState<VideoResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [, startTransition] = useTransition();
  const [videoTitles, setVideoTitles] = useState<Map<string, string>>(new Map());
  const playlistRef = useRef<HTMLDivElement>(null);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  // Incremented on every fetch; lets us discard stale responses from previous positions
  const fetchSeqRef = useRef(0);
  // Persists fetched titles across position changes so we don't re-fetch
  const titleCacheRef = useRef<Map<string, string>>(new Map());

  const currentEntry = history[historyIndex];
  const currentFen = currentEntry.fen;
  const turn = useMemo(() => new Chess(currentFen).turn(), [currentFen]);
  const legalMoves = useMemo(() => getLegalMoves(currentFen), [currentFen]);

  const fetchVideos = useCallback(async (fen: string) => {
    const seq = ++fetchSeqRef.current;
    setIsSearching(true);
    setVideoResults([]);
    setVisibleCount(PAGE_SIZE);
    setSelectedVideo(null);
    try {
      const response = await axios.get<{ status: string; data: VideoResult[] }>(
        LOOKUP_API_URL,
        { params: { fen }, timeout: 10000 },
      );
      if (seq !== fetchSeqRef.current) return; // stale — a newer request is in flight
      if (response.data.status === 'success') {
        const results = deduplicateResults(response.data.data);
        startTransition(() => { setVideoResults(results); });
      }
    } catch (err) {
      if (seq !== fetchSeqRef.current) return;
      console.error('Position lookup failed:', err);
    } finally {
      if (seq === fetchSeqRef.current) setIsSearching(false);
    }
  }, [startTransition]);

  useEffect(() => {
    void fetchVideos(INITIAL_FEN);
  }, [fetchVideos]);

  // Fetch YouTube titles for any video IDs not yet in cache
  useEffect(() => {
    if (videoResults.length === 0) return;
    const uncachedIds = [...new Set(videoResults.map(v => v.video_id))].filter(
      id => !titleCacheRef.current.has(id),
    );
    if (uncachedIds.length === 0) {
      setVideoTitles(new Map(titleCacheRef.current));
      return;
    }
    void Promise.allSettled(
      uncachedIds.map(id =>
        fetch(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
        )
          .then(r => r.json() as Promise<{ title: string }>)
          .then(data => { titleCacheRef.current.set(id, data.title); }),
      ),
    ).then(() => { setVideoTitles(new Map(titleCacheRef.current)); });
  }, [videoResults]);

  // Scroll playlist to top when results change
  useEffect(() => {
    if (playlistRef.current) playlistRef.current.scrollTop = 0;
  }, [videoResults]);

  // Clear chessground's cached board bounds whenever the layout may shift
  // (move-history growing changes board-panel height without a scroll/resize event,
  //  which would otherwise leave chessground with a stale bounding rect)
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [history.length]);

  // Scroll the opened card to the top of the playlist
  useEffect(() => {
    if (!selectedVideo || !playlistRef.current) return;
    const openCard = playlistRef.current.querySelector('.video-card.is-open') as HTMLElement | null;
    if (!openCard) return;
    const cardTop = openCard.getBoundingClientRect().top;
    const containerTop = playlistRef.current.getBoundingClientRect().top;
    playlistRef.current.scrollBy({ top: cardTop - containerTop, behavior: 'smooth' });
  }, [selectedVideo]);

  const handleAfterMove = useCallback(
    (orig: string, dest: string) => {
      const chess = new Chess(currentFen);
      const moveResult = chess.move({ from: orig, to: dest, promotion: 'q' });
      if (!moveResult) return;

      const newFen = chess.fen();
      const newEntry: HistoryEntry = { fen: newFen, lastMove: [orig as Key, dest as Key], san: moveResult.san };
      const newHistory = [...history.slice(0, historyIndex + 1), newEntry];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      void fetchVideos(newFen);
    },
    [currentFen, history, historyIndex, fetchVideos],
  );

  const navigateTo = useCallback(
    (index: number) => {
      setHistoryIndex(index);
      void fetchVideos(history[index].fen);
    },
    [history, fetchVideos],
  );

  const handleReset = () => {
    setHistory([{ fen: INITIAL_FEN }]);
    setHistoryIndex(0);
    void fetchVideos(INITIAL_FEN);
  };

  const chessgroundConfig = useMemo(
    () => ({
      fen: currentFen,
      orientation: boardOrientation,
      turnColor: turn === 'w' ? ('white' as const) : ('black' as const),
      lastMove: currentEntry.lastMove,
      movable: {
        free: false,
        color: 'both' as const,
        dests: legalMoves,
        showDests: true,
        events: { after: handleAfterMove },
      },
      premovable: { enabled: false },
      highlight: { lastMove: true, check: true },
    }),
    [currentFen, boardOrientation, turn, currentEntry.lastMove, legalMoves, handleAfterMove],
  );

  // Build move pairs for display (1. e4 e5, 2. Nf3 ...)
  const movePairs: Array<{
    number: number;
    white: HistoryEntry | undefined;
    whiteIndex: number;
    black: HistoryEntry | undefined;
    blackIndex: number;
  }> = [];
  for (let i = 1; i < history.length; i += 2) {
    movePairs.push({
      number: Math.ceil(i / 2),
      white: history[i],
      whiteIndex: i,
      black: history[i + 1],
      blackIndex: i + 1,
    });
  }

  return (
    <div className="explorer-container">
      <div className="explorer-main">
        {/* Left: board + controls */}
        <div className="explorer-board-panel">
          <div className="explorer-board-wrapper">
            <Chessground config={chessgroundConfig} />
          </div>

          <div className="explorer-controls">
            <button type="button" className="button ctrl-btn" onClick={() => navigateTo(0)} disabled={historyIndex === 0} title="Start">&#124;&lt;</button>
            <button type="button" className="button ctrl-btn" onClick={() => navigateTo(historyIndex - 1)} disabled={historyIndex === 0} title="Previous">&lt;</button>
            <button type="button" className="button ctrl-btn" onClick={() => navigateTo(historyIndex + 1)} disabled={historyIndex === history.length - 1} title="Next">&gt;</button>
            <button type="button" className="button ctrl-btn" onClick={() => navigateTo(history.length - 1)} disabled={historyIndex === history.length - 1} title="End">&gt;&#124;</button>
            <button type="button" className="button ctrl-btn reset-btn" onClick={handleReset} title="Reset to start">Reset</button>
          </div>

          <div className="explorer-orientation">
            <button
              type="button"
              className={`button orientation-button${boardOrientation === 'white' ? ' is-active' : ''}`}
              onClick={() => setBoardOrientation('white')}
            >White</button>
            <button
              type="button"
              className={`button orientation-button${boardOrientation === 'black' ? ' is-active' : ''}`}
              onClick={() => setBoardOrientation('black')}
            >Black</button>
          </div>

          <div className="move-history">
            {history.length === 1 && (
              <span className="placeholder-moves">Make a move to start...</span>
            )}
            {movePairs.map(pair => (
              <span key={pair.number} className="move-pair">
                <span className="move-number">{pair.number}.</span>
                {pair.white && (
                  <button
                    type="button"
                    className={`move-san${historyIndex === pair.whiteIndex ? ' is-active' : ''}`}
                    onClick={() => navigateTo(pair.whiteIndex)}
                  >
                    {pair.white.san}
                  </button>
                )}
                {pair.black && (
                  <button
                    type="button"
                    className={`move-san${historyIndex === pair.blackIndex ? ' is-active' : ''}`}
                    onClick={() => navigateTo(pair.blackIndex)}
                  >
                    {pair.black.san}
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Result count + mobile playlist toggle */}
        <p className="playlist-count">
          {!isSearching && videoResults.length > 0
            ? `${videoResults.length} result${videoResults.length !== 1 ? 's' : ''}`
            : '\u00A0'}
        </p>
        <button
          type="button"
          className="playlist-toggle-btn"
          onClick={() => setPlaylistOpen(o => !o)}
        >
          {playlistOpen ? 'Hide Playlist' : 'Show Playlist'}
        </button>

        {/* Right / bottom: video playlist with inline embeds */}
        <div className={`explorer-video-panel${playlistOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            className="playlist-close-btn"
            onClick={() => setPlaylistOpen(false)}
          >&times;</button>
          <div className="video-playlist" ref={playlistRef}>
            {isSearching && <p className="playlist-status">Searching...</p>}
            {!isSearching && videoResults.length === 0 && (
              <p className="playlist-status">No videos found for this position.</p>
            )}
            {videoResults.slice(0, visibleCount).map((video, i) => {
              const isOpen =
                selectedVideo?.video_id === video.video_id &&
                selectedVideo?.timestamp_seconds === video.timestamp_seconds;
              const start = Math.max(0, video.timestamp_seconds - TIMESTAMP_OFFSET_SECONDS);
              return (
                <div
                  key={`${video.video_id}-${video.timestamp_seconds}-${i}`}
                  className={`video-card${isOpen ? ' is-open' : ''}`}
                >
                  <button
                    type="button"
                    className="video-card-header"
                    onClick={() => setSelectedVideo(isOpen ? null : video)}
                  >
                    <img
                      src={`https://img.youtube.com/vi/${video.video_id}/mqdefault.jpg`}
                      alt="Video thumbnail"
                      className="video-thumbnail"
                      loading="lazy"
                    />
                    <div className="video-card-info">
                      {videoTitles.get(video.video_id) && (
                        <span className="video-card-title">{videoTitles.get(video.video_id)}</span>
                      )}
                      <div className="video-card-meta">
                        <span className="video-timestamp">{formatTimestamp(video.timestamp_seconds)}</span>
                        <span className={`video-orientation-badge ${video.orientation}`}>
                          {video.orientation}
                        </span>
                      </div>
                    </div>
                    <span className="video-card-chevron">{isOpen ? '▲' : '▼'}</span>
                  </button>
                  {isOpen && (
                    <div className="video-card-embed">
                      <iframe
                        src={`https://www.youtube.com/embed/${video.video_id}?start=${start}&autoplay=1`}
                        title="Chess video"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {!isSearching && videoResults.length > visibleCount && (
              <button
                type="button"
                className="button load-more-btn"
                onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
              >
                Load more ({videoResults.length - visibleCount} remaining)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExplorerPage;
