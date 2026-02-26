package monitor

import (
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"
)

// Service 监控服务，定时扫描 session 文件并推送新事件
type Service struct {
	parser       *SessionParser
	activityRepo *database.ActivityRepo
	wsHub        *web.WSHub
	interval     time.Duration
	stopCh       chan struct{}
	running      bool
}

func NewService(openclawDir string, wsHub *web.WSHub, intervalSec int) *Service {
	return &Service{
		parser:       NewSessionParser(openclawDir),
		activityRepo: database.NewActivityRepo(),
		wsHub:        wsHub,
		interval:     time.Duration(intervalSec) * time.Second,
		stopCh:       make(chan struct{}),
	}
}

// IsRunning 是否正在运行
func (s *Service) IsRunning() bool {
	return s.running
}

// Start 启动监控循环
func (s *Service) Start() {
	s.running = true
	logger.Monitor.Info().
		Dur("interval", s.interval).
		Msg("监控服务已启动")

	// 首次立即扫描
	s.scan()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.scan()
		case <-s.stopCh:
			s.running = false
			logger.Monitor.Info().Msg("监控服务已停止")
			return
		}
	}
}

// Stop 停止监控循环
func (s *Service) Stop() {
	if s.running {
		close(s.stopCh)
		s.stopCh = make(chan struct{})
	}
}

// scan 执行一次扫描
func (s *Service) scan() {
	events, err := s.parser.ReadNewEvents()
	if err != nil {
		logger.Monitor.Error().Err(err).Msg("扫描 session 文件失败")
		return
	}

	if len(events) == 0 {
		return
	}

	logger.Monitor.Debug().Int("count", len(events)).Msg("发现新事件")

	for _, evt := range events {
		actionTaken := "allow"
		risk := evt.Risk

		// 写入数据库
		activity := &database.Activity{
			EventID:     evt.EventID,
			Timestamp:   evt.Timestamp,
			Category:    evt.Category,
			Risk:        risk,
			Summary:     evt.Summary,
			Detail:      evt.Detail,
			Source:      evt.Source,
			ActionTaken: actionTaken,
			SessionID:   evt.SessionID,
		}

		if err := s.activityRepo.Create(activity); err != nil {
			logger.Monitor.Warn().Str("event_id", evt.EventID).Err(err).Msg("写入活动记录失败")
			continue
		}

		// 通过 WebSocket 推送给前端
		s.wsHub.Broadcast("activity", "activity", map[string]interface{}{
			"event_id":     evt.EventID,
			"timestamp":    evt.Timestamp.Format(time.RFC3339),
			"category":     evt.Category,
			"risk":         risk,
			"summary":      evt.Summary,
			"source":       evt.Source,
			"action_taken": actionTaken,
		})
	}
}
