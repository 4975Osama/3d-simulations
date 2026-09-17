/**
 * Dashboard page — Admin interface for the YouTube integration.
 *
 * Features:
 *   - Admin login form (if not logged in)
 *   - YouTube connection status card
 *   - Video upload form per category
 *   - Video grid listing existing uploads
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import YouTubeConnectCard from '@/components/dashboard/YouTubeConnectCard';

interface VideoItem {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  privacy: string;
}

interface SessionState {
  admin: boolean;
  loginEnabled: boolean;
  youtubeConfigured: boolean;
}

const CATEGORIES: Record<string, { title: string; sub: string; gradient: string }> = {
  simex: {
    title: 'Simex Emergency Videos',
    sub: 'Emergency response simulation exercises',
    gradient: 'linear-gradient(135deg, #f43f5e, #dc2626)',
  },
  calendars: {
    title: 'Hazard Calendars',
    sub: 'Seasonal hazard prediction & preparedness timelines',
    gradient: 'linear-gradient(135deg, #f59e0b, #d946ef)',
  },
  general: {
    title: 'General Safety Videos',
    sub: 'Disaster preparedness & safety guides',
    gradient: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
  },
};

export default function DashboardPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [videos, setVideos] = useState<Record<string, VideoItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  // Upload modal state
  const [uploadCategory, setUploadCategory] = useState<string | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // Player modal state
  const [playingVideo, setPlayingVideo] = useState<{ id: string; title: string } | null>(null);

  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session', { credentials: 'same-origin' });
      const data = await res.json();
      setSession(data);
    } catch {
      setSession({ admin: false, loginEnabled: false, youtubeConfigured: false });
    }
  }, []);

  const loadVideos = useCallback(async () => {
    try {
      const res = await fetch('/api/videos', { credentials: 'same-origin' });
      const data = await res.json();
      if (data.videos) setVideos(data.videos);
    } catch {
      // Silently fail — empty grid is fine
    }
  }, []);

  useEffect(() => {
    Promise.all([loadSession(), loadVideos()]).finally(() => setLoading(false));
  }, [loadSession, loadVideos]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'same-origin',
      });
      const data = await res.json();
      if (res.ok) {
        setSession((s) => s ? { ...s, admin: true } : s);
        setPassword('');
      } else {
        setLoginError(data.error || 'Login failed.');
      }
    } catch {
      setLoginError('Network error.');
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setSession((s) => s ? { ...s, admin: false } : s);
  }

  function openUpload(category: string) {
    setUploadCategory(category);
    setUploadTitle('');
    setUploadDesc('');
    setUploadFile(null);
    setUploadProgress(null);
    setUploadStatus('');
    setUploadError('');
  }

  function closeUpload() {
    xhrRef.current?.abort();
    xhrRef.current = null;
    setUploadCategory(null);
  }

  function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile || !uploadCategory) return;

    const data = new FormData();
    data.append('category', uploadCategory);
    data.append('title', uploadTitle.trim());
    data.append('description', uploadDesc.trim());
    data.append('video', uploadFile);

    setUploadError('');
    setUploadProgress(0);
    setUploadStatus('Uploading… 0%');

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/youtube/upload');

    xhr.upload.addEventListener('progress', (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      setUploadProgress(pct);
      setUploadStatus(`Uploading… ${pct}%`);
    });

    xhr.upload.addEventListener('load', () => {
      setUploadStatus('Sending to YouTube…');
    });

    xhr.addEventListener('load', () => {
      let body: { video?: VideoItem; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }

      if (xhr.status === 201 && body.video) {
        xhrRef.current = null;
        setVideos((prev) => ({
          ...prev,
          [uploadCategory]: [...(prev[uploadCategory] || []), body.video!],
        }));
        closeUpload();
        return;
      }
      if (xhr.status === 401) {
        setSession((s) => s ? { ...s, admin: false } : s);
      }
      setUploadError(body.error || `Upload failed (HTTP ${xhr.status}).`);
      setUploadProgress(null);
      setUploadStatus('');
    });

    xhr.addEventListener('error', () => {
      setUploadError('Upload failed — lost connection to the server.');
      setUploadProgress(null);
      setUploadStatus('');
    });

    xhr.send(data);
  }

  if (loading) {
    return (
      <main className="dashboard">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading dashboard…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard">
      {/* ─── Header ─── */}
      <header className="dash-header">
        <div className="dash-header-content">
          <div className="dash-logo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
              <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.13C5.12 19.56 12 19.56 12 19.56s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z" />
              <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" fill="currentColor" stroke="none" />
            </svg>
            <h1>YouTube Dashboard</h1>
          </div>
          <div className="dash-header-actions">
            {session?.admin ? (
              <button className="yt-btn yt-btn-ghost" onClick={handleLogout}>
                Log out
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="dash-container">
        {/* ─── Login form (if not admin) ─── */}
        {!session?.admin && session?.loginEnabled && (
          <section className="dash-section">
            <div className="login-card">
              <h2>Admin Login</h2>
              <p>Log in to manage videos and connect YouTube.</p>
              <form onSubmit={handleLogin} className="login-form">
                <input
                  type="password"
                  placeholder="Admin password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {loginError && <div className="form-error">{loginError}</div>}
                <button type="submit" className="yt-btn yt-btn-primary" disabled={loginLoading}>
                  {loginLoading ? 'Logging in…' : 'Log in'}
                </button>
              </form>
            </div>
          </section>
        )}

        {!session?.loginEnabled && !session?.admin && (
          <section className="dash-section">
            <div className="login-card">
              <h2>Admin Login Disabled</h2>
              <p>Set <code>ADMIN_PASSWORD</code> in <code>.env.local</code> to enable admin access.</p>
            </div>
          </section>
        )}

        {/* ─── YouTube Connection Card (always visible) ─── */}
        <section className="dash-section">
          <YouTubeConnectCard />
        </section>

        {/* ─── Video Categories ─── */}
        {Object.entries(CATEGORIES).map(([key, cat]) => {
          const categoryVideos = videos[key] || [];
          return (
            <section className="dash-section" key={key}>
              <div className="category-header" style={{ '--cat-grad': cat.gradient } as React.CSSProperties}>
                <div className="category-info">
                  <h2>{cat.title}</h2>
                  <p>{cat.sub} · {categoryVideos.length} video{categoryVideos.length === 1 ? '' : 's'}</p>
                </div>
                {session?.admin && (
                  <button className="yt-btn yt-btn-primary yt-btn-sm" onClick={() => openUpload(key)}>
                    + Add Video
                  </button>
                )}
              </div>

              {categoryVideos.length > 0 ? (
                <div className="video-grid">
                  {categoryVideos.map((v) => (
                    <div className="video-card" key={v.id}>
                      <div
                        className="video-thumb"
                        onClick={() => setPlayingVideo({ id: v.id, title: v.title })}
                      >
                        <img
                          src={v.thumbnail || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`}
                          alt={v.title}
                          loading="lazy"
                        />
                        {v.privacy === 'private' && (
                          <span className="video-priv-badge" title="Private videos can't play here">Private</span>
                        )}
                        <div className="video-play-icon">
                          <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                      </div>
                      <div className="video-info">
                        <b>{v.title}</b>
                        {v.description && <span>{v.description}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="video-empty">
                  {session?.youtubeConfigured
                    ? `No videos yet in ${cat.title}.`
                    : 'Connect YouTube to see videos.'}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* ─── Upload Modal ─── */}
      {uploadCategory && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeUpload(); }}>
          <div className="modal-box">
            <div className="modal-header">
              <h3>Add Video</h3>
              <button className="modal-close" onClick={closeUpload}>✕</button>
            </div>
            <p className="modal-note">
              Uploads to YouTube and adds it to the &quot;{CATEGORIES[uploadCategory]?.title}&quot; playlist.
            </p>
            <form onSubmit={handleUpload} className="upload-form">
              <input
                name="title"
                placeholder="Video title"
                maxLength={100}
                required
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
              />
              <textarea
                name="description"
                placeholder="Description (optional)"
                rows={3}
                maxLength={5000}
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
              />
              <input
                name="video"
                type="file"
                accept="video/*"
                required
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              />

              {uploadProgress !== null && (
                <div className="upload-progress">
                  <div className="upload-progress-bar" style={{ width: `${uploadProgress}%` }} />
                  <span className="upload-progress-text">{uploadStatus}</span>
                </div>
              )}

              {uploadError && <div className="form-error">{uploadError}</div>}

              <div className="modal-actions">
                <button type="button" className="yt-btn yt-btn-ghost" onClick={closeUpload}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="yt-btn yt-btn-primary"
                  disabled={uploadProgress !== null}
                >
                  Upload to YouTube
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── Video Player Modal ─── */}
      {playingVideo && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPlayingVideo(null); }}>
          <div className="modal-box modal-wide">
            <div className="modal-header">
              <h3>{playingVideo.title}</h3>
              <button className="modal-close" onClick={() => setPlayingVideo(null)}>✕</button>
            </div>
            <div className="video-embed">
              <iframe
                src={`https://www.youtube.com/embed/${encodeURIComponent(playingVideo.id)}?autoplay=1&rel=0`}
                title={playingVideo.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
