package database

import (
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"

	"gorm.io/gorm"
)

type AuditLogRepo struct {
	db *gorm.DB
}

func NewAuditLogRepo() *AuditLogRepo {
	return &AuditLogRepo{db: DB}
}

func (r *AuditLogRepo) Create(log *AuditLog) error {
	if err := r.db.Create(log).Error; err != nil {
		logger.Audit.Error().Err(err).Str("action", log.Action).Msg(i18n.T(i18n.MsgLogAuditWriteFailed))
		return err
	}
	return nil
}

func (r *AuditLogRepo) List(filter AuditFilter) ([]AuditLog, int64, error) {
	var logs []AuditLog
	var total int64

	q := r.db.Model(&AuditLog{})
	if filter.Action != "" {
		q = q.Where("action = ?", filter.Action)
	}
	if filter.UserID > 0 {
		q = q.Where("user_id = ?", filter.UserID)
	}
	if filter.StartTime != "" {
		q = q.Where("created_at >= ?", filter.StartTime)
	}
	if filter.EndTime != "" {
		q = q.Where("created_at <= ?", filter.EndTime)
	}

	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	sortBy := filter.SortBy
	if sortBy == "" {
		sortBy = "created_at"
	}
	sortOrder := filter.SortOrder
	if sortOrder == "" {
		sortOrder = "desc"
	}

	err := q.Order(sortBy + " " + sortOrder).
		Offset(filter.Offset()).
		Limit(filter.PageSize).
		Find(&logs).Error
	return logs, total, err
}

type AuditFilter struct {
	Page      int
	PageSize  int
	SortBy    string
	SortOrder string
	Action    string
	UserID    uint
	StartTime string
	EndTime   string
}

func (f *AuditFilter) Offset() int {
	if f.Page <= 0 {
		f.Page = 1
	}
	if f.PageSize <= 0 {
		f.PageSize = 20
	}
	return (f.Page - 1) * f.PageSize
}
