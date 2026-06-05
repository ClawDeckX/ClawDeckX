package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ReleaseNotesTranslationRepo manages cached release notes translations.
type ReleaseNotesTranslationRepo struct {
	db *gorm.DB
}

func NewReleaseNotesTranslationRepo() *ReleaseNotesTranslationRepo {
	return &ReleaseNotesTranslationRepo{db: DB}
}

// Get returns a cached translation for the given product, version, and language.
// Returns nil if not found or if the source hash doesn't match.
func (r *ReleaseNotesTranslationRepo) Get(product, version, lang, sourceHash string) (*ReleaseNotesTranslation, error) {
	var t ReleaseNotesTranslation
	err := r.db.Where("product = ? AND version = ? AND lang = ? AND source_hash = ?", product, version, lang, sourceHash).First(&t).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	return &t, err
}

// Upsert inserts or updates a translation by (product, version, lang).
func (r *ReleaseNotesTranslationRepo) Upsert(t *ReleaseNotesTranslation) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "product"}, {Name: "version"}, {Name: "lang"}},
		DoUpdates: clause.AssignmentColumns([]string{"source_hash", "translated", "updated_at"}),
	}).Create(t).Error
}

// Delete removes a cached translation entry for the given product, version, and language.
func (r *ReleaseNotesTranslationRepo) Delete(product, version, lang string) error {
	return r.db.Where("product = ? AND version = ? AND lang = ?", product, version, lang).
		Delete(&ReleaseNotesTranslation{}).Error
}
