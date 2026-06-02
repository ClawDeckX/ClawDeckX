// Package llmdirect provides a direct LLM streaming client that reads provider
// configuration from openclaw.json and calls the LLM API without going through
// the OpenClaw agent session machinery (which triggers tool execution).
package llmdirect

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ProviderConfig holds the resolved LLM provider settings.
type ProviderConfig struct {
	ProviderID string
	BaseURL    string
	APIKey     string
	API        string // "openai-completions" etc.
	ModelID    string // without provider prefix
	MaxTokens  int    // from model config; 0 = use caller default
}

// openclawJSON is a minimal parse of ~/.openclaw/openclaw.json.
type openclawJSON struct {
	Models struct {
		Providers map[string]struct {
			BaseURL string `json:"baseUrl"`
			APIKey  string `json:"apiKey"`
			API     string `json:"api"`
			Models  []struct {
				ID        string `json:"id"`
				MaxTokens int    `json:"maxTokens"`
			} `json:"models"`
		} `json:"providers"`
	} `json:"models"`
	Agents struct {
		Defaults struct {
			Model struct {
				Primary string `json:"primary"`
			} `json:"model"`
		} `json:"defaults"`
	} `json:"agents"`
}

// ResolveProvider reads a full openclaw.json file path and returns the provider
// config for the given modelRef (e.g. "mteapi/gpt-5.4") or the default model.
// If modelRef is empty the default primary model is used.
func ResolveProvider(configPath, modelRef string) (*ProviderConfig, error) {
	resolvedPath := strings.TrimSpace(configPath)
	if resolvedPath == "" {
		return nil, fmt.Errorf("llmdirect: openclaw config path is empty")
	}
	if info, err := os.Stat(resolvedPath); err == nil && info.IsDir() {
		resolvedPath = filepath.Join(resolvedPath, "openclaw.json")
	}

	data, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("llmdirect: read openclaw.json: %w", err)
	}
	var cfg openclawJSON
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("llmdirect: parse openclaw.json: %w", err)
	}

	// Resolve model ref
	ref := strings.TrimSpace(modelRef)
	if ref == "" {
		ref = cfg.Agents.Defaults.Model.Primary
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return nil, fmt.Errorf("llmdirect: no model specified and agents.defaults.model.primary is empty")
	}

	// ref may be "providerID/modelID" or just "modelID"
	var providerID, modelID string
	if idx := strings.Index(ref, "/"); idx > 0 {
		providerID = ref[:idx]
		modelID = ref[idx+1:]
	} else {
		modelID = ref
	}

	// If providerID given, look it up directly
	if providerID != "" {
		p, ok := cfg.Models.Providers[providerID]
		if !ok {
			return nil, fmt.Errorf("llmdirect: provider %q not found in openclaw.json", providerID)
		}
		if p.BaseURL == "" || p.APIKey == "" {
			return nil, fmt.Errorf("llmdirect: provider %q missing baseUrl or apiKey", providerID)
		}
		pc := &ProviderConfig{
			ProviderID: providerID,
			BaseURL:    strings.TrimRight(p.BaseURL, "/"),
			APIKey:     p.APIKey,
			API:        p.API,
			ModelID:    modelID,
		}
		for _, m := range p.Models {
			if m.ID == modelID {
				pc.MaxTokens = m.MaxTokens
				break
			}
		}
		return pc, nil
	}

	// No provider prefix — search all providers for this modelID
	for pid, p := range cfg.Models.Providers {
		for _, m := range p.Models {
			if m.ID == modelID {
				if p.BaseURL == "" || p.APIKey == "" {
					return nil, fmt.Errorf("llmdirect: provider %q missing baseUrl or apiKey", pid)
				}
				return &ProviderConfig{
					ProviderID: pid,
					BaseURL:    strings.TrimRight(p.BaseURL, "/"),
					APIKey:     p.APIKey,
					API:        p.API,
					ModelID:    modelID,
					MaxTokens:  m.MaxTokens,
				}, nil
			}
		}
	}

	return nil, fmt.Errorf("llmdirect: model %q not found in any provider", modelID)
}

