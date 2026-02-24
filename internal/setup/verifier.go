package setup

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os/exec"
	"time"
)

// VerifyResult 验证结果
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

// Verifier 安装验证器
type Verifier struct {
	emitter *EventEmitter
}

// NewVerifier 创建验证器
func NewVerifier(emitter *EventEmitter) *Verifier {
	return &Verifier{
		emitter: emitter,
	}
}

// Verify 执行完整验证
func (v *Verifier) Verify(ctx context.Context) (*VerifyResult, error) {
	result := &VerifyResult{
		Errors: []string{},
	}

	// 1. 检查 OpenClaw 安装
	if v.emitter != nil {
		v.emitter.EmitStep("verify", "check-install", "检查 OpenClaw 安装...", 10)
	}

	if info := detectTool("openclaw", "--version"); info.Installed {
		result.OpenClawInstalled = true
		result.OpenClawVersion = info.Version
	} else {
		result.Errors = append(result.Errors, "OpenClaw 未安装")
	}

	// 2. 检查配置
	if v.emitter != nil {
		v.emitter.EmitStep("verify", "check-config", "检查配置...", 30)
	}

	configPath := GetOpenClawConfigPath()
	result.OpenClawConfigured = checkOpenClawConfigured(configPath)
	if !result.OpenClawConfigured {
		result.Errors = append(result.Errors, "OpenClaw 未配置")
	}

	// 3. 检查 Gateway
	if v.emitter != nil {
		v.emitter.EmitStep("verify", "check-gateway", "检查 Gateway...", 50)
	}

	result.GatewayRunning, result.GatewayPort = checkGatewayRunning()
	if !result.GatewayRunning {
		result.Errors = append(result.Errors, "Gateway 未运行")
	}

	// 4. Gateway 健康检查
	if result.GatewayRunning {
		if v.emitter != nil {
			v.emitter.EmitStep("verify", "health-check", "Gateway 健康检查...", 70)
		}
		result.GatewayHealthy = v.healthCheck(result.GatewayPort)
		if !result.GatewayHealthy {
			result.Errors = append(result.Errors, "Gateway 健康检查失败")
		}
	}

	// 5. 运行 doctor
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

	// 综合判断
	result.AllPassed = result.OpenClawInstalled &&
		result.OpenClawConfigured &&
		result.GatewayRunning &&
		result.GatewayHealthy

	return result, nil
}

// healthCheck 执行 Gateway 健康检查
func (v *Verifier) healthCheck(port int) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)

	resp, err := client.Get(url)
	if err != nil {
		// 尝试根路径
		url = fmt.Sprintf("http://127.0.0.1:%d/", port)
		resp, err = client.Get(url)
		if err != nil {
			return false
		}
	}
	defer resp.Body.Close()

	return resp.StatusCode < 500
}

// runDoctor 运行 openclaw doctor
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

// QuickCheck 快速检查（不运行 doctor）
func QuickCheck() *VerifyResult {
	result := &VerifyResult{
		Errors: []string{},
	}

	// OpenClaw 安装状态
	if info := detectTool("openclaw", "--version"); info.Installed {
		result.OpenClawInstalled = true
		result.OpenClawVersion = info.Version
	}

	// 配置状态
	result.OpenClawConfigured = checkOpenClawConfigured(GetOpenClawConfigPath())

	// Gateway 状态
	result.GatewayRunning, result.GatewayPort = checkGatewayRunning()

	// 简单健康检查
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
