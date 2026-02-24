package database

import (
	"time"

	"gorm.io/gorm"
)

// GatewayProfile 网关配置档案（支持多网关管理）
type GatewayProfile struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	Name      string         `gorm:"size:100;not null" json:"name"`
	Host      string         `gorm:"size:255;not null" json:"host"`
	Port      int            `gorm:"not null;default:18789" json:"port"`
	Token     string         `gorm:"size:512" json:"token"`
	IsActive  bool           `gorm:"default:false" json:"is_active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

// GatewayProfileRepo 网关配置档案仓库
type GatewayProfileRepo struct {
	db *gorm.DB
}

func NewGatewayProfileRepo() *GatewayProfileRepo {
	return &GatewayProfileRepo{db: DB}
}

// List 获取所有网关配置
func (r *GatewayProfileRepo) List() ([]GatewayProfile, error) {
	var list []GatewayProfile
	err := r.db.Order("is_active desc, updated_at desc").Find(&list).Error
	return list, err
}

// GetByID 根据 ID 获取
func (r *GatewayProfileRepo) GetByID(id uint) (*GatewayProfile, error) {
	var p GatewayProfile
	err := r.db.First(&p, id).Error
	return &p, err
}

// GetActive 获取当前活跃的网关配置
func (r *GatewayProfileRepo) GetActive() (*GatewayProfile, error) {
	var p GatewayProfile
	err := r.db.Where("is_active = ?", true).First(&p).Error
	return &p, err
}

// Create 创建网关配置
func (r *GatewayProfileRepo) Create(p *GatewayProfile) error {
	return r.db.Create(p).Error
}

// Update 更新网关配置
func (r *GatewayProfileRepo) Update(p *GatewayProfile) error {
	return r.db.Save(p).Error
}

// Delete 删除网关配置
func (r *GatewayProfileRepo) Delete(id uint) error {
	return r.db.Delete(&GatewayProfile{}, id).Error
}

// SetActive 设置指定网关为活跃，其余全部取消活跃
func (r *GatewayProfileRepo) SetActive(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		// 先全部取消
		if err := tx.Model(&GatewayProfile{}).Where("is_active = ?", true).Update("is_active", false).Error; err != nil {
			return err
		}
		// 设置目标为活跃
		return tx.Model(&GatewayProfile{}).Where("id = ?", id).Update("is_active", true).Error
	})
}
