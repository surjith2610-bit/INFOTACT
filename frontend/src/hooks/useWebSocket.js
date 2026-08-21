import { useState, useEffect, useRef, useCallback } from "react";

export function useWebSocket(url = "ws://127.0.0.1:5001/ws") {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState(null);
  const socketRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const wsUrl = url.startsWith("ws") ? url : url.replace(/^http/, "ws") + "/ws";
      console.log("[WS HOOK] Connecting to WebSocket:", wsUrl);
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("[WS HOOK] Connected successfully!");
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setLastMessage(payload);
        } catch (err) {
          console.debug("[WS HOOK] Raw message received:", event.data);
        }
      };

      ws.onclose = () => {
        console.log("[WS HOOK] Disconnected. Scheduling reconnect in 3s...");
        setConnected(false);
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 3000);
      };

      ws.onerror = (err) => {
        console.warn("[WS HOOK] Error:", err);
        ws.close();
      };

      socketRef.current = ws;
    } catch (e) {
      console.error("[WS HOOK] Exception connecting:", e);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    }
  }, [url]);

  useEffect(() => {
    connect();
    const pingInterval = setInterval(() => {
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send("ping");
      }
    }, 15000);

    return () => {
      clearInterval(pingInterval);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  return { connected, lastMessage };
}
