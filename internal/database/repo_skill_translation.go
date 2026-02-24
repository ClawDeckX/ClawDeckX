package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// SkillTranslationRepo manages cached skill translations.
type SkillTranslationRepo struct {
	db *gorm.DB
}

func NewSkillTranslationRepo() *SkillTranslationRepo {
	return &SkillTranslationRepo{db: DB}
}

// GetByKeys returns translations for the given skill keys and language.
func (r *SkillTranslationRepo) GetByKeys(lang string, keys []string) ([]SkillTranslation, error) {
	var translations []SkillTranslation
	if len(keys) == 0 {
		return translations, nil
	}
	err := r.db.Where("lang = ? AND skill_key IN ?", lang, keys).Find(&translations).Error
	return translations, err
}

// Upsert inserts or updates a translation by (skill_key, lang).
func (r *SkillTranslationRepo) Upsert(t *SkillTranslation) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "skill_key"}, {Name: "lang"}},
		DoUpdates: clause.AssignmentColumns([]string{"source_hash", "name", "description", "updated_at"}),
	}).Create(t).Error
}

// DeleteByLang removes all translations for a language.
func (r *SkillTranslationRepo) DeleteByLang(lang string) error {
	return r.db.Where("lang = ?", lang).Delete(&SkillTranslation{}).Error
}
