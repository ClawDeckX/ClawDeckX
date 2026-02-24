package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"ClawDeckX/internal/logger"
	"ClawDeckX/internal/web"
)

// SkillsHandler manages skill auditing.
type SkillsHandler struct{}

func NewSkillsHandler() *SkillsHandler {
	return &SkillsHandler{}
}

// SkillInfo represents installed skill metadata.
type SkillInfo struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Description string `json:"description,omitempty"`
	Risk        string `json:"risk"`
	FileCount   int    `json:"file_count"`
}

// List returns installed skills.
func (h *SkillsHandler) List(w http.ResponseWriter, r *http.Request) {
	home, err := os.UserHomeDir()
	if err != nil {
		web.FailErr(w, r, web.ErrSkillsPathError)
		return
	}

	skillsDir := filepath.Join(home, ".openclaw", "skills")
	entries, err := os.ReadDir(skillsDir)
	if err != nil {
		if os.IsNotExist(err) {
			web.OK(w, r, []SkillInfo{})
			return
		}
		web.FailErr(w, r, web.ErrSkillsReadFail)
		return
	}

	var skills []SkillInfo
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		skillPath := filepath.Join(skillsDir, entry.Name())
		skill := SkillInfo{
			Name: entry.Name(),
			Path: skillPath,
			Risk: "low",
		}

		// read skill description
		descFile := filepath.Join(skillPath, "skill.json")
		if data, err := os.ReadFile(descFile); err == nil {
			var meta map[string]interface{}
			if json.Unmarshal(data, &meta) == nil {
				if desc, ok := meta["description"].(string); ok {
					skill.Description = desc
				}
			}
		}

		// count files
		fileCount := 0
		filepath.Walk(skillPath, func(path string, info os.FileInfo, err error) error {
			if err == nil && !info.IsDir() {
				fileCount++
			}
			return nil
		})
		skill.FileCount = fileCount

		// simple risk assessment
		skill.Risk = h.assessSkillRisk(skillPath)

		skills = append(skills, skill)
	}

	if skills == nil {
		skills = []SkillInfo{}
	}

	web.OK(w, r, skills)
}

// assessSkillRisk assesses the risk level of a skill.
func (h *SkillsHandler) assessSkillRisk(skillPath string) string {
	risk := "low"

	filepath.Walk(skillPath, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}

		// check for executable scripts
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".sh" || ext == ".py" || ext == ".js" || ext == ".bat" || ext == ".ps1" {
			risk = "medium"
		}

		// check file content for high-risk patterns
		if info.Size() < 1024*100 { // only check files < 100KB
			if data, err := os.ReadFile(path); err == nil {
				content := strings.ToLower(string(data))
				highRiskPatterns := []string{
					"eval(", "exec(", "subprocess", "os.system",
					"child_process", "curl ", "wget ",
					"/etc/passwd", "api_key", "secret",
				}
				for _, p := range highRiskPatterns {
					if strings.Contains(content, p) {
						risk = "high"
						return filepath.SkipAll
					}
				}
			}
		}
		return nil
	})

	logger.Security.Debug().Str("skill", filepath.Base(skillPath)).Str("risk", risk).Msg("skill risk assessed")
	return risk
}
