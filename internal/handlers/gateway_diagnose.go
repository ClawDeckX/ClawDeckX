package handlers

import (
	"net/http"

	"ClawDeckX/internal/openclaw"
	"ClawDeckX/internal/web"
)

// GatewayDiagnoseHandler handles gateway diagnosis.
type GatewayDiagnoseHandler struct {
	svc *openclaw.Service
}

// NewGatewayDiagnoseHandler creates a new GatewayDiagnoseHandler.
func NewGatewayDiagnoseHandler(svc *openclaw.Service) *GatewayDiagnoseHandler {
	return &GatewayDiagnoseHandler{svc: svc}
}

// Diagnose runs gateway diagnostics.
// POST /api/v1/gateway/diagnose
func (h *GatewayDiagnoseHandler) Diagnose(w http.ResponseWriter, r *http.Request) {
	host := h.svc.GatewayHost
	port := h.svc.GatewayPort
	result := openclaw.DiagnoseGateway(host, port)
	web.OK(w, r, result)
}
