package monitor

import (
	"time"

	"ClawDeckX/internal/database"
	"ClawDeckX/internal/i18n"
	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"
)

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

func (s *Service) IsRunning() bool {
	return s.running
}

func (s *Service) Start() {
	s.running = true
	logger.Monitor.Info().
		Dur("interval", s.interval).
		Msg(i18n.T(i18n.MsgLogMonitorStarted))

	s.scan()

	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.scan()
		case <-s.stopCh:
			s.running = false
			logger.Monitor.Info().Msg(i18n.T(i18n.MsgLogMonitorStopped))
			return
		}
	}
}

func (s *Service) Stop() {
	if s.running {
		close(s.stopCh)
		s.stopCh = make(chan struct{})
	}
}

func (s *Service) scan() {
	events, err := s.parser.ReadNewEvents()
	if err != nil {
		logger.Monitor.Error().Err(err).Msg(i18n.T(i18n.MsgLogMonitorScanFailed))
		return
	}

	if len(events) == 0 {
		return
	}

	logger.Monitor.Debug().Int("count", len(events)).Msg(i18n.T(i18n.MsgLogMonitorNewEvents))

	for _, evt := range events {
		actionTaken := "allow"
		risk := evt.Risk

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
			logger.Monitor.Warn().Str("event_id", evt.EventID).Err(err).Msg(i18n.T(i18n.MsgLogMonitorActivityWriteFailed))
			continue
		}

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
