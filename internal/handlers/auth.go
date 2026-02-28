package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"
	"ClawDeckX/internal/webconfig"

	"golang.org/x/crypto/bcrypt"
)

const (
	maxFailedAttempts = 5
	lockDuration      = 15 * time.Minute
)

type AuthHandler struct {
	userRepo  *database.UserRepo
	auditRepo *database.AuditLogRepo
	cfg       *webconfig.Config
}

func NewAuthHandler(cfg *webconfig.Config) *AuthHandler {
	return &AuthHandler{
		userRepo:  database.NewUserRepo(),
		auditRepo: database.NewAuditLogRepo(),
		cfg:       cfg,
	}
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	Token     string        `json:"token"`
	ExpiresAt string        `json:"expires_at"`
	User      loginUserInfo `json:"user"`
}

type loginUserInfo struct {
	ID       uint   `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if req.Username == "" || req.Password == "" {
		web.FailErr(w, r, web.ErrEmptyCredentials)
		return
	}

	user, err := h.userRepo.FindByUsername(req.Username)
	if err != nil {
		h.auditRepo.Create(&database.AuditLog{
			Username: req.Username,
			Action:   constants.ActionLoginFailed,
			Result:   "failed",
			Detail:   "user not found",
			IP:       r.RemoteAddr,
		})
		logger.Auth.Warn().Str("username", req.Username).Str("ip", r.RemoteAddr).Msg("login failed: user not found")
		web.FailErr(w, r, web.ErrInvalidPassword)
		return
	}

	// Check lock
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now().UTC()) {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   user.ID,
			Username: user.Username,
			Action:   constants.ActionLoginFailed,
			Result:   "failed",
			Detail:   "account locked",
			IP:       r.RemoteAddr,
		})
		logger.Auth.Warn().Str("username", req.Username).Str("ip", r.RemoteAddr).Msg("login failed: account locked")
		web.FailErr(w, r, web.ErrAccountLocked)
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		h.userRepo.IncrementFailedAttempts(user.ID)
		h.auditRepo.Create(&database.AuditLog{
			UserID:   user.ID,
			Username: user.Username,
			Action:   constants.ActionLoginFailed,
			Result:   "failed",
			Detail:   "wrong password",
			IP:       r.RemoteAddr,
		})
		if user.FailedAttempts+1 >= maxFailedAttempts {
			lockUntil := time.Now().UTC().Add(lockDuration)
			h.userRepo.LockUntil(user.ID, lockUntil)
			h.auditRepo.Create(&database.AuditLog{
				UserID:   user.ID,
				Username: user.Username,
				Action:   constants.ActionAccountLocked,
				Result:   "locked",
				Detail:   "too many failed attempts",
				IP:       r.RemoteAddr,
			})
			logger.Auth.Warn().Str("username", req.Username).Str("ip", r.RemoteAddr).Msg("account locked")
		}
		logger.Auth.Warn().Str("username", req.Username).Str("ip", r.RemoteAddr).Msg("login failed: wrong password")
		web.FailErr(w, r, web.ErrInvalidPassword)
		return
	}

	// Reset failed attempts
	h.userRepo.ResetFailedAttempts(user.ID)

	// Generate JWT
	token, expiresAt, err := web.GenerateJWT(user.ID, user.Username, user.Role, h.cfg.Auth.JWTSecret, h.cfg.JWTExpireDuration())
	if err != nil {
		logger.Auth.Error().Err(err).Msg("JWT generation failed")
		web.FailErr(w, r, web.ErrLoginFailed)
		return
	}

	// Audit log
	h.auditRepo.Create(&database.AuditLog{
		UserID:   user.ID,
		Username: user.Username,
		Action:   constants.ActionLogin,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Auth.Info().Str("username", user.Username).Str("ip", r.RemoteAddr).Msg("user logged in")

	http.SetCookie(w, &http.Cookie{
		Name:     "claw_token",
		Value:    token,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		// Secure:   true, // TODO: Enable in production with HTTPS
	})

	web.OK(w, r, loginResponse{
		Token:     token,
		ExpiresAt: expiresAt.Format(time.RFC3339),
		User: loginUserInfo{
			ID:       user.ID,
			Username: user.Username,
			Role:     user.Role,
		},
	})
}

type setupRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (h *AuthHandler) Setup(w http.ResponseWriter, r *http.Request) {
	// Only allow setup if no users exist
	count, err := h.userRepo.Count()
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery)
		return
	}
	if count > 0 {
		web.FailErr(w, r, web.ErrSetupDone)
		return
	}

	var req setupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if req.Username == "" || len(req.Password) < 6 {
		web.FailErr(w, r, web.ErrEmptyCredentials)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		web.FailErr(w, r, web.ErrEncrypt)
		return
	}

	user := &database.User{
		Username:     req.Username,
		PasswordHash: string(hash),
		Role:         constants.RoleAdmin,
	}
	if err := h.userRepo.Create(user); err != nil {
		web.FailErr(w, r, web.ErrUserCreateFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   user.ID,
		Username: user.Username,
		Action:   constants.ActionSetup,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Auth.Info().Str("username", user.Username).Msg("admin account created")
	web.OK(w, r, map[string]string{"message": "ok"})
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if len(req.NewPassword) < 6 {
		web.FailErr(w, r, web.ErrPasswordTooShort)
		return
	}

	userID := web.GetUserID(r)
	user, err := h.userRepo.FindByID(userID)
	if err != nil {
		web.FailErr(w, r, web.ErrUserNotFound)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.OldPassword)); err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   user.ID,
			Username: user.Username,
			Action:   constants.ActionPasswordChange,
			Result:   "failed",
			Detail:   "wrong old password",
			IP:       r.RemoteAddr,
		})
		web.FailErr(w, r, web.ErrOldPasswordWrong)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		web.FailErr(w, r, web.ErrEncrypt)
		return
	}

	h.userRepo.UpdatePassword(user.ID, string(hash))

	h.auditRepo.Create(&database.AuditLog{
		UserID:   user.ID,
		Username: user.Username,
		Action:   constants.ActionPasswordChange,
		Result:   "success",
		IP:       r.RemoteAddr,
	})

	logger.Auth.Info().Str("username", user.Username).Msg("password changed")
	web.OK(w, r, map[string]string{"message": "ok"})
}

func (h *AuthHandler) ChangeUsername(w http.ResponseWriter, r *http.Request) {
	var req struct {
		NewUsername string `json:"new_username"`
		Password    string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}
	if len(req.NewUsername) < 3 {
		web.Fail(w, r, "USERNAME_TOO_SHORT", i18n.T(i18n.MsgAuthUsernameTooShort), http.StatusBadRequest)
		return
	}

	userID := web.GetUserID(r)
	user, err := h.userRepo.FindByID(userID)
	if err != nil {
		web.FailErr(w, r, web.ErrUserNotFound)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		h.auditRepo.Create(&database.AuditLog{
			UserID:   user.ID,
			Username: user.Username,
			Action:   "username_change",
			Result:   "failed",
			Detail:   "wrong password",
			IP:       r.RemoteAddr,
		})
		web.FailErr(w, r, web.ErrInvalidPassword)
		return
	}

	if existing, _ := h.userRepo.FindByUsername(req.NewUsername); existing != nil && existing.ID != user.ID {
		web.Fail(w, r, "USERNAME_EXISTS", i18n.T(i18n.MsgAuthUsernameExists), http.StatusBadRequest)
		return
	}

	oldUsername := user.Username
	h.userRepo.UpdateUsername(user.ID, req.NewUsername)

	h.auditRepo.Create(&database.AuditLog{
		UserID:   user.ID,
		Username: req.NewUsername,
		Action:   "username_change",
		Result:   "success",
		Detail:   oldUsername + " -> " + req.NewUsername,
		IP:       r.RemoteAddr,
	})

	logger.Auth.Info().Str("old", oldUsername).Str("new", req.NewUsername).Msg("username changed")
	web.OK(w, r, map[string]string{"message": "ok"})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID := web.GetUserID(r)
	user, err := h.userRepo.FindByID(userID)
	if err != nil {
		web.FailErr(w, r, web.ErrUserNotFound)
		return
	}
	web.OK(w, r, map[string]interface{}{
		"id":       user.ID,
		"username": user.Username,
		"role":     user.Role,
	})
}

func (h *AuthHandler) NeedsSetup(w http.ResponseWriter, r *http.Request) {
	count, err := h.userRepo.Count()
	if err != nil {
		web.FailErr(w, r, web.ErrDBQuery)
		return
	}
	resp := map[string]interface{}{
		"needs_setup": count == 0,
	}
	if count > 0 {
		resp["login_hint"] = h.userRepo.FirstUsername()
	}
	web.OK(w, r, resp)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionLogout,
		Result:   "success",
		IP:       r.RemoteAddr,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "claw_token",
		Value:    "",
		Path:     "/",
		Expires:  time.Now().Add(-1 * time.Hour),
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
	})
	web.OK(w, r, map[string]string{"message": "logged out"})
}
