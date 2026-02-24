package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"ClawDeckX/internal/constants"
	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"

	"golang.org/x/crypto/bcrypt"
)

// UserHandler manages user CRUD operations.
type UserHandler struct {
	userRepo  *database.UserRepo
	auditRepo *database.AuditLogRepo
}

func NewUserHandler() *UserHandler {
	return &UserHandler{
		userRepo:  database.NewUserRepo(),
		auditRepo: database.NewAuditLogRepo(),
	}
}

// UserResponse is the user info response (no password).
type UserResponse struct {
	ID        uint   `json:"id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	CreatedAt string `json:"created_at"`
}

// List returns all users.
func (h *UserHandler) List(w http.ResponseWriter, r *http.Request) {
	users, err := h.userRepo.List()
	if err != nil {
		web.FailErr(w, r, web.ErrUserQueryFail)
		return
	}

	var resp []UserResponse
	for _, u := range users {
		resp = append(resp, UserResponse{
			ID:        u.ID,
			Username:  u.Username,
			Role:      u.Role,
			CreatedAt: u.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	web.OK(w, r, resp)
}

// Create creates a new user (admin only).
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
	if web.GetRole(r) != constants.RoleAdmin {
		web.FailErr(w, r, web.ErrForbidden)
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		web.FailErr(w, r, web.ErrInvalidBody)
		return
	}

	if req.Username == "" || len(req.Password) < 6 {
		web.FailErr(w, r, web.ErrEmptyCredentials)
		return
	}

	if req.Role == "" {
		req.Role = constants.RoleReadonly
	}

	if existing, _ := h.userRepo.FindByUsername(req.Username); existing != nil {
		web.FailErr(w, r, web.ErrUserExists)
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
		Role:         req.Role,
	}
	if err := h.userRepo.Create(user); err != nil {
		web.FailErr(w, r, web.ErrUserCreateFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionUserCreate,
		Result:   "success",
		Detail:   "created user: " + req.Username,
		IP:       r.RemoteAddr,
	})

	logger.Auth.Info().Str("username", req.Username).Str("role", req.Role).Msg("user created")
	web.OK(w, r, UserResponse{
		ID:        user.ID,
		Username:  user.Username,
		Role:      user.Role,
		CreatedAt: user.CreatedAt.Format("2006-01-02T15:04:05Z"),
	})
}

// Delete removes a user (admin only, cannot delete self).
func (h *UserHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if web.GetRole(r) != constants.RoleAdmin {
		web.FailErr(w, r, web.ErrForbidden)
		return
	}

	idStr := strings.TrimPrefix(r.URL.Path, "/api/v1/users/")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil || id == 0 {
		web.FailErr(w, r, web.ErrInvalidParam)
		return
	}

	if uint(id) == web.GetUserID(r) {
		web.FailErr(w, r, web.ErrUserSelfDelete)
		return
	}

	user, err := h.userRepo.FindByID(uint(id))
	if err != nil {
		web.FailErr(w, r, web.ErrUserNotFound)
		return
	}

	if err := h.userRepo.Delete(uint(id)); err != nil {
		web.FailErr(w, r, web.ErrUserDeleteFail)
		return
	}

	h.auditRepo.Create(&database.AuditLog{
		UserID:   web.GetUserID(r),
		Username: web.GetUsername(r),
		Action:   constants.ActionUserDelete,
		Result:   "success",
		Detail:   "deleted user: " + user.Username,
		IP:       r.RemoteAddr,
	})

	logger.Auth.Info().Str("username", user.Username).Msg("user deleted")
	web.OK(w, r, map[string]string{"message": "ok"})
}
