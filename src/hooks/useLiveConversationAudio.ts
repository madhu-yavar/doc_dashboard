import { useCallback, useEffect, useRef, useState } from "react";

export type MediaRecorderState = "idle" | "starting" | "recording" | "paused" | "stopping" | "failed";
export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "closed" | "error";

export interface LiveAudioConfig {
  mimeType?: string;
  audioBitsPerSecond?: number;
  chunkIntervalMs?: number;
  enableDebugLogs?: boolean;
  onTranscriptFinal?: (segment: any) => void;
  onDraftUpdated?: (draft: any) => void;
  onSessionStateChange?: (status: string) => void;
}

const DEFAULT_CHUNK_INTERVAL = 5000; // 5 seconds for better transcription
const DEFAULT_MIME_TYPE = "audio/webm"; // Use WebM for better compatibility
const DEFAULT_AUDIO_BITRATE = 128000; // 128 kbps for better quality
const MICROPHONE_GAIN_BOOST = 2.0; // Not used - keeping for reference
const WEBSOCKET_CONNECT_TIMEOUT_MS = 10000;

function resolveLiveConversationWebSocketUrl(sessionId: string) {
  const configuredApiRoot = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  const baseOrigin = configuredApiRoot
    ? new URL(configuredApiRoot, window.location.origin).origin
    : window.location.origin;
  const websocketOrigin = baseOrigin.replace(/^http/i, (protocol) =>
    protocol.toLowerCase() === "https" ? "wss" : "ws",
  );

  return `${websocketOrigin}/api/voice/live/sessions/${sessionId}/stream`;
}

export interface UseLiveConversationAudioResult {
  permissionState: PermissionState;
  connectionState: ConnectionState;
  recorderState: MediaRecorderState;
  error: string | null;
  audioLevel: number;
  devices: MediaDeviceInfo[];
  selectedDevice: string | null;
  startSession: (sessionId: string, deviceId?: string) => Promise<void>;
  pauseSession: () => void;
  resumeSession: () => void;
  endSession: () => Promise<void>;
  selectDevice: (deviceId: string) => void;
  disconnect: () => void;
}

