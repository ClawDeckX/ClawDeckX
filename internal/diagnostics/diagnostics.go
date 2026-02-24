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
	// 占位报告，后续补充配置与环境检查。
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
