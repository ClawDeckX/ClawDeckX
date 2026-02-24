package handlers

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/web"
)

// ExportHandler handles data export.
type ExportHandler struct {
	activityRepo *database.ActivityRepo
	alertRepo    *database.AlertRepo
	auditRepo    *database.AuditLogRepo
}

func NewExportHandler() *ExportHandler {
	return &ExportHandler{
		activityRepo: database.NewActivityRepo(),
		alertRepo:    database.NewAlertRepo(),
		auditRepo:    database.NewAuditLogRepo(),
	}
}

// ExportActivities exports activity records.
func (h *ExportHandler) ExportActivities(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	pq := web.ParsePageQuery(r)
	pq.PageSize = 5000 // export max 5000 rows

	filter := database.ActivityFilter{
		Page:      1,
		PageSize:  pq.PageSize,
		SortBy:    pq.SortBy,
		SortOrder: pq.SortOrder,
		Category:  r.URL.Query().Get("category"),
		Risk:      r.URL.Query().Get("risk"),
		StartTime: pq.StartTime,
		EndTime:   pq.EndTime,
	}

	activities, _, err := h.activityRepo.List(filter)
	if err != nil {
		web.FailErr(w, r, web.ErrExportFailed)
		return
	}

	filename := fmt.Sprintf("activities_%s", time.Now().Format("20060102_150405"))

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".csv")
		writer := csv.NewWriter(w)
		writer.Write([]string{"ID", "EventID", "Time", "Category", "Risk", "Summary", "Source", "Action", "SessionID"})
		for _, a := range activities {
			writer.Write([]string{
				fmt.Sprintf("%d", a.ID),
				a.EventID,
				a.Timestamp.Format(time.RFC3339),
				a.Category,
				a.Risk,
				a.Summary,
				a.Source,
				a.ActionTaken,
				a.SessionID,
			})
		}
		writer.Flush()
	default:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".json")
		json.NewEncoder(w).Encode(activities)
	}
}

// ExportAlerts exports alert records.
func (h *ExportHandler) ExportAlerts(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	filter := database.AlertFilter{
		Page:      1,
		PageSize:  5000,
		Risk:      r.URL.Query().Get("risk"),
		StartTime: r.URL.Query().Get("start_time"),
		EndTime:   r.URL.Query().Get("end_time"),
	}

	alerts, _, err := h.alertRepo.List(filter)
	if err != nil {
		web.FailErr(w, r, web.ErrExportFailed)
		return
	}

	filename := fmt.Sprintf("alerts_%s", time.Now().Format("20060102_150405"))

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".csv")
		writer := csv.NewWriter(w)
		writer.Write([]string{"ID", "AlertID", "Risk", "Message", "Notified", "CreatedAt"})
		for _, a := range alerts {
			writer.Write([]string{
				fmt.Sprintf("%d", a.ID),
				a.AlertID,
				a.Risk,
				a.Message,
				fmt.Sprintf("%v", a.Notified),
				a.CreatedAt.Format(time.RFC3339),
			})
		}
		writer.Flush()
	default:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".json")
		json.NewEncoder(w).Encode(alerts)
	}
}

// ExportAuditLogs exports audit log records.
func (h *ExportHandler) ExportAuditLogs(w http.ResponseWriter, r *http.Request) {
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "json"
	}

	filter := database.AuditFilter{
		Page:      1,
		PageSize:  5000,
		Action:    r.URL.Query().Get("action"),
		StartTime: r.URL.Query().Get("start_time"),
		EndTime:   r.URL.Query().Get("end_time"),
	}

	logs, _, err := h.auditRepo.List(filter)
	if err != nil {
		web.FailErr(w, r, web.ErrExportFailed)
		return
	}

	filename := fmt.Sprintf("audit_logs_%s", time.Now().Format("20060102_150405"))

	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".csv")
		writer := csv.NewWriter(w)
		writer.Write([]string{"ID", "UserID", "Username", "Action", "Result", "Detail", "IP", "CreatedAt"})
		for _, l := range logs {
			writer.Write([]string{
				fmt.Sprintf("%d", l.ID),
				fmt.Sprintf("%d", l.UserID),
				l.Username,
				l.Action,
				l.Result,
				l.Detail,
				l.IP,
				l.CreatedAt.Format(time.RFC3339),
			})
		}
		writer.Flush()
	default:
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename="+filename+".json")
		json.NewEncoder(w).Encode(logs)
	}
}
