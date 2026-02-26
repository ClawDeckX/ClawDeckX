package database

import (
	"testing"
	"time"

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
		&User{},
		&Activity{},
		&Alert{},
		&AuditLog{},
		&MonitorState{},
		&BackupRecord{},
		&Setting{},
		&CredentialScan{},
		&ConnectionLog{},
		&SkillHash{},
		&GatewayProfile{},
		&Template{},
		&SkillTranslation{},
	)
	require.NoError(t, err, "failed to migrate test database")

	DB = db

	return func() {
		sqlDB, _ := db.DB()
		if sqlDB != nil {
			sqlDB.Close()
		}
		DB = nil
	}
}

// ============== UserRepo Tests ==============

func TestUserRepo_Create(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{
		Username:     "testuser",
		PasswordHash: "hashedpassword",
		Role:         "admin",
	}

	err := repo.Create(user)
	assert.NoError(t, err)
	assert.NotZero(t, user.ID)
}

func TestUserRepo_Create_DuplicateUsername(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()

	user1 := &User{Username: "testuser", PasswordHash: "hash1", Role: "admin"}
	err := repo.Create(user1)
	require.NoError(t, err)

	user2 := &User{Username: "testuser", PasswordHash: "hash2", Role: "admin"}
	err = repo.Create(user2)
	assert.Error(t, err, "should fail on duplicate username")
}

func TestUserRepo_FindByUsername(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{Username: "findme", PasswordHash: "hash", Role: "admin"}
	require.NoError(t, repo.Create(user))

	found, err := repo.FindByUsername("findme")
	assert.NoError(t, err)
	assert.Equal(t, "findme", found.Username)
	assert.Equal(t, user.ID, found.ID)
}

func TestUserRepo_FindByUsername_NotFound(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	_, err := repo.FindByUsername("nonexistent")
	assert.Error(t, err)
}

func TestUserRepo_FindByID(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{Username: "findbyid", PasswordHash: "hash", Role: "admin"}
	require.NoError(t, repo.Create(user))

	found, err := repo.FindByID(user.ID)
	assert.NoError(t, err)
	assert.Equal(t, user.Username, found.Username)
}

func TestUserRepo_UpdatePassword(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{Username: "pwduser", PasswordHash: "oldhash", Role: "admin", FailedAttempts: 3}
	require.NoError(t, repo.Create(user))

	err := repo.UpdatePassword(user.ID, "newhash")
	assert.NoError(t, err)

	updated, _ := repo.FindByID(user.ID)
	assert.Equal(t, "newhash", updated.PasswordHash)
	assert.Equal(t, 0, updated.FailedAttempts, "failed attempts should be reset")
}

func TestUserRepo_IncrementFailedAttempts(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{Username: "failuser", PasswordHash: "hash", Role: "admin"}
	require.NoError(t, repo.Create(user))

	err := repo.IncrementFailedAttempts(user.ID)
	assert.NoError(t, err)

	updated, _ := repo.FindByID(user.ID)
	assert.Equal(t, 1, updated.FailedAttempts)

	repo.IncrementFailedAttempts(user.ID)
	updated, _ = repo.FindByID(user.ID)
	assert.Equal(t, 2, updated.FailedAttempts)
}

func TestUserRepo_ResetFailedAttempts(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	lockTime := time.Now().Add(time.Hour)
	user := &User{Username: "resetuser", PasswordHash: "hash", Role: "admin", FailedAttempts: 5, LockedUntil: &lockTime}
	require.NoError(t, repo.Create(user))

	err := repo.ResetFailedAttempts(user.ID)
	assert.NoError(t, err)

	updated, _ := repo.FindByID(user.ID)
	assert.Equal(t, 0, updated.FailedAttempts)
	assert.Nil(t, updated.LockedUntil)
}

func TestUserRepo_LockUntil(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{Username: "lockuser", PasswordHash: "hash", Role: "admin"}
	require.NoError(t, repo.Create(user))

	lockTime := time.Now().Add(15 * time.Minute)
	err := repo.LockUntil(user.ID, lockTime)
	assert.NoError(t, err)

	updated, _ := repo.FindByID(user.ID)
	assert.NotNil(t, updated.LockedUntil)
	assert.WithinDuration(t, lockTime, *updated.LockedUntil, time.Second)
}

func TestUserRepo_Count(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()

	count, err := repo.Count()
	assert.NoError(t, err)
	assert.Equal(t, int64(0), count)

	repo.Create(&User{Username: "user1", PasswordHash: "hash", Role: "admin"})
	repo.Create(&User{Username: "user2", PasswordHash: "hash", Role: "admin"})

	count, err = repo.Count()
	assert.NoError(t, err)
	assert.Equal(t, int64(2), count)
}

