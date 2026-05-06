package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
)

func remoteLogin(ctx context.Context, client *http.Client, base *url.URL, username, password string) (string, error) {
	payload, _ := json.Marshal(map[string]string{"username": username, "password": password})
	u := *base
	u.Path = "/api/v1/auth/login"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("remote login request failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("remote login failed: %s", string(body))
	}
	for _, c := range resp.Cookies() {
		if len(c.Value) > 20 {
			return c.Name + "=" + c.Value, nil
		}
	}
	var loginResp struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &loginResp); err == nil && loginResp.Data.Token != "" {
		return "claw_token=" + loginResp.Data.Token, nil
	}
	return "", fmt.Errorf("remote login: no session cookie received")
}

func remotePostJSON(ctx context.Context, client *http.Client, base *url.URL, path string, body any, auth remoteOpenClawRequest) ([]byte, error) {
	payload, _ := json.Marshal(body)
	u := *base
	u.Path = path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	setRemoteAuth(req, auth)
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 210<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("remote %s failed: %s", path, string(data))
	}
	return data, nil
}

func remoteExportSnapshot(ctx context.Context, client *http.Client, base *url.URL, id string, auth remoteOpenClawRequest) ([]byte, error) {
	u := *base
	u.Path = "/api/v1/snapshots/" + url.PathEscape(id) + "/export"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), nil)
	if err != nil {
		return nil, err
	}
	setRemoteAuth(req, auth)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 210<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("remote export failed: %s", string(data))
	}
	return data, nil
}
