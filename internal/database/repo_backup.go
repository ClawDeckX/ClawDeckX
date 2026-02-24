package database

import (
	"gorm.io/gorm"
)

// BackupRepo 备份记录数据仓库
type BackupRepo struct {
	db *gorm.DB
}

func NewBackupRepo() *BackupRepo {
	return &BackupRepo{db: DB}
}

// Create 创建备份记录
func (r *BackupRepo) Create(record *BackupRecord) error {
	return r.db.Create(record).Error
}

// List 查询备份列表
func (r *BackupRepo) List() ([]BackupRecord, error) {
	var records []BackupRecord
	err := r.db.Order("created_at desc").Find(&records).Error
	return records, err
}

// FindByID 根据 ID 查询
func (r *BackupRepo) FindByID(id uint) (*BackupRecord, error) {
	var record BackupRecord
	err := r.db.First(&record, id).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

// Delete 删除备份记录
func (r *BackupRepo) Delete(id uint) error {
	return r.db.Delete(&BackupRecord{}, id).Error
}
