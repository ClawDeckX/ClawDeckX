package database

import (
	"gorm.io/gorm"
)

// RiskRuleRepo 风险规则数据仓库
type RiskRuleRepo struct {
	db *gorm.DB
}

func NewRiskRuleRepo() *RiskRuleRepo {
	return &RiskRuleRepo{db: DB}
}

// Create 创建规则
func (r *RiskRuleRepo) Create(rule *RiskRule) error {
	return r.db.Create(rule).Error
}

// Update 更新规则
func (r *RiskRuleRepo) Update(rule *RiskRule) error {
	return r.db.Save(rule).Error
}

// Delete 删除规则（内置规则不可删除）
func (r *RiskRuleRepo) Delete(id uint) error {
	return r.db.Where("id = ? AND built_in = ?", id, false).Delete(&RiskRule{}).Error
}

// FindByID 根据 ID 查询
func (r *RiskRuleRepo) FindByID(id uint) (*RiskRule, error) {
	var rule RiskRule
	err := r.db.First(&rule, id).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// FindByRuleID 根据 rule_id 查询
func (r *RiskRuleRepo) FindByRuleID(ruleID string) (*RiskRule, error) {
	var rule RiskRule
	err := r.db.Where("rule_id = ?", ruleID).First(&rule).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// ListAll 查询所有规则
func (r *RiskRuleRepo) ListAll() ([]RiskRule, error) {
	var rules []RiskRule
	err := r.db.Order("built_in desc, category asc, risk desc").Find(&rules).Error
	return rules, err
}

// ListEnabled 查询所有启用的规则
func (r *RiskRuleRepo) ListEnabled() ([]RiskRule, error) {
	var rules []RiskRule
	err := r.db.Where("enabled = ?", true).Order("risk desc").Find(&rules).Error
	return rules, err
}

// Count 统计规则总数
func (r *RiskRuleRepo) Count() (int64, error) {
	var count int64
	err := r.db.Model(&RiskRule{}).Count(&count).Error
	return count, err
}

// CountEnabled 统计启用的规则数
func (r *RiskRuleRepo) CountEnabled() (int64, error) {
	var count int64
	err := r.db.Model(&RiskRule{}).Where("enabled = ?", true).Count(&count).Error
	return count, err
}

// CountByRiskLevel 按风险等级统计规则数（total 和 enabled）
func (r *RiskRuleRepo) CountByRiskLevel() (total map[string]int64, enabled map[string]int64, err error) {
	total = map[string]int64{}
	enabled = map[string]int64{}

	type result struct {
		Risk    string
		Enabled bool
		Count   int64
	}
	var results []result
	err = r.db.Model(&RiskRule{}).
		Select("risk, enabled, count(*) as count").
		Group("risk, enabled").
		Find(&results).Error
	if err != nil {
		return
	}
	for _, row := range results {
		total[row.Risk] += row.Count
		if row.Enabled {
			enabled[row.Risk] += row.Count
		}
	}
	return
}

// CountDisabledHighRisk 统计未启用的高危规则数（critical + high）
func (r *RiskRuleRepo) CountDisabledHighRisk() (int64, error) {
	var count int64
	err := r.db.Model(&RiskRule{}).
		Where("enabled = ? AND risk IN ?", false, []string{"critical", "high"}).
		Count(&count).Error
	return count, err
}

// ToggleEnabled 切换规则启用状态
func (r *RiskRuleRepo) ToggleEnabled(id uint, enabled bool) error {
	return r.db.Model(&RiskRule{}).Where("id = ?", id).Update("enabled", enabled).Error
}

// SeedBuiltinRules 初始化内置规则（仅在规则表为空时执行）
func (r *RiskRuleRepo) SeedBuiltinRules(rules []RiskRule) error {
	count, err := r.Count()
	if err != nil {
		return err
	}
	if count > 0 {
		return nil // 已有规则，跳过
	}
	for i := range rules {
		rules[i].BuiltIn = true
		rules[i].Enabled = true
		if err := r.db.Create(&rules[i]).Error; err != nil {
			return err
		}
	}
	return nil
}
