package security

import (
	"testing"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// setupTestDB creates an in-memory SQLite database for testing
func setupTestDB(t *testing.T) func() {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	require.NoError(t, err, "failed to create test database")

	err = db.AutoMigrate(
		&database.RiskRule{},
		&database.Alert{},
		&database.Activity{},
		&database.AuditLog{},
	)
	require.NoError(t, err, "failed to migrate test database")

	database.DB = db

	return func() {
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			sqlDB.Close()
		}
		database.DB = nil
	}
}

func TestRiskLevel(t *testing.T) {
	tests := []struct {
		risk     string
		expected int
	}{
		{constants.RiskCritical, 4},
		{constants.RiskHigh, 3},
		{constants.RiskMedium, 2},
		{constants.RiskLow, 1},
		{"unknown", 0},
		{"", 0},
	}

	for _, tt := range tests {
		t.Run(tt.risk, func(t *testing.T) {
			assert.Equal(t, tt.expected, riskLevel(tt.risk))
		})
	}
}

func TestEngine_Evaluate_NoRules(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	engine := NewEngine(nil)
	engine.Reload()

	result := engine.Evaluate("security", "test", "some summary")
	assert.Nil(t, result)
}

func TestEngine_Evaluate_MatchesRule(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	// Create a rule
	repo := database.NewRiskRuleRepo()
	repo.Create(&database.RiskRule{
		RuleID:   "test_rm_rf",
		Category: "security",
		Risk:     constants.RiskHigh,
		Pattern:  `rm\s+-rf`,
		Reason:   "Dangerous delete command",
		Actions:  `["abort","notify"]`,
		Enabled:  true,
	})

	engine := NewEngine(nil)
	engine.Reload()

	// Should match
	result := engine.Evaluate("security", "shell", "executing rm -rf /")
	assert.NotNil(t, result)
	assert.True(t, result.Matched)
	assert.Equal(t, "test_rm_rf", result.Rule.RuleID)
	assert.Contains(t, result.Actions, "abort")

	// Should not match
	result = engine.Evaluate("security", "shell", "listing files")
	assert.Nil(t, result)
}

func TestEngine_Evaluate_CategoryFilter(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := database.NewRiskRuleRepo()
	repo.Create(&database.RiskRule{
		RuleID:   "security_only",
		Category: "security",
		Risk:     constants.RiskMedium,
		Pattern:  `password`,
		Reason:   "Password detected",
		Actions:  `["warn"]`,
		Enabled:  true,
	})

	engine := NewEngine(nil)
	engine.Reload()

	// Should match - same category
	result := engine.Evaluate("security", "test", "password123")
	assert.NotNil(t, result)
	assert.True(t, result.Matched)

	// Should not match - different category
	result = engine.Evaluate("audit", "test", "password123")
	assert.Nil(t, result)
}

func TestEngine_Evaluate_HighestRiskWins(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := database.NewRiskRuleRepo()
	repo.Create(&database.RiskRule{
		RuleID:   "low_risk",
		Category: "",
		Risk:     constants.RiskLow,
		Pattern:  `test`,
		Reason:   "Low risk match",
		Actions:  `["warn"]`,
		Enabled:  true,
	})
	repo.Create(&database.RiskRule{
		RuleID:   "high_risk",
		Category: "",
		Risk:     constants.RiskHigh,
		Pattern:  `test`,
		Reason:   "High risk match",
		Actions:  `["abort"]`,
		Enabled:  true,
	})

	engine := NewEngine(nil)
	engine.Reload()

	result := engine.Evaluate("any", "test", "test data")
	assert.NotNil(t, result)
	assert.Equal(t, constants.RiskHigh, result.Rule.Risk)
	assert.Equal(t, "high_risk", result.Rule.RuleID)
}

func TestEngine_Evaluate_DisabledRuleIgnored(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := database.NewRiskRuleRepo()
	rule := &database.RiskRule{
		RuleID:   "disabled_rule",
		Category: "",
		Risk:     constants.RiskCritical,
		Pattern:  `critical`,
		Reason:   "Critical match",
		Actions:  `["abort"]`,
		Enabled:  true, // Start enabled
	}
	repo.Create(rule)

	engine := NewEngine(nil)
	engine.Reload()

	// Should match when enabled
	result := engine.Evaluate("any", "test", "critical data")
	assert.NotNil(t, result, "enabled rule should match")

	// Disable the rule
	repo.ToggleEnabled(rule.ID, false)
	engine.Reload()

	// Should not match when disabled
	result = engine.Evaluate("any", "test", "critical data")
	assert.Nil(t, result, "disabled rule should not match")
}

func TestEngine_Reload(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	engine := NewEngine(nil)

	// Initially no rules
	err := engine.Reload()
	assert.NoError(t, err)

	result := engine.Evaluate("any", "test", "pattern123")
	assert.Nil(t, result)

	// Add a rule
	repo := database.NewRiskRuleRepo()
	repo.Create(&database.RiskRule{
		RuleID:   "new_rule",
		Category: "",
		Risk:     constants.RiskMedium,
		Pattern:  `pattern123`,
		Reason:   "Pattern match",
		Actions:  `["warn"]`,
		Enabled:  true,
	})

	// Reload and verify
	err = engine.Reload()
	assert.NoError(t, err)

	result = engine.Evaluate("any", "test", "pattern123")
	assert.NotNil(t, result)
	assert.True(t, result.Matched)
}

func TestEngine_InvalidRegex(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := database.NewRiskRuleRepo()
	repo.Create(&database.RiskRule{
		RuleID:   "invalid_regex",
		Category: "",
		Risk:     constants.RiskHigh,
		Pattern:  `[invalid(regex`,
		Reason:   "Invalid regex",
		Actions:  `["abort"]`,
		Enabled:  true,
	})

	engine := NewEngine(nil)
	err := engine.Reload()
	assert.NoError(t, err, "reload should succeed even with invalid regex")

	// Rule with invalid regex should be skipped
	result := engine.Evaluate("any", "test", "[invalid(regex")
	assert.Nil(t, result)
}

func TestMatchResult(t *testing.T) {
	rule := &database.RiskRule{
		RuleID: "test",
		Risk:   constants.RiskHigh,
	}

	result := &MatchResult{
		Matched: true,
		Rule:    rule,
		Actions: []string{"abort", "notify"},
	}

	assert.True(t, result.Matched)
	assert.Equal(t, "test", result.Rule.RuleID)
	assert.Len(t, result.Actions, 2)
}
