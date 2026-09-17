/**
 * YouTubeConnectCard — Admin dashboard component.
 *
 * Shows three states:
 *   1. "Checking…"           — on mount, while calling /api/youtube/status
 *   2. "YouTube not connected" — shows "Connect YouTube" button
 *   3. "YouTube Ready"        — shows channel name, thumbnail, green badge
 *
 * This is a CLIENT component (uses hooks). All API calls go to server
 * routes — no Google credentials are ever exposed to the browser.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

interface ChannelInfo {
  id: string;
  title: string;
  thumbnail: string;
}

interface YouTubeStatus {
  connected: boolean;
  status: string;
  message: string;
  channel: ChannelInfo | null;
}

export default function YouTubeConnectCard() {
  const [state, setState] = useState<'loading' | 'disconnected' | 'connected' | 'error'>('loading');
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const checkStatus = useCallback(async () => {
    setState('loading');
    try {
      const res = await fetch('/api/youtube/status', { credentials: 'same-origin' });
      const data: YouTubeStatus = await res.json();
      setStatus(data);
      if (data.connected) {
        setState('connected');
      } else {
        setState('disconnected');
      }
    } catch (err) {
      setErrorMsg((err as Error).message);
      setState('error');
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return (
    <div className="yt-card">
      <div className="yt-card-header">
        <div className="yt-card-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z" />
            <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <h2 className="yt-card-title">YouTube Integration</h2>
      </div>

      {/* Loading state */}
      {state === 'loading' && (
        <div className="yt-card-body">
          <div className="yt-status-row">
            <span className="yt-badge yt-badge-checking">
              <span className="yt-pulse" />
              Checking…
            </span>
          </div>
          <p className="yt-card-desc">Validating YouTube connection and channel access…</p>
        </div>
      )}

      {/* Connected state */}
      {state === 'connected' && status?.channel && (
        <div className="yt-card-body">
          <div className="yt-status-row">
            <span className="yt-badge yt-badge-ready">
              <span className="yt-dot yt-dot-green" />
              YouTube Ready
            </span>
          </div>
          <div className="yt-channel">
            {status.channel.thumbnail && (
              <img
                className="yt-channel-thumb"
                src={status.channel.thumbnail}
                alt={status.channel.title}
              />
            )}
            <div className="yt-channel-info">
              <span className="yt-channel-name">{status.channel.title}</span>
              <span className="yt-channel-id">{status.channel.id}</span>
            </div>
          </div>
          <p className="yt-card-desc">{status.message}</p>
          <button className="yt-btn yt-btn-secondary" onClick={checkStatus}>
            Refresh Status
          </button>
        </div>
      )}

      {/* Disconnected state */}
      {state === 'disconnected' && (
        <div className="yt-card-body">
          <div className="yt-status-row">
            <span className="yt-badge yt-badge-disconnected">
              <span className="yt-dot yt-dot-amber" />
              YouTube Not Connected
            </span>
          </div>
          <p className="yt-card-desc">
            {status?.message || 'Connect your YouTube channel to enable video uploads.'}
          </p>
          <div className="yt-card-actions">
            <a href="/api/youtube/auth" className="yt-btn yt-btn-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Connect YouTube
            </a>
            <button className="yt-btn yt-btn-secondary" onClick={checkStatus}>
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {state === 'error' && (
        <div className="yt-card-body">
          <div className="yt-status-row">
            <span className="yt-badge yt-badge-error">
              <span className="yt-dot yt-dot-red" />
              Connection Error
            </span>
          </div>
          <p className="yt-card-desc yt-card-error">
            {errorMsg || 'Could not check YouTube status.'}
          </p>
          <button className="yt-btn yt-btn-secondary" onClick={checkStatus}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