// ToolCall represents a single tool/function call from the LLM.
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // "function"
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// Message is a single chat message.
type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`   // assistant messages with tool calls
	ToolCallID string     `json:"tool_call_id,omitempty"` // tool role messages referencing a call
	Name       string     `json:"name,omitempty"`         // tool name for tool role messages
}

// StreamChunk is a delta token received from the SSE stream.
type StreamChunk struct {
	Token     string
	ToolCalls []ToolCall // populated on Done when finish_reason=tool_calls
	Done      bool
	Error     error
}

// StreamCompletion sends a streaming chat completion request and yields chunks
// on the returned channel. The channel is closed when the stream ends or ctx is cancelled.
// Uses OpenAI-compatible /chat/completions with stream=true.
// Optional tools parameter: pass a []ToolDef as the first variadic arg to enable tool calling.
func StreamCompletion(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int, optTools ...[]ToolDef) <-chan StreamChunk {
	var tools []ToolDef
	if len(optTools) > 0 {
		tools = optTools[0]
	}
	ch := make(chan StreamChunk, 64)
	go func() {
		defer close(ch)
		if err := doStream(ctx, cfg, messages, maxTokens, tools, ch); err != nil {
			ch <- StreamChunk{Error: err}
		}
	}()
	return ch
}

func doStream(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int, tools []ToolDef, ch chan<- StreamChunk) error {
	// Use model's configured maxTokens when caller passes 0 or a smaller value.
	if cfg.MaxTokens > 0 && (maxTokens <= 0 || maxTokens < cfg.MaxTokens) {
		maxTokens = cfg.MaxTokens
	}
	if maxTokens <= 0 {
		maxTokens = 8192
	}

	if cfg.API == "anthropic-messages" {
		return doStreamAnthropic(ctx, cfg, messages, maxTokens, ch)
	}
	return doStreamOpenAI(ctx, cfg, messages, maxTokens, tools, ch)
}

// resolveOpenAIURL builds the chat completions endpoint from the provider's BaseURL.
// Handles common configurations: baseUrl ending with /v1, /v1/, or already containing
// the full /chat/completions path.
func resolveOpenAIURL(base string) string {
	b := strings.TrimRight(base, "/")
	if strings.HasSuffix(b, "/chat/completions") {
		return b
	}
	if strings.HasSuffix(b, "/v1") {
		return b + "/chat/completions"
	}
	return b + "/v1/chat/completions"
}

// resolveAnthropicURL builds the messages endpoint from the provider's BaseURL.
func resolveAnthropicURL(base string) string {
	b := strings.TrimRight(base, "/")
	if strings.HasSuffix(b, "/v1/messages") || strings.HasSuffix(b, "/messages") {
		return b
	}
	if strings.HasSuffix(b, "/v1") {
		return b + "/messages"
	}
	return b + "/v1/messages"
}

// doStreamOpenAI handles OpenAI-compatible /chat/completions streaming.
func doStreamOpenAI(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int, tools []ToolDef, ch chan<- StreamChunk) error {
	body := map[string]interface{}{
		"model":      cfg.ModelID,
		"messages":   messages,
		"stream":     true,
		"max_tokens": maxTokens,
	}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("llmdirect: marshal request: %w", err)
	}

	url := resolveOpenAIURL(cfg.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("llmdirect: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	client := &http.Client{Timeout: 0} // no overall timeout — caller manages via ctx
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("llmdirect: http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		limitedBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("llmdirect: LLM returned HTTP %d: %s", resp.StatusCode, string(limitedBody))
	}

	// Parse SSE stream: "data: {...}\n\n"
	// tool_calls are accumulated across delta chunks and emitted on Done.
	tcMap := map[int]*tcAccum{}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*512), 1024*512)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")
		if payload == "[DONE]" {
			ch <- StreamChunk{Done: true, ToolCalls: buildToolCalls(tcMap)}
			return nil
		}
		var event struct {
			Choices []struct {
				Delta struct {
					Content   string `json:"content"`
					ToolCalls []struct {
						Index    int    `json:"index"`
						ID       string `json:"id,omitempty"`
						Type     string `json:"type,omitempty"`
						Function struct {
							Name      string `json:"name,omitempty"`
							Arguments string `json:"arguments,omitempty"`
						} `json:"function,omitempty"`
					} `json:"tool_calls,omitempty"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(payload), &event); err != nil {
			continue // skip malformed events
		}
		for _, choice := range event.Choices {
			if choice.Delta.Content != "" {
				select {
				case ch <- StreamChunk{Token: choice.Delta.Content}:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			// Accumulate tool_call deltas
			for _, tc := range choice.Delta.ToolCalls {
				acc, ok := tcMap[tc.Index]
				if !ok {
					acc = &tcAccum{}
					tcMap[tc.Index] = acc
				}
				if tc.ID != "" {
					acc.ID = tc.ID
				}
				if tc.Type != "" {
					acc.Type = tc.Type
				}
				if tc.Function.Name != "" {
					acc.Name = tc.Function.Name
				}
				if tc.Function.Arguments != "" {
					acc.Args.WriteString(tc.Function.Arguments)
				}
			}
			if choice.FinishReason != nil && *choice.FinishReason != "" {
				ch <- StreamChunk{Done: true, ToolCalls: buildToolCalls(tcMap)}
				return nil
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("llmdirect: reading stream: %w", err)
	}
	return nil
}

// doStreamAnthropic handles Anthropic Messages API (/v1/messages) streaming.
func doStreamAnthropic(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int, ch chan<- StreamChunk) error {
	// Anthropic requires system as a top-level field, not in messages array.
	var system string
	var anthropicMsgs []map[string]string
	for _, m := range messages {
		if m.Role == "system" {
			system = m.Content
			continue
		}
		anthropicMsgs = append(anthropicMsgs, map[string]string{
			"role":    m.Role,
			"content": m.Content,
		})
	}
	// Anthropic requires at least one user message.
	if len(anthropicMsgs) == 0 {
		return fmt.Errorf("llmdirect: anthropic requires at least one user message")
	}

	body := map[string]interface{}{
		"model":      cfg.ModelID,
		"messages":   anthropicMsgs,
		"max_tokens": maxTokens,
		"stream":     true,
	}
	if system != "" {
		body["system"] = system
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("llmdirect: marshal request: %w", err)
	}

	url := resolveAnthropicURL(cfg.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return fmt.Errorf("llmdirect: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("llmdirect: http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		limitedBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("llmdirect: LLM returned HTTP %d: %s", resp.StatusCode, string(limitedBody))
	}

	// Anthropic SSE format:
	// event: content_block_delta
	// data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"..."}}
	// event: message_stop
	// data: {"type":"message_stop"}
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 1024*512), 1024*512)
	var currentEvent string
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "event: ") {
			currentEvent = strings.TrimPrefix(line, "event: ")
			continue
		}
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		payload := strings.TrimPrefix(line, "data: ")

		switch currentEvent {
		case "content_block_delta":
			var delta struct {
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(payload), &delta); err != nil {
				continue
			}
			if delta.Delta.Text != "" {
				select {
				case ch <- StreamChunk{Token: delta.Delta.Text}:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		case "message_stop":
			ch <- StreamChunk{Done: true}
			return nil
		case "message_delta":
			// message_delta with stop_reason signals end
			var md struct {
				Delta struct {
					StopReason string `json:"stop_reason"`
				} `json:"delta"`
			}
			if err := json.Unmarshal([]byte(payload), &md); err == nil && md.Delta.StopReason != "" {
				ch <- StreamChunk{Done: true}
				return nil
			}
		case "error":
			var errEvt struct {
				Error struct {
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal([]byte(payload), &errEvt); err == nil && errEvt.Error.Message != "" {
				return fmt.Errorf("llmdirect: anthropic error: %s", errEvt.Error.Message)
			}
		}
		currentEvent = ""
	}
	if err := scanner.Err(); err != nil {
		return fmt.Errorf("llmdirect: reading stream: %w", err)
	}
	// If stream ended without explicit message_stop, signal done.
	ch <- StreamChunk{Done: true}
	return nil
}

// buildToolCalls converts the accumulated tool_call deltas into a slice of ToolCall.
func buildToolCalls(m map[int]*tcAccum) []ToolCall {
	if len(m) == 0 {
		return nil
	}
	// Find max index
	maxIdx := 0
	for idx := range m {
		if idx > maxIdx {
			maxIdx = idx
		}
	}
	result := make([]ToolCall, 0, len(m))
	for i := 0; i <= maxIdx; i++ {
		acc, ok := m[i]
		if !ok {
			continue
		}
		tc := ToolCall{
			ID:   acc.ID,
			Type: acc.Type,
		}
		tc.Function.Name = acc.Name
		tc.Function.Arguments = acc.Args.String()
		result = append(result, tc)
	}
	return result
}

// Complete performs a non-streaming chat completion and returns the full response text.
// Accumulates all tokens from StreamCompletion with a timeout.
func Complete(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int, timeout time.Duration) (string, error) {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}
	var sb strings.Builder
	for chunk := range StreamCompletion(ctx, cfg, messages, maxTokens) {
		if chunk.Error != nil {
			return sb.String(), chunk.Error
		}
		if chunk.Done {
			break
		}
		sb.WriteString(chunk.Token)
	}
	return sb.String(), nil
}

// CompleteNonStream sends a single non-streaming request (stream:false) and returns the full text.
// Faster for short outputs; avoids SSE framing overhead.
func CompleteNonStream(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int) (string, error) {
	if maxTokens <= 0 {
		if cfg.MaxTokens > 0 {
			maxTokens = cfg.MaxTokens
		} else {
			maxTokens = 4096
		}
	}

	if cfg.API == "anthropic-messages" {
		return completeNonStreamAnthropic(ctx, cfg, messages, maxTokens)
	}

	body := map[string]interface{}{
		"model":      cfg.ModelID,
		"messages":   messages,
		"stream":     false,
		"max_tokens": maxTokens,
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("llmdirect: marshal request: %w", err)
	}

	url := resolveOpenAIURL(cfg.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("llmdirect: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("llmdirect: http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		limitedBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("llmdirect: LLM returned HTTP %d: %s", resp.StatusCode, string(limitedBody))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content   string     `json:"content"`
				ToolCalls []ToolCall `json:"tool_calls,omitempty"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("llmdirect: decode response: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("llmdirect: no choices in response")
	}
	return result.Choices[0].Message.Content, nil
}

// completeNonStreamAnthropic handles non-streaming Anthropic Messages API call.
func completeNonStreamAnthropic(ctx context.Context, cfg *ProviderConfig, messages []Message, maxTokens int) (string, error) {
	var system string
	var anthropicMsgs []map[string]string
	for _, m := range messages {
		if m.Role == "system" {
			system = m.Content
			continue
		}
		anthropicMsgs = append(anthropicMsgs, map[string]string{
			"role":    m.Role,
			"content": m.Content,
		})
	}
	if len(anthropicMsgs) == 0 {
		return "", fmt.Errorf("llmdirect: anthropic requires at least one user message")
	}

	body := map[string]interface{}{
		"model":      cfg.ModelID,
		"messages":   anthropicMsgs,
		"max_tokens": maxTokens,
	}
	if system != "" {
		body["system"] = system
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("llmdirect: marshal request: %w", err)
	}

	url := resolveAnthropicURL(cfg.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", fmt.Errorf("llmdirect: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("llmdirect: http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		limitedBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("llmdirect: LLM returned HTTP %d: %s", resp.StatusCode, string(limitedBody))
	}

	var result struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("llmdirect: decode response: %w", err)
	}
	var sb strings.Builder
	for _, c := range result.Content {
		if c.Type == "text" {
			sb.WriteString(c.Text)
		}
	}
	return sb.String(), nil
}

// CompleteWithTools performs a non-streaming chat completion that may return tool_calls.
// Returns content text and any tool_calls the model wants to invoke.
func CompleteWithTools(ctx context.Context, cfg *ProviderConfig, messages []Message, tools []ToolDef, maxTokens int) (string, []ToolCall, error) {
	if maxTokens <= 0 {
		if cfg.MaxTokens > 0 {
			maxTokens = cfg.MaxTokens
		} else {
			maxTokens = 4096
		}
	}

	// Anthropic tool calling uses a different wire format; fall back to streaming
	// which accumulates tool_calls via the standard StreamCompletion path.
	if cfg.API == "anthropic-messages" {
		var sb strings.Builder
		var tcs []ToolCall
		for chunk := range StreamCompletion(ctx, cfg, messages, maxTokens, tools) {
			if chunk.Error != nil {
				return sb.String(), nil, chunk.Error
			}
			if chunk.Done {
				tcs = chunk.ToolCalls
				break
			}
			sb.WriteString(chunk.Token)
		}
		return sb.String(), tcs, nil
	}

	body := map[string]interface{}{
		"model":      cfg.ModelID,
		"messages":   messages,
		"stream":     false,
		"max_tokens": maxTokens,
	}
	if len(tools) > 0 {
		body["tools"] = tools
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return "", nil, fmt.Errorf("llmdirect: marshal request: %w", err)
	}

	url := resolveOpenAIURL(cfg.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(bodyBytes))
	if err != nil {
		return "", nil, fmt.Errorf("llmdirect: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.APIKey)

	client := &http.Client{Timeout: 0}
	resp, err := client.Do(req)
	if err != nil {
		return "", nil, fmt.Errorf("llmdirect: http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		limitedBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", nil, fmt.Errorf("llmdirect: LLM returned HTTP %d: %s", resp.StatusCode, string(limitedBody))
	}

	var res struct {
		Choices []struct {
			Message struct {
				Content   string     `json:"content"`
				ToolCalls []ToolCall `json:"tool_calls,omitempty"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		return "", nil, fmt.Errorf("llmdirect: decode response: %w", err)
	}
	if len(res.Choices) == 0 {
		return "", nil, fmt.Errorf("llmdirect: no choices in response")
	}
	return res.Choices[0].Message.Content, res.Choices[0].Message.ToolCalls, nil
}

// tcAccum accumulates streamed tool_call deltas for a single call index.
type tcAccum struct {
	ID   string
	Type string
	Name string
	Args strings.Builder
}

// ToolDef defines a tool schema to pass to the LLM.
type ToolDef struct {
	Type     string      `json:"type"` // "function"
	Function ToolDefFunc `json:"function"`
}

// ToolDefFunc defines the function schema within a ToolDef.
type ToolDefFunc struct {
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Parameters  interface{} `json:"parameters,omitempty"` // JSON Schema object
}
