package openclaw

import (
	"encoding/json"
	"net"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewGWClient(t *testing.T) {
	cfg := GWClientConfig{
		Host:  "127.0.0.1",
		Port:  18789,
		Token: "test-token",
	}

	client := NewGWClient(cfg)

	assert.NotNil(t, client)
	assert.Equal(t, cfg.Host, client.cfg.Host)
	assert.Equal(t, cfg.Port, client.cfg.Port)
	assert.Equal(t, cfg.Token, client.cfg.Token)
	assert.NotNil(t, client.pending)
	assert.NotNil(t, client.stopCh)
	assert.False(t, client.connected)
	assert.False(t, client.closed)
}

func TestGWClient_SetEventHandler(t *testing.T) {
	client := NewGWClient(GWClientConfig{})

	assert.Nil(t, client.onEvent)

	client.SetEventHandler(func(event string, payload json.RawMessage) {})
	assert.NotNil(t, client.onEvent)
}

func TestGWClient_SetRestartCallback(t *testing.T) {
	client := NewGWClient(GWClientConfig{})

	called := false
	callback := func() error {
		called = true
		return nil
	}

	client.SetRestartCallback(callback)
	assert.NotNil(t, client.onRestart)

	err := client.onRestart()
	assert.NoError(t, err)
	assert.True(t, called)
}

func TestGWClient_SetNotifyCallback(t *testing.T) {
	client := NewGWClient(GWClientConfig{})

	var receivedType, receivedMsg string
	callback := func(eventType string, message string) {
		receivedType = eventType
		receivedMsg = message
	}

	client.SetNotifyCallback(callback)
	assert.NotNil(t, client.onNotify)

	client.onNotify("shutdown", "test message")
	assert.Equal(t, "shutdown", receivedType)
	assert.Equal(t, "test message", receivedMsg)
}

func TestGWClient_HealthStatus(t *testing.T) {
	client := NewGWClient(GWClientConfig{})

	status := client.HealthStatus()

	assert.False(t, status["enabled"].(bool))
	assert.Equal(t, 0, status["fail_count"].(int))
	assert.Equal(t, 3, status["max_fails"].(int))
	assert.Equal(t, "", status["last_ok"].(string))
}

func TestProbeGatewayChecksReadyWhenHealthFails(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	})
	mux.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	assert.NoError(t, err)
	defer listener.Close()

	server := &http.Server{Handler: mux}
	defer server.Close()
	go func() {
		_ = server.Serve(listener)
	}()

	host, portText, err := net.SplitHostPort(listener.Addr().String())
	assert.NoError(t, err)
	port, err := net.LookupPort("tcp", portText)
	assert.NoError(t, err)

	probe := ProbeGateway(host, port)

	assert.True(t, probe.TCPReachable)
	assert.False(t, probe.Live.OK)
	assert.Equal(t, http.StatusServiceUnavailable, probe.Live.StatusCode)
	assert.True(t, probe.Ready.OK)
	assert.Equal(t, http.StatusOK, probe.Ready.StatusCode)
	assert.Equal(t, "http_live", probe.Stage)
}

func TestGWClient_IsConnected_NotConnected(t *testing.T) {
	client := NewGWClient(GWClientConfig{})

	assert.False(t, client.IsConnected())
}

func TestRequestFrame(t *testing.T) {
	frame := RequestFrame{
		Type:   "req",
		ID:     "test-id",
		Method: "test.method",
		Params: map[string]string{"key": "value"},
	}

	assert.Equal(t, "req", frame.Type)
	assert.Equal(t, "test-id", frame.ID)
	assert.Equal(t, "test.method", frame.Method)
}

func TestRPCError(t *testing.T) {
	err := &RPCError{
		Code:    -32600,
		Message: "Invalid Request",
	}

	assert.Equal(t, -32600, err.Code)
	assert.Equal(t, "Invalid Request", err.Message)
}

func TestConnectParams(t *testing.T) {
	params := ConnectParams{
		MinProtocol: 1,
		MaxProtocol: 1,
		Client: ConnectClient{
			ID:          "test-client",
			DisplayName: "Test Client",
			Version:     "1.0.0",
			Platform:    "windows",
			Mode:        "manager",
		},
		Role:   "manager",
		Scopes: []string{"read", "write"},
		Caps:   []string{"events"},
	}

	assert.Equal(t, 1, params.MinProtocol)
	assert.Equal(t, "test-client", params.Client.ID)
	assert.Equal(t, "manager", params.Role)
	assert.Contains(t, params.Scopes, "read")
}

func TestDefaultOperatorScopes(t *testing.T) {
	scopes := cloneDefaultOperatorScopes()

	assert.Contains(t, scopes, "operator.admin")
	assert.Contains(t, scopes, "operator.read")
	assert.Contains(t, scopes, "operator.write")
	assert.Contains(t, scopes, "operator.approvals")
	assert.Contains(t, scopes, "operator.pairing")
	assert.Contains(t, scopes, "operator.talk.secrets")
}

func TestGWClientConfig(t *testing.T) {
	cfg := GWClientConfig{
		Host:  "localhost",
		Port:  18789,
		Token: "secret-token",
	}

	assert.Equal(t, "localhost", cfg.Host)
	assert.Equal(t, 18789, cfg.Port)
	assert.Equal(t, "secret-token", cfg.Token)
}
