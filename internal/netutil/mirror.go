package netutil

import (
	"context"
	"net/http"
	"sort"
	"sync"
	"time"

	"ClawDeckX/internal/logger"
)

// MirrorSource represents a mirror endpoint with metadata
type MirrorSource struct {
	Name     string
	URL      string
	Priority int // Lower is higher priority
}

// MirrorResult holds the result of a mirror test
type MirrorResult struct {
	Source   MirrorSource
	Latency  time.Duration
	Success  bool
	Error    error
}

// MirrorSelector provides intelligent mirror selection with caching
type MirrorSelector struct {
	sources      []MirrorSource
	testPath     string
	timeout      time.Duration
	cacheDur     time.Duration
	cachedBest   *MirrorSource
	cachedAt     time.Time
	mu           sync.RWMutex
}

// NewMirrorSelector creates a new mirror selector
func NewMirrorSelector(sources []MirrorSource, testPath string, timeout, cacheDuration time.Duration) *MirrorSelector {
	return &MirrorSelector{
		sources:  sources,
		testPath: testPath,
		timeout:  timeout,
		cacheDur: cacheDuration,
	}
}

// GetBest returns the best (fastest) mirror, using cache if available
func (m *MirrorSelector) GetBest(ctx context.Context) *MirrorSource {
	m.mu.RLock()
	if m.cachedBest != nil && time.Since(m.cachedAt) < m.cacheDur {
		best := m.cachedBest
		m.mu.RUnlock()
		return best
	}
	m.mu.RUnlock()

	// Test all mirrors in parallel
	results := m.testAll(ctx)
	
	// Filter successful results and sort by latency
	var successful []MirrorResult
	for _, r := range results {
		if r.Success {
			successful = append(successful, r)
		}
	}

	if len(successful) == 0 {
		// All failed, return first source as fallback
		logger.Config.Warn().Msg("[MirrorSelector] All mirrors failed, using first source as fallback")
		return &m.sources[0]
	}

	// Sort by latency, then by priority
	sort.Slice(successful, func(i, j int) bool {
		if successful[i].Latency == successful[j].Latency {
			return successful[i].Source.Priority < successful[j].Source.Priority
		}
		return successful[i].Latency < successful[j].Latency
	})

	best := &successful[0].Source
	logger.Config.Info().
		Str("mirror", best.Name).
		Dur("latency", successful[0].Latency).
		Msg("[MirrorSelector] Selected best mirror")

	// Cache the result
	m.mu.Lock()
	m.cachedBest = best
	m.cachedAt = time.Now()
	m.mu.Unlock()

	return best
}

// testAll tests all mirrors in parallel and returns results
func (m *MirrorSelector) testAll(ctx context.Context) []MirrorResult {
	results := make([]MirrorResult, len(m.sources))
	var wg sync.WaitGroup

	for i, source := range m.sources {
		wg.Add(1)
		go func(idx int, src MirrorSource) {
			defer wg.Done()
			results[idx] = m.testOne(ctx, src)
		}(i, source)
	}

	wg.Wait()
	return results
}

// testOne tests a single mirror source
func (m *MirrorSelector) testOne(ctx context.Context, source MirrorSource) MirrorResult {
	testURL := source.URL + m.testPath
	
	ctx, cancel := context.WithTimeout(ctx, m.timeout)
	defer cancel()

	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, "HEAD", testURL, nil)
	if err != nil {
		return MirrorResult{Source: source, Success: false, Error: err}
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return MirrorResult{Source: source, Success: false, Error: err}
	}
	defer resp.Body.Close()

	latency := time.Since(start)
	success := resp.StatusCode >= 200 && resp.StatusCode < 400

	return MirrorResult{
		Source:  source,
		Latency: latency,
		Success: success,
	}
}

// InvalidateCache clears the cached best mirror
func (m *MirrorSelector) InvalidateCache() {
	m.mu.Lock()
	m.cachedBest = nil
	m.mu.Unlock()
}

// GetFastest is a convenience function that races all mirrors and returns the fastest
func GetFastest(ctx context.Context, urls []string, timeout time.Duration) (string, time.Duration, error) {
	if len(urls) == 0 {
		return "", 0, nil
	}

	type result struct {
		url     string
		latency time.Duration
		err     error
	}

	results := make(chan result, len(urls))
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	for _, url := range urls {
		go func(u string) {
			start := time.Now()
			req, err := http.NewRequestWithContext(ctx, "HEAD", u, nil)
			if err != nil {
				results <- result{url: u, err: err}
				return
			}

			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				results <- result{url: u, err: err}
				return
			}
			resp.Body.Close()

			if resp.StatusCode >= 200 && resp.StatusCode < 400 {
				results <- result{url: u, latency: time.Since(start)}
			} else {
				results <- result{url: u, err: http.ErrNotSupported}
			}
		}(url)
	}

	// Wait for first successful result or all failures
	var firstSuccess *result
	failures := 0
	for i := 0; i < len(urls); i++ {
		r := <-results
		if r.err == nil && firstSuccess == nil {
			firstSuccess = &r
			cancel() // Cancel remaining requests
		} else {
			failures++
		}
	}

	if firstSuccess != nil {
		return firstSuccess.url, firstSuccess.latency, nil
	}

	return urls[0], 0, nil // Fallback to first URL
}
