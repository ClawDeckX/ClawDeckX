package diagnostics

import "ClawDeckX/internal/i18n"

type Issue struct {
	Level      string
	Message    string
	Suggestion string
}

type Report struct {
	Issues    []Issue
	HasErrors bool
}

func Run() Report {
	return Report{
		Issues: []Issue{
			{
				Level:      i18n.T(i18n.MsgDiagnosticsLevelWarning),
				Message:    i18n.T(i18n.MsgDiagnosticsGatewayStatusPlaceholder),
				Suggestion: i18n.T(i18n.MsgDiagnosticsImplementHealthCheck),
			},
		},
		HasErrors: false,
	}
}
