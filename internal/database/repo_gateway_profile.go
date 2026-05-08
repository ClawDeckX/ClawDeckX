package database

import (
	"time"

	"gorm.io/gorm"
)

type GatewayProfile struct {
	ID        uint           `gorm:"primarykey" json:"id"`
	Name      string         `gorm:"size:100;not null" json:"name"`
	Host      string         `gorm:"size:255;not null" json:"host"`
	Port      int            `gorm:"not null;default:18789" json:"port"`
	Path      string         `gorm:"size:255;default:'/'" json:"path"`
	Token     string         `gorm:"size:512" json:"token"`
	IsActive  bool           `gorm:"default:false" json:"is_active"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type GatewayProfileRepo struct {
	db *gorm.DB
}

func NewGatewayProfileRepo() *GatewayProfileRepo {
	return &GatewayProfileRepo{db: DB}
}

func (r *GatewayProfileRepo) List() ([]GatewayProfile, error) {
	var list []GatewayProfile
	if err := r.db.Order("is_active desc, updated_at desc").Find(&list).Error; err != nil {
		return nil, err
	}
	for i := range list {
		token, err := decryptStoredValue(list[i].Token)
		if err != nil {
			return nil, err
		}
		list[i].Token = token
	}
	return list, nil
}

func (r *GatewayProfileRepo) GetByID(id uint) (*GatewayProfile, error) {
	var p GatewayProfile
	if err := r.db.First(&p, id).Error; err != nil {
		return nil, err
	}
	token, err := decryptStoredValue(p.Token)
	if err != nil {
		return nil, err
	}
	p.Token = token
	return &p, nil
}

func (r *GatewayProfileRepo) GetActive() (*GatewayProfile, error) {
	var p GatewayProfile
	if err := r.db.Where("is_active = ?", true).First(&p).Error; err != nil {
		return nil, err
	}
	token, err := decryptStoredValue(p.Token)
	if err != nil {
		return nil, err
	}
	p.Token = token
	return &p, nil
}

func (r *GatewayProfileRepo) Create(p *GatewayProfile) error {
	stored := *p
	token, err := encryptStoredValue(stored.Token)
	if err != nil {
		return err
	}
	stored.Token = token
	if err := r.db.Create(&stored).Error; err != nil {
		return err
	}
	p.ID = stored.ID
	p.CreatedAt = stored.CreatedAt
	p.UpdatedAt = stored.UpdatedAt
	return nil
}

func (r *GatewayProfileRepo) Update(p *GatewayProfile) error {
	stored := *p
	token, err := encryptStoredValue(stored.Token)
	if err != nil {
		return err
	}
	stored.Token = token
	if err := r.db.Save(&stored).Error; err != nil {
		return err
	}
	p.UpdatedAt = stored.UpdatedAt
	return nil
}

func (r *GatewayProfileRepo) Delete(id uint) error {
	return r.db.Delete(&GatewayProfile{}, id).Error
}

func (r *GatewayProfileRepo) SetActive(id uint) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&GatewayProfile{}).Where("is_active = ?", true).Update("is_active", false).Error; err != nil {
			return err
		}
		return tx.Model(&GatewayProfile{}).Where("id = ?", id).Update("is_active", true).Error
	})
}
