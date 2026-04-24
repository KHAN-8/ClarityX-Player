import { useState, useRef } from 'react'
import './App.css'
import VideoPlayer from './components/VideoPlayer'

function App() {
  const [selectedFile, setSelectedFile] = useState(null)
  const [cloudUrl, setCloudUrl] = useState('')
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractError, setExtractError] = useState('')
  const [formats, setFormats] = useState([])
  const [videoTitle, setVideoTitle] = useState('')
  const [selectedFormat, setSelectedFormat] = useState('')
  const [showFormats, setShowFormats] = useState(false)
  const fileInputRef = useRef(null)

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (file && file.type.startsWith('video/')) {
      setSelectedFile(file)
    } else {
      alert('Please select a valid video file.')
    }
  }

  const handleDragOver = (e) => { e.preventDefault(); }

  const handleDrop = (e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('video/')) {
      setSelectedFile(file)
    } else if (file) {
      alert('Please drop a valid video format.')
    }
  }

  const handleWindowControl = (action) => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron')
      ipcRenderer.send(`window-${action}`)
    }
  }

  const handleStream = async () => {
    if (!cloudUrl || isExtracting) return
    setExtractError('')
    setFormats([])
    setShowFormats(false)

    // Direct video file — play immediately
    const isDirectVideo = /\.(mp4|mkv|webm|mov|avi|m3u8)(\?|$)/i.test(cloudUrl)
    if (isDirectVideo) {
      setSelectedFile({ isUrl: true, path: cloudUrl })
      return
    }

    if (!window.require) {
      setExtractError('Stream extraction only works in desktop mode.')
      return
    }

    // Fetch available qualities first
    setIsExtracting(true)
    try {
      const { ipcRenderer } = window.require('electron')
      const result = await ipcRenderer.invoke('list-formats', cloudUrl)
      if (result.formats.length > 0) {
        setFormats(result.formats)
        setVideoTitle(result.title)
        setSelectedFormat(result.formats[0].id) // default to highest
        setShowFormats(true)
      } else {
        // Fallback: no parseable formats, just stream best
        const streamUrl = await ipcRenderer.invoke('extract-url', cloudUrl)
        setSelectedFile({ isUrl: true, path: streamUrl })
      }
    } catch (err) {
      const msg = err.message || ''
      if (msg.includes('Unsupported URL')) {
        setExtractError('This website is not supported. Try YouTube, Vimeo, Dailymotion, or a direct .mp4 link.')
      } else {
        setExtractError(`Extraction failed: ${msg.split('\n')[0]}`)
      }
    } finally {
      setIsExtracting(false)
    }
  }

  const handlePlayFormat = async () => {
    if (!selectedFormat || !cloudUrl) return
    setIsExtracting(true)
    setExtractError('')
    try {
      const { ipcRenderer } = window.require('electron')
      const streamUrl = await ipcRenderer.invoke('extract-url', cloudUrl, selectedFormat)
      setShowFormats(false)
      setSelectedFile({ isUrl: true, path: streamUrl })
    } catch (err) {
      setExtractError(`Failed to load quality: ${(err.message || '').split('\n')[0]}`)
    } finally {
      setIsExtracting(false)
    }
  }

  return (
    <>
      {window.require && (
        <div className="titlebar-wrapper">
          <div className="titlebar-drag-region">
            <img src="./Icon.png" alt="ClarityX" style={{ height: '18px', marginLeft: '10px', opacity: 0.9 }} />
            <span style={{
              marginLeft: '8px',
              fontSize: '0.85rem',
              fontWeight: '800',
              background: 'linear-gradient(90deg, #ffffff, var(--accent-glow))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '1px'
            }}>
              CLARITYX
            </span>
          </div>
          <div className="titlebar-buttons">
            <button onClick={() => handleWindowControl('minimize')}>_</button>
            <button onClick={() => handleWindowControl('maximize')}>◻</button>
            <button onClick={() => handleWindowControl('close')} className="close-btn-title">X</button>
          </div>
        </div>
      )}

      <div
        className={`app-container ${window.require ? 'desktop-mode' : ''}`}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {!selectedFile ? (
          <div className="home-screen">
            {/* Logo */}
            <div style={{ textAlign: 'center', marginBottom: '0.25rem' }}>
              <img src="./Icon.png" alt="ClarityX" style={{ width: '72px', height: '72px', objectFit: 'contain', marginBottom: '0.5rem', filter: 'drop-shadow(0 0 18px rgba(0,240,255,0.4))' }} />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', letterSpacing: '3px', textTransform: 'uppercase' }}>AI Video Player</div>
            </div>

            {/* Upload Box */}
            <div
              className="upload-area"
              onClick={() => fileInputRef.current.click()}
            >
              <div className="upload-icon">🎬</div>
              <p className="upload-text">Drop or Select a Video</p>
              <p className="upload-sub">Supports .mp4 · .mkv · .webm · .mov</p>
            </div>

            {/* URL Streaming */}
            <div className="stream-row">
              <input
                type="text"
                className="stream-input"
                placeholder="Paste YouTube / direct .mp4 URL..."
                value={cloudUrl}
                onChange={(e) => { setCloudUrl(e.target.value); setExtractError(''); setShowFormats(false) }}
                onKeyDown={(e) => e.key === 'Enter' && handleStream()}
              />
              <button
                className={`stream-btn ${isExtracting ? 'extracting' : ''}`}
                disabled={isExtracting}
                onClick={handleStream}
              >
                {isExtracting ? '⏳ Loading...' : '▶ Stream'}
              </button>
            </div>

            {/* Quality Picker */}
            {showFormats && (
              <div className="quality-picker">
                {videoTitle && <div className="quality-title">🎬 {videoTitle}</div>}
                <div className="quality-row">
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Quality:</span>
                  <select
                    className="quality-select"
                    value={selectedFormat}
                    onChange={(e) => setSelectedFormat(e.target.value)}
                  >
                    {formats.map(f => (
                      <option key={f.id} value={f.id}>
                        {f.label}{f.filesize ? ` — ${(f.filesize / 1048576).toFixed(0)}MB` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    className="stream-btn"
                    onClick={handlePlayFormat}
                    disabled={isExtracting}
                  >
                    {isExtracting ? '⏳' : '▶ Play'}
                  </button>
                </div>
              </div>
            )}

            {extractError && (
              <p className="stream-error">{extractError}</p>
            )}

            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', textAlign: 'center' }}>
              Supports YouTube, Vimeo, Dailymotion + 1900 sites via yt-dlp
            </p>

            <input
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileSelect}
            />
          </div>
        ) : (
          <VideoPlayer file={selectedFile} onBack={() => setSelectedFile(null)} />
        )}
      </div>
    </>
  )
}

export default App
