import { useState, useRef, useEffect, useCallback } from 'react';

const PRESETS = [
  { name: "Original (Raw)", value: "none" },
  { name: "Anime4K WebGL Upscaler", value: "anime4k" },
  { name: "ClarityX Core (RTX VSR Optimized)", value: "contrast(1.05) saturate(1.05) brightness(1.02)" },
  { name: "Deep Cinematic HDR", value: "contrast(1.15) brightness(0.9) saturate(1.1)" },
  { name: "Anime / 2D Saturation", value: "saturate(1.4) contrast(1.1) brightness(1.05)" },
  { name: "CSSgram: Clarendon", value: "contrast(1.2) saturate(1.35) sepia(0.1)" },
  { name: "CSSgram: 1977 (Retro)", value: "contrast(1.1) saturate(1.3) sepia(0.2) hue-rotate(-10deg)" },
  { name: "CSSgram: Aden (Pastel)", value: "contrast(0.9) saturate(0.85) sepia(0.2) brightness(1.1)" },
  { name: "Noir Vintage (B&W)", value: "grayscale(1) contrast(1.2) brightness(0.95)" },
  { name: "Raw GLSL Shader Uploader", value: "custom-glsl" }
];

function srtToVtt(srtStr) {
  return 'WEBVTT\n\n' + srtStr.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}

