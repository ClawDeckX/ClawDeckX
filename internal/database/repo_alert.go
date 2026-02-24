package database

import (
	"gorm.io/gorm"
)

// AlertRepo 告警数据仓库
type AlertRepo struct {
	db *gorm.DB
}

func NewAlertRepo() *AlertRepo {
	return &AlertRepo{db: DB}
}

// Create 创建告警记录
func (r *AlertRepo) Create(alert *Alert) error {
	return r.db.Create(alert).Error
}

// Recent 获取最近 N 条告警
func (r *AlertRepo) Recent(limit int) ([]Alert, error) {
	var alerts []Alert
	err := r.db.Order("created_at desc").Limit(limit).Find(&alerts).Error
	return alerts, err
}

// List 分页查询告警
func (r *AlertRepo) List(filter AlertFilter) ([]Alert, int64, error) {
	var alerts []Alert
	var total int64

	q := r.db.Model(&Alert{})
	if filter.Risk != "" {
		q = q.Where("risk = ?", filter.Risk)
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
		Find(&alerts).Error
	return alerts, total, err
}

// MarkNotified 标记单条告警为已读
func (r *AlertRepo) MarkNotified(id uint) error {
	return r.db.Model(&Alert{}).Where("id = ?", id).Update("notified", true).Error
}

// MarkAllNotified 标记所有告警为已读
func (r *AlertRepo) MarkAllNotified() error {
	return r.db.Model(&Alert{}).Where("notified = ?", false).Update("notified", true).Error
}

// CountUnread 统计未读告警数
func (r *AlertRepo) CountUnread() (int64, error) {
	var count int64
	err := r.db.Model(&Alert{}).Where("notified = ?", false).Count(&count).Error
	return count, err
}

// AlertFilter 告警查询筛选条件
type AlertFilter struct {
	Page      int
	PageSize  int
	SortBy    string
	SortOrder string
	Risk      string
	StartTime string
	EndTime   string
}

func (f *AlertFilter) Offset() int {
	if f.Page <= 0 {
		f.Page = 1
	}
	if f.PageSize <= 0 {
		f.PageSize = 20
	}
	return (f.Page - 1) * f.PageSize
}
