package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SettingRepo struct {
	db *gorm.DB
}

func NewSettingRepo() *SettingRepo {
	return &SettingRepo{db: DB}
}

func (r *SettingRepo) Get(key string) (string, error) {
	var setting Setting
	err := r.db.Where("`key` = ?", key).First(&setting).Error
	if err != nil {
		return "", err
	}
	return setting.Value, nil
}

func (r *SettingRepo) Set(key, value string) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&Setting{Key: key, Value: value}).Error
}

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

func (r *SettingRepo) Delete(key string) error {
	return r.db.Where("`key` = ?", key).Delete(&Setting{}).Error
}
