package web

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/logger"
)

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *statusWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *statusWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if hj, ok := w.ResponseWriter.(http.Hijacker); ok {
		return hj.Hijack()
	}
	return nil, nil, fmt.Errorf("underlying ResponseWriter does not support hijacking")
}

func RecoveryMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				logger.Log.Error().
					Str("request_id", GetRequestID(r)).
					Interface("panic", err).
					Str("stack", string(debug.Stack())).
					Msg("PANIC RECOVERED")
				FailErr(w, r, ErrInternalError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func RequestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := GenerateRequestID()
		r = SetRequestID(r, id)
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r)
	})
}

// ClientIP extracts the IP address from RemoteAddr, handling IPv6 correctly.
func ClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// SanitizePath redacts sensitive query parameters (e.g. token) for logging.
func SanitizePath(r *http.Request) string {
	if r.URL.RawQuery == "" {
		return r.URL.Path
	}
	q := r.URL.Query()
	if q.Get("token") != "" {
		q.Set("token", "[REDACTED]")
		return r.URL.Path + "?" + q.Encode()
	}
	return r.URL.RequestURI()
}

func RequestLogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(sw, r)
		logger.Log.Info().
			Str("request_id", GetRequestID(r)).
			Str("method", r.Method).
			Str("path", SanitizePath(r)).
			Str("ip", ClientIP(r)).
			Int("status", sw.status).
			Dur("latency", time.Since(start)).
			Msg("HTTP request")
	})
}

func CORSMiddleware(origins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool)
	for _, o := range origins {
		allowed[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			// Only allow explicitly configured origins; empty list = same-origin only
			if origin != "" && len(allowed) > 0 && allowed[origin] {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Max-Age", "86400")
				w.Header().Set("Vary", "Origin")
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// SecurityHeadersMiddleware adds security response headers.
func SecurityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// CSP: allow inline styles, same-origin scripts, Google Fonts CDN
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss:")
		next.ServeHTTP(w, r)
	})
}

// RateLimiter is a simple token-bucket rate limiter.
type RateLimiter struct {
	mu      sync.Mutex
	clients map[string]*rateBucket
	rate    int           // max requests per window
	window  time.Duration // window duration
}

type rateBucket struct {
	count   int
	resetAt time.Time
}

func NewRateLimiter(rate int, window time.Duration, ctx context.Context) *RateLimiter {
	rl := &RateLimiter{
		clients: make(map[string]*rateBucket),
		rate:    rate,
		window:  window,
	}
	// periodically clean expired entries; stop when ctx is cancelled
	go func() {
		ticker := time.NewTicker(window * 2)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rl.mu.Lock()
				now := time.Now()
				for k, b := range rl.clients {
					if now.After(b.resetAt) {
						delete(rl.clients, k)
					}
				}
				rl.mu.Unlock()
			}
		}
	}()
	return rl
}

func (rl *RateLimiter) Allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	b, exists := rl.clients[key]
	if !exists || now.After(b.resetAt) {
		rl.clients[key] = &rateBucket{count: 1, resetAt: now.Add(rl.window)}
		return true
	}
	if b.count >= rl.rate {
		return false
	}
	b.count++
	return true
}

// RateLimitMiddleware rate-limits specific paths.
func RateLimitMiddleware(limiter *RateLimiter, paths []string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, p := range paths {
				if r.URL.Path == p {
					ip := ClientIP(r)
					if !limiter.Allow(ip + ":" + p) {
						logger.Log.Warn().Str("ip", ip).Str("path", r.URL.Path).Msg("request rate limited")
						FailErr(w, r, ErrRateLimited)
						return
					}
					break
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// AuditFunc is a callback for writing audit log entries from middleware.
type AuditFunc func(action, result, detail, ip, username string, userID uint)

// authAuditFn holds the global audit callback set by SetAuthAuditFunc.
var authAuditFn AuditFunc

// SetAuthAuditFunc registers the audit callback used by auth middleware.
func SetAuthAuditFunc(fn AuditFunc) { authAuditFn = fn }

func AuthMiddleware(jwtSecret string, skipPaths []string) func(http.Handler) http.Handler {
	skipSet := make(map[string]bool, len(skipPaths))
	for _, sp := range skipPaths {
		skipSet[sp] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if skipSet[path] {
				next.ServeHTTP(w, r)
				return
			}

			// Static assets don't need auth
			if !strings.HasPrefix(path, "/api/") {
				next.ServeHTTP(w, r)
				return
			}

			var tokenStr string
			authHeader := r.Header.Get("Authorization")
			if authHeader != "" && strings.HasPrefix(authHeader, "Bearer ") {
				tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
			} else {
				// Try cookie
				if cookie, err := r.Cookie("claw_token"); err == nil {
					tokenStr = cookie.Value
				}
			}

			if tokenStr == "" {
				if authAuditFn != nil {
					authAuditFn("auth.failed", "failed", "no token: "+path, r.RemoteAddr, "", 0)
				}
				Fail(w, r, ErrUnauthorized.Code, ErrUnauthorized.Message, ErrUnauthorized.HTTPStatus)
				return
			}

			claims, err := ValidateJWT(tokenStr, jwtSecret)
			if err != nil {
				if authAuditFn != nil {
					authAuditFn("auth.failed", "failed", "invalid/expired token: "+path, r.RemoteAddr, "", 0)
				}
				Fail(w, r, ErrTokenExpired.Code, ErrTokenExpired.Message, ErrTokenExpired.HTTPStatus)
				return
			}

			r = SetUserInfo(r, claims.UserID, claims.Username, claims.Role)
			next.ServeHTTP(w, r)
		})
	}
}

func RequireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if GetRole(r) != "admin" {
			if authAuditFn != nil {
				authAuditFn("forbidden", "denied", "admin required: "+r.URL.Path, r.RemoteAddr, GetUsername(r), GetUserID(r))
			}
			Fail(w, r, ErrForbidden.Code, ErrForbidden.Message, ErrForbidden.HTTPStatus)
			return
		}
		next(w, r)
	}
}

// MaxBodySizeMiddleware limits request body size to prevent OOM from oversized payloads.
func MaxBodySizeMiddleware(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Body != nil && r.ContentLength != 0 {
				r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			}
			next.ServeHTTP(w, r)
		})
	}
}

// InputSanitizeMiddleware sanitizes URL query parameters for dangerous patterns.
func InputSanitizeMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for key, values := range r.URL.Query() {
			for _, v := range values {
				if containsDangerousInput(v) {
					logger.Log.Warn().Str("param", key).Msg("suspicious input detected")
					FailErr(w, r, ErrInvalidInput)
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// containsDangerousInput detects common XSS injection patterns.
func containsDangerousInput(s string) bool {
	lower := strings.ToLower(s)
	dangerousPatterns := []string{
		"<script", "javascript:", "onerror=", "onload=",
	}
	for _, p := range dangerousPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

func Chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}
