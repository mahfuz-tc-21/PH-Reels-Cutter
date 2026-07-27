import React, { useState, useEffect, useRef } from 'react';
import { 
  Scissors, Plus, Search, Download, Upload, Trash2, Film, Play, Pause, 
  ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Gauge, Share2, 
  ArrowUpDown, Sparkles, Clock, AlertTriangle, Clipboard, FileText, 
  Terminal, Menu, Activity, Eye, EyeOff, X, Loader, FileSpreadsheet
} from 'lucide-react';

/* ----------------------------------------------------
   Database Interfaces & Seeds
   ---------------------------------------------------- */
const STORAGE_KEY = 'reels_cutter_database';
const GEMINI_KEY_STORAGE = 'reels_cutter_gemini_api_key';

interface ReelsTimestamp {
  id: string;
  hook: string;
  startTime: string;
  endTime: string;
}

interface Project {
  id: string;
  title: string;
  videoUrl: string;
  reelsTimestamps: ReelsTimestamp[];
}

interface Database {
  projects: Project[];
  activeProjectId: string;
}

const INITIAL_SEEDS: Database = {
  projects: [
    {
      id: 'proj-default-1',
      title: 'Untitled Video Project',
      videoUrl: '',
      reelsTimestamps: []
    }
  ],
  activeProjectId: 'proj-default-1'
};

/* ----------------------------------------------------
   Time Conversions Utility Functions
   ---------------------------------------------------- */
const timeStringToSeconds = (timeStr: string): number => {
  if (!timeStr) return 0;
  const clean = timeStr.trim();
  if (/^\d+$/.test(clean)) {
    return parseInt(clean, 10);
  }
  const parts = clean.split(':').map(p => parseInt(p, 10));
  if (parts.some(isNaN)) return 0;
  
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    return parts[0];
  }
  return 0;
};

