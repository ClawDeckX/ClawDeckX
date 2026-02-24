package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SettingRepo 系统设置数据仓库
type SettingRepo struct {
	db *gorm.DB
}

func NewSettingRepo() *SettingRepo {
	return &SettingRepo{db: DB}
}

// Get 获取单个设置项
func (r *SettingRepo) Get(key string) (string, error) {
	var setting Setting
	err := r.db.Where("`key` = ?", key).First(&setting).Error
	if err != nil {
		return "", err
	}
	return setting.Value, nil
}

// Set 设置单个配置项（存在则更新，不存在则创建）
func (r *SettingRepo) Set(key, value string) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&Setting{Key: key, Value: value}).Error
}

// GetAll 获取所有设置项
func (r *SettingRepo) GetAll() (map[string]string, error) {
	var settings []Setting
	err := r.db.Find(&settings).Error
	if err != nil {
		return nil, err
	}
	result := make(map[string]string)
	for _, s := range settings {
		result[s.Key] = s.Value
	}
	return result, nil
}

// SetBatch 批量设置
func (r *SettingRepo) SetBatch(items map[string]string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for key, value := range items {
			err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "key"}},
				DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
			}).Create(&Setting{Key: key, Value: value}).Error
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// Delete 删除设置项
func (r *SettingRepo) Delete(key string) error {
	return r.db.Where("`key` = ?", key).Delete(&Setting{}).Error
}
