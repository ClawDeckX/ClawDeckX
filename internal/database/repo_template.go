package database

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// TemplateRepo manages workspace file templates.
type TemplateRepo struct {
	db *gorm.DB
}

func NewTemplateRepo() *TemplateRepo {
	return &TemplateRepo{db: DB}
}

// List returns all templates, optionally filtered by target file.
func (r *TemplateRepo) List(targetFile string) ([]Template, error) {
	var templates []Template
	q := r.db.Order("built_in DESC, updated_at DESC")
	if targetFile != "" {
		q = q.Where("target_file = ?", targetFile)
	}
	err := q.Find(&templates).Error
	return templates, err
}

// GetByID returns a single template by its primary key.
func (r *TemplateRepo) GetByID(id uint) (*Template, error) {
	var tpl Template
	err := r.db.First(&tpl, id).Error
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

// GetByTemplateID returns a single template by its unique template_id.
func (r *TemplateRepo) GetByTemplateID(templateID string) (*Template, error) {
	var tpl Template
	err := r.db.Where("template_id = ?", templateID).First(&tpl).Error
	if err != nil {
		return nil, err
	}
	return &tpl, nil
}

// Create inserts a new template.
func (r *TemplateRepo) Create(tpl *Template) error {
	return r.db.Create(tpl).Error
}

// Update saves changes to an existing template.
func (r *TemplateRepo) Update(tpl *Template) error {
	return r.db.Save(tpl).Error
}

// Delete removes a template by primary key.
func (r *TemplateRepo) Delete(id uint) error {
	return r.db.Delete(&Template{}, id).Error
}

// Upsert inserts or updates a template by template_id (used for seeding built-in templates).
func (r *TemplateRepo) Upsert(tpl *Template) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "template_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"target_file", "icon", "category", "tags", "author", "built_in", "i18n", "version", "updated_at"}),
	}).Create(tpl).Error
}

// CountBuiltIn returns the number of built-in templates.
func (r *TemplateRepo) CountBuiltIn() (int64, error) {
	var count int64
	err := r.db.Model(&Template{}).Where("built_in = ?", true).Count(&count).Error
	return count, err
}