const secondsToTimeString = (totalSeconds: number): string => {
  if (isNaN(totalSeconds) || totalSeconds < 0) return '0:00:00';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

const getYoutubeId = (url: string): string | null => {
  if (!url) return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=|shorts\/)([^#\&\?]*).*/;
  const match = url.match(regExp);
  if (match && match[2].length === 11) {
    return match[2];
  }
  const cleanUrl = url.trim();
  if (cleanUrl.length === 11 && !cleanUrl.includes('/') && !cleanUrl.includes('?')) {
    return cleanUrl;
  }
  return null;
};

export default function App() {
  /* ----------------------------------------------------
     State Definitions
     ---------------------------------------------------- */
  const [db, setDb] = useState<Database>(() => {
    const local = localStorage.getItem(STORAGE_KEY);
    if (local) {
      try {
        return JSON.parse(local);
      } catch (e) {
        return INITIAL_SEEDS;
      }
    }
    return INITIAL_SEEDS;
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(db.activeProjectId || db.projects[0]?.id || 'proj-default-1');
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [digitalClock, setDigitalClock] = useState<string>('0:00:00');
  const [playbackSpeed, setPlaybackSpeed] = useState<string>('1');
  const [activePreviewIndex, setActivePreviewIndex] = useState<number | null>(null);
  const [isLoopingSegment, setIsLoopingSegment] = useState<boolean>(false);

  // Modal displays
  const [showImportModal, setShowImportModal] = useState<boolean>(false);
  const [importInputText, setImportInputText] = useState<string>('');
  
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [activeExportTab, setActiveExportTab] = useState<string>('tab-chapters');
  const [ffmpegInputFilename, setFfmpegInputFilename] = useState<string>('input.mp4');

  const [showAIModal, setShowAIModal] = useState<boolean>(false);
  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => localStorage.getItem(GEMINI_KEY_STORAGE) || '');
  const [showApiKey, setShowApiKey] = useState<boolean>(false);
  const [subtitleFile, setSubtitleFile] = useState<File | null>(null);
  const [subtitleText, setSubtitleText] = useState<string>('');
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [aiStatus, setAiStatus] = useState<string>('');
  const [aiError, setAiError] = useState<string | null>(null);

  // Refs for tracking state inside timers and events
  const ytPlayerRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);
  const isPlayingSegmentRef = useRef<boolean>(false);
  const activePreviewIndexRef = useRef<number | null>(null);
  const focusedRowIdRef = useRef<string | null>(null);
  
  const activeProject = db.projects.find(p => p.id === activeProjectId) || db.projects[0];
  const activeProjectRef = useRef<Project>(activeProject);

  // Sync refs with state values
  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  useEffect(() => {
    isPlayingSegmentRef.current = isLoopingSegment;
  }, [isLoopingSegment]);

  useEffect(() => {
    activePreviewIndexRef.current = activePreviewIndex;
  }, [activePreviewIndex]);

  useEffect(() => {
    focusedRowIdRef.current = focusedRowId;
  }, [focusedRowId]);

  // Sync DB changes to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }, [db]);

  // Sync Gemini API Key changes to localStorage
  useEffect(() => {
    localStorage.setItem(GEMINI_KEY_STORAGE, geminiApiKey);
  }, [geminiApiKey]);

  /* ----------------------------------------------------
     YouTube Player Integration
     ---------------------------------------------------- */
  useEffect(() => {
    // Load Iframe API if not loaded
    if (!(window as any).YT) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    // Set player setup trigger
    (window as any).onYouTubeIframeAPIReady = () => {
      rebuildPlayer();
    };

    if ((window as any).YT && (window as any).YT.Player) {
      rebuildPlayer();
    }

    return () => {
      stopPlaybackTimer();
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch (e) {}
        ytPlayerRef.current = null;
      }
    };
  }, [activeProjectId, activeProject?.videoUrl]);

  const rebuildPlayer = () => {
    const videoId = getYoutubeId(activeProject?.videoUrl || '');
    if (!videoId) {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch (e) {}
        ytPlayerRef.current = null;
      }
      return;
    }

    if (ytPlayerRef.current && typeof ytPlayerRef.current.loadVideoById === 'function') {
      try {
        ytPlayerRef.current.loadVideoById(videoId);
        return;
      } catch (e) {}
    }

    try {
      ytPlayerRef.current = new (window as any).YT.Player('youtube-player-element-react', {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1
        },
        events: {
          onReady: () => {
            // Apply speed if set
            if (ytPlayerRef.current && typeof ytPlayerRef.current.setPlaybackRate === 'function') {
              ytPlayerRef.current.setPlaybackRate(parseFloat(playbackSpeed));
            }
          },
          onStateChange: (event: any) => {
            if (event.data === (window as any).YT.PlayerState.PLAYING) {
              startPlaybackTimer();
            } else {
              stopPlaybackTimer();
            }
          }
        }
      });
    } catch (err) {
      console.error("Vite React YT Player Init Error: ", err);
    }
  };

  const startPlaybackTimer = () => {
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      const player = ytPlayerRef.current;
      if (player && typeof player.getCurrentTime === 'function') {
        try {
          const t = player.getCurrentTime();
          setDigitalClock(secondsToTimeString(t));

          // Direct DOM manipulation of playhead left percentage (High efficiency)
          const playhead = document.getElementById('timeline-playhead');
          if (playhead) {
            const D = player.getDuration() || 1;
            playhead.style.left = `${(t / D) * 100}%`;
          }

          // Loop logic boundary check
          if (isPlayingSegmentRef.current && activePreviewIndexRef.current !== null) {
            const segment = activeProjectRef.current.reelsTimestamps[activePreviewIndexRef.current];
            if (segment) {
              const endSec = timeStringToSeconds(segment.endTime);
              if (t >= endSec) {
                player.pauseVideo();
                setIsLoopingSegment(false);
                setActivePreviewIndex(null);
              }
            }
          }
        } catch (e) {}
      }
    }, 250);
  };

  const stopPlaybackTimer = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  /* ----------------------------------------------------
     Keyboard Shortcuts Trigger
     ---------------------------------------------------- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' || 
        target.tagName === 'TEXTAREA' || 
        target.isContentEditable
      ) {
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        triggerPlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekRelative(5);
      } else if (e.key === '[') {
        e.preventDefault();
        grabTimeForActiveRow('start');
      } else if (e.key === ']') {
        e.preventDefault();
        grabTimeForActiveRow('end');
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        addNewRow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeProjectId]);

  const triggerPlayPause = () => {
    const player = ytPlayerRef.current;
    if (player && typeof player.getPlayerState === 'function') {
      const state = player.getPlayerState();
      if (state === (window as any).YT.PlayerState.PLAYING) {
        player.pauseVideo();
      } else {
        player.playVideo();
      }
    }
  };

  const seekRelative = (seconds: number) => {
    const player = ytPlayerRef.current;
    if (player && typeof player.getCurrentTime === 'function') {
      const t = player.getCurrentTime();
      player.seekTo(Math.max(0, t + seconds), true);
    }
  };

  const seekTo = (seconds: number) => {
    const player = ytPlayerRef.current;
    if (player && typeof player.seekTo === 'function') {
      player.seekTo(seconds, true);
      player.playVideo();
    }
  };

  const grabTimeForActiveRow = (type: 'start' | 'end') => {
    const activeProj = activeProjectRef.current;
    if (!activeProj || activeProj.reelsTimestamps.length === 0) return;

    let targetId = focusedRowIdRef.current;
    if (!targetId) {
      targetId = activeProj.reelsTimestamps[0].id;
      setFocusedRowId(targetId);
    }

    const player = ytPlayerRef.current;
    if (player && typeof player.getCurrentTime === 'function') {
      const t = player.getCurrentTime();
      const timeStr = secondsToTimeString(t);

      setDb(prev => {
        const nextProjects = prev.projects.map(p => {
          if (p.id === activeProj.id) {
            const nextTimestamps = p.reelsTimestamps.map(ts => {
              if (ts.id === targetId) {
                return type === 'start' 
                  ? { ...ts, startTime: timeStr } 
                  : { ...ts, endTime: timeStr };
              }
              return ts;
            });
            return { ...p, reelsTimestamps: nextTimestamps };
          }
          return p;
        });
        return { ...prev, projects: nextProjects };
      });

      // Simple visual feedback flash
      const row = document.getElementById(`row-${targetId}`);
      if (row) {
        row.style.transition = 'background-color 0.2s ease';
        row.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
        setTimeout(() => {
          row.style.backgroundColor = '';
        }, 400);
      }
    }
  };

  /* ----------------------------------------------------
     Project and Row Helpers
     ---------------------------------------------------- */
  const handleAddNewProject = () => {
    const title = prompt("Enter Video Title / Topic name:");
    if (title && title.trim()) {
      const newProj: Project = {
        id: `proj-${Date.now()}`,
        title: title.trim(),
        videoUrl: '',
        reelsTimestamps: []
      };
      setDb(prev => ({
        ...prev,
        projects: [...prev.projects, newProj],
        activeProjectId: newProj.id
      }));
      setActiveProjectId(newProj.id);
    }
  };

  const handleDeleteProject = () => {
    if (confirm(`Are you sure you want to delete the project "${activeProject.title}"?`)) {
      const remaining = db.projects.filter(p => p.id !== activeProject.id);
      let nextActiveId = '';
      let nextProjects = remaining;
      if (remaining.length === 0) {
        nextProjects = INITIAL_SEEDS.projects;
        nextActiveId = INITIAL_SEEDS.projects[0].id;
      } else {
        nextActiveId = remaining[0].id;
      }
      setDb({
        projects: nextProjects,
        activeProjectId: nextActiveId
      });
      setActiveProjectId(nextActiveId);
    }
  };

  const handleRenameProject = (newTitle: string) => {
    if (!newTitle.trim()) return;
    setDb(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === activeProject.id ? { ...p, title: newTitle.trim() } : p)
    }));
  };

  const handleUpdateVideoUrl = (url: string) => {
    setDb(prev => ({
      ...prev,
      projects: prev.projects.map(p => p.id === activeProject.id ? { ...p, videoUrl: url.trim() } : p)
    }));
  };

  const addNewRow = () => {
    const newId = `ts-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    setDb(prev => ({
      ...prev,
      projects: prev.projects.map(p => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            reelsTimestamps: [
              ...p.reelsTimestamps,
              { id: newId, hook: '', startTime: '0:00:00', endTime: '0:00:00' }
            ]
          };
        }
        return p;
      })
    }));
    setFocusedRowId(newId);

    // Auto-focus the input
    setTimeout(() => {
      const row = document.getElementById(`row-${newId}`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        const input = row.querySelector('.reels-text-input') as HTMLInputElement | null;
        input?.focus();
      }
    }, 100);
  };

  const handleUpdateRowHook = (rowId: string, hookValue: string) => {
    setDb(prev => ({
      ...prev,
      projects: prev.projects.map(p => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            reelsTimestamps: p.reelsTimestamps.map(ts => ts.id === rowId ? { ...ts, hook: hookValue } : ts)
          };
        }
        return p;
      })
    }));
  };

  const handleUpdateRowTimes = (rowId: string, type: 'start' | 'end', timeStr: string) => {
    setDb(prev => ({
      ...prev,
      projects: prev.projects.map(p => {
        if (p.id === activeProject.id) {
          return {
            ...p,
            reelsTimestamps: p.reelsTimestamps.map(ts => {
              if (ts.id === rowId) {
                return type === 'start' ? { ...ts, startTime: timeStr } : { ...ts, endTime: timeStr };
              }
              return ts;
            })
          };
        }
        return p;
      })
    }));
  };

  const handleDeleteRow = (rowId: string, index: number) => {
    if (confirm(`Delete timestamp row #${index + 1}?`)) {
      setDb(prev => ({
        ...prev,
        projects: prev.projects.map(p => {
          if (p.id === activeProject.id) {
            return { ...p, reelsTimestamps: p.reelsTimestamps.filter(ts => ts.id !== rowId) };
          }
          return p;
        })
      }));
      if (focusedRowId === rowId) setFocusedRowId(null);
    }
  };

  const handleSortRows = () => {
    setDb(prev => ({
      ...prev,
      projects: prev.projects.map(p => {
        if (p.id === activeProject.id) {
          const sorted = [...p.reelsTimestamps].sort((a, b) => {
            return timeStringToSeconds(a.startTime) - timeStringToSeconds(b.startTime);
          });
          return { ...p, reelsTimestamps: sorted };
        }
        return p;
      })
    }));
  };

  const handleClearAllRows = () => {
    if (confirm("Are you sure you want to delete all timestamps in this project? This cannot be undone.")) {
      setDb(prev => ({
        ...prev,
        projects: prev.projects.map(p => p.id === activeProject.id ? { ...p, reelsTimestamps: [] } : p)
      }));
      setFocusedRowId(null);
    }
  };

  const handlePreviewLoop = (index: number) => {
    const segment = activeProject.reelsTimestamps[index];
    if (!segment) return;

    const player = ytPlayerRef.current;
    if (player && typeof player.seekTo === 'function') {
      if (isLoopingSegment && activePreviewIndex === index) {
        player.pauseVideo();
        setIsLoopingSegment(false);
        setActivePreviewIndex(null);
      } else {
        const start = timeStringToSeconds(segment.startTime);
        player.seekTo(start, true);
        player.playVideo();
        setIsLoopingSegment(true);
        setActivePreviewIndex(index);
      }
    }
  };

  const handleSetSpeed = (speed: string) => {
    setPlaybackSpeed(speed);
    const player = ytPlayerRef.current;
    if (player && typeof player.setPlaybackRate === 'function') {
      player.setPlaybackRate(parseFloat(speed));
    }
  };

  const handleProjectSelect = (id: string) => {
    setActiveProjectId(id);
    setDb(prev => ({ ...prev, activeProjectId: id }));
  };

  /* ----------------------------------------------------
     Bulk Columns Importer
     ---------------------------------------------------- */
  const handleImportSubmit = () => {
    const val = importInputText.trim();
    if (!val) {
      setShowImportModal(false);
      return;
    }

    const lines = val.split('\n');
    const importedRows: ReelsTimestamp[] = [];

    lines.forEach((line, idx) => {
      const cleanLine = line.trim();
      if (!cleanLine) return;

      let parts = cleanLine.split('\t');
      if (parts.length < 2) parts = cleanLine.split(',');
      if (parts.length < 2) parts = cleanLine.split(/\s{2,}/);

      if (parts.length >= 2) {
        const hook = parts[0]?.trim() || `Segment ${idx + 1}`;
        const start = parts[1]?.trim() || '0:00:00';
        const end = parts[2]?.trim() || '0:00:00';
        importedRows.push({
          id: `ts-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
          hook,
          startTime: start,
          endTime: end
        });
      } else {
        const timeRegex = /(\d{1,2}:)?\d{1,2}:\d{2}/g;
        const matches = cleanLine.match(timeRegex);
        if (matches && matches.length > 0) {
          const start = matches[0];
          const end = matches[1] || '0:00:00';
          let hook = cleanLine;
          matches.forEach(m => {
            hook = hook.replace(m, '');
          });
          hook = hook.trim().replace(/^[-–—]\s*/, '').trim();

          importedRows.push({
            id: `ts-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
            hook: hook || `Segment ${idx + 1}`,
            startTime: start,
            endTime: end
          });
        }
      }
    });

    if (importedRows.length > 0) {
      setDb(prev => ({
        ...prev,
        projects: prev.projects.map(p => p.id === activeProject.id ? { ...p, reelsTimestamps: [...p.reelsTimestamps, ...importedRows] } : p)
      }));
      setShowImportModal(false);
      alert(`Successfully imported ${importedRows.length} rows!`);
    } else {
      alert("Could not parse columns. Make sure you copy/paste columns of data.");
    }
  };

  /* ----------------------------------------------------
     Database backup utilities
     ---------------------------------------------------- */
  const handleBackupExport = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(db, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `reels-cutter-backup-${Date.now()}.json`);
    dlAnchorElem.click();
  };

  const handleBackupRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const backup = JSON.parse(evt.target?.result as string);
        if (backup.projects && Array.isArray(backup.projects)) {
          setDb(backup);
          if (backup.projects.length > 0) {
            setActiveProjectId(backup.activeProjectId || backup.projects[0].id);
          }
          alert("Database restored successfully!");
        } else {
          alert("Invalid backup file format.");
        }
      } catch (err) {
        alert("Failed to parse backup JSON file.");
      }
    };
    reader.readAsText(file);
  };

  /* ----------------------------------------------------
     Gemini AI Subtitle Parser & Generator
     ---------------------------------------------------- */
  const parseSubtitleText = (content: string, extension: string): string => {
    const clean = content.trim();
    if (extension === 'sbv') {
      const lines = clean.split('\n');
      let result = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^\d{1,2}:\d{2}:\d{2}/.test(line) || /^\d{1,2}:\d{2}/.test(line)) {
          result += `[${line}] `;
        } else if (line) {
          result += `${line}\n`;
        }
      }
      return result;
    } else if (extension === 'srt') {
      const lines = clean.split('\n');
      let result = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/^\d+$/.test(line)) continue;
        if (line.includes('-->')) {
          const parts = line.split('-->').map(p => p.trim().split(',')[0]);
          result += `[${parts[0]} - ${parts[1]}] `;
        } else if (line) {
          result += `${line}\n`;
        }
      }
      return result;
    }
    return content;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSubtitleFile(file);
    setAiError(null);

    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const parsedText = parseSubtitleText(text, ext);
      setSubtitleText(parsedText);
    };
    reader.readAsText(file);
  };

  const handleAISubmit = async () => {
    if (!geminiApiKey.trim()) {
      alert("Please enter a valid Gemini API Key.");
      return;
    }

    setIsAiLoading(true);
    setAiStatus("Connecting to Gemini Flash Latest...");
    setAiError(null);

    const promptText = `You are a professional video editor specializing in cutting engaging Reels/Shorts clips from YouTube videos.
We have a video project titled: "${activeProject.title}".
Analyze the following transcript subtitles text, which contains dialogue paired with time tags (formatted as [start_time - end_time] or [start_time]).
Extract the most engaging clips, highlights, or topics that are ideal for vertical Reels.
Each cut must have an engaging Hook title/question and the start/end timestamp ranges.

Subtitles Transcript:
"""
${subtitleText || 'No transcript file provided. Please brainstorm cuts and segment ideas based only on the video title.'}
"""

You MUST return ONLY a valid JSON object matching this schema. Do NOT wrap the JSON in markdown code blocks like \`\`\`json. Return the raw JSON directly:
{
  "timestamps": [
    {
      "hook": "An engaging topic hook title or dialogue hook for the reel",
      "startTime": "0:01:25",
      "endTime": "0:02:10"
    }
  ]
}`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': geminiApiKey.trim()
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: promptText }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Gemini API returned status code ${response.status}`);
      }

      const resData = await response.json();
      const rawText = resData.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) {
        throw new Error("No response returned from Gemini AI model.");
      }

      const parsed = JSON.parse(rawText.trim());
      if (!parsed.timestamps || !Array.isArray(parsed.timestamps)) {
        throw new Error("Invalid response format. Expected timestamps array.");
      }

      const newSegments = parsed.timestamps.map((t: any, idx: number) => ({
        id: `ts-ai-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 4)}`,
        hook: t.hook || `AI Segment ${idx + 1}`,
        startTime: t.startTime || '0:00:00',
        endTime: t.endTime || '0:00:00'
      }));

      setDb(prev => ({
        ...prev,
        projects: prev.projects.map(p => p.id === activeProject.id ? { ...p, reelsTimestamps: [...p.reelsTimestamps, ...newSegments] } : p)
      }));

      setShowAIModal(false);
      setSubtitleFile(null);
      setSubtitleText('');
      alert(`Successfully generated ${newSegments.length} reels timestamps!`);
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || "Failed to parse API response");
    } finally {
      setIsAiLoading(false);
    }
  };

  /* ----------------------------------------------------
     Calculations & Validation helpers
     ---------------------------------------------------- */
  const totalReels = activeProject?.reelsTimestamps.length || 0;
  let totalDurationSec = 0;
  activeProject?.reelsTimestamps.forEach(ts => {
    const s = timeStringToSeconds(ts.startTime);
    const e = timeStringToSeconds(ts.endTime);
    if (e > s) totalDurationSec += (e - s);
  });

  const overlaps = getOverlappingRows(activeProject?.reelsTimestamps || []);
  const filteredProjects = db.projects.filter(p => p.title.toLowerCase().includes(searchQuery.toLowerCase()));

  // Generate FFmpeg commands
  const ffmpegCommands = activeProject?.reelsTimestamps.map((ts, idx) => {
    const cleanTitle = ts.hook.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').toLowerCase();
    const suffix = cleanTitle ? `_${cleanTitle}` : '';
    return `ffmpeg -ss ${ts.startTime} -to ${ts.endTime} -i "${ffmpegInputFilename}" -c copy -map 0 "reels_${idx + 1}${suffix}.mp4"`;
  }).join('\n');

  // Generate CSV data
  const triggerCSVDownload = () => {
    if (activeProject.reelsTimestamps.length === 0) {
      alert("No timestamps to export.");
      return;
    }
    let csv = "\ufeffHook,Start Time,End Time,Duration\n";
    activeProject.reelsTimestamps.forEach(ts => {
      const dur = calculateRowDuration(ts);
      csv += `"${ts.hook.replace(/"/g, '""')}",${ts.startTime},${ts.endTime},${dur}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = (activeProject.title || 'project').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    link.setAttribute("href", url);
    link.setAttribute("download", `${filename}_reels.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ----------------------------------------------------
     Render Component
     ---------------------------------------------------- */
  return (
    <div className="app-container">
      {/* Sidebar Panel */}
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="logo">
            <Scissors className="logo-icon" />
            <span>PH Reels Cutter</span>
          </div>
        </div>

        <div className="project-actions">
          <button className="btn btn-primary btn-full" onClick={handleAddNewProject}>
            <Plus size={16} />
            New Video Project
          </button>
          <div className="search-box-wrapper">
            <Search className="search-icon" />
            <input 
              type="text" 
              className="form-control search-input" 
              placeholder="Search projects..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="project-list-section">
          <h3 className="section-title">Video Projects</h3>
          <ul className="project-list">
            {filteredProjects.map(p => (
              <li 
                key={p.id} 
                className={`project-item ${p.id === activeProject.id ? 'active' : ''}`}
                onClick={() => handleProjectSelect(p.id)}
              >
                <span className="project-item-title">{p.title}</span>
                <Scissors className="project-item-icon" />
              </li>
            ))}
          </ul>
        </div>

        <div className="sidebar-footer">
          <button className="btn btn-secondary btn-full btn-sm" onClick={handleBackupExport}>
            <Download size={13} />
            Backup Database
          </button>
          <button className="btn btn-secondary btn-full btn-sm" onClick={() => document.getElementById('file-import-db-react')?.click()}>
            <Upload size={13} />
            Restore Backup
          </button>
          <input 
            type="file" 
            id="file-import-db-react" 
            style={{ display: 'none' }} 
            accept=".json" 
            onChange={handleBackupRestore}
          />
        </div>
      </aside>

      {/* Main Workspace Area */}
      <main className="main-content">
        <header className="workspace-header">
          <div className="project-title-area">
            <button 
              className="btn btn-secondary btn-icon-sm" 
              title="Toggle Sidebar" 
              onClick={() => setIsSidebarCollapsed(prev => !prev)}
            >
              <Menu size={14} />
            </button>
            <Film className="header-icon" />
            <h1 
              id="project-title-heading" 
              contentEditable 
              suppressContentEditableWarning
              title="Click to rename project"
              onBlur={(e) => handleRenameProject(e.target.textContent || '')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLElement).blur();
                }
              }}
            >
              {activeProject.title}
            </h1>
            <span id="save-status">Saved</span>
          </div>

          {/* Stats Bar */}
          <div className="project-stats">
            <div className="stat-item">
              <span className="stat-label">Total Reels:</span>
              <span className="stat-value">{totalReels}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Total Duration:</span>
              <span className="stat-value">{formatDurationSec(totalDurationSec)}</span>
            </div>
          </div>

          <div className="header-actions">
            <button className="btn btn-danger btn-sm" title="Delete Project" onClick={handleDeleteProject}>
              <Trash2 size={13} />
              Delete Project
            </button>
          </div>
        </header>

        <div className="workspace-body">
          {/* Video URL URL bar */}
          <div className="card url-card">
            <div className="card-title">YouTube Video Link</div>
            <div className="url-input-wrapper">
              <input 
                type="url" 
                className="form-control" 
                placeholder="Paste YouTube link here (e.g., https://www.youtube.com/watch?v=...)"
                value={activeProject.videoUrl || ''}
                onChange={(e) => handleUpdateVideoUrl(e.target.value)}
              />
              {activeProject.videoUrl && (
                <button className="btn btn-secondary" onClick={() => handleUpdateVideoUrl('')}>Clear</button>
              )}
            </div>
          </div>

          {/* Editor columns grid */}
          <div className="editor-grid">
            {/* Left Playback Screen Card */}
            <div className="card player-card">
              <div className="card-title">
                <span>Playback Screen</span>
                {isLoopingSegment && (
                  <span className="badge badge-active">
                    <Activity size={12} /> Looping Segment
                  </span>
                )}
              </div>

              {/* YouTube Element placeholder */}
              <div className="player-wrapper">
                <div 
                  id="youtube-player-placeholder" 
                  className="player-placeholder"
                  style={{ display: getYoutubeId(activeProject.videoUrl) ? 'none' : 'flex' }}
                >
                  <Film className="placeholder-icon" />
                  <h3>Enter a YouTube link above</h3>
                  <p>Link a stream or clip to load the video timeline, seek clips, and cut reels.</p>
                </div>
                <div id="youtube-player-element-react" style={{ display: getYoutubeId(activeProject.videoUrl) ? 'block' : 'none' }}></div>
              </div>

              {/* Interactive timeline progress bar */}
              {getYoutubeId(activeProject.videoUrl) && (
                <div className="timeline-container">
                  <div className="timeline-header">
                    <span className="timeline-title"><Activity size={13} /> Visual Segments Tracker</span>
                    <span className="timeline-duration">{secondsToTimeString(ytPlayerRef.current?.getDuration() || 0)}</span>
                  </div>
                  <div className="timeline-track-wrapper" id="timeline-track-wrapper-react" onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const clickX = e.clientX - rect.left;
                    const pct = clickX / rect.width;
                    const D = ytPlayerRef.current?.getDuration() || 0;
                    if (D > 0) seekTo(pct * D);
                  }}>
                    <div className="timeline-track">
                      {/* Dynamically draw blocks for timestamps */}
                      {activeProject.reelsTimestamps.map((ts, idx) => {
                        const D = ytPlayerRef.current?.getDuration() || 0;
                        if (D <= 0) return null;
                        const s = timeStringToSeconds(ts.startTime);
                        const e = timeStringToSeconds(ts.endTime);
                        if (s >= e || s > D) return null;
                        const startPct = (s / D) * 100;
                        const widthPct = ((Math.min(e, D) - s) / D) * 100;

                        return (
                          <div 
                            key={ts.id}
                            className={`timeline-segment-block ${activePreviewIndex === idx ? 'active-block' : ''}`}
                            style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                            title={`${ts.hook || 'Untitled'} (${ts.startTime} - ${ts.endTime})`}
                            onClick={(e) => {
                              e.stopPropagation();
                              seekTo(s);
                              setFocusedRowId(ts.id);
                              
                              // Scroll into row
                              const row = document.getElementById(`row-${ts.id}`);
                              row?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                              (row?.querySelector('.reels-text-input') as HTMLInputElement | null)?.focus();
                            }}
                          />
                        );
                      })}
                      <div id="timeline-playhead" className="timeline-playhead"></div>
                    </div>
                  </div>
                  <div id="timeline-tooltip" className="timeline-tooltip">0:00:00</div>
                </div>
              )}

              {/* Media seeker controls */}
              {getYoutubeId(activeProject.videoUrl) && (
                <div className="player-controls">
                  <div className="controls-row">
                    <div className="control-btns">
                      <button 
                        className="btn btn-primary btn-icon" 
                        title="Play/Pause (Spacebar)"
                        onClick={triggerPlayPause}
                      >
                        {ytPlayerRef.current?.getPlayerState?.() === (window as any).YT?.PlayerState?.PLAYING ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      
                      <div className="control-group">
                        <button className="btn-icon-sm" title="Back 5s (Left Arrow)" onClick={() => seekRelative(-5)}>
                          <ChevronsLeft size={14} />
                        </button>
                        <button className="btn-icon-sm" title="Back 1s" onClick={() => seekRelative(-1)}>
                          <ChevronLeft size={14} />
                        </button>
                        <button className="btn-icon-sm" title="Forward 1s" onClick={() => seekRelative(1)}>
                          <ChevronRight size={14} />
                        </button>
                        <button className="btn-icon-sm" title="Forward 5s (Right Arrow)" onClick={() => seekRelative(5)}>
                          <ChevronsRight size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="controls-right">
                      <div className="speed-control-wrapper">
                        <Gauge className="speed-icon" />
                        <select 
                          className="speed-select" 
                          title="Playback Speed"
                          value={playbackSpeed}
                          onChange={(e) => handleSetSpeed(e.target.value)}
                        >
                          <option value="0.25">0.25x</option>
                          <option value="0.5">0.5x</option>
                          <option value="0.75">0.75x</option>
                          <option value="1">1.0x</option>
                          <option value="1.25">1.25x</option>
                          <option value="1.5">1.5x</option>
                          <option value="1.75">1.75x</option>
                          <option value="2">2.0x</option>
                        </select>
                      </div>
                      <div className="digital-time">{digitalClock}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right Sheet Card Table */}
            <div className="card sheet-card">
              <div className="sheet-header">
                <div className="card-title">Timestamps Sheet</div>
                <div className="sheet-actions">
                  <button className="btn btn-secondary btn-sm" title="Sort chronologically" onClick={handleSortRows}>
                    <ArrowUpDown size={13} />
                    Sort
                  </button>
                  <button className="btn btn-danger btn-sm" title="Clear All Rows" onClick={handleClearAllRows}>
                    <Trash2 size={13} />
                    Clear All
                  </button>
                  <button className="btn btn-secondary btn-sm" title="Import" onClick={() => { setImportInputText(''); setShowImportModal(true); }}>
                    <FileSpreadsheet size={13} />
                    Import
                  </button>
                  <button className="btn btn-secondary btn-sm" title="AI Cutter" onClick={() => setShowAIModal(true)} style={{ backgroundColor: 'var(--primary-soft)', color: 'var(--primary)', borderColor: 'var(--primary-light)' }}>
                    <Sparkles size={13} />
                    AI Cutter
                  </button>
                  <button className="btn btn-secondary btn-sm" title="Export options" onClick={() => setShowExportModal(true)}>
                    <Share2 size={13} />
                    Export
                  </button>
                  <button className="btn btn-primary btn-sm" title="Add new row (Shortcut: N)" onClick={addNewRow}>
                    <Plus size={13} />
                    Add Row
                  </button>
                </div>
              </div>

              {/* Keyboard Shortcuts helper */}
              <div className="keyboard-helper">
                <span>Shortcuts: <kbd>Space</kbd> Play/Pause | <kbd>←</kbd> <kbd>→</kbd> Seek 5s | <kbd>[</kbd> Set Start | <kbd>]</kbd> Set End | <kbd>N</kbd> Add Row</span>
              </div>

              {/* Timestamps Table */}
              <div className="table-wrapper">
                <table className="stamps-table">
                  <thead>
                    <tr>
                      <th style={{ width: '35px' }}>#</th>
                      <th>Hook</th>
                      <th style={{ width: '135px' }}>Start Time</th>
                      <th style={{ width: '135px' }}>End Time</th>
                      <th style={{ width: '90px', textAlign: 'center' }}>Duration</th>
                      <th style={{ width: '110px', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeProject.reelsTimestamps.map((ts, idx) => {
                      const isWarning = overlaps.has(ts.id);
                      const duration = calculateRowDuration(ts);
                      return (
                        <tr 
                          key={ts.id} 
                          id={`row-${ts.id}`}
                          className={`${focusedRowId === ts.id ? 'active-row' : ''} ${isWarning ? 'warning-row' : ''}`}
                          onClick={() => setFocusedRowId(ts.id)}
                        >
                          {/* index */}
                          <td style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                            <div className="warning-cell-wrapper">
                              {isWarning && (
                                <span title="Warning: Overlaps with another segment!">
                                  <AlertTriangle className="warning-icon" />
                                </span>
                              )}
                              <span>{idx + 1}</span>
                            </div>
                          </td>

                          {/* Hook title input */}
                          <td>
                            <input 
                              type="text" 
                              className="reels-text-input" 
                              placeholder="রিলস টপিক / হুক..."
                              value={ts.hook}
                              onChange={(e) => handleUpdateRowHook(ts.id, e.target.value)}
                            />
                          </td>

                          {/* Start time */}
                          <td>
                            <div className="time-cell-input-group">
                              <button className="time-display-btn" title="Seek to start" onClick={() => seekTo(timeStringToSeconds(ts.startTime))}>
                                <Play size={11} />
                              </button>
                              <input 
                                type="text" 
                                className="time-small-input"
                                value={ts.startTime}
                                onChange={(e) => handleUpdateRowTimes(ts.id, 'start', e.target.value)}
                              />
                              <button className="btn-grab" title="Grab current time" onClick={() => {
                                const player = ytPlayerRef.current;
                                if (player && typeof player.getCurrentTime === 'function') {
                                  const timeStr = secondsToTimeString(player.getCurrentTime());
                                  handleUpdateRowTimes(ts.id, 'start', timeStr);
                                }
                              }}>
                                <Clock size={11} />
                              </button>
                            </div>
                          </td>

                          {/* End time */}
                          <td>
                            <div className="time-cell-input-group">
                              <button className="time-display-btn" title="Seek to end" onClick={() => seekTo(timeStringToSeconds(ts.endTime))}>
                                <Play size={11} />
                              </button>
                              <input 
                                type="text" 
                                className="time-small-input"
                                value={ts.endTime}
                                onChange={(e) => handleUpdateRowTimes(ts.id, 'end', e.target.value)}
                              />
                              <button className="btn-grab" title="Grab current time" onClick={() => {
                                const player = ytPlayerRef.current;
                                if (player && typeof player.getCurrentTime === 'function') {
                                  const timeStr = secondsToTimeString(player.getCurrentTime());
                                  handleUpdateRowTimes(ts.id, 'end', timeStr);
                                }
                              }}>
                                <Clock size={11} />
                              </button>
                            </div>
                          </td>

                          {/* Duration text */}
                          <td>
                            <div className="duration-text">{duration}</div>
                          </td>

                          {/* Row action preview and delete */}
                          <td>
                            <div className="segment-actions-cell">
                              <button 
                                className={`btn-segment-play ${activePreviewIndex === idx ? 'playing' : ''}`} 
                                title="Preview loop segment"
                                onClick={() => handlePreviewLoop(idx)}
                              >
                                <Play size={11} />
                                <span>{activePreviewIndex === idx ? 'Playing' : 'Loop'}</span>
                              </button>
                              <button className="btn-trash" title="Delete Row" onClick={() => handleDeleteRow(ts.id, idx)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {activeProject.reelsTimestamps.length === 0 && (
                  <div className="empty-state">
                    <Clock className="empty-icon" />
                    <p>No timestamps defined. Click "Add Row" or "Import" to start.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Bulk Columns Import Modal */}
      {showImportModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Import columns from Spreadsheet</h3>
              <button className="btn-close" onClick={() => setShowImportModal(false)}>&times;</button>
            </div>
            <div className="modal-body">
              <p className="help-text">
                Copy 3 columns from Excel/Google Sheets (<strong>Hook title</strong>, <strong>Start Time</strong>, and <strong>End Time</strong>) and paste them here:
              </p>
              <textarea 
                value={importInputText} 
                onChange={(e) => setImportInputText(e.target.value)} 
                placeholder="Paste spreadsheet rows here...&#10;e.g.&#10;Hook Title 1&#9;0:01:25&#9;0:02:10&#10;Hook Title 2&#9;0:03:40&#9;0:04:15"
              />
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowImportModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleImportSubmit}>Import Rows</button>
            </div>
          </div>
        </div>
      )}

      {/* Export Options Modal */}
      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-card modal-lg">
            <div className="modal-header">
              <h3>Export Options</h3>
              <button className="btn-close" onClick={() => setShowExportModal(false)}>&times;</button>
            </div>
            <div className="modal-body export-tabs-body">
              <div className="export-tabs-header">
                <button 
                  className={`export-tab-btn ${activeExportTab === 'tab-chapters' ? 'active' : ''}`}
                  onClick={() => setActiveExportTab('tab-chapters')}
                >
                  <Clipboard size={14} /> YouTube Chapters
                </button>
                <button 
                  className={`export-tab-btn ${activeExportTab === 'tab-csv' ? 'active' : ''}`}
                  onClick={() => setActiveExportTab('tab-csv')}
                >
                  <FileText size={14} /> CSV / Spreadsheet
                </button>
                <button 
                  className={`export-tab-btn ${activeExportTab === 'tab-ffmpeg' ? 'active' : ''}`}
                  onClick={() => setActiveExportTab('tab-ffmpeg')}
                >
                  <Terminal size={14} /> FFmpeg Cut Script
                </button>
              </div>

              <div className="export-tabs-contents">
                {/* Chapters tab */}
                <div className={`export-tab-content ${activeExportTab === 'tab-chapters' ? 'active' : ''}`}>
                  <p className="help-text">Copy and paste this directly into your YouTube description:</p>
                  <textarea 
                    readOnly 
                    value={activeProject.reelsTimestamps.map(ts => `${ts.startTime} - ${ts.endTime} ${ts.hook}`).join('\n')}
                    placeholder="No segments created yet..."
                  />
                  <div className="tab-actions">
                    <button className="btn btn-primary" onClick={() => {
                      const text = activeProject.reelsTimestamps.map(ts => `${ts.startTime} - ${ts.endTime} ${ts.hook}`).join('\n');
                      navigator.clipboard.writeText(text).then(() => alert("YouTube Chapters copied to clipboard!"));
                    }}>
                      <Clipboard size={14} /> Copy to Clipboard
                    </button>
                  </div>
                </div>

                {/* CSV tab */}
                <div className={`export-tab-content ${activeExportTab === 'tab-csv' ? 'active' : ''}`}>
                  <p className="help-text">Download a clean CSV spreadsheet with all timestamps data:</p>
                  <div className="csv-preview-box">
                    <table className="csv-preview-table">
                      <thead>
                        <tr>
                          <th>Hook</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeProject.reelsTimestamps.map(ts => (
                          <tr key={ts.id}>
                            <td>{ts.hook || 'Untitled'}</td>
                            <td>{ts.startTime}</td>
                            <td>{ts.endTime}</td>
                            <td>{calculateRowDuration(ts)}</td>
                          </tr>
                        ))}
                        {activeProject.reelsTimestamps.length === 0 && (
                          <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No segments defined yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="tab-actions">
                    <button className="btn btn-primary" onClick={triggerCSVDownload}>
                      <Download size={14} /> Download CSV File
                    </button>
                  </div>
                </div>

                {/* FFmpeg tab */}
                <div className={`export-tab-content ${activeExportTab === 'tab-ffmpeg' ? 'active' : ''}`}>
                  <p className="help-text">Use these command-line scripts to automatically cut your downloaded video file locally using FFmpeg:</p>
                  <div className="ffmpeg-settings">
                    <div className="form-group-inline">
                      <label for-id="ffmpeg-input-filename-react">Source File Name:</label>
                      <input 
                        type="text" 
                        id="ffmpeg-input-filename-react" 
                        className="form-control form-control-sm" 
                        value={ffmpegInputFilename} 
                        onChange={(e) => setFfmpegInputFilename(e.target.value)}
                        style={{ width: '180px' }}
                      />
                    </div>
                  </div>
                  <textarea 
                    readOnly 
                    value={ffmpegCommands}
                    placeholder="No segments created yet..."
                  />
                  <div className="tab-actions">
                    <button className="btn btn-primary" onClick={() => {
                      navigator.clipboard.writeText(ffmpegCommands).then(() => alert("FFmpeg commands copied to clipboard!"));
                    }}>
                      <Clipboard size={14} /> Copy Commands
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowExportModal(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* AI Cutter Modal */}
      {showAIModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3>AI Reels Timestamp Cutter</h3>
              <button className="btn-close" onClick={() => setShowAIModal(false)}>&times;</button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* API Key */}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Gemini API Key:
                </label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    type={showApiKey ? "text" : "password"} 
                    className="form-control" 
                    placeholder="Enter your Gemini API Key..."
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                  />
                  <button 
                    className="btn btn-secondary btn-icon-sm" 
                    style={{ minWidth: '36px', height: '38px', borderRadius: '6px' }}
                    onClick={() => setShowApiKey(prev => !prev)}
                    title="Toggle key visibility"
                  >
                    {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Get a free API Key from <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'underline' }}>Google AI Studio</a>. Key is saved locally.
                </p>
              </div>

              {/* Subtitle upload */}
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Upload Subtitles File (.sbv, .srt, .vtt):
                </label>
                {!subtitleFile ? (
                  <div 
                    className="file-upload-dropzone"
                    onClick={() => document.getElementById('file-upload-subtitles')?.click()}
                  >
                    <Upload className="file-upload-icon" />
                    <p>Click to browse and upload subtitle file</p>
                    <span>Supports YouTube .sbv, .srt, and .vtt captions</span>
                    <input 
                      type="file" 
                      id="file-upload-subtitles" 
                      style={{ display: 'none' }} 
                      accept=".sbv,.srt,.vtt,.txt"
                      onChange={handleFileUpload}
                    />
                  </div>
                ) : (
                  <div className="file-uploaded-badge">
                    <div className="file-info">
                      <FileSpreadsheet />
                      <span>{subtitleFile.name}</span>
                    </div>
                    <button className="btn-remove-file" onClick={() => { setSubtitleFile(null); setSubtitleText(''); }}>
                      <X size={14} />
                    </button>
                  </div>
                )}
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  Upload the video subtitles. Gemini will parse dialogue and timestamps to identify high-impact reel hooks!
                </p>
              </div>

              {/* Loader Status */}
              {isAiLoading && (
                <div id="ai-status-container" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary)', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'var(--primary-soft)', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--primary-light)' }}>
                  <Loader className="badge-active" size={14} />
                  <span>{aiStatus}</span>
                </div>
              )}

              {/* Error logs */}
              {aiError && (
                <div style={{ color: 'var(--danger)', fontSize: '0.8rem', fontWeight: 600, backgroundColor: 'var(--danger-soft)', padding: '0.5rem', borderRadius: '6px', border: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <AlertTriangle size={14} />
                  <span>Error: {aiError}</span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowAIModal(false)} disabled={isAiLoading}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAISubmit} disabled={isAiLoading} style={{ background: 'var(--primary-gradient)' }}>
                <Sparkles size={13} />
                Generate Timestamps
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------
   Overlapping segments helper
   ---------------------------------------------------- */
function getOverlappingRows(timestamps: ReelsTimestamp[]): Set<string> {
  const sorted = timestamps
    .map((ts, idx) => ({ ts, originalIndex: idx, start: timeStringToSeconds(ts.startTime), end: timeStringToSeconds(ts.endTime) }))
    .filter(item => item.end > item.start)
    .sort((a, b) => a.start - b.start);

  const overlappingIds = new Set<string>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.start < prev.end) {
      overlappingIds.add(curr.ts.id);
      overlappingIds.add(prev.ts.id);
    }
  }
  return overlappingIds;
}

/* ----------------------------------------------------
   Duration calculations helper
   ---------------------------------------------------- */
function calculateRowDuration(ts: ReelsTimestamp): string {
  const start = timeStringToSeconds(ts.startTime);
  const end = timeStringToSeconds(ts.endTime);
  if (start >= end) return '--';
  
  const diff = end - start;
  const mins = Math.floor(diff / 60);
  const secs = diff % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/* ----------------------------------------------------
   Format Duration seconds helper
   ---------------------------------------------------- */
function formatDurationSec(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  
  let parts: string[] = [];
  if (hrs > 0) parts.push(`${hrs}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}
