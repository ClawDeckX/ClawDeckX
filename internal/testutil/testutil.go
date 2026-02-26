package testutil

import (
	"testing"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/webconfig"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// SetupTestDB creates an in-memory SQLite database for testing.
// It returns a cleanup function that should be called after the test.
func SetupTestDB(t *testing.T) func() {
	t.Helper()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: gormlogger.Default.LogMode(gormlogger.Silent),
	})
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	// Auto migrate all models
	err = db.AutoMigrate(
		&database.User{},
		&database.Activity{},
		&database.Alert{},
		&database.AuditLog{},
		&database.MonitorState{},
		&database.BackupRecord{},
		&database.Setting{},
		&database.CredentialScan{},
		&database.ConnectionLog{},
		&database.SkillHash{},
		&database.GatewayProfile{},
		&database.Template{},
		&database.SkillTranslation{},
	)
	if err != nil {
		t.Fatalf("failed to migrate test database: %v", err)
	}

	// Set global DB
	database.DB = db

	return func() {
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			sqlDB.Close()
		}
		database.DB = nil
	}
}

// TestConfig returns a test configuration
func TestConfig() *webconfig.Config {
	return &webconfig.Config{
		Auth: webconfig.AuthConfig{
			JWTSecret: "test-secret-key-for-unit-tests",
			JWTExpire: "24h",
		},
	}
}
