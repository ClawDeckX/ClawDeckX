package web

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "test-secret-key-for-unit-tests-32chars"

func TestGenerateJWT(t *testing.T) {
	token, expiresAt, err := GenerateJWT(1, "admin", "admin", testSecret, 24*time.Hour)

	assert.NoError(t, err)
	assert.NotEmpty(t, token)
	assert.True(t, expiresAt.After(time.Now()))
	assert.True(t, expiresAt.Before(time.Now().Add(25*time.Hour)))
}

func TestValidateJWT_Valid(t *testing.T) {
	token, _, err := GenerateJWT(1, "testuser", "user", testSecret, time.Hour)
	require.NoError(t, err)

	claims, err := ValidateJWT(token, testSecret)

	assert.NoError(t, err)
	assert.NotNil(t, claims)
	assert.Equal(t, uint(1), claims.UserID)
	assert.Equal(t, "testuser", claims.Username)
	assert.Equal(t, "user", claims.Role)
	assert.Equal(t, "ClawDeckX", claims.Issuer)
}

func TestValidateJWT_InvalidSecret(t *testing.T) {
	token, _, err := GenerateJWT(1, "testuser", "user", testSecret, time.Hour)
	require.NoError(t, err)

	claims, err := ValidateJWT(token, "wrong-secret")

	assert.Error(t, err)
	assert.Nil(t, claims)
}

func TestValidateJWT_Expired(t *testing.T) {
	// Generate a token that expires immediately
	token, _, err := GenerateJWT(1, "testuser", "user", testSecret, -time.Hour)
	require.NoError(t, err)

	claims, err := ValidateJWT(token, testSecret)

	assert.Error(t, err)
	assert.Nil(t, claims)
}

func TestValidateJWT_InvalidToken(t *testing.T) {
	claims, err := ValidateJWT("invalid.token.string", testSecret)

	assert.Error(t, err)
	assert.Nil(t, claims)
}

func TestValidateJWT_EmptyToken(t *testing.T) {
	claims, err := ValidateJWT("", testSecret)

	assert.Error(t, err)
	assert.Nil(t, claims)
}

func TestJWTClaims(t *testing.T) {
	claims := JWTClaims{
		UserID:   42,
		Username: "testuser",
		Role:     "admin",
	}

	assert.Equal(t, uint(42), claims.UserID)
	assert.Equal(t, "testuser", claims.Username)
	assert.Equal(t, "admin", claims.Role)
}

func TestGenerateJWT_DifferentExpiry(t *testing.T) {
	tests := []struct {
		name   string
		expiry time.Duration
	}{
		{"1 hour", time.Hour},
		{"24 hours", 24 * time.Hour},
		{"7 days", 7 * 24 * time.Hour},
		{"1 minute", time.Minute},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			token, expiresAt, err := GenerateJWT(1, "user", "user", testSecret, tt.expiry)

			assert.NoError(t, err)
			assert.NotEmpty(t, token)

			expectedExpiry := time.Now().Add(tt.expiry)
			assert.WithinDuration(t, expectedExpiry, expiresAt, 2*time.Second)
		})
	}
}