function formatTime(seconds) {
  if (isNaN(seconds)) return "00:00";
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function VideoPlayer({ file, onBack }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isSliderEnabled, setIsSliderEnabled] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  
  // Custom states
  const [isUIHidden, setIsUIHidden] = useState(false);
  const uiTimeoutRef = useRef(null);
  const [gpuEnabled, setGpuEnabled] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [osdMessage, setOsdMessage] = useState('');
  const osdTimeoutRef = useRef(null);

  const seekBarRef = useRef(null);
  const [hoverTime, setHoverTime] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(0);
  const [isPinned, setIsPinned] = useState(false);

  const showOsd = useCallback((msg) => {
    setOsdMessage(msg);
    if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
    osdTimeoutRef.current = setTimeout(() => {
      setOsdMessage('');
    }, 1000);
  }, []);

  useEffect(() => {
    if (window.require) {
      try {
        const { ipcRenderer } = window.require('electron');
        setGpuEnabled(ipcRenderer.sendSync('get-gpu-status'));
      } catch(e) {}
    }
  }, []);

  const toggleGpu = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('toggle-gpu');
    }
  };

  // Media State
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [subtitleUrl, setSubtitleUrl] = useState(null);
  const [currentFilter, setCurrentFilter] = useState(PRESETS[0].value); // Default Original

  const videoBaseRef = useRef(null);
  const previewVideoRef = useRef(null);
  const containerRef = useRef(null);
  const wrapperRef = useRef(null);
  const subInputRef = useRef(null);

  const animeCanvasRef = useRef(null);
  const upscalerRef = useRef(null);

  // Audio Context Vault
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);

  // GLSL Engine
  const customGlCanvasRef = useRef(null);
  const shaderInputRef = useRef(null);
  const glRef = useRef(null);
  const glProgramInfo = useRef(null);
  const reqAnimFrameRef = useRef(null);
  const [shaderCode, setShaderCode] = useState(`
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_image;
void main() {
    // Default pass-through mapping
    gl_FragColor = texture2D(u_image, v_texCoord);
}
  `);

  useEffect(() => {
    if (file) {
      if (file.isUrl) {
         setVideoUrl(file.path);
         return;
      }
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  useEffect(() => {
    if (videoBaseRef.current && !audioCtxRef.current) {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtxRef.current = new AudioContext();
        gainNodeRef.current = audioCtxRef.current.createGain();
        const sourceNode = audioCtxRef.current.createMediaElementSource(videoBaseRef.current);
        sourceNode.connect(gainNodeRef.current);
        gainNodeRef.current.connect(audioCtxRef.current.destination);
      } catch (err) {}
    }
  }, []);

  // Anime4K logic
  useEffect(() => {
    if (currentFilter === 'anime4k' && videoBaseRef.current && animeCanvasRef.current && window.Anime4KJS) {
       try {
         if (!upscalerRef.current) {
           upscalerRef.current = new window.Anime4KJS.VideoUpscaler(30, window.Anime4KJS.ANIME4KJS_SIMPLE_M_2X);
           upscalerRef.current.attachVideo(videoBaseRef.current, animeCanvasRef.current);
         }
         upscalerRef.current.start();
       } catch (err) {}
    }
  }, [currentFilter, videoUrl]);

  // GLSL Hook Pipeline
  const loadCustomShader = (e) => {
    const sFile = e.target.files[0];
    if (!sFile) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setShaderCode(event.target.result);
      setCurrentFilter('custom-glsl');
      showOsd('GLSL Matrix Initialized');
    };
    reader.readAsText(sFile);
  };

  const compileShader = (gl, type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  useEffect(() => {
    if (currentFilter !== 'custom-glsl' || !customGlCanvasRef.current) return;
    const gl = customGlCanvasRef.current.getContext('webgl');
    if (!gl) return;
    glRef.current = gl;

    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      void main() {
        gl_Position = vec4(a_position, 0, 1);
        v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
      }
    `;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, shaderCode);

    if (!vs || !fs) {
       showOsd('❌ Raw GLSL Compile Error');
       return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);

    const texBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,1, 1,1, 0,0, 0,0, 1,1, 1,0]), gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    glProgramInfo.current = { program, posBuffer, texBuffer, texture };
  }, [currentFilter, shaderCode, showOsd]);

  const renderWebGL = useCallback(() => {
    if (currentFilter === 'custom-glsl' && glRef.current && glProgramInfo.current && videoBaseRef.current) {
        const gl = glRef.current;
        const p = glProgramInfo.current;
        const video = videoBaseRef.current;

        if (video.videoWidth > 0 && customGlCanvasRef.current.width !== video.videoWidth) {
           customGlCanvasRef.current.width = video.videoWidth;
           customGlCanvasRef.current.height = video.videoHeight;
        }

        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.bindTexture(gl.TEXTURE_2D, p.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

        gl.useProgram(p.program);
        
        const posLoc = gl.getAttribLocation(p.program, 'a_position');
        gl.bindBuffer(gl.ARRAY_BUFFER, p.posBuffer);
        gl.enableVertexAttribArray(posLoc);
        gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

        const texLoc = gl.getAttribLocation(p.program, 'a_texCoord');
        gl.bindBuffer(gl.ARRAY_BUFFER, p.texBuffer);
        gl.enableVertexAttribArray(texLoc);
        gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    reqAnimFrameRef.current = requestAnimationFrame(renderWebGL);
  }, [currentFilter]);

  useEffect(() => {
    reqAnimFrameRef.current = requestAnimationFrame(renderWebGL);
    return () => cancelAnimationFrame(reqAnimFrameRef.current);
  }, [renderWebGL]);

  const togglePlay = useCallback(() => {
    if (!videoBaseRef.current) return;
    if (videoBaseRef.current.paused) {
      videoBaseRef.current.play();
      setIsPlaying(true);
      showOsd('▶ Play');
    } else {
      videoBaseRef.current.pause();
      setIsPlaying(false);
      showOsd('⏸ Pause');
    }
  }, [showOsd]);

  const skip = useCallback((amount) => {
    if (!videoBaseRef.current) return;
    videoBaseRef.current.currentTime += amount;
    showOsd(amount > 0 ? `↻ +${amount}s` : `↺ ${amount}s`);
  }, [showOsd]);

  const stepFrame = useCallback((dir) => {
    if (!videoBaseRef.current) return;
    videoBaseRef.current.pause();
    setIsPlaying(false);
    videoBaseRef.current.currentTime += (dir * (1/30)); 
    showOsd(dir > 0 ? '⏭ +1 Frame' : '⏮ -1 Frame');
  }, [showOsd]);

  const toggleFullScreen = useCallback(() => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const isFS = ipcRenderer.sendSync('window-fullscreen');
      if (isFS) {
        document.body.classList.add('native-fullscreen');
        showOsd('⛶ Fullscreen ON');
      } else {
        document.body.classList.remove('native-fullscreen');
        showOsd('⛶ Fullscreen OFF');
      }
    } else {
      if (!document.fullscreenElement) {
        wrapperRef.current?.requestFullscreen().catch(err => {
          console.warn(`Fullscreen error: ${err.message}`);
        });
      } else {
        document.exitFullscreen();
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    if (!videoBaseRef.current) return;
    const newMuted = !videoBaseRef.current.muted;
    videoBaseRef.current.muted = newMuted;
    setIsMuted(newMuted);
    showOsd(newMuted ? '🔇 Muted' : '🔊 Unmuted');
  }, [showOsd]);

  const resetUI = useCallback(() => {
    setIsUIHidden(false);
    if (uiTimeoutRef.current) clearTimeout(uiTimeoutRef.current);
    if (isPlaying) {
      uiTimeoutRef.current = setTimeout(() => {
        setIsUIHidden(true);
      }, 2500);
    }
  }, [isPlaying]);

  const handleSeekHover = (e) => {
    if (!seekBarRef.current || !duration) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = x / rect.width;
    const newHoverTime = percentage * duration;
    
    setHoverTime(newHoverTime);
    setHoverPosition(x); 

    if (previewVideoRef.current && previewVideoRef.current.readyState >= 1) {
       previewVideoRef.current.currentTime = newHoverTime;
    }
  };

  const togglePin = () => {
    if (window.require) {
      const { ipcRenderer } = window.require('electron');
      const newState = !isPinned;
      ipcRenderer.sendSync('window-pin', newState);
      setIsPinned(newState);
      showOsd(newState ? '📌 Pinned On Top' : 'Unpinned');
    }
  };

  useEffect(() => {
    resetUI();
    return () => {
      if (uiTimeoutRef.current) clearTimeout(uiTimeoutRef.current);
    };
  }, [isPlaying, resetUI]);

  const handleMouseMoveWrap = () => {
    resetUI();
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName.toLowerCase() === 'input' && e.target.type !== 'range') return;
      // Auto-wake UI when keyboard used
      resetUI();

      switch(e.key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          toggleFullScreen();
          break;
        case ' ': // space
          e.preventDefault();
          togglePlay();
          break;
        case 'arrowright':
          e.preventDefault();
          skip(10);
          break;
        case 'arrowleft':
          e.preventDefault();
          skip(-10);
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case ',':
          e.preventDefault();
          stepFrame(-1);
          break;
        case '.':
          e.preventDefault();
          stepFrame(1);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, skip, stepFrame, toggleFullScreen, toggleMute, resetUI]);

  const handleTimeUpdate = () => {
    setCurrentTime(videoBaseRef.current.currentTime);
    if (window.require && file.path && Math.floor(videoBaseRef.current.currentTime) % 15 === 0) {
      const { ipcRenderer } = window.require('electron');
      ipcRenderer.send('save-time', { filePath: file.path, time: videoBaseRef.current.currentTime });
    }
  };
  
  const handleLoadedMetadata = () => {
    setDuration(videoBaseRef.current.duration);
    if (window.require && file.path) {
      try {
        const { ipcRenderer } = window.require('electron');
        const savedTime = ipcRenderer.sendSync('get-time', file.path);
        if (savedTime > 0) {
          videoBaseRef.current.currentTime = savedTime;
          setCurrentTime(savedTime);
          showOsd('Memory: Resumed');
        }
      } catch (e) {}
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    videoBaseRef.current.currentTime = time;
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = vol;
    } else {
      videoBaseRef.current.volume = Math.min(vol, 1);
    }
    setIsMuted(vol === 0);
  };

  const handleSpeedChange = (e) => {
    const speed = parseFloat(e.target.value);
    setPlaybackRate(speed);
    if (videoBaseRef.current) {
      videoBaseRef.current.playbackRate = speed;
    }
  };

  const takeSnapshot = useCallback(() => {
    let source = null;
    if (currentFilter === 'anime4k' && animeCanvasRef.current) {
      source = animeCanvasRef.current;
    } else if (videoBaseRef.current) {
      source = videoBaseRef.current;
    }
    if (!source) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = source.videoWidth || source.width || 1920;
      canvas.height = source.videoHeight || source.height || 1080;
      const ctx = canvas.getContext('2d');
      if (source === videoBaseRef.current && currentFilter !== 'none' && currentFilter !== 'anime4k') {
        ctx.filter = currentFilter;
      }
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `ClarityX-Capture-${Date.now()}.png`;
      a.click();
    } catch (err) {
      console.warn("Snapshot failed:", err);
    }
  }, [currentFilter]);

  const handleMouseMove = (e) => {
    if (!isSliderEnabled || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percentage = (x / rect.width) * 100;
    setSliderPosition(percentage);
  };

  const loadSubtitles = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      let content = event.target.result;
      if (file.name.endsWith('.srt')) {
        content = srtToVtt(content);
      }
      const vttBlob = new Blob([content], { type: 'text/vtt' });
      const url = URL.createObjectURL(vttBlob);
      setSubtitleUrl(url);
    };
    reader.readAsText(file);
  };

  const shiftSubtitles = (amount) => {
    if (!videoBaseRef.current) return;
    const textTracks = videoBaseRef.current.textTracks;
    if (textTracks.length > 0) {
       const activeTrack = textTracks[0];
       if (activeTrack.cues) {
           for(let i=0; i<activeTrack.cues.length; i++){
               activeTrack.cues[i].startTime += amount;
               activeTrack.cues[i].endTime += amount;
           }
       }
    }
    showOsd(amount > 0 ? 'Sync: +100ms' : 'Sync: -100ms');
  };

  const currentClipPath = isSliderEnabled ? `polygon(${sliderPosition}% 0, 100% 0, 100% 100%, ${sliderPosition}% 100%)` : 'none';

  return (
    <div className="player-wrapper" ref={wrapperRef} onMouseMove={handleMouseMoveWrap}>
      <div 
        className="video-container"
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onTouchMove={(e) => {
          resetUI();
          if (!isSliderEnabled || !containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.touches[0].clientX - rect.left, rect.width));
          setSliderPosition((x / rect.width) * 100);
        }}
        onClick={togglePlay}
        onDoubleClick={toggleFullScreen}
      >
        <video 
          ref={videoBaseRef} 
          className="video-content video-base"
          src={videoUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onClick={togglePlay}
          crossOrigin={file.isUrl ? 'anonymous' : undefined}
          autoPlay
        >
          {subtitleUrl && <track kind="captions" src={subtitleUrl} srcLang="en" label="English" default />}
        </video>
        
        {/* Anime4K WebGL Layer */}
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
          pointerEvents: 'none', 
          clipPath: currentClipPath,
          opacity: currentFilter === 'anime4k' ? 1 : 0
        }}>
          <canvas ref={animeCanvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        {/* Custom Raw GLSL Layer */}
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
          pointerEvents: 'none', 
          clipPath: currentClipPath,
          opacity: currentFilter === 'custom-glsl' ? 1 : 0
        }}>
          <canvas ref={customGlCanvasRef} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>

        {/* Standard CSS Filter Layer */}
        <div 
          className="enhanced-overlay"
          style={{ 
            clipPath: currentClipPath,
            backdropFilter: (currentFilter === 'anime4k' || currentFilter === 'custom-glsl') ? 'none' : currentFilter,
            WebkitBackdropFilter: (currentFilter === 'anime4k' || currentFilter === 'custom-glsl') ? 'none' : currentFilter,
            display: (currentFilter === 'anime4k' || currentFilter === 'custom-glsl') ? 'none' : 'block'
          }}
        />

        {isSliderEnabled && (
          <div className={`slider-handle ${isUIHidden ? 'hidden' : ''}`} style={{ left: `${sliderPosition}%` }} />
        )}

        {osdMessage && (
          <div className="osd-overlay" key={Date.now() + Math.random()}>
            {osdMessage}
          </div>
        )}
      </div>

      <div className={`glass-panel controls-module ${isUIHidden ? 'hidden' : ''}`}>
        {/* Timeline Row */}
        <div className="timeline-row" style={{ position: 'relative' }}>
          <span className="time-text">{formatTime(currentTime)}</span>
          
          <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center' }}
               onMouseMove={handleSeekHover}
               onMouseLeave={() => setHoverTime(null)}>
            
            <div style={{
                 position: 'absolute', 
                 left: `${hoverPosition}px`, 
                 bottom: '100%', 
                 transform: 'translateX(-50%)',
                 marginBottom: '10px',
                 background: 'rgba(0,0,0,0.85)',
                 padding: '6px',
                 borderRadius: '8px',
                 backdropFilter: 'blur(4px)',
                 border: '1px solid var(--accent-glow)',
                 color: '#fff',
                 pointerEvents: 'none',
                 zIndex: 50,
                 display: 'flex',
                 flexDirection: 'column',
                 alignItems: 'center',
                 boxShadow: '0 10px 30px rgba(0,0,0,0.7)',
                 opacity: hoverTime !== null ? 1 : 0,
                 visibility: hoverTime !== null ? 'visible' : 'hidden',
                 transition: 'opacity 0.1s'
              }}>
                <video 
                  ref={previewVideoRef}
                  src={videoUrl}
                  style={{ width: '160px', borderRadius: '4px', marginBottom: '6px', backgroundColor: '#000' }}
                  muted
                />
                <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>{formatTime(hoverTime || 0)}</span>
              </div>
            <input  
              ref={seekBarRef}
              type="range" 
              className="seek-bar"
              min="0" 
              max={duration || 0} 
              value={currentTime} 
              onChange={handleSeek} 
              style={{ width: '100%' }}
            />
          </div>
          
          <span className="time-text">{formatTime(duration)}</span>
        </div>

        {/* ROW 1: Playback */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:'0.5rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <button className="icon-btn tooltip play-glow-btn" onClick={(e)=>{ e.stopPropagation(); togglePlay(); }}>
              {isPlaying ? '\u23F8' : '\u25B6'} <span className="tooltiptext">Play/Pause</span>
            </button>
            <button className="icon-btn tooltip" onClick={()=>skip(-10)}>⏪ <span className="tooltiptext">-10s</span></button>
            <button className="icon-btn tooltip" onClick={()=>skip(10)}>⏩ <span className="tooltiptext">+10s</span></button>
            <select className="preset-select" style={{padding:'4px 8px',fontSize:'0.8rem'}} value={playbackRate} onChange={handleSpeedChange}>
              <option value="0.5">0.5x</option>
              <option value="1">1.0x</option>
              <option value="1.5">1.5x</option>
              <option value="2">2.0x</option>
            </select>
            <button className="icon-btn" onClick={toggleMute}>{isMuted||volume===0?'\uD83D\uDD07':'\uD83D\uDD0A'}</button>
            <input type="range" className="vol-bar" min="0" max="3" step="0.1"
              value={isMuted?0:volume} onChange={handleVolumeChange}
              style={{background:volume>1?'linear-gradient(90deg,rgba(255,255,255,0.3),#ff4444)':''}}
            />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem' }}>
            <button className="icon-btn tooltip" onClick={takeSnapshot}>📷 <span className="tooltiptext">Snapshot</span></button>
            {window.require && (
              <button className={`icon-btn tooltip ${isPinned?'play-glow-btn':''}`} onClick={togglePin}>
                📌 <span className="tooltiptext">{isPinned?'Unpin':'Always On Top'}</span>
              </button>
            )}
            <button className="icon-btn tooltip" onClick={toggleFullScreen}>⛶ <span className="tooltiptext">Fullscreen (F)</span></button>
            <button className="outline-btn close-btn" style={{padding:'0.3rem 0.7rem'}} onClick={onBack}>&#x2715;</button>
          </div>
        </div>

        {/* ROW 2: Enhancement Tools */}
        <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', flexWrap:'wrap' }}>
          <button
            className={`outline-btn tooltip ${isSliderEnabled?'active-glow':''}`}
            style={{padding:'0.3rem 0.7rem',fontSize:'0.8rem'}}
            onClick={(e)=>{ e.stopPropagation(); setIsSliderEnabled(!isSliderEnabled); }}
          >▨ Compare <span className="tooltiptext">A/B Slider</span></button>

          <select className="preset-select" style={{fontSize:'0.8rem',maxWidth:'170px'}}
            value={currentFilter} onChange={e=>setCurrentFilter(e.target.value)}>
            {PRESETS.map((p,idx)=><option key={idx} value={p.value}>{p.name}</option>)}
          </select>

          <button
            className={`outline-btn tooltip ${currentFilter==='custom-glsl'?'active-glow':''}`}
            style={{padding:'0.3rem 0.7rem',fontSize:'0.8rem'}}
            onClick={()=>shaderInputRef.current.click()}
          >+ GLSL <span className="tooltiptext">Load Custom Shader</span></button>
          <input type="file" ref={shaderInputRef} accept=".glsl,.txt" style={{display:'none'}} onChange={loadCustomShader}/>

          <button className="outline-btn tooltip" style={{padding:'0.3rem 0.7rem',fontSize:'0.8rem'}}
            onClick={()=>subInputRef.current.click()}>CC <span className="tooltiptext">Load Subtitles</span></button>
          <input type="file" ref={subInputRef} accept=".srt,.vtt" style={{display:'none'}} onChange={loadSubtitles}/>

          {subtitleUrl && <>
            <button className="outline-btn tooltip" style={{padding:'0.3rem 0.5rem',fontSize:'0.8rem'}} onClick={()=>shiftSubtitles(-0.1)}>-T <span className="tooltiptext">Sub -100ms</span></button>
            <button className="outline-btn tooltip" style={{padding:'0.3rem 0.5rem',fontSize:'0.8rem'}} onClick={()=>shiftSubtitles(0.1)}>+T <span className="tooltiptext">Sub +100ms</span></button>
          </>}

          {window.require && (
            <button className="outline-btn tooltip" style={{padding:'0.3rem 0.7rem',fontSize:'0.8rem',color:gpuEnabled?'inherit':'#ff6060',borderColor:gpuEnabled?'rgba(255,255,255,0.15)':'#ff6060'}}
              onClick={toggleGpu}>GPU {gpuEnabled?'ON':'OFF'} <span className="tooltiptext">Toggle GPU Acceleration</span></button>
          )}
        </div>
      </div>
    </div>
  );
}
