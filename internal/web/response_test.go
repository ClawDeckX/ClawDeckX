package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOK(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	data := map[string]string{"message": "hello"}
	OK(w, req, data)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

	var resp Response
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.True(t, resp.Success)
	assert.NotEmpty(t, resp.Timestamp)
}

func TestOKPage(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	list := []string{"item1", "item2", "item3"}
	OKPage(w, req, list, 100, 1, 10)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp Response
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.True(t, resp.Success)

	// Check page data
	dataMap, ok := resp.Data.(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, float64(100), dataMap["total"])
	assert.Equal(t, float64(1), dataMap["page"])
	assert.Equal(t, float64(10), dataMap["page_size"])
}

func TestFail(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	Fail(w, req, "TEST_ERROR", "Test error message", http.StatusBadRequest)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "application/json")

	var resp Response
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.False(t, resp.Success)
	assert.Equal(t, "TEST_ERROR", resp.ErrorCode)
	assert.Equal(t, "Test error message", resp.Message)
	assert.NotEmpty(t, resp.Timestamp)
}

func TestFail_DifferentStatusCodes(t *testing.T) {
	tests := []struct {
		name       string
		code       string
		message    string
		httpStatus int
	}{
		{"Bad Request", "BAD_REQUEST", "Invalid input", http.StatusBadRequest},
		{"Unauthorized", "UNAUTHORIZED", "Not logged in", http.StatusUnauthorized},
		{"Forbidden", "FORBIDDEN", "Access denied", http.StatusForbidden},
		{"Not Found", "NOT_FOUND", "Resource not found", http.StatusNotFound},
		{"Internal Error", "INTERNAL_ERROR", "Server error", http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			w := httptest.NewRecorder()

			Fail(w, req, tt.code, tt.message, tt.httpStatus)

			assert.Equal(t, tt.httpStatus, w.Code)

			var resp Response
			json.Unmarshal(w.Body.Bytes(), &resp)
			assert.Equal(t, tt.code, resp.ErrorCode)
			assert.Equal(t, tt.message, resp.Message)
		})
	}
}

func TestResponse_Structure(t *testing.T) {
	resp := Response{
		Success:   true,
		Data:      map[string]string{"key": "value"},
		Message:   "",
		ErrorCode: "",
		Timestamp: "2026-02-21T10:00:00Z",
		RequestID: "req-123",
	}

	assert.True(t, resp.Success)
	assert.NotNil(t, resp.Data)
	assert.Empty(t, resp.Message)
	assert.Empty(t, resp.ErrorCode)
	assert.Equal(t, "2026-02-21T10:00:00Z", resp.Timestamp)
	assert.Equal(t, "req-123", resp.RequestID)
}

func TestPageData_Structure(t *testing.T) {
	pd := PageData{
		List:     []int{1, 2, 3},
		Total:    100,
		Page:     2,
		PageSize: 10,
	}

	assert.Len(t, pd.List.([]int), 3)
	assert.Equal(t, int64(100), pd.Total)
	assert.Equal(t, 2, pd.Page)
	assert.Equal(t, 10, pd.PageSize)
}

func TestOK_WithNilData(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	OK(w, req, nil)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp Response
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.True(t, resp.Success)
}

func TestOK_WithComplexData(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	w := httptest.NewRecorder()

	data := struct {
		ID      int      `json:"id"`
		Name    string   `json:"name"`
		Tags    []string `json:"tags"`
		Enabled bool     `json:"enabled"`
	}{
		ID:      1,
		Name:    "Test",
		Tags:    []string{"a", "b"},
		Enabled: true,
	}

	OK(w, req, data)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.True(t, resp["success"].(bool))
	dataMap := resp["data"].(map[string]interface{})
	assert.Equal(t, float64(1), dataMap["id"])
	assert.Equal(t, "Test", dataMap["name"])
	assert.True(t, dataMap["enabled"].(bool))
}
