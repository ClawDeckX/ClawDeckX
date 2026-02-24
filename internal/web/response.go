package web

import (
	"encoding/json"
	"net/http"
	"time"
)

type Response struct {
	Success   bool        `json:"success"`
	Data      interface{} `json:"data,omitempty"`
	Message   string      `json:"message,omitempty"`
	ErrorCode string      `json:"error_code,omitempty"`
	Timestamp string      `json:"timestamp"`
	RequestID string      `json:"request_id"`
}

type PageData struct {
	List     interface{} `json:"list"`
	Total    int64       `json:"total"`
	Page     int         `json:"page"`
	PageSize int         `json:"page_size"`
}

func OK(w http.ResponseWriter, r *http.Request, data interface{}) {
	writeJSON(w, http.StatusOK, Response{
		Success:   true,
		Data:      data,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		RequestID: GetRequestID(r),
	})
}

func OKPage(w http.ResponseWriter, r *http.Request, list interface{}, total int64, page, pageSize int) {
	OK(w, r, PageData{
		List:     list,
		Total:    total,
		Page:     page,
		PageSize: pageSize,
	})
}

// OKRaw returns raw JSON data (used by gateway proxy).
func OKRaw(w http.ResponseWriter, r *http.Request, rawData json.RawMessage) {
	writeJSON(w, http.StatusOK, Response{
		Success:   true,
		Data:      rawData,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		RequestID: GetRequestID(r),
	})
}

func Fail(w http.ResponseWriter, r *http.Request, code string, message string, httpStatus int) {
	writeJSON(w, httpStatus, Response{
		Success:   false,
		ErrorCode: code,
		Message:   message,
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		RequestID: GetRequestID(r),
	})
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
