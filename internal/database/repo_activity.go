package database

import (
	"time"

	"gorm.io/gorm"
)

type ActivityRepo struct {
	db *gorm.DB
}

func NewActivityRepo() *ActivityRepo {
	return &ActivityRepo{db: DB}
}

func (r *ActivityRepo) Create(activity *Activity) error {
	return r.db.Create(activity).Error
}

func (r *ActivityRepo) Count() (int64, error) {
	var count int64
	err := r.db.Model(&Activity{}).Count(&count).Error
	return count, err
}

func (r *ActivityRepo) CountSince(since time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&Activity{}).Where("created_at >= ?", since).Count(&count).Error
	return count, err
}

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

func (r *ActivityRepo) GetByID(id uint) (*Activity, error) {
	var activity Activity
	err := r.db.First(&activity, id).Error
	if err != nil {
		return nil, err
	}
	return &activity, nil
}

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
