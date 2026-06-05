package web

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/safego"
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
				transient := safego.IsTransientError(err)
				if transient {
					logger.Log.Warn().
						Str("request_id", GetRequestID(r)).
						Interface("panic", err).
						Msg("TRANSIENT PANIC RECOVERED (non-fatal)")
				} else {
					logger.Log.Error().
						Str("request_id", GetRequestID(r)).
						Interface("panic", err).
						Str("stack", string(debug.Stack())).
						Msg("PANIC RECOVERED")
				}
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

// IsLoopbackRequest returns true when both the client IP and target host are loopback.
func IsLoopbackRequest(r *http.Request) bool {
	host := ClientIP(r)
	ip := net.ParseIP(host)
	if ip == nil || !ip.IsLoopback() {
		return false
	}

	target := r.Host
	if h, _, err := net.SplitHostPort(target); err == nil {
		target = h
	}
	target = strings.TrimSpace(strings.ToLower(target))
	if target == "localhost" {
		return true
	}
	ip = net.ParseIP(target)
	return ip != nil && ip.IsLoopback()
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
		// CSP: allow inline styles, same-origin scripts, Google Fonts CDN + China mirrors,
		// GitHub API (template loader), npm mirrors (setup wizard mirror detection)
		w.Header().Set("Content-Security-Policy", strings.Join([]string{
			"default-src 'self'",
			"script-src 'self'",
			"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.loli.net https://fonts.geekzu.org",
			"img-src 'self' data: https:",
			"font-src 'self' data: https://fonts.gstatic.com https://fonts.loli.net https://fonts.geekzu.org",
			"connect-src 'self' ws: wss: https://github.com https://ghproxy.com https://mirror.ghproxy.com https://api.github.com https://raw.githubusercontent.com https://registry.npmjs.org https://registry.npmmirror.com https://mirrors.cloud.tencent.com https://picsum.photos https://i.picsum.photos https://fastly.picsum.photos https://market.clawdeckx.com",
		}, "; "))
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
				if cookie, err := r.Cookie(CookieNameFromRequest(r)); err == nil {
					tokenStr = cookie.Value
				}
			}

			if tokenStr == "" {
				if authAuditFn != nil {
					authAuditFn("auth.failed", "failed", "no token: "+path, r.RemoteAddr, "", 0)
				}
				logger.Auth.Warn().Str("path", path).Str("ip", r.RemoteAddr).Msg("auth failed: no token (cookie missing)")
				Fail(w, r, ErrUnauthorized.Code, ErrUnauthorized.Message, ErrUnauthorized.HTTPStatus)
				return
			}

			claims, err := ValidateJWT(tokenStr, jwtSecret)
			if err != nil {
				if authAuditFn != nil {
					authAuditFn("auth.failed", "failed", "invalid/expired token: "+path, r.RemoteAddr, "", 0)
				}
				logger.Auth.Warn().Err(err).Str("path", path).Str("ip", r.RemoteAddr).
					Int("tokenLen", len(tokenStr)).Msg("auth failed: token validation error")
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
		if !bodySanitizeExempt(r.URL.Path) && requestBodyContainsDangerousInput(r) {
			logger.Log.Warn().Str("path", r.URL.Path).Msg("suspicious request body detected")
			FailErr(w, r, ErrInvalidInput)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bodySanitizeExempt returns true for API paths whose request body may
// legitimately contain HTML-like patterns (e.g. upstream release notes
// passed for translation, or config values with URLs/code snippets).
// These endpoints must sanitize or escape output on their own.
func bodySanitizeExempt(path string) bool {
	exemptPrefixes := []string{
		"/api/v1/self-update/translate-notes",
		"/api/v1/gateway/config",
	}
	for _, p := range exemptPrefixes {
		if strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}

func requestBodyContainsDangerousInput(r *http.Request) bool {
	if r.Body == nil || r.ContentLength == 0 {
		return false
	}

	contentType := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	if !(strings.Contains(contentType, "application/json") ||
		strings.Contains(contentType, "application/x-www-form-urlencoded") ||
		strings.Contains(contentType, "text/plain") ||
		strings.Contains(contentType, "text/html")) {
		return false
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return false
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return containsDangerousInput(string(body))
}

// containsDangerousInput detects common XSS injection patterns.
func containsDangerousInput(s string) bool {
	lower := strings.ToLower(s)
	dangerousPatterns := []string{
		"<script", "javascript:", "onerror=", "onload=",
		"onclick=", "onmouseover=", "onfocus=", "onblur=",
		"onmouseenter=", "onmouseleave=", "onanimationstart=",
		"eval(", "expression(", "vbscript:", "data:text/html",
		"<iframe", "<object", "<embed", "<svg/onload",
	}
	for _, p := range dangerousPatterns {
		if strings.Contains(lower, p) {
			return true
		}
	}
	return false
}

// gzipResponseWriter wraps http.ResponseWriter to transparently compress response bodies.
type gzipResponseWriter struct {
	http.ResponseWriter
	gz *gzip.Writer
}

func (g *gzipResponseWriter) Write(b []byte) (int, error) {
	return g.gz.Write(b)
}

func (g *gzipResponseWriter) Flush() {
	g.gz.Flush()
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

var gzipWriterPool = sync.Pool{
	New: func() interface{} {
		gz, _ := gzip.NewWriterLevel(nil, gzip.DefaultCompression)
		return gz
	},
}

// lazyGzipWriter defers the decision to gzip until Write or WriteHeader is called,
// allowing handlers to opt out by setting X-No-Gzip or using a binary Content-Type.
type lazyGzipWriter struct {
	http.ResponseWriter
	gz          *gzip.Writer
	decided     bool
	useGzip     bool
	wroteHeader bool
}

// shouldCompress returns true if the response should be gzip-compressed.
func (l *lazyGzipWriter) shouldCompress() bool {
	if l.Header().Get("X-No-Gzip") != "" {
		return false
	}
	ct := l.Header().Get("Content-Type")
	if ct == "" {
		return true // will be sniffed as text/html by net/http
	}
	// Skip already-compressed formats
	switch {
	case strings.HasPrefix(ct, "application/gzip"),
		strings.HasPrefix(ct, "application/x-gzip"),
		strings.HasPrefix(ct, "application/zip"),
		strings.HasPrefix(ct, "application/x-tar"),
		strings.HasPrefix(ct, "application/octet-stream"),
		strings.HasPrefix(ct, "image/"),
		strings.HasPrefix(ct, "video/"),
		strings.HasPrefix(ct, "audio/"):
		return false
	}
	return true
}

func (l *lazyGzipWriter) decide() {
	if l.decided {
		return
	}
	l.decided = true
	l.useGzip = l.shouldCompress()
	if l.useGzip {
		l.gz = gzipWriterPool.Get().(*gzip.Writer)
		l.gz.Reset(l.ResponseWriter)
		l.Header().Set("Content-Encoding", "gzip")
		l.Header().Set("Vary", "Accept-Encoding")
		l.Header().Del("Content-Length")
	}
	// Remove internal header before sending to client
	l.Header().Del("X-No-Gzip")
}

func (l *lazyGzipWriter) WriteHeader(code int) {
	l.decide()
	l.wroteHeader = true
	l.ResponseWriter.WriteHeader(code)
}

func (l *lazyGzipWriter) Write(b []byte) (int, error) {
	if !l.decided {
		l.decide()
	}
	if !l.wroteHeader {
		l.wroteHeader = true
		l.ResponseWriter.WriteHeader(http.StatusOK)
	}
	if l.useGzip {
		return l.gz.Write(b)
	}
	return l.ResponseWriter.Write(b)
}

func (l *lazyGzipWriter) Flush() {
	if l.useGzip && l.gz != nil {
		l.gz.Flush()
	}
	if f, ok := l.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (l *lazyGzipWriter) finish() {
	if l.useGzip && l.gz != nil {
		l.gz.Close()
		gzipWriterPool.Put(l.gz)
	}
}

// GzipMiddleware compresses responses with gzip when the client accepts it
// and the response Content-Type is compressible (JSON, HTML, JS, CSS, text).
// Handlers can set the response header "X-No-Gzip" to any value to bypass compression
// (useful for already-compressed binary downloads like .tar.gz).
func GzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		// Skip for WebSocket upgrades and SSE streams
		if r.Header.Get("Upgrade") != "" || r.Header.Get("Accept") == "text/event-stream" {
			next.ServeHTTP(w, r)
			return
		}

		// Use a buffered writer that defers the gzip decision until WriteHeader/Write,
		// so handlers can opt out via X-No-Gzip header.
		gzw := &lazyGzipWriter{ResponseWriter: w}
		next.ServeHTTP(gzw, r)
		gzw.finish()
	})
}

func Chain(h http.Handler, middlewares ...func(http.Handler) http.Handler) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		h = middlewares[i](h)
	}
	return h
}