func TestUserRepo_List(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	repo.Create(&User{Username: "user1", PasswordHash: "hash", Role: "admin"})
	repo.Create(&User{Username: "user2", PasswordHash: "hash", Role: "user"})

	users, err := repo.List()
	assert.NoError(t, err)
	assert.Len(t, users, 2)
}

func TestUserRepo_Delete(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewUserRepo()
	user := &User{Username: "deleteuser", PasswordHash: "hash", Role: "admin"}
	require.NoError(t, repo.Create(user))

	err := repo.Delete(user.ID)
	assert.NoError(t, err)

	_, err = repo.FindByID(user.ID)
	assert.Error(t, err, "user should be deleted")
}

// ============== SettingRepo Tests ==============

func TestSettingRepo_SetAndGet(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewSettingRepo()

	err := repo.Set("test_key", "test_value")
	assert.NoError(t, err)

	value, err := repo.Get("test_key")
	assert.NoError(t, err)
	assert.Equal(t, "test_value", value)
}

func TestSettingRepo_Set_Upsert(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewSettingRepo()

	repo.Set("key1", "value1")
	repo.Set("key1", "value2")

	value, err := repo.Get("key1")
	assert.NoError(t, err)
	assert.Equal(t, "value2", value, "should update existing key")
}

func TestSettingRepo_Get_NotFound(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewSettingRepo()
	_, err := repo.Get("nonexistent")
	assert.Error(t, err)
}

func TestSettingRepo_GetAll(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewSettingRepo()
	repo.Set("key1", "value1")
	repo.Set("key2", "value2")
	repo.Set("key3", "value3")

	all, err := repo.GetAll()
	assert.NoError(t, err)
	assert.Len(t, all, 3)
	assert.Equal(t, "value1", all["key1"])
	assert.Equal(t, "value2", all["key2"])
	assert.Equal(t, "value3", all["key3"])
}

func TestSettingRepo_SetBatch(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewSettingRepo()
	items := map[string]string{
		"batch1": "val1",
		"batch2": "val2",
		"batch3": "val3",
	}

	err := repo.SetBatch(items)
	assert.NoError(t, err)

	all, _ := repo.GetAll()
	assert.Len(t, all, 3)
}

func TestSettingRepo_Delete(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewSettingRepo()
	repo.Set("to_delete", "value")

	err := repo.Delete("to_delete")
	assert.NoError(t, err)

	_, err = repo.Get("to_delete")
	assert.Error(t, err, "setting should be deleted")
}

// ============== ActivityRepo Tests ==============

func TestActivityRepo_Create(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewActivityRepo()
	activity := &Activity{
		EventID:   "evt-001",
		Timestamp: time.Now(),
		Category:  "security",
		Risk:      "high",
		Summary:   "Test activity",
		Source:    "test",
	}

	err := repo.Create(activity)
	assert.NoError(t, err)
	assert.NotZero(t, activity.ID)
}

func TestActivityRepo_Count(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewActivityRepo()

	count, err := repo.Count()
	assert.NoError(t, err)
	assert.Equal(t, int64(0), count)

	repo.Create(&Activity{EventID: "e1", Timestamp: time.Now(), Category: "test", Risk: "low", Summary: "Test", Source: "test"})
	repo.Create(&Activity{EventID: "e2", Timestamp: time.Now(), Category: "test", Risk: "low", Summary: "Test", Source: "test"})

	count, err = repo.Count()
	assert.NoError(t, err)
	assert.Equal(t, int64(2), count)
}

func TestActivityRepo_List(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewActivityRepo()

	// Create test activities
	for i := 0; i < 25; i++ {
		repo.Create(&Activity{
			EventID:   "evt-" + string(rune('a'+i)),
			Timestamp: time.Now(),
			Category:  "test",
			Risk:      "low",
			Summary:   "Activity",
			Source:    "test",
		})
	}

	// Test pagination
	filter := ActivityFilter{Page: 1, PageSize: 10}
	activities, total, err := repo.List(filter)
	assert.NoError(t, err)
	assert.Equal(t, int64(25), total)
	assert.Len(t, activities, 10)
}

func TestActivityRepo_List_WithFilters(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewActivityRepo()
	repo.Create(&Activity{EventID: "e1", Timestamp: time.Now(), Category: "security", Risk: "high", Summary: "High risk", Source: "test"})
	repo.Create(&Activity{EventID: "e2", Timestamp: time.Now(), Category: "audit", Risk: "low", Summary: "Low risk", Source: "test"})
	repo.Create(&Activity{EventID: "e3", Timestamp: time.Now(), Category: "security", Risk: "low", Summary: "Another", Source: "test"})

	// Filter by category
	filter := ActivityFilter{Page: 1, PageSize: 10, Category: "security"}
	activities, total, err := repo.List(filter)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)

	// Filter by risk
	filter = ActivityFilter{Page: 1, PageSize: 10, Risk: "high"}
	activities, total, err = repo.List(filter)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "high", activities[0].Risk)
}

