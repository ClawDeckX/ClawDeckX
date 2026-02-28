package setup

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"time"
)

type VerifyResult struct {
	OpenClawInstalled  bool     `json:"openClawInstalled"`
	OpenClawVersion    string   `json:"openClawVersion,omitempty"`
	OpenClawConfigured bool     `json:"openClawConfigured"`
	GatewayRunning     bool     `json:"gatewayRunning"`
	GatewayPort        int      `json:"gatewayPort,omitempty"`
	GatewayHealthy     bool     `json:"gatewayHealthy"`
	DoctorPassed       bool     `json:"doctorPassed"`
	DoctorOutput       string   `json:"doctorOutput,omitempty"`
	AllPassed          bool     `json:"allPassed"`
	Errors             []string `json:"errors,omitempty"`
}

type Verifier struct {
	emitter *EventEmitter
}

func NewVerifier(emitter *EventEmitter) *Verifier {
	return &Verifier{
		emitter: emitter,
	}
}

func (v *Verifier) Verify(ctx context.Context) (*VerifyResult, error) {
	result := &VerifyResult{
		Errors: []string{},
	}

	if v.emitter != nil {
		v.emitter.EmitStep("verify", "check-install", "检查 OpenClaw 安装...", 10)
	}

	if info := detectTool("openclaw", "--version"); info.Installed {
		result.OpenClawInstalled = true
		result.OpenClawVersion = info.Version
	} else {
		result.Errors = append(result.Errors, "OpenClaw 未安装")
	}

	if v.emitter != nil {
		v.emitter.EmitStep("verify", "check-config", "检查配置...", 30)
	}

	configPath := GetOpenClawConfigPath()
	result.OpenClawConfigured = checkOpenClawConfigured(configPath)
	if !result.OpenClawConfigured {
		result.Errors = append(result.Errors, "OpenClaw 未配置")
	}

	if v.emitter != nil {
		v.emitter.EmitStep("verify", "check-gateway", "检查 Gateway...", 50)
	}

	result.GatewayRunning, result.GatewayPort = checkGatewayRunning()
	if !result.GatewayRunning {
		result.Errors = append(result.Errors, "Gateway 未运行")
	}

	if result.GatewayRunning {
		if v.emitter != nil {
			v.emitter.EmitStep("verify", "health-check", "Gateway 健康检查...", 70)
		}
		result.GatewayHealthy = v.healthCheck(result.GatewayPort)
		if !result.GatewayHealthy {
			result.Errors = append(result.Errors, "Gateway 健康检查失败")
		}
	}

	if result.OpenClawInstalled {
		if v.emitter != nil {
			v.emitter.EmitStep("verify", "doctor", "运行诊断...", 90)
		}
		doctorResult := v.runDoctor(ctx)
		result.DoctorPassed = doctorResult.Success
		result.DoctorOutput = doctorResult.Output
		if !result.DoctorPassed && doctorResult.Error != "" {
			result.Errors = append(result.Errors, fmt.Sprintf("诊断失败: %s", doctorResult.Error))
		}
	}

	result.AllPassed = result.OpenClawInstalled &&
		result.OpenClawConfigured &&
		result.GatewayRunning &&
		result.GatewayHealthy

	return result, nil
}

func (v *Verifier) healthCheck(port int) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)

	resp, err := client.Get(url)
	if err != nil {
		url = fmt.Sprintf("http://127.0.0.1:%d/", port)
		resp, err = client.Get(url)
		if err != nil {
			return false
		}
	}
	defer resp.Body.Close()

	return resp.StatusCode < 500
}

func (v *Verifier) runDoctor(ctx context.Context) *DoctorResult {
	result := &DoctorResult{}

	cmd := exec.CommandContext(ctx, "openclaw", "doctor")
	output, err := cmd.CombinedOutput()

	result.Output = string(output)
	if err != nil {
		result.Success = false
		result.Error = err.Error()
	} else {
		result.Success = true
	}

	return result
}

func QuickCheck() *VerifyResult {
	result := &VerifyResult{
		Errors: []string{},
	}

	if info := detectTool("openclaw", "--version"); info.Installed {
		result.OpenClawInstalled = true
		result.OpenClawVersion = info.Version
	}

	result.OpenClawConfigured = checkOpenClawConfigured(GetOpenClawConfigPath())

	result.GatewayRunning, result.GatewayPort = checkGatewayRunning()

	if result.GatewayRunning {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", result.GatewayPort), time.Second)
		if err == nil {
			conn.Close()
			result.GatewayHealthy = true
		}
	}

	result.AllPassed = result.OpenClawInstalled &&
		result.OpenClawConfigured &&
		result.GatewayRunning

	return result
}
