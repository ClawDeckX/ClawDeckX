package web

import (
	"net/http"
	"strconv"
)

type PageQuery struct {
	Page      int    `json:"page"`
	PageSize  int    `json:"page_size"`
	SortBy    string `json:"sort_by"`
	SortOrder string `json:"sort_order"`
	Keyword   string `json:"keyword"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

func ParsePageQuery(r *http.Request) PageQuery {
	q := PageQuery{
		Page:      1,
		PageSize:  20,
		SortBy:    "created_at",
		SortOrder: "desc",
	}
	if v := r.URL.Query().Get("page"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			q.Page = p
		}
	}
	if v := r.URL.Query().Get("page_size"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 && p <= 100 {
			q.PageSize = p
		}
	}
	if v := r.URL.Query().Get("sort_by"); v != "" {
		q.SortBy = v
	}
	if v := r.URL.Query().Get("sort_order"); v != "" {
		if v == "asc" || v == "desc" {
			q.SortOrder = v
		}
	}
	q.Keyword = r.URL.Query().Get("keyword")
	q.StartTime = r.URL.Query().Get("start_time")
	q.EndTime = r.URL.Query().Get("end_time")
	return q
}

func (q *PageQuery) Offset() int {
	return (q.Page - 1) * q.PageSize
}
