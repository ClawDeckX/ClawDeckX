package database

import (
	"time"

	"gorm.io/gorm"
)

// ActivityRepo 活动事件数据仓库
type ActivityRepo struct {
	db *gorm.DB
}

func NewActivityRepo() *ActivityRepo {
	return &ActivityRepo{db: DB}
}

// Create 创建活动记录
func (r *ActivityRepo) Create(activity *Activity) error {
	return r.db.Create(activity).Error
}

// Count 统计活动总数
func (r *ActivityRepo) Count() (int64, error) {
	var count int64
	err := r.db.Model(&Activity{}).Count(&count).Error
	return count, err
}

// CountSince 统计指定时间之后的活动数
func (r *ActivityRepo) CountSince(since time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&Activity{}).Where("created_at >= ?", since).Count(&count).Error
	return count, err
}

// CountByRisk 按风险等级统计（指定时间之后）
func (r *ActivityRepo) CountByRisk(since time.Time) (map[string]int64, error) {
	type result struct {
		Risk  string
		Count int64
	}
	var results []result
	err := r.db.Model(&Activity{}).
		Select("risk, count(*) as count").
		Where("created_at >= ?", since).
		Group("risk").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, r := range results {
		counts[r.Risk] = r.Count
	}
	return counts, nil
}

// CountByCategory 按分类统计（指定时间之后）
func (r *ActivityRepo) CountByCategory(since time.Time) (map[string]int64, error) {
	type result struct {
		Category string
		Count    int64
	}
	var results []result
	err := r.db.Model(&Activity{}).
		Select("category, count(*) as count").
		Where("created_at >= ?", since).
		Group("category").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, r := range results {
		counts[r.Category] = r.Count
	}
	return counts, nil
}

// CountByTool 按工具名统计（工具名存储在 source 字段）
func (r *ActivityRepo) CountByTool(since time.Time) (map[string]int64, error) {
	type result struct {
		Source string
		Count  int64
	}
	var results []result
	err := r.db.Model(&Activity{}).
		Select("source, count(*) as count").
		Where("created_at >= ? AND source != ''", since).
		Group("source").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, r := range results {
		counts[r.Source] = r.Count
	}
	return counts, nil
}

// CountByHour 按小时统计（返回 "2026-02-07T18" 格式的 key）
func (r *ActivityRepo) CountByHour(since time.Time) (map[string]int64, error) {
	type result struct {
		Hour  string
		Count int64
	}
	var results []result
	err := r.db.Model(&Activity{}).
		Select("strftime('%Y-%m-%dT%H', created_at) as hour, count(*) as count").
		Where("created_at >= ?", since).
		Group("hour").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, r := range results {
		counts[r.Hour] = r.Count
	}
	return counts, nil
}

// CountByDay 按天统计（返回 "2026-02-07" 格式的 key）
func (r *ActivityRepo) CountByDay(since time.Time) (map[string]int64, error) {
	type result struct {
		Day   string
		Count int64
	}
	var results []result
	err := r.db.Model(&Activity{}).
		Select("strftime('%Y-%m-%d', created_at) as day, count(*) as count").
		Where("created_at >= ?", since).
		Group("day").
		Find(&results).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64)
	for _, r := range results {
		counts[r.Day] = r.Count
	}
	return counts, nil
}

// List 分页查询活动
func (r *ActivityRepo) List(filter ActivityFilter) ([]Activity, int64, error) {
	var activities []Activity
	var total int64

	q := r.db.Model(&Activity{})
	if filter.Category != "" {
		q = q.Where("category = ?", filter.Category)
	}
	if filter.Risk != "" {
		q = q.Where("risk = ?", filter.Risk)
	}
	if filter.Keyword != "" {
		q = q.Where("summary LIKE ?", "%"+filter.Keyword+"%")
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
		Find(&activities).Error
	return activities, total, err
}

// GetByID 根据 ID 获取活动详情
func (r *ActivityRepo) GetByID(id uint) (*Activity, error) {
	var activity Activity
	err := r.db.First(&activity, id).Error
	if err != nil {
		return nil, err
	}
	return &activity, nil
}

// ActivityFilter 活动查询筛选条件
type ActivityFilter struct {
	Page      int
	PageSize  int
	SortBy    string
	SortOrder string
	Category  string
	Risk      string
	Keyword   string
	StartTime string
	EndTime   string
}

func (f *ActivityFilter) Offset() int {
	if f.Page <= 0 {
		f.Page = 1
	}
	if f.PageSize <= 0 {
		f.PageSize = 20
	}
	return (f.Page - 1) * f.PageSize
}
