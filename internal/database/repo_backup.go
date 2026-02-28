package database

import (
	"gorm.io/gorm"
)

type BackupRepo struct {
	db *gorm.DB
}

func NewBackupRepo() *BackupRepo {
	return &BackupRepo{db: DB}
}

func (r *BackupRepo) Create(record *BackupRecord) error {
	return r.db.Create(record).Error
}

func (r *BackupRepo) List() ([]BackupRecord, error) {
	var records []BackupRecord
	err := r.db.Order("created_at desc").Find(&records).Error
	return records, err
}

func (r *BackupRepo) FindByID(id uint) (*BackupRecord, error) {
	var record BackupRecord
	err := r.db.First(&record, id).Error
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (r *BackupRepo) Delete(id uint) error {
	return r.db.Delete(&BackupRecord{}, id).Error
}