// ============== AlertRepo Tests ==============

func TestAlertRepo_Create(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewAlertRepo()
	alert := &Alert{
		AlertID: "alert-001",
		Risk:    "high",
		Message: "Test alert",
	}

	err := repo.Create(alert)
	assert.NoError(t, err)
	assert.NotZero(t, alert.ID)
}

func TestAlertRepo_MarkNotified(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewAlertRepo()
	alert := &Alert{AlertID: "alert-002", Risk: "medium", Message: "Test", Notified: false}
	require.NoError(t, repo.Create(alert))

	err := repo.MarkNotified(alert.ID)
	assert.NoError(t, err)

	var updated Alert
	DB.First(&updated, alert.ID)
	assert.True(t, updated.Notified)
}

// ============== AuditLogRepo Tests ==============

func TestAuditLogRepo_Create(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewAuditLogRepo()
	log := &AuditLog{
		UserID:   1,
		Username: "admin",
		Action:   "login",
		Result:   "success",
		IP:       "127.0.0.1",
	}

	err := repo.Create(log)
	assert.NoError(t, err)
	assert.NotZero(t, log.ID)
}

func TestAuditLogRepo_List(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewAuditLogRepo()
	repo.Create(&AuditLog{UserID: 1, Username: "admin", Action: "login", Result: "success", IP: "127.0.0.1"})
	repo.Create(&AuditLog{UserID: 1, Username: "admin", Action: "logout", Result: "success", IP: "127.0.0.1"})

	filter := AuditFilter{Page: 1, PageSize: 10}
	logs, total, err := repo.List(filter)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)
	assert.Len(t, logs, 2)
}

func TestAuditLogRepo_List_WithFilters(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewAuditLogRepo()
	repo.Create(&AuditLog{UserID: 1, Username: "admin", Action: "login", Result: "success", IP: "127.0.0.1"})
	repo.Create(&AuditLog{UserID: 1, Username: "admin", Action: "logout", Result: "success", IP: "127.0.0.1"})
	repo.Create(&AuditLog{UserID: 2, Username: "user", Action: "login", Result: "failed", IP: "192.168.1.1"})

	// Filter by action
	filter := AuditFilter{Page: 1, PageSize: 10, Action: "login"}
	logs, total, err := repo.List(filter)
	assert.NoError(t, err)
	assert.Equal(t, int64(2), total)

	// Filter by user ID
	filter = AuditFilter{Page: 1, PageSize: 10, UserID: 2}
	logs, total, err = repo.List(filter)
	assert.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, "user", logs[0].Username)
}

// ============== BackupRepo Tests ==============

func TestBackupRepo_Create(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewBackupRepo()
	record := &BackupRecord{
		Filename: "backup_20260221.zip",
		FilePath: "/backups/backup_20260221.zip",
		FileSize: 1024,
		Trigger:  "manual",
		Note:     "Test backup",
	}

	err := repo.Create(record)
	assert.NoError(t, err)
	assert.NotZero(t, record.ID)
}

func TestBackupRepo_List(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewBackupRepo()
	repo.Create(&BackupRecord{Filename: "backup1.zip", FilePath: "/b1", FileSize: 100, Trigger: "manual"})
	repo.Create(&BackupRecord{Filename: "backup2.zip", FilePath: "/b2", FileSize: 200, Trigger: "auto"})

	records, err := repo.List()
	assert.NoError(t, err)
	assert.Len(t, records, 2)
}

func TestBackupRepo_FindByID(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewBackupRepo()
	record := &BackupRecord{Filename: "findme.zip", FilePath: "/findme", FileSize: 500, Trigger: "manual"}
	require.NoError(t, repo.Create(record))

	found, err := repo.FindByID(record.ID)
	assert.NoError(t, err)
	assert.Equal(t, "findme.zip", found.Filename)
}

func TestBackupRepo_Delete(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	repo := NewBackupRepo()
	record := &BackupRecord{Filename: "delete.zip", FilePath: "/delete", FileSize: 100, Trigger: "manual"}
	require.NoError(t, repo.Create(record))

	err := repo.Delete(record.ID)
	assert.NoError(t, err)

	_, err = repo.FindByID(record.ID)
	assert.Error(t, err, "record should be deleted")
}
