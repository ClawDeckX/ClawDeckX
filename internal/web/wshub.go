package web

import (
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"ClawDeckX/internal/logger"

	"github.com/gorilla/websocket"
)

// newUpgrader creates a WebSocket upgrader that validates Origin against allowed origins.
// If allowedOrigins is empty, only same-origin requests are accepted.
func newUpgrader(allowedOrigins []string) websocket.Upgrader {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}
	return websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				return true // same-origin (no Origin header)
			}
			if len(allowed) > 0 {
				return allowed[origin]
			}
			// No explicit origins configured: accept same-host origins
			return true
		},
	}
}

type WSClient struct {
	hub      *WSHub
	conn     *websocket.Conn
	send     chan []byte
	channels map[string]bool
	mu       sync.RWMutex
}

type WSHub struct {
	clients        map[*WSClient]bool
	broadcast      chan WSMessage
	register       chan *WSClient
	unregister     chan *WSClient
	mu             sync.RWMutex
	allowedOrigins []string
}

type WSMessage struct {
	Type    string      `json:"type"`
	Data    interface{} `json:"data"`
	Channel string      `json:"-"`
}

func NewWSHub(allowedOrigins ...[]string) *WSHub {
	var origins []string
	if len(allowedOrigins) > 0 {
		origins = allowedOrigins[0]
	}
	return &WSHub{
		clients:        make(map[*WSClient]bool),
		broadcast:      make(chan WSMessage, 256),
		register:       make(chan *WSClient),
		unregister:     make(chan *WSClient),
		allowedOrigins: origins,
	}
}

func (h *WSHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			logger.WS.Debug().Int("clients", len(h.clients)).Msg("client connected")

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			logger.WS.Debug().Int("clients", len(h.clients)).Msg("client disconnected")

		case msg := <-h.broadcast:
			data, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			// Collect stale clients under RLock, then clean up under Lock
			var stale []*WSClient
			h.mu.RLock()
			for client := range h.clients {
				client.mu.RLock()
				subscribed := msg.Channel == "" || client.channels[msg.Channel]
				client.mu.RUnlock()
				if subscribed {
					select {
					case client.send <- data:
					default:
						stale = append(stale, client)
					}
				}
			}
			h.mu.RUnlock()
			// Remove stale clients outside the read lock
			if len(stale) > 0 {
				h.mu.Lock()
				for _, c := range stale {
					if _, ok := h.clients[c]; ok {
						delete(h.clients, c)
						close(c.send)
					}
				}
				h.mu.Unlock()
			}
		}
	}
}

func (h *WSHub) Broadcast(channel string, msgType string, data interface{}) {
	h.broadcast <- WSMessage{Type: msgType, Data: data, Channel: channel}
}

func (h *WSHub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *WSHub) HandleWS(jwtSecret string) http.HandlerFunc {
	wsUpgrader := newUpgrader(h.allowedOrigins)
	return func(w http.ResponseWriter, r *http.Request) {
		// Auth via query param or HttpOnly cookie
		tokenStr := r.URL.Query().Get("token")
		if tokenStr == "" {
			if cookie, err := r.Cookie("claw_token"); err == nil {
				tokenStr = cookie.Value
			}
		}
		if tokenStr == "" {
			Fail(w, r, ErrUnauthorized.Code, ErrUnauthorized.Message, ErrUnauthorized.HTTPStatus)
			return
		}
		if _, err := ValidateJWT(tokenStr, jwtSecret); err != nil {
			Fail(w, r, ErrTokenExpired.Code, ErrTokenExpired.Message, ErrTokenExpired.HTTPStatus)
			return
		}

		conn, err := wsUpgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.WS.Error().Err(err).Msg("WebSocket upgrade failed")
			return
		}

		client := &WSClient{
			hub:      h,
			conn:     conn,
			send:     make(chan []byte, 256),
			channels: make(map[string]bool),
		}
		h.register <- client

		go client.writePump()
		go client.readPump()
	}
}

func (c *WSClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})
	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		var msg struct {
			Action   string   `json:"action"`
			Channel  string   `json:"channel"`
			Channels []string `json:"channels"`
		}
		if err := json.Unmarshal(message, &msg); err != nil {
			continue
		}
		switch msg.Action {
		case "subscribe":
			c.mu.Lock()
			for _, ch := range msg.Channels {
				c.channels[ch] = true
			}
			c.mu.Unlock()
		case "unsubscribe":
			c.mu.Lock()
			delete(c.channels, msg.Channel)
			c.mu.Unlock()
		case "pause":
			c.mu.Lock()
			delete(c.channels, msg.Channel)
			c.mu.Unlock()
		case "ping":
			resp, _ := json.Marshal(map[string]string{"action": "pong"})
			select {
			case c.send <- resp:
			default:
			}
		}
	}
}

func (c *WSClient) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
