package diagnostics

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
				Level:      "警告",
				Message:    "网关状态未检查（占位）",
				Suggestion: "实现网关健康检查",
			},
		},
		HasErrors: false,
	}
}
