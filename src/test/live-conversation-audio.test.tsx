import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveConversationAudio } from "@/hooks/useLiveConversationAudio";

class MockWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  close = vi.fn((_code?: number, _reason?: string) => {
    this.readyState = MockWebSocket.CLOSED;
  });
  send = vi.fn();

  constructor(url: string) {
    super();
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  emitError() {
    const event = new Event("error");
    this.dispatchEvent(event);
    this.onerror?.(event);
  }

  emitClose(code = 1006, reason = "") {
    this.readyState = MockWebSocket.CLOSED;
    const event = new CloseEvent("close", { code, reason });
    this.dispatchEvent(event);
    this.onclose?.(event);
  }
}

describe("useLiveConversationAudio", () => {
  const originalWebSocket = globalThis.WebSocket;
  const originalMediaDevices = navigator.mediaDevices;
  const originalPermissions = navigator.permissions;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let enumerateDevices: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    MockWebSocket.instances = [];
    getUserMedia = vi.fn();
    enumerateDevices = vi.fn(async () => []);

    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: MockWebSocket,
    });

    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices,
        getUserMedia,
      },
    });

    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: {
        query: vi.fn(async () => ({
          state: "prompt",
          addEventListener: vi.fn(),
        })),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
    Object.defineProperty(navigator, "permissions", {
      configurable: true,
      value: originalPermissions,
    });
    vi.clearAllMocks();
  });

  it("rejects immediately when the websocket errors during connect", async () => {
    const { result } = renderHook(() => useLiveConversationAudio());

    const startPromise = result.current.startSession("live-session-1");
    const errorPromise = startPromise.then(
      () => null,
      (error) => error as Error,
    );

    const socket = MockWebSocket.instances.at(-1);
    expect(socket?.url).toContain("/api/voice/live/sessions/live-session-1/stream");

    await act(async () => {
      socket?.emitError();
      await Promise.resolve();
    });

    const error = await errorPromise;
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("WebSocket connection failed");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(socket?.close).not.toHaveBeenCalled();
  });

  it("rejects immediately when the websocket closes before opening", async () => {
    const { result } = renderHook(() => useLiveConversationAudio());

    const startPromise = result.current.startSession("live-session-2");
    const errorPromise = startPromise.then(
      () => null,
      (error) => error as Error,
    );

    const socket = MockWebSocket.instances.at(-1);

    await act(async () => {
      socket?.emitClose(1006, "Proxy rejected the websocket connection");
      await Promise.resolve();
    });

    const error = await errorPromise;
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe("Proxy rejected the websocket connection");
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