export function useLiveConversationAudio(config: LiveAudioConfig = {}): UseLiveConversationAudioResult {
  const {
    mimeType = DEFAULT_MIME_TYPE,
    audioBitsPerSecond = DEFAULT_AUDIO_BITRATE,
    chunkIntervalMs = DEFAULT_CHUNK_INTERVAL,
    enableDebugLogs = false,
    onTranscriptFinal,
    onDraftUpdated,
    onSessionStateChange,
  } = config;

  const [permissionState, setPermissionState] = useState<PermissionState>("prompt");
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");
  const [recorderState, setRecorderState] = useState<MediaRecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderStateRef = useRef<MediaRecorderState>("idle");
  const chunkTimerRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const recorderMimeTypeRef = useRef<string>(mimeType);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelAnimationFrameRef = useRef<number | null>(null);
  const levelBufferRef = useRef<Uint8Array | null>(null);
  const pendingEndRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number;
  } | null>(null);
  const pendingStartRef = useRef<{
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number;
  } | null>(null);

  const log = useCallback((message: string, data?: unknown) => {
    if (enableDebugLogs) {
      console.log(`[LiveConversationAudio] ${message}`, data || "");
    }
  }, [enableDebugLogs]);

  useEffect(() => {
    recorderStateRef.current = recorderState;
  }, [recorderState]);

  const clearPendingEnd = useCallback((error?: Error) => {
    const pendingEnd = pendingEndRef.current;
    if (!pendingEnd) return;

    window.clearTimeout(pendingEnd.timeoutId);
    pendingEndRef.current = null;

    if (error) {
      pendingEnd.reject(error);
      return;
    }

    pendingEnd.resolve();
  }, []);

  const clearPendingStart = useCallback((error?: Error) => {
    const pendingStart = pendingStartRef.current;
    if (!pendingStart) return;

    window.clearTimeout(pendingStart.timeoutId);
    pendingStartRef.current = null;

    if (error) {
      pendingStart.reject(error);
      return;
    }

    pendingStart.resolve();
  }, []);

  const stopLevelMonitoring = useCallback(() => {
    if (levelAnimationFrameRef.current) {
      window.cancelAnimationFrame(levelAnimationFrameRef.current);
      levelAnimationFrameRef.current = null;
    }

    analyserRef.current?.disconnect();
    analyserRef.current = null;
    levelBufferRef.current = null;

    if (audioContextRef.current) {
      const context = audioContextRef.current;
      audioContextRef.current = null;
      void context.close().catch(() => undefined);
    }

    setAudioLevel(0);
  }, []);

  const startLevelMonitoring = useCallback((stream: MediaStream) => {
    stopLevelMonitoring();

    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);

      const levelBuffer = new Uint8Array(analyser.frequencyBinCount);
      audioContextRef.current = context;
      analyserRef.current = analyser;
      levelBufferRef.current = levelBuffer;

      const tick = () => {
        if (!analyserRef.current || !levelBufferRef.current) return;

        analyserRef.current.getByteTimeDomainData(levelBufferRef.current);

        let sumSquares = 0;
        for (const sample of levelBufferRef.current) {
          const normalized = (sample - 128) / 128;
          sumSquares += normalized * normalized;
        }

        const rms = Math.sqrt(sumSquares / levelBufferRef.current.length);
        const nextLevel = Math.min(1, rms * 4.5);
        setAudioLevel((currentLevel) => (currentLevel * 0.55) + (nextLevel * 0.45));
        // Log audio level for debugging
        if (nextLevel > 0.01) {
          console.log('[LiveConversationAudio] Audio level:', nextLevel.toFixed(3));
        }
        levelAnimationFrameRef.current = window.requestAnimationFrame(tick);
      };

      tick();
    } catch (err) {
      log("Failed to start audio level monitoring", err);
    }
  }, [log, stopLevelMonitoring]);

  const checkPermission = useCallback(async () => {
    try {
      const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
      setPermissionState(result.state);
      result.addEventListener("change", () => {
        setPermissionState(result.state);
      });
    } catch {
      setPermissionState("prompt");
    }
  }, []);

  const enumerateDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");
      setDevices(audioInputs);
      if (audioInputs.length > 0 && !selectedDevice) {
        setSelectedDevice(audioInputs[0].deviceId);
      }
    } catch (err) {
      log("Failed to enumerate devices", err);
    }
  }, [selectedDevice, log]);

  const connectWebSocket = useCallback((sessionId: string) => {
    const existingSocket = websocketRef.current;
    if (existingSocket) {
      if (
        existingSocket.readyState === WebSocket.OPEN
        || existingSocket.readyState === WebSocket.CONNECTING
      ) {
        return existingSocket;
      }

      websocketRef.current = null;
    }

    const wsUrl = resolveLiveConversationWebSocketUrl(sessionId);
    log("Connecting WebSocket", { wsUrl });

    setConnectionState("connecting");
    setError(null);

    const ws = new WebSocket(wsUrl);
    websocketRef.current = ws;

    ws.onopen = () => {
      if (websocketRef.current !== ws) return;
      log("WebSocket connected");
      setConnectionState("connected");
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      if (websocketRef.current !== ws) return;
      try {
        const message = JSON.parse(event.data);
        // Always log WebSocket messages for debugging
        console.log("[LiveConversationAudio] WebSocket message received", message);
        log("WebSocket message received", message);

        switch (message.type) {
          case "session.ready":
            onSessionStateChange?.(message.status);
            break;
          case "session.state":
            if (message.status === "paused") {
              setRecorderState("paused");
            } else if (message.status === "live") {
              setRecorderState("recording");
              clearPendingStart();
            } else if (message.status === "review_required") {
              setRecorderState("idle");
              setConnectionState("closed");
              clearPendingEnd();
            }
            onSessionStateChange?.(message.status);
            break;
          case "transcript.final":
            onTranscriptFinal?.(message.segment);
            break;
          case "draft.updated":
            onDraftUpdated?.(message.draft);
            break;
          case "session.error":
            setError(message.error);
            setConnectionState("error");
            clearPendingStart(new Error(message.error || "Session error"));
            clearPendingEnd(new Error(message.error || "Session error"));
            break;
        }
      } catch (err) {
        log("Failed to parse WebSocket message", err);
      }
    };

    ws.onerror = (event) => {
      if (websocketRef.current !== ws) return;
      log("WebSocket error", event);
      setError("Connection error");
      setConnectionState("error");
    };

    ws.onclose = (event) => {
      if (websocketRef.current !== ws) return;
      log("WebSocket closed", { code: event.code, reason: event.reason });
      if (websocketRef.current === ws) {
        websocketRef.current = null;
      }
      setConnectionState("closed");
      clearPendingStart(new Error("Microphone capture did not start"));
      clearPendingEnd();

      if (recorderStateRef.current === "recording" && event.code !== 1000) {
        setConnectionState("reconnecting");
        reconnectTimerRef.current = window.setTimeout(() => {
          if (sessionIdRef.current) {
            connectWebSocket(sessionIdRef.current);
          }
        }, 3000);
      }
    };

    return ws;
  }, [clearPendingEnd, clearPendingStart, log, onDraftUpdated, onSessionStateChange, onTranscriptFinal]);

  const waitForWebSocketOpen = useCallback((websocket: WebSocket) => new Promise<void>((resolve, reject) => {
    if (websocket.readyState === WebSocket.OPEN) {
      resolve();
      return;
    }

    if (websocket.readyState === WebSocket.CLOSING || websocket.readyState === WebSocket.CLOSED) {
      reject(new Error("WebSocket closed before the connection was established"));
      return;
    }

    let settled = false;

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      websocket.removeEventListener("open", handleOpen);
      websocket.removeEventListener("error", handleError);
      websocket.removeEventListener("close", handleClose);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const handleOpen = () => {
      settle(resolve);
    };

    const handleError = () => {
      settle(() => reject(new Error("WebSocket connection failed")));
    };

    const handleClose = (event: CloseEvent) => {
      const reason = event.reason?.trim();
      settle(() => reject(new Error(reason || "WebSocket closed before the connection was established")));
    };

    const timeoutId = window.setTimeout(() => {
      settle(() => reject(new Error("WebSocket connection timeout")));
    }, WEBSOCKET_CONNECT_TIMEOUT_MS);

    websocket.addEventListener("open", handleOpen);
    websocket.addEventListener("error", handleError);
    websocket.addEventListener("close", handleClose);
  }), []);

  const startRecording = useCallback(async (deviceId?: string) => {
    try {
      setRecorderState("starting");
      setError(null);

      const constraints: MediaStreamConstraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      };

      log("Requesting microphone access", constraints);
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia(constraints),
        new Promise<MediaStream>((_, reject) => {
          window.setTimeout(() => {
            reject(new Error("Microphone permission timed out. Allow access and try Start again."));
          }, 15000);
        }),
      ]);
      streamRef.current = stream;
      setPermissionState("granted");
      startLevelMonitoring(stream);

      log("Enumerating devices after permission granted");
      await enumerateDevices();

      let supportedMimeType = mimeType;
      // Prioritize WebM/Opus which works best with both browsers and Whisper STT
      const types = [
        "audio/webm;codecs=opus",  // Chrome/Firefox - best quality
        "audio/webm",
        "audio/ogg;codecs=opus",   // Firefox
        "audio/mp4",                // Safari fallback
        "audio/mpeg",               // MP3 format
      ];

      for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
          supportedMimeType = type;
          break;
        }
      }

      log("Using MIME type", { selected: supportedMimeType, requested: mimeType });

      const recorder = new MediaRecorder(stream, {
        mimeType: supportedMimeType,
        audioBitsPerSecond: audioBitsPerSecond ?? DEFAULT_AUDIO_BITRATE,
      });

      mediaRecorderRef.current = recorder;
      recorderMimeTypeRef.current = recorder.mimeType || supportedMimeType || mimeType;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && websocketRef.current?.readyState === WebSocket.OPEN) {
          log("Sending audio chunk", { size: event.data.size });
          console.log("[LiveConversationAudio] Sending audio chunk", { size: event.data.size, type: event.data.type });
          websocketRef.current.send(event.data);
        }
      };

      recorder.onerror = (event) => {
        log("MediaRecorder error", event);
        setError("Recording error");
        setRecorderState("failed");
      };

      recorder.start(chunkIntervalMs);
      setRecorderState("recording");
      log("Recording started", { interval: chunkIntervalMs });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("Failed to start recording", err);
      setError(message);
      setRecorderState("failed");
      if (message.toLowerCase().includes("denied") || message.toLowerCase().includes("notallowed")) {
        setPermissionState("denied");
      } else {
        setPermissionState("prompt");
      }
      throw err instanceof Error ? err : new Error(message);
    }
  }, [mimeType, audioBitsPerSecond, chunkIntervalMs, log, enumerateDevices, startLevelMonitoring]);

  const stopRecording = useCallback(() => {
    log("Stopping recording");

    if (chunkTimerRef.current) {
      window.clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    stopLevelMonitoring();
    setRecorderState("idle");
  }, [log, stopLevelMonitoring]);

  const flushAndStopRecording = useCallback(async () => {
    log("Flushing final audio chunk before stopping");

    if (chunkTimerRef.current) {
      window.clearInterval(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        let finished = false;

        const finish = () => {
          if (finished) return;
          finished = true;
          resolve();
        };

        recorder.addEventListener("dataavailable", finish, { once: true });
        recorder.addEventListener("stop", finish, { once: true });

        try {
          recorder.stop();
        } catch {
          finish();
        }

        window.setTimeout(finish, 600);
      });
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    mediaRecorderRef.current = null;
    stopLevelMonitoring();
  }, [log, stopLevelMonitoring]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const websocket = websocketRef.current;
    if (websocket) {
      websocketRef.current = null;
      websocket.onopen = null;
      websocket.onmessage = null;
      websocket.onerror = null;
      websocket.onclose = null;

      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close(1000, "User disconnected");
      } else if (websocket.readyState === WebSocket.CONNECTING) {
        websocket.addEventListener("open", () => {
          try {
            websocket.close(1000, "User disconnected");
          } catch {
            // Ignore close failures while abandoning an in-flight socket.
          }
        }, { once: true });
      }
    }

    stopRecording();
    clearPendingStart();
    clearPendingEnd();
    sessionIdRef.current = null;
    setConnectionState("idle");
    log("Disconnected");
  }, [clearPendingEnd, clearPendingStart, stopRecording, log]);

  const startSession = useCallback(async (sessionId: string, deviceId?: string) => {
    sessionIdRef.current = sessionId;

    if (!deviceId && selectedDevice) {
      deviceId = selectedDevice;
    } else if (!deviceId && devices.length > 0) {
      deviceId = devices[0].deviceId;
    }

    setSelectedDevice(deviceId || null);
    const websocket = connectWebSocket(sessionId);

    try {
      await waitForWebSocketOpen(websocket);
    } catch (error) {
      disconnect();
      throw error;
    }

    try {
      await startRecording(deviceId);
    } catch (error) {
      disconnect();
      throw error;
    }

    if (!websocketRef.current || websocketRef.current !== websocket || websocket.readyState !== WebSocket.OPEN) {
      disconnect();
      throw new Error("WebSocket disconnected before recording could begin");
    }

    try {
      await new Promise<void>((resolve, reject) => {
        pendingStartRef.current = {
          resolve,
          reject,
          timeoutId: window.setTimeout(() => {
            pendingStartRef.current = null;
            reject(new Error("Timed out waiting for live capture to begin"));
          }, 8000),
        };

        websocket.send(JSON.stringify({
          type: "session.begin",
          mimeType: recorderMimeTypeRef.current || mimeType,
        }));
      });
    } catch (error) {
      disconnect();
      throw error;
    }
  }, [connectWebSocket, startRecording, selectedDevice, devices, disconnect, waitForWebSocketOpen]);

  const pauseSession = useCallback(() => {
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ type: "session.pause" }));
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
    }
    setRecorderState("paused");
    log("Session paused");
  }, [log]);

  const resumeSession = useCallback(() => {
    if (websocketRef.current?.readyState === WebSocket.OPEN) {
      websocketRef.current.send(JSON.stringify({ type: "session.resume" }));
    }
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
    }
    setRecorderState("recording");
    log("Session resumed");
  }, [log]);

  const endSession = useCallback(async () => {
    setRecorderState("stopping");
    setError(null);

    await flushAndStopRecording();

    const websocket = websocketRef.current;
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      setConnectionState("closed");
      setRecorderState("idle");
      log("Session ended without active WebSocket");
      return;
    }

    await new Promise<void>((resolve, reject) => {
      pendingEndRef.current = {
        resolve,
        reject,
        timeoutId: window.setTimeout(() => {
          pendingEndRef.current = null;
          reject(new Error("Timed out waiting for session to finish"));
        }, 8000),
      };

      websocket.send(JSON.stringify({ type: "session.end" }));
    });

    log("Session ended");
  }, [flushAndStopRecording, log]);

  const selectDevice = useCallback((deviceId: string) => {
    setSelectedDevice(deviceId);
  }, []);

  useEffect(() => {
    checkPermission();
    enumerateDevices();

    return () => {
      disconnect();
    };
  }, [checkPermission, enumerateDevices, disconnect]);

  return {
    permissionState,
    connectionState,
    recorderState,
    error,
    audioLevel,
    devices,
    selectedDevice,
    startSession,
    pauseSession,
    resumeSession,
    endSession,
    selectDevice,
    disconnect,
  };
}
