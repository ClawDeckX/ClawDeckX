package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/webconfig"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
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
		&database.User{},
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

func testConfig() *webconfig.Config {
	return &webconfig.Config{
		Auth: webconfig.AuthConfig{
			JWTSecret: "test-secret-key-for-unit-tests-32chars",
			JWTExpire: "24h",
		},
	}
}

func createTestUser(t *testing.T, username, password string) *database.User {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	require.NoError(t, err)

	user := &database.User{
		Username:     username,
		PasswordHash: string(hash),
		Role:         "admin",
	}
	err = database.NewUserRepo().Create(user)
	require.NoError(t, err)
	return user
}

// ============== Login Tests ==============

func TestLogin_Success(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	createTestUser(t, "admin", "password123")

	handler := NewAuthHandler(testConfig())

	body := `{"username":"admin","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Login(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	err := json.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)

	assert.True(t, resp["success"].(bool))
	data := resp["data"].(map[string]interface{})
	assert.NotEmpty(t, data["token"])
	assert.NotEmpty(t, data["expires_at"])

	user := data["user"].(map[string]interface{})
	assert.Equal(t, "admin", user["username"])
}

func TestLogin_WrongPassword(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	createTestUser(t, "admin", "password123")

	handler := NewAuthHandler(testConfig())

	body := `{"username":"admin","password":"wrongpassword"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Login(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.False(t, resp["success"].(bool))
}

func TestLogin_UserNotFound(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	handler := NewAuthHandler(testConfig())

	body := `{"username":"nonexistent","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Login(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestLogin_EmptyCredentials(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	handler := NewAuthHandler(testConfig())

	body := `{"username":"","password":""}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Login(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestLogin_AccountLocked(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	user := createTestUser(t, "locked", "password123")

	// Lock the account
	lockUntil := time.Now().Add(time.Hour)
	database.NewUserRepo().LockUntil(user.ID, lockUntil)

	handler := NewAuthHandler(testConfig())

	body := `{"username":"locked","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Login(w, req)

	assert.Equal(t, 423, w.Code) // 423 Locked

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "AUTH_ACCOUNT_LOCKED", resp["error_code"])
}

func TestLogin_FailedAttemptsLock(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	createTestUser(t, "lockme", "password123")

	handler := NewAuthHandler(testConfig())

	// Try wrong password 5 times
	for i := 0; i < 5; i++ {
		body := `{"username":"lockme","password":"wrongpassword"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.Login(w, req)
	}

	// Now try with correct password - should be locked
	body := `{"username":"lockme","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Login(w, req)

	assert.Equal(t, 423, w.Code) // 423 Locked
}

// ============== Setup Tests ==============

func TestSetup_Success(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	handler := NewAuthHandler(testConfig())

	body := `{"username":"newadmin","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Setup(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Verify user was created
	user, err := database.NewUserRepo().FindByUsername("newadmin")
	assert.NoError(t, err)
	assert.Equal(t, "newadmin", user.Username)
}

func TestSetup_AlreadyDone(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	createTestUser(t, "existing", "password123")

	handler := NewAuthHandler(testConfig())

	body := `{"username":"newadmin","password":"password123"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Setup(w, req)

	assert.Equal(t, 409, w.Code) // 409 Conflict

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	assert.Equal(t, "AUTH_SETUP_DONE", resp["error_code"])
}

func TestSetup_PasswordTooShort(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	handler := NewAuthHandler(testConfig())

	body := `{"username":"admin","password":"12345"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/setup", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	handler.Setup(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// ============== NeedsSetup Tests ==============

func TestNeedsSetup_True(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	handler := NewAuthHandler(testConfig())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/needs-setup", nil)
	w := httptest.NewRecorder()

	handler.NeedsSetup(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})
	assert.True(t, data["needs_setup"].(bool))
}

func TestNeedsSetup_False(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	createTestUser(t, "admin", "password123")

	handler := NewAuthHandler(testConfig())

	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/needs-setup", nil)
	w := httptest.NewRecorder()

	handler.NeedsSetup(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})
	assert.False(t, data["needs_setup"].(bool))
	assert.Equal(t, "admin", data["login_hint"])
}

// ============== Logout Tests ==============

func TestLogout(t *testing.T) {
	cleanup := setupTestDB(t)
	defer cleanup()

	createTestUser(t, "admin", "password123")

	handler := NewAuthHandler(testConfig())

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	w := httptest.NewRecorder()

	handler.Logout(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	// Check cookie is cleared
	cookies := w.Result().Cookies()
	var found bool
	for _, c := range cookies {
		if c.Name == "claw_token" {
			found = true
			assert.Equal(t, "", c.Value)
			assert.True(t, c.MaxAge < 0)
		}
	}
	assert.True(t, found, "claw_token cookie should be set")
}
