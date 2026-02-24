package database

import (
	"time"

	"gorm.io/gorm"
)

type UserRepo struct {
	db *gorm.DB
}

func NewUserRepo() *UserRepo {
	return &UserRepo{db: DB}
}

func (r *UserRepo) Create(user *User) error {
	return r.db.Create(user).Error
}

func (r *UserRepo) FindByUsername(username string) (*User, error) {
	var user User
	err := r.db.Where("username = ?", username).First(&user).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepo) FindByID(id uint) (*User, error) {
	var user User
	err := r.db.First(&user, id).Error
	if err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *UserRepo) UpdatePassword(id uint, hash string) error {
	return r.db.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
		"password_hash":   hash,
		"failed_attempts": 0,
		"locked_until":    nil,
	}).Error
}

func (r *UserRepo) IncrementFailedAttempts(id uint) error {
	return r.db.Model(&User{}).Where("id = ?", id).
		Update("failed_attempts", gorm.Expr("failed_attempts + 1")).Error
}

func (r *UserRepo) ResetFailedAttempts(id uint) error {
	return r.db.Model(&User{}).Where("id = ?", id).Updates(map[string]interface{}{
		"failed_attempts": 0,
		"locked_until":    nil,
	}).Error
}

func (r *UserRepo) LockUntil(id uint, until time.Time) error {
	return r.db.Model(&User{}).Where("id = ?", id).Update("locked_until", until).Error
}

func (r *UserRepo) Count() (int64, error) {
	var count int64
	err := r.db.Model(&User{}).Count(&count).Error
	return count, err
}

func (r *UserRepo) List() ([]User, error) {
	var users []User
	err := r.db.Find(&users).Error
	return users, err
}

// FirstUsername returns the username of the first user (for login hint).
func (r *UserRepo) FirstUsername() string {
	var user User
	if err := r.db.Select("username").First(&user).Error; err != nil {
		return ""
	}
	return user.Username
}

// UpdateUsername 更新用户名
func (r *UserRepo) UpdateUsername(id uint, username string) error {
	return r.db.Model(&User{}).Where("id = ?", id).Update("username", username).Error
}

// Delete 删除用户
func (r *UserRepo) Delete(id uint) error {
	return r.db.Delete(&User{}, id).Error
}
